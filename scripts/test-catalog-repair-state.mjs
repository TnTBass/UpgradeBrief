import assert from 'node:assert/strict'
import { emptyRepairState, githubStateStore, STATE_REF, validateRepairState } from './lib/catalog-repair-state.mjs'

let ref = null, serial = 0, ambiguous = false, race = false
const objects = new Map()
const api = async (path, { method = 'GET', body } = {}) => {
  if (path.startsWith('/git/matching-refs/')) return ref ? [{ ref: `refs/${STATE_REF}`, object: { sha: ref } }] : []
  if (path === '/git/refs') { assert.equal(ref, null); ref = body.sha; return {} }
  if (path === `/git/refs/${STATE_REF}`) {
    assert.equal(body.force, false)
    if (race) throw new Error('conflict')
    assert.equal(objects.get(body.sha).parents[0], ref)
    ref = body.sha
    if (ambiguous) throw new Error('timeout after accepted write')
    return {}
  }
  if (method === 'POST') {
    const sha = String(++serial).padStart(40, '0')
    const value = path === '/git/blobs' ? { encoding: 'base64', content: Buffer.from(body.content).toString('base64'), size: body.content.length }
      : path === '/git/commits' ? { ...body, tree: { sha: body.tree } } : body
    objects.set(sha, value)
    return { sha }
  }
  return objects.get(path.split('/').at(-1))
}
const store = githubStateStore(api)
await assert.rejects(store.load(), /missing/)
await assert.rejects(store.save(emptyRepairState()), /concurrently/)
await store.initialize()
await assert.rejects(store.initialize(), /already exists/)
const state = await store.load()
state.holds.push('kb4902')
await store.save(state)
assert.deepEqual((await store.load()).holds, ['kb4902'])
ambiguous = true
await store.save(state)
ambiguous = false
const other = githubStateStore(api)
await other.load()
await store.save(state)
await assert.rejects(other.save(state), /concurrently/)
race = true
await assert.rejects(store.save(state), /conflict/)
assert.throws(() => validateRepairState({ ...emptyRepairState(), reservations: null }), /budget/)
console.log('Durable repair state tests passed: initialization, CAS, conflict, ambiguous writes, schema.')
