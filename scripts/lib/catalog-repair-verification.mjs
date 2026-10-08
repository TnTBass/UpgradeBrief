import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const snapshotHash = catalog => createHash('sha256').update(JSON.stringify(catalog)).digest('hex')

export function verifyCatalogCheckout(directory, { live = false } = {}) {
  const logDirectory = join(directory, 'artifacts/catalog-repair/verification')
  mkdirSync(logDirectory, { recursive: true })
  const packageFile = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const checks = [
    ...(live ? [['live-refresh', ['scripts/refresh-catalog.mjs', '--live']]] : []),
    ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
    ['app-tests', ['node_modules/vitest/vitest.mjs', 'run']],
    ...Object.entries(packageFile.scripts).filter(([key]) => key.startsWith('test:')).map(([key, command]) => {
      if (!/^node scripts\/[\w.-]+\.mjs$/.test(command)) throw new Error(`Unsupported verification script: ${key}`)
      return [key, [command.slice(5)]]
    }),
    ['catalog', ['scripts/validate-catalog.mjs']],
    ['typescript', ['node_modules/typescript/bin/tsc', '-b']],
    ['build', ['node_modules/vite/bin/vite.js', 'build']],
  ]
  const passed = []
  for (const [name, args] of checks) {
    const logPath = join(logDirectory, `${name.replaceAll(':', '-')}.log`)
    try {
      const output = execFileSync(process.execPath, args, { cwd: directory, encoding: 'utf8', maxBuffer: 8_000_000, timeout: name === 'live-refresh' ? 1_500_000 : 300_000, env: { ...process.env, CLOUDFLARE_WORKERS_AI_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '' } })
      writeFileSync(logPath, output)
      passed.push(name)
      console.log(`Verified ${name}`)
    } catch (error) {
      writeFileSync(logPath, `${error.stdout ?? ''}\n${error.stderr ?? ''}`)
      throw new Error(`Candidate check failed: ${name}; see ${logPath}`)
    }
  }
  return passed
}

export async function verifyPublication({ url = 'https://upgradebrief.com/catalog-health.json', commit, catalogHash, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 30 }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}$/.test(catalogHash)) throw new Error('Invalid expected publication identity')
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(`${url}?commit=${commit}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000), redirect: 'error' })
      if (response.ok) {
        const health = await response.json()
        if (health.schemaVersion === 1 && health.commit === commit && health.catalogHash === catalogHash) return health
      }
    } catch { /* Deployment may still be starting; retry within the fixed window. */ }
    if (attempt + 1 < attempts) await sleep(20_000)
  }
  throw new Error('Published catalog commit/hash could not be verified within ten minutes')
}

export async function verifyRepairDeployment(api, { environment = 'production', commit, catalogHash, attempts = 30, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (environment === 'production') return verifyPublication({ commit, catalogHash, attempts, sleep })
  if (environment !== 'trial') throw new Error('Unknown publication environment')
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await api(`/commits/${commit}/check-runs?per_page=100`)
    const build = response.check_runs.find(check => check.name === 'Workers Builds: upgradebrief')
    if (build?.conclusion === 'failure') throw new Error('Cloudflare trial preview build failed')
    const preview = build?.output?.summary?.match(/Preview URL: (https:\/\/[a-z0-9-]+-upgradebrief\.tyler-jurgens\.workers\.dev)\b/)?.[1]
    if (build?.conclusion === 'success' && preview) {
      try { return { ...await verifyPublication({ url: `${preview}/catalog-health.json`, commit, catalogHash, attempts: 1 }), preview } }
      catch { /* A successful build may take a moment to reach the preview edge. */ }
    }
    if (attempt + 1 < attempts) await sleep(20_000)
  }
  throw new Error('Trial preview catalog could not be verified within the bounded window')
}
