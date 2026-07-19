import type { Catalog, ProductId, Release, SecurityFinding, UpgradePath } from './catalog-types'

export function normalizeInput(value: string): string {
  return value.trim().toLowerCase().replace(/^v(?:eeam)?\s*/i, '').replace(/\s+/g, ' ')
}

export function findRelease(catalog: Catalog, productId: ProductId, input: string): Release | undefined {
  const normalized = normalizeInput(input)
  return catalog.releases.find(
    (release) => release.productId === productId && release.aliases.map(normalizeInput).includes(normalized),
  )
}

export function findUpgradePath(catalog: Catalog, release: Release): UpgradePath | undefined {
  const exact = catalog.upgradePaths.find((path) => path.fromReleaseId === release.id)
  if (exact) return exact

  return catalog.upgradePaths.find((path) =>
    path.productId === release.productId &&
    (path.fromVersionPrefixes ?? []).some((prefix) =>
      release.aliases.some((alias) => normalizeInput(alias).startsWith(normalizeInput(prefix))),
    ),
  )
}

export function findingAppliesToRelease(finding: SecurityFinding, release: Release): boolean {
  if (finding.affectedReleaseIds.includes(release.id)) return true
  return (finding.affectedVersionPrefixes ?? []).some((prefix) =>
    release.aliases.some((alias) => normalizeInput(alias).startsWith(normalizeInput(prefix))),
  )
}

export function sourceById(catalog: Catalog, sourceId: string) {
  return catalog.sources.find((source) => source.id === sourceId)
}
