import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'

function createClock() {
  let current = 0
  const sleeps = []
  return {
    now: () => current,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); current += milliseconds },
    sleeps,
  }
}

{
  const clock = createClock()
  const startedAt = []
  const fetcher = createCatalogSourceFetcher({
    now: clock.now,
    sleep: clock.sleep,
    fetchImpl: async () => {
      startedAt.push(clock.now())
      return new Response('ok', { status: 200 })
    },
    logger: { warn: () => {} },
  })
  await Promise.all([
    fetcher.request('https://www.veeam.com/kb2680', { sourceId: 'kb2680' }),
    fetcher.request('https://www.veeam.com/kb4357', { sourceId: 'kb4357' }),
  ])
  if (startedAt.join(',') !== '0,3000') throw new Error(`Expected Veeam requests to be paced at the default three-second interval, received ${startedAt.join(',')}`)
}

{
  const clock = createClock()
  const attempts = []
  const fetcher = createCatalogSourceFetcher({
    now: clock.now,
    sleep: clock.sleep,
    minimumVeeamIntervalMs: 1_500,
    fetchImpl: async () => {
      attempts.push(clock.now())
      return attempts.length === 1 ? new Response('busy', { status: 503, headers: { 'retry-after': '2' } }) : new Response('ok', { status: 200 })
    },
    logger: { warn: () => {} },
  })
  await fetcher.request('https://www.veeam.com/kb2680', { sourceId: 'kb2680' })
  if (attempts.join(',') !== '0,2000') throw new Error(`Expected retry-after to be honoured, received ${attempts.join(',')}`)
}

{
  const diagnostics = []
  let attempts = 0
  const fetcher = createCatalogSourceFetcher({
    fetchImpl: async () => {
      attempts += 1
      return new Response('<title>Access denied</title>', { status: 403, headers: { server: 'cloudflare', 'cf-ray': 'example-ray', 'set-cookie': 'must-not-log' } })
    },
    logger: { warn: (_message, diagnostic) => diagnostics.push(diagnostic) },
  })
  try {
    await fetcher.request('https://www.veeam.com/kb2680', { sourceId: 'kb2680' })
    throw new Error('Expected the 403 response to fail')
  } catch (error) {
    if (error.message !== 'kb2680 request failed with HTTP 403') throw error
  }
  const diagnostic = diagnostics.at(-1)
  if (attempts !== 1 || diagnostic?.headers?.['cf-ray'] !== 'example-ray' || diagnostic?.headers?.['set-cookie'] || diagnostic?.bodyPreview !== undefined) throw new Error('Expected a single-attempt 403 with a metadata-only blocked-response diagnostic')
}

console.log('Catalog source fetch policy test passed.')
