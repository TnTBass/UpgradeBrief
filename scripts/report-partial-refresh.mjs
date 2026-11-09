import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { hash } from './lib/catalog-provenance.mjs'
const result = JSON.parse(await readFile('artifacts/catalog-review/refresh-result.json', 'utf8'))
if (result.status === 'partial') {
  const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
  if (hash(catalog) !== result.catalogHash) throw new Error('Published partial catalog differs from validated assembly')
  const path = 'artifacts/catalog-review/review.json'
  const review = JSON.parse(await readFile(path, 'utf8'))
  review.sourceRunBaseCommit = review.baseCommit
  review.baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  await writeFile(path, JSON.stringify(review, null, 2) + '\n')
  throw new Error('Partial refresh published and verified; retained product groups still require repair: ' + JSON.stringify(result.transactions.filter(item => item.state === 'retained')))
}
if (result.status !== 'complete') throw new Error('Unexpected refresh outcome')

