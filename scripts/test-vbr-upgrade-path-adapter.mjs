import { readFile } from 'node:fs/promises'
import { mergeVbrUpgradePaths, parseVbrUpgradePaths } from './lib/vbr-upgrade-paths.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-upgrade-path.fixture.html', import.meta.url), 'utf8')
const routes = parseVbrUpgradePaths(fixture)
if (routes.length !== 12 || !routes.some((route) => route.label === '13.0.3' && route.fromPrefix === '13.0.3.')) throw new Error('VBR KB2053 parser did not retain the documented 13.0.3 to 13.1 route.')

const families = ['10.0.1', '11.0.0', '11.0.1', '12.0', '12.1', '12.2', '12.3', '12.3.1', '12.3.2', '13.0.1', '13.0.2', '13.0.3', '13.1']
const catalog = {
  products: [{ id: 'vbr', recommendedReleaseId: 'vbr-13-1-1' }],
  releases: [...families.map((family) => ({ id: `vbr-${family.replace(/\./g, '-')}`, productId: 'vbr', aliases: [family, `${family}.1`], sourceIds: ['kb2680'] })), { id: 'vbr-13-1-1', productId: 'vbr', aliases: ['13.1.1.18', '13.1.1'], sourceIds: ['kb2680'] }],
  upgradePaths: [
    { id: 'vbr-13-0-0-vsa-to-13-0-2', productId: 'vbr', fromReleaseId: 'vbr-vsa', fromVersionPrefixes: null, toReleaseId: 'vbr-13-0-2', hopReleaseIds: ['vbr-13-0-2'], notes: [], howToSourceIds: ['kb4738'], sourceIds: ['kb4738'] },
  ],
}
const merged = mergeVbrUpgradePaths(catalog, routes)
const direct = merged.catalog.upgradePaths.find((path) => path.fromVersionPrefixes?.includes('13.0.3.'))
if (merged.paths !== 12 || direct?.toReleaseId !== 'vbr-13-1-1' || direct.hopReleaseIds.join() !== 'vbr-13-1-1') throw new Error('VBR KB2053 merge did not map the documented 13.1 family to its current recommended patch.')
const twelveThree = merged.catalog.upgradePaths.find((path) => path.fromVersionPrefixes?.includes('12.3.'))
if (twelveThree?.hopReleaseIds.join() !== 'vbr-12-3-2,vbr-13-1-1') throw new Error('VBR KB2053 merge did not preserve the documented 12.3.2 intermediate hop without inserting the superseded 13.1 GA build.')
if (!merged.catalog.upgradePaths.some((path) => path.id === 'vbr-13-0-0-vsa-to-13-0-2')) throw new Error('VBR KB2053 merge must not replace the separate VSA route.')

const undocumented = structuredClone(catalog)
undocumented.products[0].recommendedReleaseId = 'vbr-13-0-2'
if (mergeVbrUpgradePaths(undocumented, routes).paths !== 0) throw new Error('VBR KB2053 merge created a route to a target that KB2053 does not document.')

console.log('VBR KB2053 upgrade-path adapter fixture test passed.')
