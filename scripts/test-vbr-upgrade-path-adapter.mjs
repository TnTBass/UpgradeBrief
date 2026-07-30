import { readFile } from 'node:fs/promises'
import { mergeVbrUpgradePaths, parseVbrUpgradePaths } from './lib/vbr-upgrade-paths.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-upgrade-path.fixture.html', import.meta.url), 'utf8')
const routes = parseVbrUpgradePaths(fixture)
if (routes.length !== 11 || !routes.some((route) => route.label === '13.0.2' && route.fromPrefix === '13.0.2.')) throw new Error('VBR KB2053 parser did not retain the documented 13.0.2 to 13.1 route.')

const families = ['10.0.1', '11.0.0', '11.0.1', '12.0', '12.1', '12.2', '12.3', '12.3.1', '12.3.2', '13.0.1', '13.0.2', '13.1']
const catalog = {
  products: [{ id: 'vbr', recommendedReleaseId: 'vbr-13-1' }],
  releases: [{ id: 'vbr-12-3-2-3617', productId: 'vbr', aliases: ['12.3.2.3617'], sourceIds: ['kb4771'] }, ...families.map((family) => ({ id: `vbr-${family.replace(/\./g, '-')}`, productId: 'vbr', aliases: [family, `${family}.1`], sourceIds: ['kb2680'] }))],
  upgradePaths: [
    { id: 'vbr-13-0-0-vsa-to-13-0-2', productId: 'vbr', fromReleaseId: 'vbr-vsa', fromVersionPrefixes: null, toReleaseId: 'vbr-13-0-2', hopReleaseIds: ['vbr-13-0-2'], notes: [], howToSourceIds: ['kb4738'], sourceIds: ['kb4738'] },
    { id: 'vbr-12-3-2-3617-to-13-0-2', productId: 'vbr', fromReleaseId: 'vbr-12-3-2-3617', toReleaseId: 'vbr-13-0-2', hopReleaseIds: ['vbr-12-3-2-4165', 'vbr-13-0-2'], notes: [], howToSourceIds: ['vbr-checklist'], sourceIds: ['kb2053', 'kb4771'] },
  ],
}
const merged = mergeVbrUpgradePaths(catalog, routes)
const direct = merged.catalog.upgradePaths.find((path) => path.fromVersionPrefixes?.includes('13.0.2.'))
if (merged.paths !== 11 || direct?.toReleaseId !== 'vbr-13-1' || direct.hopReleaseIds.join() !== 'vbr-13-1') throw new Error('VBR KB2053 merge did not create the direct 13.0.2 to 13.1 route.')
const twelveThree = merged.catalog.upgradePaths.find((path) => path.fromVersionPrefixes?.includes('12.3.'))
if (twelveThree?.hopReleaseIds.join() !== 'vbr-12-3-2,vbr-13-1') throw new Error('VBR KB2053 merge did not preserve the documented 12.3.2 intermediate hop.')
if (!merged.catalog.upgradePaths.some((path) => path.id === 'vbr-13-0-0-vsa-to-13-0-2')) throw new Error('VBR KB2053 merge must not replace the separate VSA route.')
const exactBuildRoute = merged.catalog.upgradePaths.find((path) => path.fromReleaseId === 'vbr-12-3-2-3617')
if (exactBuildRoute?.toReleaseId !== 'vbr-13-1' || exactBuildRoute.hopReleaseIds.join() !== 'vbr-12-3-2-4165,vbr-13-1') throw new Error('VBR KB2053 merge must advance exact-build guidance while retaining its security prerequisite.')

const undocumented = structuredClone(catalog)
undocumented.products[0].recommendedReleaseId = 'vbr-13-0-2'
if (mergeVbrUpgradePaths(undocumented, routes).paths !== 0) throw new Error('VBR KB2053 merge created a route to a target that KB2053 does not document.')

console.log('VBR KB2053 upgrade-path adapter fixture test passed.')
