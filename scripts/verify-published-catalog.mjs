import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { snapshotHash, verifyPublication } from './lib/catalog-repair-verification.mjs'

const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const health = await verifyPublication({ commit, catalogHash: snapshotHash(catalog) })
console.log(JSON.stringify({ status: 'published-catalog-verified', ...health }))
