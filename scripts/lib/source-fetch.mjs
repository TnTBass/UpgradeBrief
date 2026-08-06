const VEEAM_HOST_SUFFIX = '.veeam.com'
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const SAFE_DIAGNOSTIC_HEADERS = ['server', 'cf-ray', 'retry-after', 'x-request-id', 'x-correlation-id', 'content-type']

export const DEFAULT_VEEAM_REQUEST_INTERVAL_MS = 3_000
export const DEFAULT_MAX_ATTEMPTS = 3

function isVeeamHost(hostname) {
  return hostname === 'veeam.com' || hostname.endsWith(VEEAM_HOST_SUFFIX)
}

function retryAfterMilliseconds(value, now) {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1_000
  const retryAt = Date.parse(value)
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - now())
}

function retryDelayMilliseconds(response, attempt, now) {
  const retryAfter = response ? retryAfterMilliseconds(response.headers.get('retry-after'), now) : undefined
  return Math.max(1_000 * 2 ** (attempt - 1), retryAfter ?? 0)
}

function responseDiagnostic(response, sourceId, url) {
  const headers = Object.fromEntries(SAFE_DIAGNOSTIC_HEADERS.flatMap((name) => {
    const value = response.headers.get(name)
    return value ? [[name, value]] : []
  }))
  return { sourceId, host: new URL(url).host, status: response.status, headers }
}

export class CatalogSourceFetchError extends Error {
  constructor(sourceId, status, diagnostic) {
    super(`${sourceId} request failed with HTTP ${status}`)
    this.name = 'CatalogSourceFetchError'
    this.diagnostic = diagnostic
  }
}

export function createCatalogSourceFetcher({
  fetchImpl = globalThis.fetch,
  logger = console,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  minimumVeeamIntervalMs = DEFAULT_VEEAM_REQUEST_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const hosts = new Map()

  async function queueForHost(url, work) {
    const hostname = new URL(url).hostname
    if (!isVeeamHost(hostname)) return work(async () => {})

    const state = hosts.get(hostname) ?? { tail: Promise.resolve(), nextRequestAt: 0 }
    hosts.set(hostname, state)
    let release
    const previous = state.tail
    state.tail = new Promise((resolve) => { release = resolve })
    await previous

    const beforeAttempt = async () => {
      const remaining = state.nextRequestAt - now()
      if (remaining > 0) await sleep(remaining)
      state.nextRequestAt = now() + minimumVeeamIntervalMs
    }

    try {
      return await work(beforeAttempt)
    } finally {
      release()
    }
  }

  async function request(url, { sourceId, timeoutMs = 30_000 } = {}) {
    const label = sourceId ?? new URL(url).pathname
    return queueForHost(url, async (beforeAttempt) => {
      let networkError
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await beforeAttempt()
        let response
        try {
          response = await fetchImpl(url, {
            headers: { 'user-agent': 'UpgradeBrief catalog refresher (+https://github.com/TnTBass/UpgradeBrief)' },
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (error) {
          networkError = error
          if (attempt === maxAttempts) break
          const delay = retryDelayMilliseconds(undefined, attempt, now)
          logger.warn('[catalog-refresh] retrying transient network failure', { sourceId: label, host: new URL(url).host, attempt, delayMs: delay, error: error.message })
          await sleep(delay)
          continue
        }

        if (response.ok) return response
        if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxAttempts) {
          const delay = retryDelayMilliseconds(response, attempt, now)
          logger.warn('[catalog-refresh] retrying transient source response', { sourceId: label, host: new URL(url).host, status: response.status, attempt, delayMs: delay })
          await sleep(delay)
          continue
        }

        const diagnostic = responseDiagnostic(response, label, url)
        logger.warn('[catalog-refresh] source request failed', diagnostic)
        throw new CatalogSourceFetchError(label, response.status, diagnostic)
      }

      logger.warn('[catalog-refresh] source request failed after transient network errors', { sourceId: label, host: new URL(url).host, attempts: maxAttempts, error: networkError?.message })
      throw new Error(`${label} request failed after ${maxAttempts} transient network errors`, { cause: networkError })
    })
  }

  return { request }
}
