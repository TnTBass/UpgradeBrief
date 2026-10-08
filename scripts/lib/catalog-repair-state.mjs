import { validateBudgetState } from './catalog-repair-budget.mjs'

// A notes ref is outside branches/tags: state updates must not start site builds.
// Every write creates a child commit and advances the ref without force (CAS).
export const STATE_REF = 'notes/catalog-repair-state'
export const emptyRepairState = () => ({ schemaVersion: 1, reservations: [], cache: [], holds: [], repairs: {}, feedback: {} })

export function validateRepairState(state) {
  validateBudgetState(state)
  if (!Array.isArray(state.cache) || state.cache.length > 3 || !Array.isArray(state.holds)
    || state.holds.some(id => typeof id !== 'string') || !state.repairs || Array.isArray(state.repairs)
    || !state.feedback || Array.isArray(state.feedback) || Buffer.byteLength(JSON.stringify(state)) > 2_000_000) throw new Error('Catalog repair state is invalid')
  return state
}

export function githubClient({ repository, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) throw new Error('GitHub configuration missing')
  return async function api(path, { method = 'GET', body, allow404 = false } = {}) {
    // GitHub compares commits using base...head. Reject traversal segments,
    // not the legitimate comparison separator inside a path segment.
    let segments
    try { segments = path.split('?')[0].split('/').map(decodeURIComponent) } catch { throw new Error('Invalid GitHub API path') }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('#') || segments.some(segment => ['.', '..'].includes(segment) || /[\\/]/.test(segment))) throw new Error('Invalid GitHub API path')
    let response
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: 'error',
      })
    } catch { throw new Error(`GitHub ${method} ${path.split('?')[0]} failed; outcome may be unknown`) }
    if (allow404 && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} returned HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
}

export function githubStateStore(api) {
  let head
  async function currentHead() {
    const refs = await api(`/git/matching-refs/${STATE_REF}`)
    if (!Array.isArray(refs)) throw new Error('Could not read durable repair state')
    const ref = refs.find(item => item.ref === `refs/${STATE_REF}`)
    return ref?.object?.sha ?? null
  }
  async function commitState(state, parent) {
    validateRepairState(state)
    const blob = await api('/git/blobs', { method: 'POST', body: { content: `${JSON.stringify(state)}\n`, encoding: 'utf-8' } })
    const tree = await api('/git/trees', { method: 'POST', body: { tree: [{ path: 'state.json', mode: '100644', type: 'blob', sha: blob.sha }] } })
    return api('/git/commits', { method: 'POST', body: { message: 'chore: persist catalog repair control state', tree: tree.sha, parents: parent ? [parent] : [] } })
  }
  return {
    async initialize() {
      if (await currentHead()) throw new Error('Repair state already exists; initialization refused')
      const commit = await commitState(emptyRepairState(), null)
      await api('/git/refs', { method: 'POST', body: { ref: `refs/${STATE_REF}`, sha: commit.sha } })
      head = commit.sha
      return head
    },
    async load() {
      const sha = await currentHead()
      if (!sha) throw new Error('Durable repair state is missing; inference disabled')
      const commit = await api(`/git/commits/${sha}`)
      const tree = await api(`/git/trees/${commit.tree.sha}`)
      if (tree.truncated || tree.tree?.length !== 1 || tree.tree[0].path !== 'state.json' || tree.tree[0].type !== 'blob') throw new Error('Unexpected repair state tree')
      const blob = await api(`/git/blobs/${tree.tree[0].sha}`)
      if (blob.encoding !== 'base64' || blob.size > 2_000_000) throw new Error('Unexpected repair state blob')
      const state = validateRepairState(JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')))
      head = sha
      return state
    },
    async save(state) {
      if (!head || await currentHead() !== head) throw new Error('Repair state changed concurrently; retry from fresh state')
      const commit = await commitState(state, head)
      // Do not retry a write after an ambiguous response without reading it back.
      try {
        await api(`/git/refs/${STATE_REF}`, { method: 'PATCH', body: { sha: commit.sha, force: false } })
      } catch (error) {
        if (await currentHead() !== commit.sha) throw error
      }
      if (await currentHead() !== commit.sha) throw new Error('Repair state write was superseded; inference disabled')
      head = commit.sha
    },
  }
}
