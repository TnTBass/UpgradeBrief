import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const equal = (a, b) => digest(a ?? null) === digest(b ?? null)
export const articleHold = (articleId, environment = 'production') => environment === 'trial' ? `trial:${articleId}` : articleId
export const effectiveHolds = (state, environment = 'production') => state.holds.flatMap(id => environment === 'trial' ? id.startsWith('trial:') ? [id.slice(6)] : id.startsWith('sha256:') ? [id] : [] : id.startsWith('trial:') ? [] : [id])

export async function readTrustedFeedback(api, number, trustedUserIds = [1081294]) {
  const result = []
  const collect = async (path, type) => {
    for (let page = 1; page <= 10; page++) {
      const comments = await api(`${path}?per_page=100&page=${page}`)
      for (const comment of comments) {
        if (type === 'review' && !['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED'].includes(comment.state)) continue
        const value = { ...comment, id: `${type}:${comment.id}`, body: comment.body || (comment.state === 'CHANGES_REQUESTED' ? 'Changes requested in GitHub review.' : comment.state === 'APPROVED' ? 'Approved' : '') }
        const feedback = interpretFeedback(value, trustedUserIds)
        if (feedback) result.push(comment.state === 'CHANGES_REQUESTED' ? { ...feedback, kind: 'changes-requested' } : feedback)
      }
      if (comments.length < 100) return
    }
    throw new Error('Feedback scan exceeded its bound; publication held')
  }
  await collect(`/issues/${number}/comments`, 'comment')
  if (await api(`/pulls/${number}`, { allow404: true })) {
    await collect(`/pulls/${number}/reviews`, 'review')
    await collect(`/pulls/${number}/comments`, 'inline')
  }
  return result.sort((left, right) => left.updatedAt - right.updatedAt)
}

export function interpretFeedback(comment, trustedUserIds) {
  if (!trustedUserIds.includes(comment.user?.id) || comment.user?.type !== 'User' || typeof comment.body !== 'string') return null
  const text = comment.body.trim()
  if (!text || text.length > 20_000) return null
  const approval = /^(?:looks good(?: to me)?|approved|lgtm|this (?:looks|is) good|thanks(?:,? looks good)?)[.!\s]*$/i.test(text)
  const revert = /^(?:(?:please|can you|could you)\s+)?(?:revert|undo|roll back)\s+(?:this(?: change| repair)?|the (?:change|repair))(?: please)?[.!?\s]*$/i.test(text)
  return { kind: approval ? 'reviewed' : revert ? 'revert-requested' : 'changes-requested', authorId: comment.user.id, author: comment.user.login, commentId: comment.id, url: comment.html_url, text, updatedAt: Date.parse(comment.updated_at ?? comment.submitted_at ?? comment.created_at) || 0, fingerprint: digest([comment.id, text, comment.state ?? null]) }
}

export function recordFeedback(state, repairId, feedback) {
  const next = structuredClone(state)
  const repair = next.repairs[repairId]
  if (!repair) throw new Error('Feedback does not identify a known repair')
  if (next.feedback[String(feedback.commentId)] === feedback.fingerprint) return { state: next, changed: false }
  next.feedback[String(feedback.commentId)] = feedback.fingerprint
  if ((repair.latestFeedbackAt ?? 0) > feedback.updatedAt) return { state: next, changed: false }
  repair.latestFeedbackAt = feedback.updatedAt
  if (feedback.kind === 'reviewed' && repair.state === 'applied-awaiting-review') repair.state = 'reviewed'
  else if (feedback.kind !== 'reviewed') {
    repair.state = feedback.kind
    repair.changeRequest = feedback
    next.holds = [...new Set([...next.holds, repairId, ...repair.articleIds.map(id => articleHold(id, repair.environment))])]
  }
  return { state: next, changed: true }
}

// Only restore the affected security records. Keep newer releases, capabilities,
// timestamps and unrelated source data. Refuse overlapping edits rather than
// discarding them. The caller must rerun catalog checks before publication.
export function projectRepairState({ reviewedData, baselines, catalog }, articleIds) {
  const selected = new Set(articleIds)
  return structuredClone({
    advisories: reviewedData.advisories.filter(item => selected.has(item.articleId)),
    specs: Object.fromEntries(articleIds.map(id => [id, reviewedData.observationSpecs[id] ?? null])),
    baselines: Object.fromEntries(articleIds.map(id => [id, baselines.articles[id] ?? null])),
    pageStates: catalog.securityFeedPageStates.filter(item => selected.has(item.articleId)),
    routes: catalog.securityFeedRoutes.filter(item => selected.has(item.articleId)),
    findings: catalog.securityFindings.filter(item => item.sourceIds?.some(id => selected.has(id))),
  })
}

export function scopedRevert({ current, before, after, articleIds }) {
  const actual = projectRepairState(current, articleIds)
  // Full field equality, not a timestamp or a commit-message guess, establishes
  // whether later work overlaps the applied security change.
  for (const key of Object.keys(after)) if (!equal(actual[key], after[key]) && !equal(actual[key], before[key])) throw new Error(`Cannot isolate revert: newer changes overlap ${key}`)
  const next = structuredClone(current)
  const selected = new Set(articleIds)
  next.reviewedData.advisories = [...next.reviewedData.advisories.filter(item => !selected.has(item.articleId)), ...before.advisories]
  for (const id of articleIds) {
    for (const [target, source] of [[next.reviewedData.observationSpecs, before.specs], [next.baselines.articles, before.baselines]]) {
      if (source[id] === null) delete target[id]
      else target[id] = structuredClone(source[id])
    }
  }
  next.catalog.securityFeedPageStates = [...next.catalog.securityFeedPageStates.filter(item => !selected.has(item.articleId)), ...before.pageStates]
  next.catalog.securityFeedRoutes = [...next.catalog.securityFeedRoutes.filter(item => !selected.has(item.articleId)), ...before.routes]
  const replacedIds = new Set([...before.findings, ...after.findings].map(item => item.id))
  next.catalog.securityFindings = [...next.catalog.securityFindings.filter(item => !replacedIds.has(item.id)), ...before.findings]
  return next
}
