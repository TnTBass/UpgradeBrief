import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { findingAppliesToRelease, findRelease, findUpgradePath } from './lookup'

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
    const finding = catalog.securityFindings.find((item) => item.id === 'vbr-cve-2024-40711')!
    const release = { id: 'vbr-build-11a-other', productId: 'vbr' as const, name: '11a', aliases: ['11.0.1.1261 P20211211'], sourceIds: ['kb2680'] }
    expect(findingAppliesToRelease(finding, release)).toBe(true)
  })

  it('applies the documented 11a route to a refreshed build variant', () => {
    const release = { id: 'vbr-build-11a-p20211211', productId: 'vbr' as const, name: '11a', aliases: ['11.0.1.1261 P20211211'], sourceIds: ['kb2680'] }
    expect(findUpgradePath(catalog, release)?.id).toBe('vbr-11a-p20230227-to-13.0.2')
  })
})
