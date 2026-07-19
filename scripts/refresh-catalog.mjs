import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mergeVbrBuilds, parseVbrBuilds } from './lib/vbr-builds.mjs'
import { mergeVbrSecurityBulletin, mergeVeeamOneSecurityBulletin, parseVbrSecurityBulletin, parseVeeamOneSecurityBulletin } from './lib/vbr-security.mjs'
import { mergeVbrReleaseSecurityArticles, parseVbrReleaseSecurityArticle, selectVbrSecurityArticles } from './lib/vbr-release-security.mjs'
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
const securityFeedSource = current.sources.find((item) => item.id === 'security-kb')
const kevSource = current.sources.find((item) => item.id === 'cisa-kev')
if (!buildSource || !securitySource || !securityFeedSource || !kevSource) throw new Error('A required catalog source is missing from the catalog.')

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'UpgradeBrief catalog refresher (+https://github.com/TnTBass/UpgradeBrief)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${source.id} request failed with HTTP ${response.status}`)
  return response.text()
}

const [buildHtml, securityHtml, securityFeedPayload, kevPayload] = await Promise.all([fetchSource(buildSource), fetchSource(securitySource), fetchSource({ ...securityFeedSource, url: 'https://www.veeam.com/services/kb-articles?type=security&offset=0&limit=100' }), fetchSource(kevSource)])
const builds = parseVbrBuilds(buildHtml)
const vbrAdvisories = parseVbrSecurityBulletin(securityHtml)
const veeamOneAdvisories = parseVeeamOneSecurityBulletin(securityHtml)
const discoveredVbrArticles = selectVbrSecurityArticles(JSON.parse(securityFeedPayload))
const discoveredResponses = await Promise.allSettled(discoveredVbrArticles.map(async (article) => ({
  article,
  html: await fetchSource({ id: article.id, url: new URL(article.url, 'https://www.veeam.com').toString() }),
})))
const discoveredVbrAdvisories = discoveredResponses.flatMap((response) => {
  if (response.status !== 'fulfilled') return []
  try {
    return [parseVbrReleaseSecurityArticle(response.value.html, response.value.article)]
  } catch {
    return []
  }
})
const kevCves = parseCisaKev(JSON.parse(kevPayload))
if (builds.length < 10) throw new Error(`VBR build-number parser returned only ${builds.length} records; refusing to replace the catalog.`)
if (vbrAdvisories.length < 6 || veeamOneAdvisories.length < 6) throw new Error(`Security parser returned ${vbrAdvisories.length} VBR and ${veeamOneAdvisories.length} Veeam ONE advisories; refusing to replace the catalog.`)
if (!discoveredVbrAdvisories.some((advisory) => advisory.source.id === 'kb4831')) throw new Error('Security feed did not yield the supported KB4831 VBR advisory; refusing to replace the catalog.')

const buildsMerged = mergeVbrBuilds(current, builds)
const vbrMerged = mergeVbrSecurityBulletin(buildsMerged.catalog, vbrAdvisories)
const oneMerged = mergeVeeamOneSecurityBulletin(vbrMerged.catalog, veeamOneAdvisories)
const releaseSecurityMerged = mergeVbrReleaseSecurityArticles(oneMerged.catalog, discoveredVbrAdvisories)
const merged = mergeCisaKev(releaseSecurityMerged.catalog, kevCves)
const refreshedAt = new Date().toISOString()
merged.catalog.generatedAt = refreshedAt
const discoveredSources = discoveredVbrAdvisories.map((advisory) => ({ ...advisory.source, checkedAt: refreshedAt }))
merged.catalog.sources = merged.catalog.sources.map((item) =>
  item.id === buildSource.id || item.id === securitySource.id || item.id === securityFeedSource.id || item.id === kevSource.id ? { ...item, checkedAt: refreshedAt } : item,
)
for (const source of discoveredSources) {
  const index = merged.catalog.sources.findIndex((item) => item.id === source.id)
  if (index < 0) merged.catalog.sources.push(source)
  else merged.catalog.sources[index] = source
}

await validateThenInstall(merged.catalog)
console.log(`Catalog refresh complete: ${builds.length} VBR builds, ${buildsMerged.additions} releases added, ${vbrMerged.findings} VBR bulletin advisories, ${releaseSecurityMerged.findings} VBR release advisories from ${discoveredVbrAdvisories.length} parseable security KBs, ${oneMerged.findings} Veeam ONE advisories, ${merged.matches} KEV matches.`)
