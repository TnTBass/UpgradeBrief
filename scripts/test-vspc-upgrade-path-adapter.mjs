import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mergeVspcUpgradePaths, parseVspcUpgradePaths } from './lib/vspc-upgrade-paths.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vspc-upgrade.fixture.html', import.meta.url), 'utf8')
const guidance = parseVspcUpgradePaths(fixture)
assert.deepEqual(guidance, { targetFamily: '9.3', sourceFamilies: ['9.2', '9.1'], minimumBuild: '9.1.0.30636', minimumBuildFamily: '9.1' })
for (const html of [fixture.replace(' or later', ''), fixture.replace('9.1.0.30636', '9.0.0.30636'), fixture.replace('Page content applies', 'Unknown target')]) {
  assert.throws(() => parseVspcUpgradePaths(html), /refusing to replace/)
}
assert.deepEqual(parseVspcUpgradePaths(fixture.replace('9.1 (build', '<b>9.1</b>&nbsp;(build')), guidance)

const releases = ['9.1.0.30345', '9.1.0.30636', '9.1.0.30713', '9.2.0.33215', '9.2.1.33875', '9.3.0.35706', '9.4.0.1']
  .map((build) => ({ id: build, productId: 'vspc', aliases: [build] }))
releases.push({ id: 'family-only', productId: 'vspc', aliases: ['9.1'] })
const legacyPath = { id: 'legacy', productId: 'vspc', fromReleaseId: '8.1', toReleaseId: '9.2.0.33215' }
const otherPath = { id: 'other-product', productId: 'vbr', fromReleaseId: 'vbr-12' }
const catalog = {
  products: [{ id: 'vspc', recommendedReleaseId: '9.3.0.35706' }],
  releases,
  upgradePaths: [legacyPath, otherPath, { id: 'stale', productId: 'vspc', fromReleaseId: '9.1.0.30636', fromVersionPrefixes: ['9.1.'], toReleaseId: '9.2.0.33215' }],
}
const before = structuredClone(catalog)
const merged = mergeVspcUpgradePaths(catalog, guidance)
assert.equal(merged.paths, 4)
const routes = merged.catalog.upgradePaths.filter((path) => path.sourceIds?.includes('vspc-upgrade'))
assert.deepEqual(routes.map((path) => path.fromReleaseId), ['9.1.0.30636', '9.1.0.30713', '9.2.0.33215', '9.2.1.33875'])
for (const path of routes) {
  assert.equal(path.toReleaseId, '9.3.0.35706')
  assert.deepEqual(path.hopReleaseIds, ['9.3.0.35706'])
  assert.equal(path.fromVersionPrefixes, undefined)
}
assert.deepEqual(merged.catalog.upgradePaths.slice(0, 2), [legacyPath, otherPath])
assert.deepEqual(catalog, before)
assert.deepEqual(mergeVspcUpgradePaths(merged.catalog, guidance), merged)

const refreshed = structuredClone(catalog)
refreshed.releases.push({ id: 'future-9.1-patch', productId: 'vspc', aliases: ['9.1.0.31000'] })
assert.equal(mergeVspcUpgradePaths(refreshed, guidance).paths, 5)
refreshed.products[0].recommendedReleaseId = '9.4.0.1'
assert.throws(() => mergeVspcUpgradePaths(refreshed, guidance), /outside the documented upgrade target family/)
const incomplete = structuredClone(catalog)
incomplete.releases = incomplete.releases.filter((release) => !release.aliases.some((alias) => alias.startsWith('9.2.')))
assert.throws(() => mergeVspcUpgradePaths(incomplete, guidance), /missing a supported source family/)
console.log('VSPC upgrade-path adapter tests passed.')
