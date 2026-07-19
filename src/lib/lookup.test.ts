import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { documentedFixSourceIds, findingAppliesToRelease, findingsForRelease, findLifecycleNotice, findRelease, findUpgradePath, isRecommendedRelease, releaseMaterialSourceIds, upgradeHowToSourceIds, upgradeTargetRelease } from './lookup'
import { classifyUrgency } from './urgency'

describe('catalog lookup', () => {
  it('matches an exact VBR build and gives the source-backed staged path', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')
    expect(release?.id).toBe('vbr-12.3.2.3617')
    expect(findUpgradePath(catalog, release!)?.hopReleaseIds).toEqual(['vbr-12.3.2.4165', 'vbr-13.0.2'])
    expect(findUpgradePath(catalog, release!)?.guidanceNote).toContain('security-first recommendation')
  })

  it('explains why broad 12.3.2 input differs from a vulnerable exact build', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2')!
    expect(findUpgradePath(catalog, release!)?.guidanceNote).toContain('12.3.2.3617')
  })

  it('links vendor release information and documented fixes for the fixed 12.3.2.4465 build', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.4465')!

    expect(release.sourceIds).toContain('kb4696')
    expect(documentedFixSourceIds(catalog, release)).toContain('kb4830')
  })

  it('does not infer an unmatched build from a nearby release', () => {
    expect(findRelease(catalog, 'vbr', '12.3.2.4000')).toBeUndefined()
  })

  it('matches the VBR 11a P20230227 build format shown by the console', () => {
    expect(findRelease(catalog, 'vbr', '11.0.1.1261 P20230227')?.id).toBe('vbr-11a-p20230227')
  })

  it('applies a source-backed version prefix without inferring other products', () => {
    const finding = {
      id: 'prefix', productId: 'vbr' as const, title: 'prefix', cves: ['CVE-2024-40711'], affectedReleaseIds: [],
      affectedVersionPrefixes: ['11.0.1.'], fixedReleaseId: 'vbr-build-13-0-1-2067', conditions: [], sourceIds: ['kb4831'],
    }
    const release = { id: 'vbr-build-11a-other', productId: 'vbr' as const, name: '11a', aliases: ['11.0.1.1261 P20211211'], sourceIds: ['kb2680'] }
    expect(findingAppliesToRelease(finding, release)).toBe(true)
  })

  it('applies the documented 11a route to a refreshed build variant', () => {
    const release = { id: 'vbr-build-11a-p20211211', productId: 'vbr' as const, name: '11a', aliases: ['11.0.1.1261 P20211211'], sourceIds: ['kb2680'] }
    expect(findUpgradePath(catalog, release)?.id).toBe('vbr-11a-p20230227-to-13.0.2')
  })

  it('applies the refreshed lifecycle row to related builds in the same major version', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.180')!
    expect(findLifecycleNotice(catalog, 'vbr', release.id)?.state).toBe('supported')
  })

  it('applies a documented VBR build range through its final vulnerable build', () => {
    const finding = {
      id: 'range', productId: 'vbr' as const, title: 'range', cves: ['CVE-2026-21669'], affectedReleaseIds: [],
      affectedBuildRanges: [{ versionPrefix: '13.', throughBuild: '13.0.1.1071' }], fixedReleaseId: 'vbr-build-13-0-1-2067', conditions: [], sourceIds: ['kb4831'],
    }
    expect(findingAppliesToRelease(finding, findRelease(catalog, 'vbr', '13.0.1.180')!)).toBe(true)
    expect(findingAppliesToRelease(finding, findRelease(catalog, 'vbr', '13.0.1.2067')!)).toBe(false)
  })

  it('identifies a product’s catalog-recommended release without inventing an upgrade route', () => {
    expect(isRecommendedRelease(catalog, findRelease(catalog, 'veeam-one', '13.0.2.6723')!)).toBe(true)
  })

  it('recognizes the current Enterprise Manager documentation build', () => {
    expect(findRelease(catalog, 'enterprise-manager', '13.0.2.29')?.id).toBe('em-13')
  })

  it('never applies another product’s similarly numbered advisory', () => {
    const release = findRelease(catalog, 'veeam-one', '6.5.0.686')!
    expect(findingsForRelease(catalog, release)).toEqual([])
  })

  it('orders matching security findings from critical to high to standard', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')!
    const urgencyOrder = { critical: 0, high: 1, standard: 2 }
    const urgencies = findingsForRelease(catalog, release).map(classifyUrgency)

    expect(urgencies).toContain('critical')
    expect(urgencies).toContain('high')
    expect(urgencies).toEqual([...urgencies].sort((left, right) => urgencyOrder[left] - urgencyOrder[right]))
  })

  it('provides a Help Center how-to link for each product', () => {
    expect(upgradeHowToSourceIds('veeam-one')).toEqual(['one-how-to'])
    expect(upgradeHowToSourceIds('vbr')).toEqual(['vbr-how-to'])
  })

  it('links target release material and source-backed fixes without treating them as matching advisories', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')!
    const target = upgradeTargetRelease(catalog, 'vbr', findUpgradePath(catalog, release))!

    expect(target.id).toBe('vbr-13.0.2')
    expect(releaseMaterialSourceIds('vbr')).toEqual(['vbr-whats-new', 'vbr-release-materials'])
    expect(documentedFixSourceIds(catalog, target)).toContain('kb4852')
  })
})
