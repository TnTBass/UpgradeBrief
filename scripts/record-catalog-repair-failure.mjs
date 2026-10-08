import { mkdir, writeFile } from 'node:fs/promises'
import { githubClient } from './lib/catalog-repair-state.mjs'
const runId = process.env.REPAIR_SOURCE_RUN_ID
if (!/^\d+$/.test(runId ?? '')) throw new Error('Invalid failed run identity')
const api = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })
const run = await api(`/actions/runs/${runId}`)
if (run.head_sha !== process.env.GITHUB_SHA || run.head_repository.full_name !== process.env.GITHUB_REPOSITORY) throw new Error('Failed run is stale or untrusted')
const jobs = await api(`/actions/runs/${runId}/jobs?per_page=100`)
const steps = jobs.jobs.flatMap(job => job.steps.filter(step => step.conclusion === 'failure').map(step => step.name))
await mkdir('artifacts/catalog-review', { recursive: true })
await writeFile('artifacts/catalog-review/review.json', JSON.stringify({ schemaVersion: 1, ok: false, baseCommit: run.head_sha, capturedAt: run.updated_at, changes: [], error: { message: `Refresh failed without a source review artifact. Failed steps: ${steps.join(', ') || 'unknown'}` } }))
