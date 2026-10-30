import type { Catalog, ProductId } from './catalog-types'
export type FreshnessState = 'current' | 'stale' | 'outdated'

export function catalogFreshness(generatedAt: string, now = new Date()): FreshnessState {
  const ageHours = (now.getTime() - new Date(generatedAt).getTime()) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours < -5 / 60 || ageHours >= 72) return 'outdated'
  if (ageHours >= 36) return 'stale'
  return 'current'
}

export function productFreshness(catalog: Catalog, productId: ProductId, now = new Date()) {
  const validation = catalog.productValidation?.find(item => item.productId === productId)
  const validMetadata = validation && ['validated', 'retained'].includes(validation.state) && Number.isFinite(Date.parse(validation.attemptedAt)) && Date.parse(validation.attemptedAt) <= now.getTime() + 300_000 && Date.parse(validation.validatedAt) <= Date.parse(validation.attemptedAt)
  const validatedAt = catalog.schemaVersion === 2 ? validMetadata ? validation.validatedAt : undefined : catalog.generatedAt
  const ageState = catalogFreshness(validatedAt ?? '', now)
  const retained = validation?.state === 'retained'
  const state = retained && ageState === 'current' ? 'stale' : ageState
  const date = validatedAt && Number.isFinite(Date.parse(validatedAt)) ? new Date(validatedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'unknown'
  const heading = ageState === 'outdated' ? 'Critical: product data is outdated' : retained ? 'Refresh incomplete: previous product data retained' : state === 'stale' ? 'Product data needs revalidation' : 'Product data validated'
  const detail = 'Last successful validation: ' + date + '. ' + (state === 'current'
    ? 'Recommendations reflect the sources validated at that time.'
    : 'Security findings and upgrade recommendations may be incomplete. Check current vendor advisories before acting.')
  return { state, ageState, retained, validatedAt, heading, detail }
}

