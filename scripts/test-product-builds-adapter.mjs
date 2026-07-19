import { readFile } from 'node:fs/promises'
import { mergeProductBuilds, parseProductBuilds } from './lib/product-builds.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/product-builds.fixture.html', import.meta.url), 'utf8')
const oneRecords = parseProductBuilds(fixture, 'Veeam ONE')
if (oneRecords.length !== 2 || oneRecords[0].build !== '13.0.2.6723') throw new Error('Veeam ONE build parser did not retain the exact build.')
const vspcRecords = parseProductBuilds(fixture, 'Veeam Service Provider Console')
if (vspcRecords.length !== 1 || vspcRecords[0].label !== '9.2.1') throw new Error('VSPC build parser did not isolate its product.')
const catalog = { products: [{ id: 'vspc', recommendedReleaseId: 'old' }], releases: [] }
const merged = mergeProductBuilds(catalog, { productId: 'vspc', sourceId: 'kb4464', records: vspcRecords })
if (merged.additions !== 1 || merged.catalog.products[0].recommendedReleaseId !== 'vspc-build-9-2-1-33875') throw new Error('Product build merge did not update the recommended release.')
console.log('Product build adapter fixture test passed.')
