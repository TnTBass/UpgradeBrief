import type { Catalog, ProductId, Release, UpgradePath } from './catalog-types'

export function normalizeInput(value: string): string {
  return value.trim().toLowerCase().replace(/^v(?:eeam)?\s*/i, '').replace(/\s+/g, ' ')
}

export function findRelease(catalog: Catalog, productId: ProductId, input: string): Release | undefined {
  const normalized = normalizeInput(input)
  return catalog.releases.find(
    (release) => release.productId === productId && release.aliases.map(normalizeInput).includes(normalized),
  )
}

export function findUpgradePath(catalog: Catalog, releaseId: string): UpgradePath | undefined {
  return catalog.upgradePaths.find((path) => path.fromReleaseId === releaseId)
}

export function sourceById(catalog: Catalog, sourceId: string) {
  return catalog.sources.find((source) => source.id === sourceId)
}
