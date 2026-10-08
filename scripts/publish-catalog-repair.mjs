import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { buildRepairCandidate } from './lib/catalog-repair-candidate.mjs'
import { repairHash, canonicalJson } from './lib/catalog-repair-evidence.mjs'
import { githubClient, githubStateStore } from './lib/catalog-repair-state.mjs'
import { effectiveHolds, projectRepairState, readTrustedFeedback, recordFeedback } from './lib/catalog-repair-feedback.mjs'
import { assertCandidateScope, createRepairPullRequest, ensureInvestigation, ensureLabels, manifestPath, mergeCandidateCAS, notifyOnce, persistRepairEvidence, REPAIR_DATA_PATHS, repairBaseBranch, repairBrief, waitForExactVerification } from './lib/catalog-repair-publication.mjs'
import { snapshotHash, verifyCatalogCheckout, verifyRepairDeployment } from './lib/catalog-repair-verification.mjs'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { normalizeReviewedSecurityMainArticle } from './lib/reviewed-security-advisories.mjs'
import { inspectSemanticChange } from './lib/catalog-repair-semantics.mjs'

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const root = resolve('.')
const repository = process.env.GITHUB_REPOSITORY
if (repository !== 'TnTBass/UpgradeBrief') throw new Error('Repair publication is restricted to the configured repository')
const api = githubClient({ repository, token: process.env.GH_TOKEN })
const store = githubStateStore(api)
let state = await store.load()
const save = async () => store.save(state)
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const inputs = async directory => ({ reviewedData: await readJson(join(directory, REPAIR_DATA_PATHS[0])), baselines: await readJson(join(directory, REPAIR_DATA_PATHS[1])), catalog: await readJson(join(directory, REPAIR_DATA_PATHS[2])) })
const prepared = await readJson('artifacts/catalog-repair/prepared/repair.json')
const { bundle, proposal, extractions } = prepared
const baseBranch = repairBaseBranch(bundle.environment)
const id = bundle.evidenceId
const articleIds = bundle.articles.map(article => article.articleId)
const sourceInputs = await inputs(root)
const candidate = buildRepairCandidate({ bundle, proposal, extractions, ...sourceInputs, currentCommit, holds: effectiveHolds(state, bundle.environment) })
if (canonicalJson(candidate) !== canonicalJson(prepared.result)) throw new Error('Candidate artifacts do not match independent reconstruction')
await ensureLabels(api)

async function announce(repair, key, message) {
  repair.notification = { key, message, pending: true }
  await save()
  const result = await notifyOnce(api, repair.number, key, message)
  repair.notification = { key, message, pending: false, ...result }
  await save()
}

async function feedbackBeforeMerge(repair) {
  for (const feedback of await readTrustedFeedback(api, repair.number)) {
    const recorded = recordFeedback(state, id, feedback)
    if (recorded.changed) { state = recorded.state; await save() }
  }
}

try {
  const previous = state.repairs[id]
  if (previous && ['applied-awaiting-review', 'reviewed', 'needs-investigation', 'changes-requested', 'revert-requested', 'reverted'].includes(previous.state)) {
    if (previous.notification?.pending) await announce(previous, previous.notification.key, previous.notification.message)
    console.log(JSON.stringify({ id, status: previous.state, duplicate: true }))
  } else if (candidate.status !== 'candidate-ready') {
    const evidenceCommit = await persistRepairEvidence(api, id, { schemaVersion: 1, bundle, proposal, extractions, result: candidate })
    const body = repairBrief({ id, baseCommit: currentCommit, articleIds, outcome: 'needs-investigation', approach: 'Keep the accepted catalog. The changed source cannot be fully validated by the supported repair rules.', checks: candidate.checks.passed, blocked: candidate.blocked.map(item => `${item.articleId ?? 'bundle'}: ${item.code}`), headCommit: evidenceCommit })
    const issue = await ensureInvestigation(api, { id, title: `Catalog refresh needs investigation: ${articleIds.join(', ') || 'source retrieval'}`, body })
    const repair = state.repairs[id] = { state: 'needs-investigation', environment: bundle.environment, number: issue.number, articleIds, evidenceCommit, baseCommit: currentCommit }
    await save()
    await announce(repair, `${id}:investigate`, `Catalog refresh needs attention. [Review the source changes and the reason it stopped](${issue.html_url}). The accepted catalog is retained.`)
    console.log(JSON.stringify({ id, status: repair.state, url: issue.html_url }))
  } else {
    const main = await api(`/git/ref/heads/${baseBranch}`)
    if (main.object.sha !== currentCommit) throw new Error('Main changed; candidate must be regenerated')
    const directory = resolve(root, `artifacts/catalog-repair/candidate-${id.slice(7, 19)}`)
    execFileSync('git', ['worktree', 'add', '--detach', directory, currentCommit], { cwd: root, stdio: 'pipe' })
    const actualRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8' }).trim()
    if (resolve(actualRoot) !== directory) throw new Error('Candidate checkout is outside its assigned worktree')
    for (const [path, content] of Object.entries(candidate.files)) await writeFile(join(directory, path), content)
    const install = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFileSync(install, ['ci', '--ignore-scripts'], { cwd: directory, stdio: 'pipe', timeout: 300_000, env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', CLOUDFLARE_WORKERS_AI_TOKEN: '' } })
    const checks = verifyCatalogCheckout(directory, { live: true })
    const finalInputs = await inputs(directory)
    const fetcher = createCatalogSourceFetcher()
    for (const article of bundle.articles) {
      const html = await (await fetcher.request(article.url, { sourceId: article.articleId })).text()
      if (repairHash(normalizeReviewedSecurityMainArticle(html)) !== article.afterHash) throw new Error(`Source changed before publication: ${article.articleId}`)
    }
    checks.push('fresh-source-verification')
    const manifest = {
      schemaVersion: 1, environment: bundle.environment, repairId: id, baseCommit: currentCommit, articleIds, bundle, proposal, extractions,
      sections: Object.fromEntries(bundle.articles.map(article => [article.articleId, inspectSemanticChange(article, sourceInputs.reviewedData)?.records.map(record => ({ cve: record.cve, start: record.section.start, end: record.section.end })) ?? []])),
      before: projectRepairState(sourceInputs, articleIds), after: projectRepairState(finalInputs, articleIds), checks,
      catalogHash: snapshotHash(finalInputs.catalog), verifiedAt: new Date().toISOString(),
    }
    const files = Object.fromEntries(await Promise.all(REPAIR_DATA_PATHS.map(async path => [path, await readFile(join(directory, path), 'utf8')])))
    const title = `${bundle.environment === 'trial' ? '[Isolated trial] ' : ''}Repair catalog source changes: ${articleIds.join(', ')}`
    const result = await createRepairPullRequest(api, { id, baseCommit: currentCommit, baseBranch, files, manifest, title, brief: headCommit => repairBrief({ id, baseCommit: currentCommit, articleIds, outcome: 'validated candidate', approach: proposal.articles.map(article => `${article.articleId}: ${article.rationale}`).join('; '), checks, headCommit }) })
    const pull = result.pull
    const repair = state.repairs[id] = { state: 'candidate-ready', environment: bundle.environment, number: pull.number, articleIds, baseCommit: currentCommit, headCommit: pull.head.sha, manifestPath: manifestPath(id), catalogHash: manifest.catalogHash }
    await save()
    await assertCandidateScope(api, { sha: pull.head.sha, baseCommit: currentCommit, id, environment: bundle.environment })
    repair.verificationUrl = await waitForExactVerification(api, { sha: pull.head.sha, baseCommit: currentCommit, id, environment: bundle.environment })
    await save()
    await feedbackBeforeMerge(repair)
    const holds = effectiveHolds(state, bundle.environment)
    const held = holds.includes(id) || articleIds.some(articleId => holds.includes(articleId))
    if (held) throw new Error('Trusted review feedback put this repair on hold')
    if (process.env.CATALOG_REPAIR_AUTO_APPLY !== 'true') {
      await announce(state.repairs[id], `${id}:ready`, `A validated catalog repair is ready. Automatic application is disabled. [Review the exact candidate](${pull.html_url}).`)
    } else {
      if ((await api(`/git/ref/heads/${baseBranch}`)).object.sha !== currentCommit) throw new Error('Main changed after validation; publication held')
      const livePull = await api(`/pulls/${pull.number}`)
      if (livePull.head.sha !== pull.head.sha || livePull.base.ref !== baseBranch || livePull.state !== 'open') throw new Error('Candidate PR changed; publication held')
      state.repairs[id].state = 'merge-pending'
      await save()
      let merged
      try { merged = await mergeCandidateCAS(api, { sha: pull.head.sha, baseCommit: currentCommit, number: pull.number, environment: bundle.environment }) }
      catch (error) {
        const readBack = await api(`/pulls/${pull.number}`)
        if (!readBack.merged || readBack.head.sha !== pull.head.sha) throw error
        merged = { merged: true, sha: readBack.merge_commit_sha }
      }
      if (!merged.merged) throw new Error('GitHub did not merge the validated candidate')
      state.repairs[id].state = 'publication-pending'
      state.repairs[id].mergeCommit = merged.sha
      await save()
      const deployment = await verifyRepairDeployment(api, { environment: bundle.environment, commit: merged.sha, catalogHash: manifest.catalogHash })
      state.repairs[id].deployment = deployment
      state.repairs[id].state = 'applied-awaiting-review'
      await save()
      await api(`/issues/${pull.number}/labels`, { method: 'POST', body: { labels: ['applied-awaiting-review'] } })
      await announce(state.repairs[id], `${id}:applied`, `${bundle.environment === 'trial' ? 'Isolated trial repair applied and preview' : 'Catalog repair applied and public catalog'} verified at commit \`${merged.sha}\`. [Skim what changed, the approach, evidence and tests](${pull.html_url}). You can request a different approach in a normal comment.`)
    }
    console.log(JSON.stringify({ id, status: state.repairs[id].state, url: pull.html_url }))
  }
} catch (error) {
  let repair = state.repairs[id]
  if (!repair?.number) {
    const evidenceCommit = await persistRepairEvidence(api, id, { schemaVersion: 1, bundle, proposal, extractions, result: candidate, runtimeError: error.message })
    const issue = await ensureInvestigation(api, { id, title: `Catalog repair validation needs attention: ${articleIds.join(', ')}`, body: repairBrief({ id, baseCommit: currentCommit, articleIds, outcome: 'needs-investigation', approach: 'Retain the accepted catalog because candidate validation did not complete.', checks: candidate.checks.passed, blocked: [error.message], headCommit: evidenceCommit }) })
    repair = state.repairs[id] = { state: 'needs-investigation', environment: bundle.environment, number: issue.number, articleIds, evidenceCommit, baseCommit: currentCommit }
  }
  if (repair?.number) {
    repair.lastError = error.message
    await save()
    await announce(repair, `${id}:blocked:${repairHash(error.message)}`, `Repair processing stopped: ${error.message}. The repair record retains its last confirmed state.`)
  }
  throw error
} finally {
  await mkdir('artifacts/catalog-repair', { recursive: true })
  await writeFile('artifacts/catalog-repair/publication-result.json', `${JSON.stringify(state.repairs[id] ?? { id, state: 'failed-before-publication' }, null, 2)}\n`)
}
