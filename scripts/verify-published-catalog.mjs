import { readFile } from 'node:fs/promises'
import { snapshotHash, verifyPublication } from './lib/catalog-repair-verification.mjs'

const catalog = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
const health = await verifyPublication({ commit: process.env.GITHUB_SHA, catalogHash: snapshotHash(catalog) })
console.log(JSON.stringify({ status: 'published-catalog-verified', ...health }))
