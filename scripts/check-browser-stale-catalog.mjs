import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const path = 'src/data/catalog.snapshot.json'
const original = await readFile(path, 'utf8')
try {
  const catalog = JSON.parse(original)
  const old = new Date(Date.now() - 73 * 3_600_000).toISOString()
  catalog.generatedAt = old
  catalog.schemaVersion = 2
  catalog.assembledAt = new Date().toISOString()
  catalog.productValidation = catalog.products.map(product => ({
    productId: product.id, state: 'retained', validatedAt: old, attemptedAt: catalog.assembledAt,
    partitionHash: 'a'.repeat(64), transactionId: 'b'.repeat(64), evidenceIds: ['fixture'], failureCodes: ['TEST_SOURCE_FAILURE'],
  }))
  // This synthetic fixture is built only for browser checks and never published.
  await writeFile(path, JSON.stringify(catalog, null, 2) + '\n')
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' })
  execFileSync(process.execPath, ['scripts/check-browser-pdf.mjs'], { stdio: 'inherit', env: { ...process.env, STALE_CATALOG_TEST: '1' } })
} finally {
  await writeFile(path, original)
}

