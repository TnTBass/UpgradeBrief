import type { Catalog, LifecycleNotice, ProductId, Release, SecurityFinding, UpgradePath } from './catalog-types'

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

export function isRecommendedRelease(catalog: Catalog, release: Release): boolean {
  return catalog.products.find((product) => product.id === release.productId)?.recommendedReleaseId === release.id
}

export function checklistSourceIds(productId: ProductId): string[] {
  return {
    vbr: ['vbr-checklist'],
    'enterprise-manager': ['em-upgrade'],
    'veeam-one': ['kb4646'],
    vro: ['vro-upgrade'],
    vspc: ['vspc-upgrade'],
  }[productId]
}

function compareDottedVersions(left: string, right: string): number | undefined {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  if (!leftParts.length || !rightParts.length || [...leftParts, ...rightParts].some((part) => !Number.isInteger(part) || part < 0)) return undefined

  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) return Math.sign(delta)
  }
  return 0
}

export function findingAppliesToRelease(finding: SecurityFinding, release: Release): boolean {
  if (finding.affectedReleaseIds.includes(release.id)) return true
  if ((finding.affectedVersionPrefixes ?? []).some((prefix) =>
    release.aliases.some((alias) => normalizeInput(alias).startsWith(normalizeInput(prefix))),
  )) return true

  return (finding.affectedBuildRanges ?? []).some((range) =>
    release.aliases.some((alias) => {
      const normalizedAlias = normalizeInput(alias)
      const normalizedPrefix = normalizeInput(range.versionPrefix)
      const comparison = compareDottedVersions(normalizedAlias, normalizeInput(range.throughBuild))
      return normalizedAlias.startsWith(normalizedPrefix) && comparison !== undefined && comparison <= 0
    }),
  )
}

export function findLifecycleNotice(catalog: Catalog, productId: ProductId, releaseId: string): LifecycleNotice | undefined {
  return catalog.lifecycleNotices.find((notice) => notice.productId === productId && notice.releaseId === releaseId)
    ?? catalog.lifecycleNotices.find((notice) => notice.productId === productId && !notice.releaseId)
}

export function sourceById(catalog: Catalog, sourceId: string) {
  return catalog.sources.find((source) => source.id === sourceId)
}
