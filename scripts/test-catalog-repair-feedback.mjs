import assert from 'node:assert/strict'
import { effectiveHolds, interpretFeedback, projectRepairState, recordFeedback, reviewCandidateFeedback, scopedRevert } from './lib/catalog-repair-feedback.mjs'
import { emptyRepairState } from './lib/catalog-repair-state.mjs'

const comment = { id: 10, user: { id: 1081294, login: 'TnTBass', type: 'User' }, body: 'Use a different approach.', html_url: 'https://github.com/TnTBass/UpgradeBrief/issues/3#issuecomment-10' }
assert.equal(interpretFeedback(comment, []) , null)
assert.equal(interpretFeedback({ ...comment, user: { ...comment.user, type: 'Bot' } }, [1081294]), null)
assert.equal(interpretFeedback(comment, [1081294]).kind, 'changes-requested')
for (const body of ['that assumption is wrong', 'Do not merge this.', 'Can you update the mitigation?', 'Fixed in abc123. Do not publish this.', "Can you explain the mitigation, and please don't merge this?"]) assert.equal(interpretFeedback({ ...comment, body }, [1081294]).kind, 'changes-requested')
for (const body of ['Whoa there donkey', 'please do not revert this', 'Fixed in abc123, but I do not trust the findings.']) assert.equal(interpretFeedback({ ...comment, body }, [1081294]).kind, 'ambiguous')
for (const body of ['Please revert this.', 'Undo this change', 'Could you roll back this repair?']) assert.equal(interpretFeedback({ ...comment, body }, [1081294]).kind, 'revert-requested')
assert.equal(interpretFeedback({ ...comment, body: 'Looks good!' }, [1081294]).kind, 'reviewed')
const state = emptyRepairState(); state.repairs.r1 = { state: 'applied-awaiting-review', articleIds: ['kb1234'] }
const feedback = interpretFeedback(comment, [1081294])
const recorded = recordFeedback(state, 'r1', feedback)
assert.deepEqual(recorded.state.holds, ['r1', 'kb1234'])
assert.equal(recordFeedback(recorded.state, 'r1', feedback).changed, false)
const trial = emptyRepairState(); trial.repairs.trial1 = { state: 'applied-awaiting-review', environment: 'trial', articleIds: ['kb1234'] }
const heldTrial = recordFeedback(trial, 'trial1', feedback).state
assert.ok(!effectiveHolds(heldTrial, 'production').includes('kb1234'))
assert.ok(effectiveHolds(heldTrial, 'trial').includes('kb1234'))
const later = interpretFeedback({ ...comment, id: 20, updated_at: '2026-10-08T03:00:00Z' }, [1081294])
const laterState = recordFeedback(state, 'r1', later).state
const older = interpretFeedback({ ...comment, id: 21, body: 'Please revert this', updated_at: '2026-10-08T02:00:00Z' }, [1081294])
assert.equal(recordFeedback(laterState, 'r1', older).state.repairs.r1.state, 'changes-requested', 'Older comments from another review surface must not replace the latest request')
const edited = interpretFeedback({ ...comment, id: 21, body: 'Please revert this', updated_at: '2026-10-08T04:00:00Z' }, [1081294])
assert.equal(recordFeedback(laterState, 'r1', edited).state.repairs.r1.state, 'revert-requested')

const novemberStatus = 'Fixed in db4a09d: KB4976 (NGINX2ROOT) is now a reviewed VBR advisory (5 CVEs, Software/Infrastructure Appliance 13.1, no fix yet; Enterprise Manager not affected). A local live refresh plus verify-catalog-repair passed against current sources. The published catalog updates on the next scheduled Refresh catalog run.'
const candidate = emptyRepairState()
candidate.repairs.current = { state: 'candidate-ready', number: 39, articleIds: ['kb4976'] }
function feedbackApi(comments = [], reviews = []) {
  const routes = {
    '/issues/39/comments?per_page=100&page=1': comments,
    '/pulls/39': { number: 39 },
    '/pulls/39/reviews?per_page=100&page=1': reviews,
    '/pulls/39/comments?per_page=100&page=1': [],
  }
  return async path => {
    assert.ok(Object.hasOwn(routes, path), `Unexpected feedback API route: ${path}`)
    return routes[path]
  }
}
const info = [novemberStatus, 'Thanks', 'Can you explain the mitigation?', 'What changed?']
  .map((body, i) => ({ ...comment, id: 100 + i, body, created_at: '2026-11-22T14:03:20Z' }))
assert.deepEqual(await reviewCandidateFeedback(feedbackApi(info), candidate, 'current'), { state: candidate, needsClarification: false })
const unclear = { ...comment, id: 110, body: 'I am not sure about this yet.', created_at: '2026-11-22T14:04:00Z' }
assert.deepEqual(await reviewCandidateFeedback(feedbackApi([...info, unclear]), candidate, 'current'), { state: candidate, needsClarification: true })
const approve = { ...comment, id: 111, state: 'APPROVED', body: 'The verification checks are clean.', submitted_at: '2026-11-22T14:05:00Z' }
const approved = await reviewCandidateFeedback(feedbackApi([unclear], [approve]), candidate, 'current')
assert.equal(approved.needsClarification, false)
assert.deepEqual(approved.state.holds, [])
const applied = { ...candidate, repairs: { current: { ...candidate.repairs.current, state: 'applied-awaiting-review' } } }
assert.equal((await reviewCandidateFeedback(feedbackApi([], [approve]), applied, 'current')).state.repairs.current.state, 'reviewed')
assert.equal((await reviewCandidateFeedback(feedbackApi([unclear], [{ ...approve, submitted_at: unclear.created_at }]), candidate, 'current')).needsClarification, true)
assert.equal((await reviewCandidateFeedback(feedbackApi([unclear], [{ ...approve, user: { ...approve.user, id: 17 } }]), candidate, 'current')).needsClarification, true)
const request = { ...comment, id: 112, state: 'CHANGES_REQUESTED', body: 'Looks good!', submitted_at: '2026-11-22T14:04:30Z' }
const held = await reviewCandidateFeedback(feedbackApi([], [request, approve]), candidate, 'current')
assert.deepEqual(held.state.holds, ['current', 'kb4976'], 'Approval must not clear explicit holds')
assert.equal(held.state.repairs.current.state, 'changes-requested')

const current = { reviewedData: { advisories: [{ articleId: 'kb1234', records: ['original'] }], observationSpecs: { kb1234: {} } }, baselines: { articles: { kb1234: { text: 'old' } } }, catalog: { generatedAt: 'today', securityFeedPageStates: [{ articleId: 'kb1234', hash: 'old' }], securityFeedRoutes: [{ articleId: 'kb1234' }], securityFindings: [{ id: 'f1', sourceIds: ['kb1234'], value: 'old' }], releases: ['new unrelated release'] } }
const before = projectRepairState(current, ['kb1234'])
current.baselines.articles.kb1234.text = 'new'
current.catalog.securityFeedPageStates[0].hash = 'new'
current.catalog.securityFindings[0].value = 'new'
const after = projectRepairState(current, ['kb1234'])
current.catalog.securityFindings.push({ id: 'unrelated', sourceIds: ['kb9999'] })
const reverted = scopedRevert({ current, before, after, articleIds: ['kb1234'] })
assert.equal(reverted.catalog.securityFindings.find(item => item.id === 'f1').value, 'old')
assert.ok(reverted.catalog.securityFindings.some(item => item.id === 'unrelated'))
assert.deepEqual(reverted.catalog.releases, ['new unrelated release'])
assert.equal(reverted.catalog.generatedAt, 'today')
current.catalog.securityFindings[0].value = 'newer correction'
assert.throws(() => scopedRevert({ current, before, after, articleIds: ['kb1234'] }), /overlap/)
console.log('Feedback tests passed: trusted identity, ordinary wording, durable dedupe/holds, scoped revert, overlapping-change refusal.')
