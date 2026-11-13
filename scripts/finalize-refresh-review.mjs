import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { hash } from './lib/catalog-provenance.mjs'
const path = 'artifacts/catalog-review/review.json'
const report = JSON.parse(await readFile(path, 'utf8'))
if (report.status === 'partial') {
  const result = JSON.parse(await readFile('artifacts/catalog-review/refresh-result.json', 'utf8'))
  const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
  if (result.catalogHash !== hash(catalog) || execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Partial refresh evidence does not match the committed catalogue')
  report.baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  await writeFile(path, JSON.stringify(report, null, 2) + '\n')
}

