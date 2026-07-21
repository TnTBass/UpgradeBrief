import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { documentedFixSourceIds, findingAppliesToRelease, findingsForRelease, findLifecycleNotice, findRelease, findUpgradePath, isLegacyLifecycleRelease, isRecommendedRelease, releaseImprovementsForRelease, releaseMaterialSourceIds, upgradeHighlightsForRelease, upgradeHowToSourceIds, upgradeTargetRelease } from './lookup'
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

  it('offers the supported VBR 12 update without displacing the recommended version 13 target', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.4165')!
    const path = findUpgradePath(catalog, release)!

    expect(path.toReleaseId).toBe('vbr-13.0.2')
    expect(path.alternatives).toEqual([expect.objectContaining({ releaseId: 'vbr-build-12-3-2-4854', sourceIds: ['kb4696'] })])
  })

  it('routes VBR 13.0.1 builds directly to 13.0.2', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.2067')!
    const path = findUpgradePath(catalog, release)!

    expect(path.id).toBe('vbr-13.0.1-to-13.0.2')
    expect(path.hopReleaseIds).toEqual(['vbr-13.0.2'])
  })

  it('shows source-backed resolved-issue context for a VBR 13.0 point-release update without presenting it as a new feature', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.180')!
    const target = findRelease(catalog, 'vbr', '13.0.2.29')!

    expect(upgradeHighlightsForRelease(catalog, release, target)).toEqual([])
    expect(releaseImprovementsForRelease(catalog, release, target)).toEqual([
      expect.objectContaining({
        id: 'vbr-13.0.2-resolved-issues',
        heading: 'Documented resolved issues in 13.0.2',
        sourceIds: ['kb4738'],
      }),
    ])
  })

  it('routes the VBR 13.0.0 Software Appliance through its in-appliance update workflow', () => {
    const release = findRelease(catalog, 'vbr', '13.0.0.4967')!
    const path = findUpgradePath(catalog, release)!

    expect(path.id).toBe('vbr-13.0.0-vsa-to-13.0.2')
    expect(path.howToSourceIds).toEqual(['kb4738'])
  })

  it('links vendor release information and documented fixes for the fixed 12.3.2.4465 build', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.4465')!

    expect(release.sourceIds).toContain('kb4696')
    expect(documentedFixSourceIds(catalog, release)).toContain('kb4830')
  })

  it('shows the KB4869 critical advisory through 12.3.2.4465 but not on its 12.3.2.4854 fix', () => {
    const vulnerable = findRelease(catalog, 'vbr', '12.3.2.4465')!
    const fixed = findRelease(catalog, 'vbr', '12.3.2.4854')!

    expect(findingsForRelease(catalog, vulnerable).some((finding) => finding.cves.includes('CVE-2026-44963'))).toBe(true)
    expect(findingsForRelease(catalog, fixed).some((finding) => finding.cves.includes('CVE-2026-44963'))).toBe(false)
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

  it('keeps documented pre-12.3.2 VBR paths available for concrete builds', () => {
    const expectedRoutes = [
      ['10.0.1.4854', 'vbr-10a-to-13.0.2'],
      ['11.0.0.837', 'vbr-11-to-13.0.2'],
      ['12.0.0.1420 P20230718', 'vbr-12.0-to-13.0.2'],
      ['12.1.0.2131', 'vbr-12.1-to-13.0.2'],
      ['12.2.0.334', 'vbr-12.2-to-13.0.2'],
      ['12.3.0.310', 'vbr-12.3-to-13.0.2'],
      ['12.3.1.1139', 'vbr-12.3.1-to-13.0.2'],
    ] as const

    for (const [version, routeId] of expectedRoutes) {
      const release = findRelease(catalog, 'vbr', version)!
      expect(findUpgradePath(catalog, release)?.id).toBe(routeId)
    }
  })

  it('applies the refreshed lifecycle row to related builds in the same major version', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.180')!
    expect(findLifecycleNotice(catalog, 'vbr', release.id)?.state).toBe('supported')
  })

  it('marks VBR, Veeam ONE, and Enterprise Manager releases before version 11 as legacy lifecycle releases', () => {
    const release = (name: string) => ({ name, aliases: [] }) as unknown as Parameters<typeof isLegacyLifecycleRelease>[1]

    expect(isLegacyLifecycleRelease('vbr', release('10.0'))).toBe(true)
    expect(isLegacyLifecycleRelease('veeam-one', release('6.5'))).toBe(true)
    expect(isLegacyLifecycleRelease('enterprise-manager', release('10.0'))).toBe(true)
    expect(isLegacyLifecycleRelease('vbr', release('11.0'))).toBe(false)
    expect(isLegacyLifecycleRelease('vspc', release('9.2'))).toBe(false)
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
    expect(findRelease(catalog, 'enterprise-manager', '13.0.2.29')?.id).toBe('em-build-13-0-2-29')
  })

  it('keeps Enterprise Manager builds distinct instead of resolving old 13.0.1 builds as current', () => {
    const release = findRelease(catalog, 'enterprise-manager', '13.0.1.2067')!
    expect(release.name).toBe('13.0.1 P2 (build 13.0.1.2067)')
    expect(findUpgradePath(catalog, release)?.id).toBe('em-13.0.1-to-13.0.2')
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
    expect(releaseMaterialSourceIds(catalog, 'vbr', target)).toEqual(['vbr-whats-new', 'release-material-vbr-13-0-release-notes'])
    expect(documentedFixSourceIds(catalog, target)).toContain('kb4852')
  })

  it('uses the target release family for automatic material links, including Enterprise Manager', () => {
    const vspcTarget = findRelease(catalog, 'vspc', '9.2.1')!
    const enterpriseManagerTarget = findRelease(catalog, 'enterprise-manager', '13.0.2.29')!

    expect(releaseMaterialSourceIds(catalog, 'vspc', vspcTarget)).toEqual([
      'release-material-vspc-9-2-whats-new',
      'release-material-vspc-9-2-release-notes',
    ])
    expect(releaseMaterialSourceIds(catalog, 'enterprise-manager', enterpriseManagerTarget)).toContain('vbr-whats-new')
  })

  it('selects source-backed VBR highlights as the installed-release delta', () => {
    const v10 = findRelease(catalog, 'vbr', '10.0.1.4854')!
    const v11 = findRelease(catalog, 'vbr', '11.0.0.837')!
    const target = findRelease(catalog, 'vbr', '13.0.2.29')!
    expect(upgradeHighlightsForRelease(catalog, v10, target)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Strengthen cyber resilience' }),
      expect.objectContaining({ title: 'Modernize backup management' }),
    ]))
    expect(upgradeHighlightsForRelease(catalog, v11, target).find((highlight) => highlight.title === 'Strengthen cyber resilience')?.summary).not.toContain('hardened repositories')
  })

  it.each([
    ['10.0.1.4854', 5],
    ['11.0.0.837', 5],
    ['12.0.0.1420', 4],
    ['12.1', 4],
    ['12.3.0.310', 3],
  ])('uses the expected VBR highlight depth from %s', (installed, expectedCount) => {
    const release = findRelease(catalog, 'vbr', installed)!
    const target = findRelease(catalog, 'vbr', '13.0.2.29')!
    expect(upgradeHighlightsForRelease(catalog, release, target)).toHaveLength(expectedCount)
  })

  it('selects capability highlights for every tracked product', () => {
    const cases = [
      ['enterprise-manager', '12.3.2.4165', '13.0.2.29'],
      ['veeam-one', '12.2', '13.0.2'],
      ['vro', '7.2.1', '13'],
      ['vspc', '8.1', '9.2'],
    ] as const
    for (const [productId, installed, targetVersion] of cases) {
      const release = findRelease(catalog, productId, installed)!
      const target = findRelease(catalog, productId, targetVersion)!
      expect(upgradeHighlightsForRelease(catalog, release, target).length).toBeGreaterThan(0)
    }
  })

  it('includes the VSA conversion portal and platform migration guide as catalog sources', () => {
    expect(catalog.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vsa-conversion', url: 'https://go.veeam.com/vsa-conversion' }),
      expect.objectContaining({ id: 'kb4800', url: 'https://www.veeam.com/kb4800' }),
    ]))
  })
})
