import assert from 'node:assert/strict'
import { AI_LIMITS, AI_MODEL, reserveInference } from './lib/catalog-repair-budget.mjs'
import { extractWithWorkersAi, makeAiRequest } from './lib/catalog-repair-ai.mjs'

const day = new Date('2026-10-07T12:00:00Z')
let state = { schemaVersion: 1, reservations: [], cache: [] }
for (let i = 0; i < 6; i++) state = reserveInference(state, { id: String(i), now: day, inputTokenUpperBound: 8000 })
assert.equal(state.reservations.length, 6)
assert.ok(state.reservations.reduce((sum, item) => sum + item.neurons, 0) <= AI_LIMITS.dailyNeurons)
assert.throws(() => reserveInference(state, { id: 'seventh', now: day, inputTokenUpperBound: 1 }), /daily budget exhausted/)
assert.equal(reserveInference(state, { id: 'next-day', now: new Date('2026-10-08T00:00:00Z'), inputTokenUpperBound: 1 }).reservations.length, 7)
assert.throws(() => reserveInference({}, { id: 'x', inputTokenUpperBound: 1 }), /state is missing/)
assert.throws(() => makeAiRequest('x'.repeat(8000)), /exceeds token budget/)

const excerpt = 'CVE-2026-12345 Veeam Backup & Replication A vulnerability. Affected 13.0.2.29 Fixed 13.1.0.411 Severity: High'
const value = { kind: 'vulnerability', records: [{ cve: 'CVE-2026-12345', product: 'Veeam Backup & Replication', description: 'A vulnerability.', affected: 'Affected 13.0.2.29', fixed: 'Fixed 13.1.0.411', severity: 'Severity: High', conditions: '', mitigation: '' }], summary: 'One finding.', unresolved: [] }
const success = () => new Response(JSON.stringify({ success: true, result: { response: value, usage: { prompt_tokens: 100, completion_tokens: 80 } } }))
const run = async (fetchImpl, saveOverride) => {
  let stored = { schemaVersion: 1, reservations: [], cache: [] }, calls = 0, saves = 0
  const args = { excerpt, accountId: 'a'.repeat(32), token: 'secret-test-value', now: () => day, sleep: async () => {}, cacheKey: 'test-policy', loadState: async () => structuredClone(stored), saveState: async next => { if (saveOverride) await saveOverride(); stored = structuredClone(next); saves++ }, fetchImpl: async (...args) => { calls++; assert.ok(saves >= calls, 'reserve before every request'); return fetchImpl(...args) } }
  return { args, stats: () => ({ stored, calls, saves }) }
}
const ok = await run(async (url, options) => {
  assert.ok(url.endsWith(`/ai/run/${AI_MODEL}`))
  assert.equal(options.redirect, 'error')
  assert.equal(JSON.parse(options.body).max_tokens, 2000)
  return success()
})
assert.equal((await extractWithWorkersAi(ok.args)).cached, false)
assert.equal((await extractWithWorkersAi(ok.args)).cached, true)
assert.equal(ok.stats().calls, 1)
assert.equal(ok.stats().stored.reservations.length, 1)
let transientCalls = 0
const retry = await run(async () => ++transientCalls === 1 ? new Response('', { status: 429 }) : success())
await extractWithWorkersAi(retry.args)
assert.equal(retry.stats().stored.reservations.length, 2)
const timeout = await run(async () => { throw new Error('secret-test-value') })
await assert.rejects(extractWithWorkersAi(timeout.args), error => /timed out/.test(error.message) && !error.message.includes('secret-test-value'))
assert.equal(timeout.stats().calls, 2)
assert.equal(timeout.stats().stored.reservations.length, 2)
const auth = await run(async () => new Response('secret-test-value', { status: 403 }))
await assert.rejects(extractWithWorkersAi(auth.args), /HTTP 403/)
assert.equal(auth.stats().calls, 1)
const noLedger = await run(success, async () => { throw new Error('state unavailable') })
await assert.rejects(extractWithWorkersAi(noLedger.args), /state unavailable/)
assert.equal(noLedger.stats().calls, 0)
const invented = await run(async () => new Response(JSON.stringify({ success: true, result: { response: { ...value, records: [{ ...value.records[0], fixed: 'invented fix' }] } } })))
await assert.rejects(extractWithWorkersAi(invented.args), /invalid or unsupported extraction/)
const refused = await run(async () => new Response(JSON.stringify({ success: false, errors: ['secret-test-value'] })))
await assert.rejects(extractWithWorkersAi(refused.args), error => !error.message.includes('secret-test-value'))
console.log('Workers AI offline tests passed: budgets, reservations, cache, bounded retries, schema/evidence and secret-safe errors.')
