import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { createRepairEvidence, classifyCatalogFailure } from './lib/catalog-repair-evidence.mjs'
import { buildRepairCandidate, renderRepairBrief } from './lib/catalog-repair-candidate.mjs'

const { values } = parseArgs({ options: {
  report: { type: 'string' }, proposal: { type: 'string' }, out: { type: 'string', default: 'artifacts/catalog-repair' },
  'run-id': { type: 'string' }, 'captured-at': { type: 'string' }, 'base-commit': { type: 'string' },
} })
if (!values.report || !values['run-id']) throw new Error('Required: --report <review.json> --run-id <Actions run ID>; legacy reports also need --base-commit and --captured-at; optional --proposal <proposal.json> --out <directory>')
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const [report, reviewedData, baselines, catalog] = await Promise.all([
  readJson(values.report), readJson(new URL('./data/reviewed-security-advisories.json', import.meta.url)),
  readJson(new URL('./data/security-review-baselines.json', import.meta.url)), readJson(new URL('../src/data/catalog.snapshot.json', import.meta.url)),
])
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const baseCommit = report.baseCommit ?? values['base-commit']
if (baseCommit !== currentCommit) throw new Error('Run preparation from the exact source report base commit')
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Repair preparation requires a clean tracked checkout')
const bundle = createRepairEvidence({ report, baseCommit, policy: reviewedData, runId: values['run-id'], capturedAt: report.capturedAt ?? values['captured-at'] })
const out = resolve(values.out)
// Export only, never install a candidate into this checkout.
const candidateRoot = resolve(out, 'candidate')
const checkout = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
if (candidateRoot.toLowerCase() === resolve(checkout).toLowerCase()) throw new Error('Candidate output cannot be the repository root')
await mkdir(out, { recursive: true })
await writeFile(join(out, 'evidence.json'), `${JSON.stringify(bundle, null, 2)}\n`)
if (values.proposal) {
  const proposal = await readJson(values.proposal)
  const result = buildRepairCandidate({ bundle, proposal, reviewedData, baselines, catalog, currentCommit })
  // Each invocation has a separate evidence directory; stale candidate files from
  // earlier blocked/successful attempts cannot masquerade as current output.
  const runDirectory = await mkdtemp(join(out, 'result-'))
  for (const [path, content] of Object.entries(result.files)) {
    const target = join(runDirectory, 'candidate', path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await writeFile(join(runDirectory, 'proposal.json'), `${JSON.stringify(proposal, null, 2)}\n`)
  await writeFile(join(runDirectory, 'evidence.json'), `${JSON.stringify(bundle, null, 2)}\n`)
  await writeFile(join(runDirectory, 'review.json'), `${JSON.stringify({ ...result, files: Object.keys(result.files) }, null, 2)}\n`)
  await writeFile(join(runDirectory, 'review.md'), renderRepairBrief(bundle, result))
  console.log(JSON.stringify({ status: result.status, eligibleForPublication: false, directory: runDirectory, blockers: result.blocked }))
  if (result.status === 'blocked') process.exitCode = 2
} else {
  const triage = classifyCatalogFailure(report.error)
  await writeFile(join(out, 'triage.json'), `${JSON.stringify(triage, null, 2)}\n`)
  console.log(JSON.stringify({ evidenceId: bundle.evidenceId, directory: out, ...triage }))
}
