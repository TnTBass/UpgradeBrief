import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { refreshCatalog } from './lib/catalog-refresh-isolation.mjs'
import { writeSecurityReviewReport } from './lib/security-review-baselines.mjs'
const snapshot = new URL('../src/data/catalog.snapshot.json', import.meta.url)
const baselineFile = new URL('./data/security-review-baselines.json', import.meta.url)
const args = process.argv.slice(2)
const candidatePath = args.find((arg) => !arg.startsWith('--'))
const live = args.includes('--live')

function runValidation(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-catalog.mjs', path], { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Catalog validation exited ${code}`)))
  })
}

async function validateThenInstall(candidate, baselineCandidate, beforeInstall) {
  const workspace = await mkdtemp(join(tmpdir(), 'upgrade-brief-'))
  const candidateFile = join(workspace, 'catalog.snapshot.json')
  try {
    await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`)
    await runValidation(candidateFile)
    if (beforeInstall) await beforeInstall()
    const oldSnapshot = await readFile(snapshot)
    const oldBaselines = baselineCandidate ? await readFile(baselineFile) : undefined
    try {
      await writeFile(snapshot, await readFile(candidateFile))
      if (baselineCandidate) await writeFile(baselineFile, `${JSON.stringify(baselineCandidate, null, 2)}\n`)
    } catch (error) {
      await writeFile(snapshot, oldSnapshot)
      if (oldBaselines) await writeFile(baselineFile, oldBaselines)
      throw error
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

if (candidatePath) {
  await validateThenInstall(JSON.parse(await readFile(candidatePath, 'utf8')))
  console.log('Candidate catalog validated and installed.')
  process.exit(0)
}

if (!live) {
  await runValidation(fileURLToPath(snapshot))
  console.log('No refresh requested. The committed snapshot remains unchanged.')
  process.exit(0)
}

const current = JSON.parse(await readFile(snapshot, 'utf8'))
const baselines = JSON.parse(await readFile(baselineFile, 'utf8'))
const reportDirectory = fileURLToPath(new URL('../artifacts/catalog-review/', import.meta.url))
const reviewTexts = {}
try {
  const result = await refreshCatalog({ current, baselines, reviewTexts, atomic: args.includes('--atomic') })
  await validateThenInstall(result.catalog, result.baselines, () => writeSecurityReviewReport({
    directory: reportDirectory, baselines: result.report.status === 'partial' ? result.baselines : baselines, texts: reviewTexts, catalog: result.report.status === 'partial' ? result.catalog : current, error: result.reviewError, partial: result.report.status === 'partial',
    equivalentChanges: result.equivalentChanges, inventoryChanges: result.inventoryChanges,
    summaryPath: process.env.GITHUB_STEP_SUMMARY,
  }))
  await writeFile(join(reportDirectory, 'refresh-result.json'), JSON.stringify(result.report, null, 2) + '\n')
  console.log(JSON.stringify(result.report))
} catch (error) {
  process.exitCode = 1
  console.error(error)
  await writeSecurityReviewReport({ directory: reportDirectory, baselines, texts: reviewTexts, catalog: current, error, summaryPath: process.env.GITHUB_STEP_SUMMARY })
}

