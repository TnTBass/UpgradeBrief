import { readFile } from 'node:fs/promises'
import { mergeVb365Builds, parseVb365Builds } from './lib/vb365-builds.mjs'
import { mergeVb365UpgradePaths, parseVb365UpgradePaths } from './lib/vb365-upgrade-paths.mjs'

const buildsFixture = await readFile(new URL('../src/data/fixtures/vb365-builds.fixture.html', import.meta.url), 'utf8')
const records = parseVb365Builds(buildsFixture)
if (records.length !== 7 || records[0].consoleBuild !== '8.5.0.1014' || records[0].logBuild !== '13.5.0.1014') throw new Error('VB365 build parser did not retain console and log-build aliases.')

const catalog = {
  products: [{ id: 'vb365', recommendedReleaseId: 'old' }],
  releases: [],
  upgradePaths: [],
}
const merged = mergeVb365Builds(catalog, records)
if (merged.additions !== 7 || merged.catalog.products[0].recommendedReleaseId !== 'vb365-build-8-5-0-1014') throw new Error('VB365 build merge did not select the latest console build.')
const current = merged.catalog.releases.find((release) => release.id === 'vb365-build-8-5-0-1014')
if (!current?.aliases.includes('13.5.0.1014')) throw new Error('VB365 log build was not retained as an input alias.')

const pathFixture = await readFile(new URL('../src/data/fixtures/vb365-upgrade-path.fixture.html', import.meta.url), 'utf8')
const routes = parseVb365UpgradePaths(pathFixture)
if (routes.length !== 4 || routes[0].prefix !== '7.0.' || routes[1].prefix !== '7.1.') throw new Error('VB365 upgrade-path parser did not retain documented version families.')
const pathMerged = mergeVb365UpgradePaths(merged.catalog, routes)
const sevenRoute = pathMerged.catalog.upgradePaths.find((path) => path.fromVersionPrefixes.includes('7.0.'))
if (!sevenRoute || sevenRoute.hopReleaseIds.length !== 2) throw new Error('VB365 upgrade-path merge did not preserve the intermediate 8.4 hop.')

const newerBuildCatalog = structuredClone(merged.catalog)
newerBuildCatalog.releases.push({ id: 'vb365-build-8-6-0-1', productId: 'vb365', name: '8.6 (build 8.6.0.1)', aliases: ['8.6.0.1', '13.6.0.1', '8.6'], sourceIds: ['kb4106'] })
newerBuildCatalog.products[0].recommendedReleaseId = 'vb365-build-8-6-0-1'
if (mergeVb365UpgradePaths(newerBuildCatalog, routes).paths !== 0) throw new Error('VB365 route merge asserted a path to a newer build before KB4098 documented it.')

console.log('VB365 build and upgrade-path adapter fixture test passed.')
