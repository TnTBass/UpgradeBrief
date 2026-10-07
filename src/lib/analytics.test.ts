import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsPageUrl } from './analytics'
import { selectionUrl } from './selection-url'

describe('analytics URLs and campaign attribution', () => {
  it('groups results and journeys without collecting raw input or arbitrary query data', () => {
    expect(analyticsPageUrl('https://upgradebrief.com/?product=vbr&version=private-input&email=private&utm_source=linkedin&utm_campaign=launch#security'))
      .toBe('/?utm_source=linkedin&utm_campaign=launch')
    expect(analyticsPageUrl('https://upgradebrief.com/?view=journey&version=12.0')).toBe('/journey')
  })

  it('preserves campaigns through selection changes, journey navigation, and the return link', () => {
    const landing = 'https://upgradebrief.com/?utm_source=linkedin&utm_medium=social&utm_campaign=launch&version=old#security'
    const results = selectionUrl(landing, 'vbr', '12.0', 'results')
    const journey = selectionUrl(`https://upgradebrief.com${results}`, 'vbr', '12.0', 'journey')
    const back = selectionUrl(`https://upgradebrief.com${journey}`, 'vb365', '', 'results')
    for (const href of [results, journey, back]) {
      const url = new URL(href, 'https://upgradebrief.com')
      expect(url.searchParams.get('utm_source')).toBe('linkedin')
      expect(url.searchParams.get('utm_medium')).toBe('social')
      expect(url.searchParams.get('utm_campaign')).toBe('launch')
      expect(url.hash).toBe('#security')
    }
    expect(new URL(journey, 'https://upgradebrief.com').searchParams.get('view')).toBe('journey')
    expect(new URL(back, 'https://upgradebrief.com').searchParams.has('view')).toBe(false)
    expect(new URL(back, 'https://upgradebrief.com').searchParams.has('version')).toBe(false)
  })
})

describe('analytics delivery', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  async function setup(host = 'upgradebrief.com', trackerReady = true) {
    const script = new EventTarget()
    const payloads: Record<string, unknown>[] = []
    const track = vi.fn((build: (defaults: Record<string, unknown>) => Record<string, unknown>) => {
      payloads.push(build({ website: 'test', url: '/?version=private', referrer: 'https://upgradebrief.com/?version=private&view=journey' }))
      return Promise.resolve()
    })
    vi.stubGlobal('window', {
      location: new URL(`https://${host}/?utm_source=linkedin&version=private`),
      umami: trackerReady ? { track } : undefined,
    })
    vi.stubGlobal('document', { getElementById: () => script })
    const analytics = await import('./analytics')
    return { ...analytics, script, payloads, track }
  }

  it('sends one pageview before queued events when the tracker loads late', async () => {
    const analytics = await setup('upgradebrief.com', false)
    analytics.initializeAnalytics()
    analytics.initializeAnalytics()
    analytics.trackEvent('product_selected', { product: 'vb365' })
    expect(analytics.payloads).toHaveLength(0)
    window.umami = { track: analytics.track }
    analytics.script.dispatchEvent(new Event('load'))
    analytics.script.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(analytics.payloads).toHaveLength(2))
    expect(analytics.payloads[0]).toEqual({ website: 'test', url: '/?utm_source=linkedin', referrer: 'https://upgradebrief.com/journey' })
    expect(analytics.payloads[1]).toMatchObject({ name: 'product_selected', data: { product: 'vb365' } })
    expect(JSON.stringify(analytics.payloads)).not.toContain('private')
  })

  it.each(['localhost', 'preview.upgradebrief.workers.dev'])('does not record development or preview traffic on %s', async (host) => {
    const analytics = await setup(host)
    analytics.initializeAnalytics()
    analytics.trackEvent('product_selected', { product: 'vbr' })
    await Promise.resolve()
    expect(analytics.track).not.toHaveBeenCalled()
  })

  it('continues after a rejected tracker request without breaking interactions', async () => {
    const analytics = await setup()
    analytics.track.mockRejectedValueOnce(new Error('blocked'))
    analytics.initializeAnalytics()
    analytics.trackEvent('pdf_exported', { product: 'vbr', release: '12.0' })
    await vi.waitFor(() => expect(analytics.track).toHaveBeenCalledTimes(2))
    expect(analytics.payloads[0]).toMatchObject({ name: 'pdf_exported' })
  })

  it('bounds the queue if the tracker is unavailable', async () => {
    const analytics = await setup('upgradebrief.com', false)
    analytics.initializeAnalytics()
    for (let index = 0; index < 30; index++) analytics.trackEvent('product_selected', { product: 'vbr' })
    window.umami = { track: analytics.track }
    analytics.script.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(analytics.payloads).toHaveLength(21))
  })
})
