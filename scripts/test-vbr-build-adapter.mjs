import { readFile } from 'node:fs/promises'
import { parseVbrBuilds, mergeVbrBuilds } from './lib/vbr-builds.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-builds.fixture.html', import.meta.url), 'utf8')
const records = parseVbrBuilds(fixture)
if (records.length !== 3) throw new Error(`Expected 3 VBR builds, received ${records.length}`)
if (!records.some((record) => record.build === '11.0.1.1261 P20230227')) throw new Error('VBR 11a patch build was not parsed')

const base = { releases: [{ id: 'vbr-13.0.2', productId: 'vbr', aliases: ['13.0.2.29'], sourceIds: [] }] }
const merged = mergeVbrBuilds(base, records)
if (merged.additions !== 2) throw new Error(`Expected 2 new builds, received ${merged.additions}`)
if (!merged.catalog.releases.find((release) => release.aliases.includes('11.0.1.1261 P20230227'))) throw new Error('VBR 11a build was not merged')

console.log('VBR build adapter fixture test passed.')
