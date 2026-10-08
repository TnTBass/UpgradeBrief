const WEBSITE_ID = '0ae1a9cd-b5fc-4966-8c43-1bb3b743bf0f'
const HOSTS = new Set(['upgradebrief.com', 'www.upgradebrief.com'])
const MAX_BODY_BYTES = 16 * 1024

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

function error(status: number, message: string, headers: HeadersInit = {}) {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

// Bound the actual stream as well as Content-Length (which may be absent).
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function collect(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'Method not allowed', { Allow: 'POST' })
  if (!HOSTS.has(url.hostname) || request.headers.get('origin') !== url.origin) {
    return error(403, 'Forbidden')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(415, 'Expected JSON')
  }

  const raw = await readBody(request)
  if (raw === null) return error(413, 'Payload too large')
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return error(400, 'Invalid JSON')
  }
  const payload = body?.payload
  if (body?.type !== 'event' || !payload || payload.website !== WEBSITE_ID || payload.hostname !== url.hostname) {
    return error(400, 'Invalid event')
  }

  // Trust Cloudflare's visitor headers, never a client-supplied payload IP or XFF.
  // payload.ip also prevents cross-zone Worker IP/location headers taking precedence in Umami.
  const ip = request.headers.get('cf-connecting-ipv6') || request.headers.get('cf-connecting-ip')
  if (!ip) return error(503, 'Visitor address unavailable')
  const userAgent = request.headers.get('user-agent') || ''
  const headers = new Headers({
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-Forwarded-For': ip,
    'x-umami-website-id': WEBSITE_ID,
    'x-umami-hostname': url.hostname,
  })
  const cache = request.headers.get('x-umami-cache')
  if (cache) headers.set('x-umami-cache', cache)

  const upstream = await fetch('https://gateway.umami.is/api/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'event', payload: { ...payload, ip, userAgent } }),
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  })
  if (upstream.status >= 300 && upstream.status < 400) return error(502, 'Unexpected analytics redirect')
  // Preserve the cache/session response for the tracker, but never HTTP-cache it.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    // Static assets and SPA navigation keep the existing asset handler.
    if (url.pathname !== '/stats.js' && url.pathname !== '/api/send') return env.ASSETS.fetch(request)
    try {
      if (url.pathname === '/api/send') return await collect(request, url)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return error(405, 'Method not allowed', { Allow: 'GET, HEAD' })
      }
      const upstream = await fetch('https://cloud.umami.is/script.js', {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      })
      if (!upstream.ok) return error(502, 'Tracker unavailable')
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      // No payloads/IPs are logged, and no automatic retry can duplicate an event.
      return error(502, 'Analytics unavailable')
    }
  },
}
