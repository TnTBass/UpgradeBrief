import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { findingAppliesToRelease, findLifecycleNotice, findRelease, findUpgradePath } from './lookup'

describe('catalog lookup', () => {
  it('matches an exact VBR build and gives the source-backed staged path', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')
    expect(release?.id).toBe('vbr-12.3.2.3617')
    expect(findUpgradePath(catalog, release!)?.hopReleaseIds).toEqual(['vbr-12.3.2.4165', 'vbr-13.0.2'])
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

  it('does not apply a release-specific lifecycle notice to a different release', () => {
    const release = findRelease(catalog, 'vbr', '13.0.1.180')!
    expect(findLifecycleNotice(catalog, 'vbr', release.id)?.state).toBe('check-source')
  })

  it('applies a documented VBR build range through its final vulnerable build', () => {
    const finding = {
      id: 'range', productId: 'vbr' as const, title: 'range', cves: ['CVE-2026-21669'], affectedReleaseIds: [],
      affectedBuildRanges: [{ versionPrefix: '13.', throughBuild: '13.0.1.1071' }], fixedReleaseId: 'vbr-build-13-0-1-2067', conditions: [], sourceIds: ['kb4831'],
    }
    expect(findingAppliesToRelease(finding, findRelease(catalog, 'vbr', '13.0.1.180')!)).toBe(true)
    expect(findingAppliesToRelease(finding, findRelease(catalog, 'vbr', '13.0.1.2067')!)).toBe(false)
  })
})
