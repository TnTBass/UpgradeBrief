import type { Catalog, LifecycleNotice, ProductId, Release, ReleaseHighlight, ReleaseImprovement, SecurityFinding, UpgradePath } from './catalog-types'
import { classifyUrgency } from './urgency'

const urgencyOrder = { critical: 0, high: 1, standard: 2 } as const
const releaseMaterialSources: Record<ProductId, string[]> = {
  vbr: ['vbr-whats-new', 'vbr-release-materials'],
  'enterprise-manager': ['vdp-release-materials'],
  'veeam-one': ['one-release-materials'],
  vro: ['vro-release-materials'],
  vspc: ['vspc-release-materials'],
}

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

export function upgradeHowToSourceIds(productId: ProductId): string[] {
  return {
    vbr: ['vbr-how-to'],
    'enterprise-manager': ['em-how-to'],
    'veeam-one': ['one-how-to'],
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

function versionFromText(value: string): string | undefined {
  return value.match(/\d+(?:\.\d+)*/)?.[0]
}

function releaseVersion(release: Release): string | undefined {
  return versionFromText(release.name) ?? release.aliases.map(versionFromText).find(Boolean)
}

export function isLegacyLifecycleRelease(productId: ProductId, release: Release): boolean {
  if (!['vbr', 'veeam-one', 'enterprise-manager'].includes(productId)) return false
  const major = Number(releaseVersion(release)?.split('.')[0])
  return Number.isFinite(major) && major < 11
}

function releaseMaterialFamily(version: string | undefined): string | undefined {
  if (!version) return undefined
  const [major, minor = '0'] = version.split('.')
  return /^\d+$/.test(major) && /^\d+$/.test(minor) ? `${major}.${minor}` : undefined
}

function materialProductId(productId: ProductId): ProductId {
  return productId === 'enterprise-manager' ? 'vbr' : productId
}

export function upgradeHighlightsForRelease(catalog: Catalog, release: Release, targetRelease: Release): ReleaseHighlight[] {
  const installedVersion = releaseVersion(release)
  const targetVersion = releaseVersion(targetRelease)
  if (!installedVersion || !targetVersion) return []

  const perFamily = new Map<string, typeof catalog.capabilities>()
  for (const capability of catalog.capabilities) {
    if (capability.productId !== release.productId) continue
    const afterInstalled = compareDottedVersions(installedVersion, capability.introducedIn)
    const includedInTarget = compareDottedVersions(targetVersion, capability.introducedIn)
    if (afterInstalled === undefined || includedInTarget === undefined || afterInstalled >= 0 || includedInTarget < 0) continue
    perFamily.set(capability.family, [...(perFamily.get(capability.family) ?? []), capability])
  }

  const majorDistance = Number(targetVersion.split('.')[0]) - Number(installedVersion.split('.')[0])
  const limit = majorDistance >= 2 ? 5 : 4
  return [...perFamily.values()]
    .map((capabilities) => {
      const ordered = [...capabilities].sort((left, right) => right.priority - left.priority)
      const primary = ordered[0]
      return {
        title: primary.title,
        summary: ordered.map((capability) => capability.summary).join(' '),
        availabilityNote: ordered.map((capability) => capability.availabilityNote).filter(Boolean).join(' ') || undefined,
        sourceIds: [...new Set(ordered.flatMap((capability) => capability.sourceIds))],
        priority: primary.priority,
      }
    })
    .sort((left, right) => right.priority - left.priority)
    .slice(0, limit)
    .map(({ title, summary, availabilityNote, sourceIds }) => ({ title, summary, availabilityNote, sourceIds }))
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

export function findingsForRelease(catalog: Catalog, release: Release): SecurityFinding[] {
  return catalog.securityFindings
    .filter((finding) => finding.productId === release.productId && findingAppliesToRelease(finding, release))
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => urgencyOrder[classifyUrgency(left.finding)] - urgencyOrder[classifyUrgency(right.finding)] || left.index - right.index)
    .map(({ finding }) => finding)
}

export function upgradeTargetRelease(catalog: Catalog, productId: ProductId, path?: UpgradePath): Release | undefined {
  const product = catalog.products.find((item) => item.id === productId)
  const targetId = path?.hopReleaseIds.at(-1) ?? product?.recommendedReleaseId
  return catalog.releases.find((release) => release.id === targetId)
}

export function releaseMaterialSourceIds(catalog: Catalog, productId: ProductId, release?: Release): string[] {
  const family = releaseMaterialFamily(release && releaseVersion(release))
  const materialSources = catalog.sources
    .filter((source) => source.productId === materialProductId(productId) && source.releaseFamily === family && source.materialKind)
    .sort((left, right) => left.materialKind === 'whats-new' ? -1 : right.materialKind === 'whats-new' ? 1 : left.title.localeCompare(right.title))
    .map((source) => source.id)
  return materialSources.length ? materialSources : releaseMaterialSources[productId]
}

export function releaseImprovementsForRelease(catalog: Catalog, release: Release, targetRelease: Release): ReleaseImprovement[] {
  return catalog.releaseImprovements.filter((improvement) =>
    improvement.productId === release.productId
    && improvement.targetReleaseId === targetRelease.id
    && (improvement.fromVersionPrefixes ?? []).some((prefix) =>
      release.aliases.some((alias) => normalizeInput(alias).startsWith(normalizeInput(prefix))),
    ),
  )
}

export function documentedFixSourceIds(catalog: Catalog, release: Release): string[] {
  return [...new Set(catalog.securityFindings
    .filter((finding) => finding.fixedReleaseId === release.id)
    .flatMap((finding) => finding.sourceIds)
    .filter((sourceId) => sourceId !== 'security-kb' && sourceId !== 'cisa-kev'))]
}

export function findLifecycleNotice(catalog: Catalog, productId: ProductId, releaseId: string): LifecycleNotice | undefined {
  return catalog.lifecycleNotices.find((notice) => notice.productId === productId && notice.releaseId === releaseId)
    ?? catalog.lifecycleNotices.find((notice) => notice.productId === productId && !notice.releaseId)
}

export function sourceById(catalog: Catalog, sourceId: string) {
  return catalog.sources.find((source) => source.id === sourceId)
}
