import type { ProductId } from './catalog-types'

type AnalyticsEvents = {
  product_selected: { product: ProductId }
  brief_viewed: { product: ProductId; release: string; outcome: 'current' | 'upgrade' | 'no_route' }
  pdf_exported: { product: ProductId; release: string }
  journey_viewed: { product: ProductId; release: string }
  journey_stage_viewed: { release: string; stage: string }
  outbound_clicked: { product: ProductId; release?: string; view: 'results' | 'journey'; destination: string }
  details_opened: { product: ProductId; release?: string; view: 'results' | 'journey'; topic: string; stage?: string }
}

type EventName = keyof AnalyticsEvents
type Payload = Record<string, unknown>
type QueuedEvent = { name: EventName; data: AnalyticsEvents[EventName] }

declare global {
  interface Window {
    umami?: { track: (payload: (defaults: Payload) => Payload) => Promise<unknown> | void }
  }
}

const productionHosts = new Set(['upgradebrief.com', 'www.upgradebrief.com'])
const campaignParameters = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id']

// One logical page per document, without the raw version input or arbitrary query data.
export function analyticsPageUrl(href: string): string {
  const url = new URL(href)
  const path = url.searchParams.get('view') === 'journey' ? '/journey' : '/'
  const campaign = new URLSearchParams()
  for (const key of campaignParameters) {
    const value = url.searchParams.get(key)
    if (value) campaign.set(key, value)
  }
  return `${path}${campaign.size ? `?${campaign}` : ''}`
}

function analyticsReferrer(referrer: unknown): string {
  if (typeof referrer !== 'string' || !referrer) return ''
  try {
    const url = new URL(referrer)
    return productionHosts.has(url.hostname)
      ? `${url.origin}${analyticsPageUrl(referrer)}`
      : `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

let initialized = false
let ready = false
let pageUrl = '/'
let queue: QueuedEvent[] = []
let delivery = Promise.resolve()

function send(event?: QueuedEvent) {
  // Serialize the first pageview and events so the tracker can establish its session.
  // Analytics must never delay an interaction or surface a tracking failure in the UI.
  delivery = delivery.then(async () => {
    await window.umami?.track((defaults) => ({
      ...defaults,
      url: pageUrl,
      referrer: analyticsReferrer(defaults.referrer),
      ...(event ? { name: event.name, data: event.data } : {}),
    }))
  }).catch(() => {})
}

export function initializeAnalytics() {
  if (initialized || !productionHosts.has(window.location.hostname)) return
  initialized = true
  // Capture campaigns before React updates the selection URL.
  pageUrl = analyticsPageUrl(window.location.href)

  const start = () => {
    if (ready || !window.umami) return
    ready = true
    send()
    for (const event of queue) send(event)
    queue = []
  }

  // A deferred external script may finish before or after the application bundle.
  document.getElementById('umami-tracker')?.addEventListener('load', start, { once: true })
  start()
}

export function trackEvent<Name extends EventName>(name: Name, data: AnalyticsEvents[Name]) {
  if (!initialized) return
  const event = { name, data }
  if (ready) send(event)
  else if (queue.length < 20) queue.push(event)
}
