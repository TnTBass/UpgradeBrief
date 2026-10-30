import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { Catalog } from './src/lib/catalog-types'

export default defineConfig({
  plugins: [react(), {
    name: 'catalog-publication-identity',
    apply: 'build',
    buildStart() {
      const catalog = JSON.parse(readFileSync(new URL('./src/data/catalog.snapshot.json', import.meta.url), 'utf8')) as Catalog
      const commit = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Missing publication commit identity')
      const catalogHash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
      this.emitFile({ type: 'asset', fileName: 'catalog-health.json', source: JSON.stringify({ schemaVersion: catalog.schemaVersion, commit, catalogHash, generatedAt: catalog.generatedAt, ...(catalog.schemaVersion === 2 ? { assembledAt: catalog.assembledAt, productValidation: catalog.productValidation } : {}) }) })
    },
  }],
  test: {
    environment: 'node',
  },
})
