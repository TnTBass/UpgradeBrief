import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

const site = '0ae1a9cd-b5fc-4966-8c43-1bb3b743bf0f'
const origin = 'https://upgradebrief.com'
const payload = {
  website: site, hostname: 'upgradebrief.com', url: '/?utm_source=test',
  name: 'details_opened', data: { product: 'vbr', release: '12.0', topic: 'security_advisories' },
}
const env = { ASSETS: { fetch: vi.fn(async () => new Response('SPA asset')) } }
const send = (body: unknown = { type: 'event', payload }, headers: Record<string, string> = {}, host = origin) =>
  new Request(host + '/api/send', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: host, 'cf-connecting-ip': '192.0.2.4', 'user-agent': 'test-browser', ...headers },
  })

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('same-origin Umami proxy', () => {
  it('proxies only the fixed tracker URL and caches the script briefly', async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response('window.umami = {}'))
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(new Request(origin + '/stats.js?target=https://other.invalid'), env)
    expect(fetch.mock.calls[0][0]).toBe('https://cloud.umami.is/script.js')
    expect(await response.text()).toBe('window.umami = {}')
    expect(response.headers.get('content-type')).toContain('application/javascript')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    const head = await worker.fetch(new Request(origin + '/stats.js', { method: 'HEAD' }), env)
    expect(await head.text()).toBe('')
  })

  it('preserves event context and session tokens, replacing spoofed visitor identity with edge headers', async () => {
    const reply = { cache: 'next-token', sessionId: 'session', visitId: 'visit' }
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json', 'set-cookie': 'unwanted=1' } }))
    vi.stubGlobal('fetch', fetch)
    const response = await worker.fetch(send(
      { type: 'event', payload: { ...payload, ip: 'spoofed', userAgent: 'spoofed' } },
      { 'x-umami-cache': 'previous-token', cookie: 'private=1', authorization: 'private', 'x-forwarded-for': 'spoofed' },
    ), env)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://gateway.umami.is/api/send')
    expect(init?.redirect).toBe('manual')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-umami-cache')).toBe('previous-token')
    expect(headers.get('x-forwarded-for')).toBe('192.0.2.4')
    expect(headers.get('user-agent')).toBe('test-browser')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(JSON.parse(init?.body as string)).toEqual({
      type: 'event', payload: { ...payload, ip: '192.0.2.4', userAgent: 'test-browser' },
    })
    expect(await response.json()).toEqual(reply)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('uses the original IPv6 address when Cloudflare pseudo IPv4 is enabled', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await worker.fetch(send(undefined, { 'cf-connecting-ipv6': '2001:db8::4' }), env)
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).payload.ip).toBe('2001:db8::4')
  })

  it.each([
    ['cross-site origin', send(undefined, { origin: 'https://other.invalid' }), 403],
    ['missing origin', send(undefined, { origin: '' }), 403],
    ['preview domain', send(undefined, {}, 'https://preview.workers.dev'), 403],
    ['different website', send({ type: 'event', payload: { ...payload, website: 'other' } }), 400],
    ['different hostname', send({ type: 'event', payload: { ...payload, hostname: 'other.invalid' } }), 400],
    ['unexpected event type', send({ type: 'identify', payload }), 400],
    ['non-JSON', send(undefined, { 'content-type': 'text/plain' }), 415],
    ['missing visitor IP', send(undefined, { 'cf-connecting-ip': '' }), 503],
    ['oversized body', send({ type: 'event', payload: { ...payload, data: 'x'.repeat(17000) } }), 413],
    ['declared oversized body', send(undefined, { 'content-length': '99999' }), 413],
    ['malformed JSON', new Request(origin + '/api/send', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' }), 400],
  ])('rejects %s without contacting Umami', async (_name, request, status) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await worker.fetch(request, env)).status).toBe(status)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps failures and bot filtering observable without caching or retrying', async () => {
    const fetch = vi.fn(async () => new Response('{"beep":"boop"}'))
    vi.stubGlobal('fetch', fetch)
    const bot = await worker.fetch(send(), env)
    expect(await bot.json()).toEqual({ beep: 'boop' })
    fetch.mockResolvedValueOnce(new Response('Too many requests', { status: 429 }))
    expect((await worker.fetch(send(), env)).status).toBe(429)
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.invalid' } }))
    const redirect = await worker.fetch(send(), env)
    expect(redirect.status).toBe(502)
    expect(redirect.headers.get('location')).toBeNull()
    fetch.mockRejectedValueOnce(new Error('upstream timeout'))
    const failed = await worker.fetch(send(), env)
    expect(failed.status).toBe(502)
    expect(failed.headers.get('cache-control')).toBe('no-store')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('returns tracker failures without caching an error as JavaScript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', { status: 503 })))
    const response = await worker.fetch(new Request(origin + '/stats.js'), env)
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects other methods and leaves static/SPA requests to ASSETS', async () => {
    expect((await worker.fetch(new Request(origin + '/api/send'), env)).status).toBe(405)
    expect((await worker.fetch(new Request(origin + '/stats.js', { method: 'POST' }), env)).status).toBe(405)
    const request = new Request(origin + '/?view=journey')
    expect(await (await worker.fetch(request, env)).text()).toBe('SPA asset')
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
  })
})
