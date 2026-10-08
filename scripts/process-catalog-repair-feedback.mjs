import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { githubClient, githubStateStore } from './lib/catalog-repair-state.mjs'
import { projectRepairState, readTrustedFeedback, recordFeedback, scopedRevert } from './lib/catalog-repair-feedback.mjs'
import { createRepairPullRequest, ensureInvestigation, ensureLabels, manifestPath, mergeCandidateCAS, notifyOnce, REPAIR_DATA_PATHS, repairBaseBranch, repairBrief, setRepairStateLabel, waitForExactVerification } from './lib/catalog-repair-publication.mjs'
import { canonicalJson, repairHash } from './lib/catalog-repair-evidence.mjs'
import { snapshotHash, verifyCatalogCheckout, verifyRepairDeployment } from './lib/catalog-repair-verification.mjs'

const root = resolve('.')
if (process.env.GITHUB_REPOSITORY !== 'TnTBass/UpgradeBrief') throw new Error('Feedback is restricted to the configured repository')
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const store = githubStateStore(api)
let state = await store.load()
await ensureLabels(api)
const save = async () => store.save(state)
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const inputs = async directory => ({ reviewedData: await readJson(join(directory, REPAIR_DATA_PATHS[0])), baselines: await readJson(join(directory, REPAIR_DATA_PATHS[1])), catalog: await readJson(join(directory, REPAIR_DATA_PATHS[2])) })
const outcomes = []

async function announce(id, key, message) {
  state.repairs[id].notification = { key, message, pending: true }
  await save()
  const result = await notifyOnce(api, state.repairs[id].number, key, message)
  state.repairs[id].notification = { key, message, pending: false, ...result }
  await save()
}

async function recoverPublication(id) {
  const repair = state.repairs[id]
  if (repair.state === 'merge-pending') {
    const pull = await api(`/pulls/${repair.number}`)
    if (!pull.merged || pull.head.sha !== repair.headCommit) return
    repair.state = 'publication-pending'; repair.mergeCommit = pull.merge_commit_sha; await save()
  }
  if (repair.state === 'publication-pending') {
    try { repair.deployment = await verifyRepairDeployment(api, { environment: repair.environment, commit: repair.mergeCommit, catalogHash: repair.catalogHash, attempts: 1 }) }
    catch (error) {
      if (repair.environment === 'trial') throw error
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      if (head === repair.mergeCommit || (await api('/git/ref/heads/main')).object.sha !== head) throw error
      const comparison = await api(`/compare/${repair.mergeCommit}...${head}`)
      if (comparison.status !== 'ahead') throw error
      const manifest = await loadManifest({ ...repair, repairId: id })
      const current = await inputs(root)
      if (canonicalJson(projectRepairState(current, repair.articleIds)) !== canonicalJson(manifest.after)) throw error
      repair.deployment = await verifyRepairDeployment(api, { commit: head, catalogHash: snapshotHash(current.catalog), attempts: 1 })
    }
    repair.state = 'applied-awaiting-review'; await save()
    if (repair.reverts && state.repairs[repair.reverts]) { state.repairs[repair.reverts].state = 'reverted'; await save() }
    await setRepairStateLabel(api, repair.number, 'applied-awaiting-review')
    await announce(id, `${id}:applied`, `Catalog publication is verified at \`${repair.deployment.commit}\`. The [repair brief and exact evidence](https://github.com/${process.env.GITHUB_REPOSITORY}/pull/${repair.number}) are ready for review; normal comments can request changes.`)
  }
}

async function loadManifest(repair) {
  if (!/^[a-f0-9]{40}$/.test(repair.headCommit ?? '') || repair.manifestPath !== manifestPath(repair.repairId)) throw new Error('Repair has no validated revert manifest')
  const file = await api(`/contents/${repair.manifestPath}?ref=${repair.headCommit}`)
  if (file.encoding !== 'base64' || file.size > 5_000_000) throw new Error('Invalid revert evidence')
  const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
  if (manifest.repairId !== repair.repairId || JSON.stringify(manifest.articleIds) !== JSON.stringify(repair.articleIds)) throw new Error('Revert manifest identity differs')
  return manifest
}

async function requestImplementation(id, repair, reason) {
  const request = repair.changeRequest
  const correctionId = repairHash({ kind: 'change-request', repair: id, request: request?.fingerprint, reason })
  const body = [
    `<!-- catalog-repair:${correctionId} -->`,
    `A trusted reviewer requested a different approach for [repair #${repair.number}](https://github.com/${process.env.GITHUB_REPOSITORY}/issues/${repair.number}).`, '',
    `The original repair and articles are on hold. ${reason}`, '',
    request ? `[Read the exact feedback](${request.url}).` : 'See the original repair for context.', '',
    'Resolve this through a scoped follow-up implementation, rerun the catalog checks, and reconcile the source hold. Closing this issue alone does not clear the hold or authorize an unsupported source interpretation.',
  ].join('\n')
  const issue = await ensureInvestigation(api, { id: correctionId, title: `Change requested for catalog repair #${repair.number}`, body })
  state.repairs[correctionId] ??= { state: 'needs-investigation', environment: repair.environment, number: issue.number, articleIds: repair.articleIds, parentRepairId: id }
  state.repairs[id].correctionIssue = issue.number; await save()
  await announce(id, `${correctionId}:requested`, `Your feedback is recorded and this repair is on hold. [Follow-up #${issue.number}](${issue.html_url}) explains the requested work and current constraint.`)
}

async function revertRepair(id) {
  const repair = state.repairs[id]
  const pull = await api(`/pulls/${repair.number}`)
  if (!pull.merged) {
    await api(`/pulls/${repair.number}`, { method: 'PATCH', body: { state: 'closed' } })
    repair.state = 'reverted'; await save()
    await announce(id, `${id}:withdrawn`, 'The unpublished repair was withdrawn. Its source hold remains active so it will not be proposed again unchanged.')
    return
  }
  const original = await loadManifest({ ...repair, repairId: id })
  const environment = repair.environment ?? 'production'
  const baseBranch = repairBaseBranch(environment)
  const currentCommit = (await api(`/git/ref/heads/${baseBranch}`)).object.sha
  if (environment === 'production' && execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== currentCommit) throw new Error('Main changed; retry the correction against current main')
  const correctionId = repairHash({ kind: 'scoped-revert', repair: id, request: repair.changeRequest.fingerprint })
  const directory = resolve(root, `artifacts/catalog-repair/revert-${correctionId.slice(7, 19)}`)
  execFileSync('git', ['fetch', 'origin', currentCommit], { cwd: root, stdio: 'pipe' })
  execFileSync('git', ['worktree', 'add', '--detach', directory, currentCommit], { cwd: root, stdio: 'pipe' })
  if (resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8' }).trim()) !== directory) throw new Error('Revert checkout is outside its assigned worktree')
  const current = await inputs(directory)
  const reverted = scopedRevert({ current, before: original.before, after: original.after, articleIds: repair.articleIds })
  const files = Object.fromEntries(REPAIR_DATA_PATHS.map((path, i) => [path, `${JSON.stringify([reverted.reviewedData, reverted.baselines, reverted.catalog][i], null, 2)}\n`]))
  for (const [path, content] of Object.entries(files)) await writeFile(join(directory, path), content)
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts'], { cwd: directory, stdio: 'pipe', timeout: 300_000, env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } })
  // A requested revert deliberately restores the earlier accepted source state.
  // Live refresh would recreate the disputed change. Keep the hold and validate
  // internal consistency, lookup behavior and the build instead.
  const checks = verifyCatalogCheckout(directory)
  const manifest = { schemaVersion: 1, environment, repairId: correctionId, reverts: id, baseCommit: currentCommit, articleIds: repair.articleIds, request: repair.changeRequest, before: projectRepairState(current, repair.articleIds), after: projectRepairState(reverted, repair.articleIds), checks, catalogHash: snapshotHash(reverted.catalog), liveRefresh: 'intentionally withheld: disputed source remains on hold' }
  const created = await createRepairPullRequest(api, { id: correctionId, baseCommit: currentCommit, baseBranch, files, manifest, title: `${environment === 'trial' ? '[Isolated trial] ' : ''}Revert disputed catalog repair #${repair.number}`, brief: headCommit => repairBrief({ id: correctionId, baseCommit: currentCommit, articleIds: repair.articleIds, outcome: 'validated scoped revert', approach: `Restore the prior accepted security records for repair #${repair.number}, preserve newer unrelated catalog work, and retain the source hold. Live refresh is intentionally withheld while the source is disputed.`, checks, headCommit }) })
  const correction = state.repairs[correctionId] = { state: 'candidate-ready', environment, number: created.pull.number, articleIds: repair.articleIds, baseCommit: currentCommit, headCommit: created.pull.head.sha, manifestPath: manifestPath(correctionId), catalogHash: manifest.catalogHash, reverts: id }
  repair.correctionId = correctionId; await save()
  await waitForExactVerification(api, { sha: correction.headCommit, baseCommit: currentCommit, id: correctionId, environment })
  // Check fresh feedback on the correction itself before applying it.
  for (const feedback of await readTrustedFeedback(api, correction.number)) {
    const recorded = recordFeedback(state, correctionId, feedback)
    if (recorded.changed) { state = recorded.state; await save() }
  }
  if (state.repairs[correctionId].changeRequest) throw new Error('The correction itself received a change request')
  // An explicit trusted revert request authorizes its application, even if
  // automatic application of ordinary AI proposals is disabled.
  state.repairs[correctionId].state = 'merge-pending'; await save()
  const merged = await mergeCandidateCAS(api, { sha: correction.headCommit, baseCommit: currentCommit, number: correction.number, environment })
  state.repairs[correctionId].state = 'publication-pending'; state.repairs[correctionId].mergeCommit = merged.sha; await save()
  state.repairs[correctionId].deployment = await verifyRepairDeployment(api, { environment, commit: merged.sha, catalogHash: manifest.catalogHash })
  state.repairs[correctionId].state = 'applied-awaiting-review'; state.repairs[id].state = 'reverted'; await save()
  await setRepairStateLabel(api, repair.number, 'corrected')
  await setRepairStateLabel(api, correction.number, 'applied-awaiting-review')
  await announce(id, `${correctionId}:reverted`, `The scoped revert is published and verified at \`${merged.sha}\`. [Follow-up PR #${correction.number}](${created.pull.html_url}) preserves newer unrelated work. The disputed source remains on hold until its policy is reconciled.`)
  await announce(correctionId, `${correctionId}:applied`, `The requested correction is published and verified. Review the before/after records here; the original source hold remains active.`)
}

// Follow-up issues are created after their parent. Read them first so a request
// there can update its original repair during this same intake pass.
for (const id of Object.keys(state.repairs).reverse()) {
  try {
    await recoverPublication(id)
    let repair = state.repairs[id]
    if (repair.notification?.pending) await announce(id, repair.notification.key, repair.notification.message)
    for (const feedback of await readTrustedFeedback(api, repair.number)) {
      const recorded = recordFeedback(state, repair.parentRepairId ?? id, feedback)
      if (recorded.changed) { state = recorded.state; await save(); outcomes.push({ id, event: feedback.kind }) }
    }
    repair = state.repairs[id]
    if (['changes-requested', 'revert-requested'].includes(repair.state)) {
      await setRepairStateLabel(api, repair.number, 'changes-requested')
      if (repair.state === 'revert-requested' && !repair.correctionId) await revertRepair(id)
      else if (!repair.correctionIssue && !repair.correctionId) await requestImplementation(id, repair, 'The requested approach requires maintained code or additional source interpretation; the automation will not invent that policy.')
    }
  } catch (error) {
    const repair = state.repairs[id]
    repair.lastError = error.message; await save()
    if (repair.changeRequest && !repair.correctionIssue) await requestImplementation(id, repair, error.message)
    else await announce(id, `${id}:processing-error:${repairHash(error.message)}`, `Catalog repair follow-up needs attention: ${error.message}. The last confirmed state is retained.`)
    outcomes.push({ id, error: error.message })
  }
}
await mkdir('artifacts/catalog-repair/feedback', { recursive: true })
await writeFile('artifacts/catalog-repair/feedback/result.json', `${JSON.stringify(outcomes, null, 2)}\n`)
console.log(JSON.stringify({ changed: outcomes.length, outcomes }))
