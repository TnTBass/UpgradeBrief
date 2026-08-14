import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { documentedFixSourceIds, findingAppliesToRelease, findingsForRelease, findLifecycleNotice, findRelease, findUpgradePath, isLegacyLifecycleRelease, isRecommendedRelease, operationalNoticesForRelease, releaseImprovementsForRelease, releaseMaterialSourceIds, upgradeHighlightsForRelease, upgradeHowToSourceIds, upgradeTargetRelease } from './lookup'
import { classifyUrgency } from './urgency'

describe('catalog lookup', () => {
  it('matches an exact VBR build and gives the source-backed staged path', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')
    expect(release?.id).toBe('vbr-12.3.2.3617')
    expect(findUpgradePath(catalog, release!)?.hopReleaseIds).toEqual(['vbr-12.3.2.4165', catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId])
    expect(findUpgradePath(catalog, release!)?.guidanceNote).toContain('security-first recommendation')
  })

  it('uses KB2053 guidance for the broad 12.3.2 family', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2')!
    expect(findUpgradePath(catalog, release!)?.toReleaseId).toBe(catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId)
  })

  it('routes patched VBR 12.3.2 builds directly using the most specific KB2053 prefix', () => {
    const targetId = catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId

    for (const version of ['12.3.2.4165', '12.3.2.4854']) {
      const release = findRelease(catalog, 'vbr', version)!
      const path = findUpgradePath(catalog, release)!

      expect(path.fromVersionPrefixes).toEqual(['12.3.2.'])
      expect(path.hopReleaseIds).toEqual([targetId])
      expect(path.sourceIds).toContain('kb2053')
    }
  })

  it('routes VBR 13.0.1 builds directly to the KB2053 target', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.2067')!
    const path = findUpgradePath(catalog, release)!

    expect(path.toReleaseId).toBe(catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId)
    expect(path.hopReleaseIds).toEqual([path.toReleaseId])
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

  it('shows the KB4892 Veeam ONE advisories through 13.0.2.6723 but not on 13.1.0.7034', () => {
    const vulnerable = findRelease(catalog, 'veeam-one', '13.0.2.6723')!
    const fixed = findRelease(catalog, 'veeam-one', '13.1.0.7034')!

    expect(findingsForRelease(catalog, vulnerable).some((finding) => finding.cves.includes('CVE-2026-64633'))).toBe(true)
    expect(findingsForRelease(catalog, fixed).some((finding) => finding.cves.includes('CVE-2026-64633'))).toBe(false)
  })

  it('applies each legacy VSPC advisory through its documented final vulnerable build', () => {
    const unsupported = findRelease(catalog, 'vspc', '6.0.0.8787')!
    const v7EnhancedFix = findRelease(catalog, 'vspc', '7.0.0.19551')!
    const v81BulletinFix = findRelease(catalog, 'vspc', '8.1.0.21377')!
    const v81FinalFix = findRelease(catalog, 'vspc', '8.1.0.21999')!
    const unsupportedCves = findingsForRelease(catalog, unsupported).flatMap((finding) => finding.cves)
    const v7Cves = findingsForRelease(catalog, v7EnhancedFix).flatMap((finding) => finding.cves)
    const bulletinFixCves = findingsForRelease(catalog, v81BulletinFix).flatMap((finding) => finding.cves)
    const finalFixCves = findingsForRelease(catalog, v81FinalFix).flatMap((finding) => finding.cves)

    expect(unsupportedCves).not.toContain('CVE-2024-29212')
    expect(unsupportedCves).toEqual(expect.arrayContaining(['CVE-2024-38650', 'CVE-2024-42448']))
    expect(v7Cves).not.toContain('CVE-2024-29212')
    expect(v7Cves).toEqual(expect.arrayContaining(['CVE-2024-38650', 'CVE-2024-42448']))
    expect(bulletinFixCves).not.toContain('CVE-2024-38650')
    expect(bulletinFixCves).toEqual(expect.arrayContaining(['CVE-2024-42448', 'CVE-2024-42449']))
    expect(finalFixCves).not.toContain('CVE-2024-42448')
    expect(finalFixCves).not.toContain('CVE-2024-42449')
  })

  it('applies every KB4893 CVE through pre-9.3 VSPC releases after CVE-record reconciliation', () => {
    const kb4893Cves = ['CVE-2026-58073', 'CVE-2026-58072', 'CVE-2026-58067', 'CVE-2026-58071']
    const vulnerableVersions = [
      '4.0.0.4914',
      '5.0.0.7151',
      '6.0.0.8787',
      '7.0.0.19551',
      '8.0.0.19552',
      '8.1.0.21999',
      '9.2.1.33875',
    ]

    for (const version of vulnerableVersions) {
      const vulnerable = findRelease(catalog, 'vspc', version)!
      const vulnerableCves = findingsForRelease(catalog, vulnerable).flatMap((finding) => finding.cves)
      expect(vulnerableCves).toEqual(expect.arrayContaining(kb4893Cves))
    }

    const fixed = findRelease(catalog, 'vspc', '9.3.0.35057')!
    const fixedCves = findingsForRelease(catalog, fixed).flatMap((finding) => finding.cves)

    for (const cve of kb4893Cves) expect(fixedCves).not.toContain(cve)
  })

  it('applies the KB4853 alarm-script RCE to legacy VSPC builds', () => {
    for (const version of ['4.0.0.4914', '5.0.0.7151', '6.0.0.8787', '7.0.0.19551', '8.1.0.21999']) {
      const vulnerable = findRelease(catalog, 'vspc', version)!
      const cves = findingsForRelease(catalog, vulnerable).flatMap((finding) => finding.cves)

      expect(cves).toContain('CVE-2026-32998')
    }
  })

  it('applies CVE-2026-64635 through VSPC 9.2 after CVE-record reconciliation but not to 9.2.1', () => {
    for (const version of ['4.0.0.4914', '5.0.0.7151', '6.0.0.8787', '7.0.0.19551', '8.0.0.19552', '8.1.0.21999', '9.0.0.29860', '9.1.0.30713', '9.2.0.33215']) {
      const vulnerable = findRelease(catalog, 'vspc', version)!
      const cves = findingsForRelease(catalog, vulnerable).flatMap((finding) => finding.cves)
      expect(cves).toContain('CVE-2026-64635')
    }

    const fixed = findRelease(catalog, 'vspc', '9.2.1.33875')!
    expect(findingsForRelease(catalog, fixed).flatMap((finding) => finding.cves)).not.toContain('CVE-2026-64635')
  })

  it('shows CVE-less VSPC release Security fixes only on their documented pre-fix builds', () => {
    const v5 = findingsForRelease(catalog, findRelease(catalog, 'vspc', '5.0.0.6959')!)
    const v6 = findingsForRelease(catalog, findRelease(catalog, 'vspc', '6.0.0.7739')!)
    const v91 = findingsForRelease(catalog, findRelease(catalog, 'vspc', '9.1.0.30636')!)
    const v91Fixed = findingsForRelease(catalog, findRelease(catalog, 'vspc', '9.1.0.30713')!)

    expect(v5.filter((finding) => finding.sourceIds.includes('kb4223'))).toHaveLength(2)
    expect(v6.some((finding) => finding.sourceIds.includes('kb4277'))).toBe(true)
    expect(v91.some((finding) => finding.sourceIds.includes('kb4788') && finding.cves.length === 0)).toBe(true)
    expect(v91Fixed.some((finding) => finding.sourceIds.includes('kb4788') && finding.cves.length === 0)).toBe(false)
  })

  it('preserves build-specific Veeam ONE hotfix remediation without inventing a fixed server build', () => {
    const vulnerable = findRelease(catalog, 'veeam-one', '10.0.0.750')!
    const finding = findingsForRelease(catalog, vulnerable).find((item) => item.cves.includes('CVE-2020-10914'))!

    expect(finding.fixedReleaseId).toBeUndefined()
    expect(finding.remediation).toContain('KB3144 hotfix')
    expect(finding.conditions.join(' ')).toContain('Veeam ONE Agent component')
  })

  it('does not stamp other KB4649 product sections as VBR findings', () => {
    const release = findRelease(catalog, 'vbr', '12.1.2.172')!
    const cves = findingsForRelease(catalog, release).flatMap((finding) => finding.cves)
    const kevFinding = catalog.securityFindings.find((finding) => finding.cves.includes('CVE-2024-40711'))!

    expect(cves).not.toContain('CVE-2024-42024')
    expect(cves).not.toContain('CVE-2024-40709')
    expect(cves).not.toContain('CVE-2024-38650')
    expect(kevFinding.isCisaKev).toBe(true)
    expect(kevFinding.sourceIds).toContain('cisa-kev')
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
    expect(findUpgradePath(catalog, release)?.toReleaseId).toBe(catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId)
  })

  it('keeps documented pre-12.3.2 VBR paths available for concrete builds', () => {
    const versions = [
      '10.0.1.4854', '11.0.0.837', '12.0.0.1420 P20230718', '12.1.0.2131', '12.2.0.334', '12.3.0.310', '12.3.1.1139',
    ] as const

    for (const version of versions) {
      const release = findRelease(catalog, 'vbr', version)!
      expect(findUpgradePath(catalog, release)?.toReleaseId).toBe(catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId)
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
    const recommendedId = catalog.products.find((product) => product.id === 'veeam-one')!.recommendedReleaseId
    const recommended = catalog.releases.find((release) => release.id === recommendedId)!

    expect(isRecommendedRelease(catalog, recommended)).toBe(true)
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
    expect(upgradeHowToSourceIds('vb365')).toEqual(['vb365-upgrade', 'vb365-after-upgrade'])
  })

  it('resolves VB365 console and log builds to one release with a documented route', () => {
    const consoleRelease = findRelease(catalog, 'vb365', '8.4.0.1457')!
    const logRelease = findRelease(catalog, 'vb365', '13.4.0.1457')!

    expect(consoleRelease.id).toBe(logRelease.id)
    expect(findUpgradePath(catalog, consoleRelease)?.hopReleaseIds).toEqual(['vb365-build-8-5-0-1014'])
    expect(releaseMaterialSourceIds(catalog, 'vb365', findRelease(catalog, 'vb365', '8.5.0.1014'))).toContain('release-material-vb365-8-5-release-notes')
  })

  it('keeps the older VB365 retention issue separate from security findings', () => {
    const release = findRelease(catalog, 'vb365', '5.0.3.1033')!

    expect(findingsForRelease(catalog, release)).toEqual([])
    expect(operationalNoticesForRelease(catalog, release)).toEqual([
      expect.objectContaining({ id: 'vb365-retention-policy-data-risk', sourceIds: ['kb4103'] }),
    ])
  })

  it('links current target release material and keeps documented fixes source-backed', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')!
    const target = upgradeTargetRelease(catalog, 'vbr', findUpgradePath(catalog, release))!
    const currentTargetId = catalog.products.find((product) => product.id === 'vbr')!.recommendedReleaseId
    const previousFixedRelease = findRelease(catalog, 'vbr', '13.0.2.29')!

    expect(target.id).toBe(currentTargetId)
    expect(releaseMaterialSourceIds(catalog, 'vbr', target)).toContain('release-material-vbr-13-1-release-notes')
    expect(documentedFixSourceIds(catalog, previousFixedRelease)).toContain('kb4852')
  })

  it('shows VBR 13.1 improvements when upgrading from 13.0.2', () => {
    const release = findRelease(catalog, 'vbr', '13.0.2.29')!
    const target = upgradeTargetRelease(catalog, 'vbr', findUpgradePath(catalog, release))!

    expect(releaseMaterialSourceIds(catalog, 'vbr', target)).toContain('release-material-vbr-13-1-whats-new')
    expect(upgradeHighlightsForRelease(catalog, release, target)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Automated Active Directory Forest Recovery',
        sourceIds: ['release-material-vbr-13-1-whats-new'],
      }),
      expect.objectContaining({ title: 'Broader hypervisor protection' }),
    ]))
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
      ['vb365', '7.0.0.4901', '8.5.0.1014'],
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
