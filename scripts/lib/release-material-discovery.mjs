import { parseReleaseMaterials } from './release-materials.mjs'

const normalizedTitle = value => String(value ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()

// Retry only a valid, matching product response with empty parsed discovery.
// HTTP refusal, malformed payloads, parser exceptions and wrong products escape.
export async function discoverReleaseMaterials({ product, fetchPayload, parse = parseReleaseMaterials, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = await fetchPayload(product)
    if (normalizedTitle(payload?.payload?.products?.[0]?.productTitle) !== product.productTitle) throw new Error('Help Center release-material discovery returned a mismatched product response.')
    const materials = parse(payload, product.productId)
    if (!Array.isArray(materials) || materials.some(material => material.productId !== product.productId)) throw new Error('Help Center release-material discovery parser returned a mismatched product.')
    if (materials.length) return materials
    if (attempt < 2) await sleep(3000 * (attempt + 1))
  }
  throw new Error(`Help Center release-material discovery returned no current document for ${product.productId} after three attempts.`)
}
