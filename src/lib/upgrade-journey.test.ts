import { describe, expect, it } from 'vitest'
import { catalog as liveCatalog } from '../data/catalog'
import type { Catalog, UpgradePath } from './catalog-types'
import reviewedJourney from './fixtures/reviewed-vbr-journey.json'
import { buildUpgradeJourney, journeyItems, journeySources } from './upgrade-journey'
import { findRelease, findUpgradePath } from './lookup'

// These editorial tests exercise the route that was actually reviewed. A
// scheduled release discovery must not silently extend the guidance's scope.
const catalog: Catalog = {
  ...liveCatalog,
  products: liveCatalog.products.map(product => product.id === 'vbr' ? { ...product, recommendedReleaseId: reviewedJourney.recommendedReleaseId } : product),
  upgradePaths: [...liveCatalog.upgradePaths.filter(path => path.productId !== 'vbr'), ...reviewedJourney.upgradePaths as UpgradePath[]],
}

function journeyFor(version: string) {
  const release = findRelease(catalog, 'vbr', version)!
  return buildUpgradeJourney(catalog, release, findUpgradePath(catalog, release))!
}
function ids(journey: ReturnType<typeof journeyFor>, stage: number) {
  return journey.stages[stage].groups.flatMap((group) => group.itemIds)
}

describe('upgrade journey applicability', () => {
  it('puts V11 blockers before entering V12 and follows the catalog hops', () => {
    const release = findRelease(catalog, 'vbr', '11.0.0.837')!
    const path = findUpgradePath(catalog, release)!
    const journey = journeyFor('11.0.0.837')
    expect(journey.route.map((item) => item.id)).toEqual([release.id, ...path.hopReleaseIds])
    expect(journey.stages[1].groups[0]).toMatchObject({ title: 'Before installing V12.0', itemIds: ['retention', 'rollback', 'licensing'] })
    expect(journey.retentionAlreadyApplies).toBe(false)
  })

  it('keeps retention visible for an early V12 start without repeating V11 blockers', () => {
    const journey = journeyFor('12.0')
    expect(journey.retentionAlreadyApplies).toBe(true)
    expect(ids(journey, 0)).toContain('retention')
    expect(journey.stages.flatMap((stage) => stage.groups.flatMap((group) => group.itemIds))).not.toContain('rollback')
    expect(journey.stages.map((stage) => stage.label)).toEqual(['Prepare now', 'V12.3.2 hop', 'V13.1.1 hop'])
  })

  it.each(['12.3.1.1139', '12.3.2.4854'])('keeps conversion work before V13 on a direct route from %s', (version) => {
    const journey = journeyFor(version)
    expect(journey.stages).toHaveLength(2)
    expect(ids(journey, 0)).toEqual(expect.arrayContaining(['conversion', 'agentBridge', 'retention']))
    expect(ids(journey, 0)).not.toContain('database')
  })

  it('retains the patched V11a route rather than adding an incompatible V12.0 hop', () => {
    const release = findRelease(catalog, 'vbr', '11.0.1.1261 P20240304')!
    const path = findUpgradePath(catalog, release)!
    const journey = journeyFor('11.0.1.1261 P20240304')
    expect(journey.route.map((item) => item.id)).not.toContain('vbr-12.0')
    expect(journey.stages[1].groups[0].itemIds).toEqual(expect.arrayContaining(['rollback', 'retention']))
    expect(path.guidanceNote).toContain('Nutanix AHV')
    expect(path.fromReleaseId).toBe(release.id)
  })

  it('keeps the conditional V11a shortcut visible without assuming whether AHV is used', () => {
    const release = findRelease(catalog, 'vbr', '11a')!
    const before = JSON.stringify(catalog.upgradePaths)
    const path = findUpgradePath(catalog, release)!
    expect(path.hopReleaseIds).toContain('vbr-12.0')
    expect(path.guidanceNote).toContain('does not interact with Nutanix AHV')
    expect(JSON.stringify(catalog.upgradePaths)).toBe(before)
  })

  it('does not invent guidance for other products, versions, missing paths or unreviewed targets', () => {
    const release = findRelease(catalog, 'vbr', '12.0')!
    const path = findUpgradePath(catalog, release)!
    expect(buildUpgradeJourney(catalog, release)).toBeUndefined()
    expect(buildUpgradeJourney(catalog, release, { ...path, toReleaseId: 'future-release' })).toBeUndefined()
    expect(buildUpgradeJourney(catalog, release, { ...path, hopReleaseIds: ['missing', path.toReleaseId] })).toBeUndefined()
    expect(buildUpgradeJourney(catalog, { ...release, productId: 'veeam-one' }, path)).toBeUndefined()
    expect(journeyFor('13.0.2.29')).toBeUndefined()
    expect(journeyFor('13.1.1.18')).toBeUndefined()
  })

  it('holds editorial guidance when the catalog discovers a new destination build', () => {
    const release = findRelease(catalog, 'vbr', '12.0')!
    const path = findUpgradePath(catalog, release)!
    const future = { id: 'unreviewed-vbr-build', productId: 'vbr' as const, name: '13.1.2', aliases: ['13.1.2.57'], sourceIds: ['kb2680'] }
    const updated: Catalog = {
      ...catalog,
      releases: [...catalog.releases, future],
      products: catalog.products.map(product => product.id === 'vbr' ? { ...product, recommendedReleaseId: future.id } : product),
    }
    expect(buildUpgradeJourney(updated, release, { ...path, toReleaseId: future.id, hopReleaseIds: [...path.hopReleaseIds.slice(0, -1), future.id] })).toBeUndefined()
  })

  it('keeps every displayed item source-linked and free of em dashes', () => {
    for (const version of ['11.0.0.837', '11a', '11.0.1.1261 P20240304', '12.0', '12.1', '12.2', '12.3.1.1139', '12.3.2.4854']) {
      const journey = journeyFor(version)
      for (const stage of journey.stages) for (const group of stage.groups) for (const id of group.itemIds) {
        if (id === 'retention') continue
        expect(journeyItems[id], id).toBeDefined()
        expect(journeyItems[id].refs.length).toBeGreaterThan(0)
        for (const ref of journeyItems[id].refs) expect(journeySources[ref]).toBeDefined()
      }
      expect(JSON.stringify(journey)).not.toContain('\u2014')
    }
    expect(JSON.stringify(journeyItems)).not.toContain('\u2014')
  })
})
