import { resolve } from 'node:path'
import { verifyCatalogCheckout } from './lib/catalog-repair-verification.mjs'
const checks = verifyCatalogCheckout(resolve('.'), { live: process.argv.includes('--live') })
console.log(`Catalog repair verification passed (${checks.length} checks).`)
