import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mergeVbrBuilds, parseVbrBuilds } from './lib/vbr-builds.mjs'
import { mergeVbrSecurityBulletin, mergeVeeamOneSecurityBulletin, parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin } from './lib/vbr-security.mjs'
import { mergeCisaKev, parseCisaKev } from './lib/cisa-kev.mjs'

const snapshot = new URL('../src/data/catalog.snapshot.json', import.meta.url)
const args = process.argv.slice(2)
const candidatePath = args.find((arg) => !arg.startsWith('--'))
const live = args.includes('--live')

function runValidation(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-catalog.mjs', path], { stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Catalog validation exited ${code}`)))
  })
}

async function validateThenInstall(candidate) {
  const workspace = await mkdtemp(join(tmpdir(), 'upgrade-brief-'))
  const candidateFile = join(workspace, 'catalog.snapshot.json')
  try {
    await writeFile(candidateFile, `${JSON.stringify(candidate, null, 2)}\n`)
    await runValidation(candidateFile)
    await writeFile(snapshot, await readFile(candidateFile))
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
const buildSource = current.sources.find((item) => item.id === 'kb2680')
const securitySource = current.sources.find((item) => item.id === 'kb4649')
const kevSource = current.sources.find((item) => item.id === 'cisa-kev')
if (!buildSource || !securitySource || !kevSource) throw new Error('A required catalog source is missing from the catalog.')

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'UpgradeBrief catalog refresher (+https://github.com/TnTBass/UpgradeBrief)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${source.id} request failed with HTTP ${response.status}`)
  return response.text()
}

const [buildHtml, securityHtml, kevPayload] = await Promise.all([fetchSource(buildSource), fetchSource(securitySource), fetchSource(kevSource)])
const builds = parseVbrBuilds(buildHtml)
const vbrAdvisories = parseVbrSecurityBulletin(securityHtml)
const veeamOneAdvisories = parseVeeamOneSecurityBulletin(securityHtml)
const kevCves = parseCisaKev(JSON.parse(kevPayload))
if (builds.length < 10) throw new Error(`VBR build-number parser returned only ${builds.length} records; refusing to replace the catalog.`)
if (vbrAdvisories.length < 6 || veeamOneAdvisories.length < 6) throw new Error(`Security parser returned ${vbrAdvisories.length} VBR and ${veeamOneAdvisories.length} Veeam ONE advisories; refusing to replace the catalog.`)

const buildsMerged = mergeVbrBuilds(current, builds)
const vbrMerged = mergeVbrSecurityBulletin(buildsMerged.catalog, vbrAdvisories)
const oneMerged = mergeVeeamOneSecurityBulletin(vbrMerged.catalog, veeamOneAdvisories)
const merged = mergeCisaKev(oneMerged.catalog, kevCves)
const refreshedAt = new Date().toISOString()
merged.catalog.generatedAt = refreshedAt
merged.catalog.sources = merged.catalog.sources.map((item) =>
  item.id === buildSource.id || item.id === securitySource.id || item.id === kevSource.id ? { ...item, checkedAt: refreshedAt } : item,
)

await validateThenInstall(merged.catalog)
console.log(`Catalog refresh complete: ${builds.length} VBR builds, ${buildsMerged.additions} releases added, ${vbrMerged.findings} VBR advisories, ${oneMerged.findings} Veeam ONE advisories, ${merged.matches} KEV matches.`)
