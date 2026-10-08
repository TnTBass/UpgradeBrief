import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRepairEvidence, REPAIR_SCHEMA_VERSION } from './lib/catalog-repair-evidence.mjs'
import { buildRepairCandidate } from './lib/catalog-repair-candidate.mjs'
import { inspectSemanticChange } from './lib/catalog-repair-semantics.mjs'
import { extractWithWorkersAi } from './lib/catalog-repair-ai.mjs'
import { githubClient, githubStateStore } from './lib/catalog-repair-state.mjs'
import { normalizeSecurityReviewText } from './lib/security-review-baselines.mjs'
import { effectiveHolds } from './lib/catalog-repair-feedback.mjs'

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const root = resolve('.')
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const reviewedData = await readJson('scripts/data/reviewed-security-advisories.json')
const baselines = await readJson('scripts/data/security-review-baselines.json')
const catalog = await readJson('src/data/catalog.snapshot.json')
const report = await readJson('artifacts/catalog-review/review.json')
if (report.baseCommit !== currentCommit) throw new Error('Failed-run evidence is stale; run a fresh catalog refresh')
const environment = process.env.CATALOG_REPAIR_TRIAL === 'true' ? 'trial' : 'production'
const bundle = createRepairEvidence({ report, baseCommit: currentCommit, policy: reviewedData, runId: process.env.REPAIR_SOURCE_RUN_ID ?? process.env.GITHUB_RUN_ID, capturedAt: report.capturedAt, environment })
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const store = githubStateStore(api)
let state = await store.load()
const extractions = {}, articles = []
const previous = state.repairs[bundle.evidenceId]
const alreadyHandled = previous && ['applied-awaiting-review', 'reviewed', 'needs-investigation', 'changes-requested', 'revert-requested', 'reverted'].includes(previous.state)
for (const article of bundle.articles) {
  const equivalent = article.before !== null && normalizeSecurityReviewText(article.articleId, article.before) === normalizeSecurityReviewText(article.articleId, article.after)
  const semantic = equivalent ? null : inspectSemanticChange(article, reviewedData)
  const unresolved = []
  if (!equivalent && !semantic) unresolved.push('The maintained validator cannot establish a supported semantic change.')
  if (semantic?.kind === 'vulnerability') {
    if (alreadyHandled || effectiveHolds(state, environment).includes(bundle.evidenceId) || effectiveHolds(state, environment).includes(article.articleId)) unresolved.push('A durable review state or hold prevents repeated inference.')
    else if (process.env.CATALOG_REPAIR_AI_ENABLED !== 'true') unresolved.push('AI proposal generation is disabled.')
    else {
      try {
        extractions[article.articleId] = (await extractWithWorkersAi({
          excerpt: semantic.excerpt, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_WORKERS_AI_TOKEN,
          cacheKey: { evidenceId: bundle.evidenceId, validator: bundle.validatorVersion },
          loadState: async () => state,
          saveState: async next => { await store.save(next); state = next },
        })).extraction
      } catch (error) { unresolved.push(error.message) }
    }
  }
  articles.push({ articleId: article.articleId, kind: equivalent ? 'equivalent' : semantic?.kind ?? 'classification', rationale: equivalent ? 'Maintained metadata or naming equivalence.' : semantic ? semantic.checks.join('; ') : 'Unsupported change requires investigation.', evidence: [{ sectionId: 'article', start: 0, end: article.after.length, quote: article.after }], unresolved })
}
const proposal = { schemaVersion: REPAIR_SCHEMA_VERSION, evidenceId: bundle.evidenceId, baseCommit: currentCommit, articles }
const result = buildRepairCandidate({ bundle, proposal, reviewedData, baselines, catalog, currentCommit, holds: effectiveHolds(state, environment), extractions })
const directory = resolve(root, 'artifacts/catalog-repair/prepared')
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'repair.json'), `${JSON.stringify({ bundle, proposal, extractions, result, alreadyHandled: Boolean(alreadyHandled) }, null, 2)}\n`)
console.log(JSON.stringify({ evidenceId: bundle.evidenceId, status: result.status, alreadyHandled: Boolean(alreadyHandled), blocked: result.blocked.map(item => item.code) }))
