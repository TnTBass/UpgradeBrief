import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { journeySources } from '../src/data/upgrade-journey.ts'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { textFromDocument } from './lib/release-materials.mjs'

const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
const sources = [...Object.entries(journeySources).map(([id, source]) => ({ id, ...source })),
  ...catalog.sources.filter(source => source.id === 'release-material-vbr-13-1-release-notes' || source.id === 'kb2680' || source.id === 'kb4948')]
const fetcher = createCatalogSourceFetcher()
const results = []
await mkdir('artifacts/journey-review', { recursive: true })
for (const source of sources) {
  if (results.some(result => result.url.split('#')[0] === source.url.split('#')[0])) continue
  try {
    const response = await fetcher.request(source.url, { sourceId: source.id })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = await textFromDocument(bytes, response.headers.get('content-type') ?? '', source.url)
    const result = { ...source, finalUrl: response.url, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex'), text }
    results.push(result)
    console.log('JOURNEY_SOURCE ' + JSON.stringify(result))
  } catch (error) {
    results.push({ ...source, error: error.message })
    console.error('JOURNEY_SOURCE_ERROR ' + JSON.stringify(results.at(-1)))
    process.exitCode = 1
  }
  await writeFile('artifacts/journey-review/sources.json', JSON.stringify(results, null, 2) + '\n')
}
