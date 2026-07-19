import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { findRelease, findUpgradePath } from './lookup'

describe('catalog lookup', () => {
  it('matches an exact VBR build and gives the source-backed staged path', () => {
    const release = findRelease(catalog, 'vbr', '12.3.2.3617')
    expect(release?.id).toBe('vbr-12.3.2.3617')
    expect(findUpgradePath(catalog, release!.id)?.hopReleaseIds).toEqual(['vbr-12.3.2.4165', 'vbr-13.0.2'])
  })

  it('does not infer an unmatched build from a nearby release', () => {
    expect(findRelease(catalog, 'vbr', '12.3.2.4000')).toBeUndefined()
  })
})
