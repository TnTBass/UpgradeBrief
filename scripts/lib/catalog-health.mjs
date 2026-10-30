import { repairHash } from './catalog-repair-evidence.mjs'

export function catalogFreshness(generatedAt, now = Date.now()) {
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp) || timestamp > now + 300_000) return { level: 'critical', ageHours: null, reason: 'invalid-catalog-timestamp' }
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000)
  return { level: ageHours >= 72 ? 'critical' : ageHours >= 36 ? 'warning' : 'healthy', ageHours, reason: 'catalog-age' }
}

export function workflowFailureIdentity(failed, diagnostic) {
  // Bind the diagnostic to the signature: different article failures at the
  // same workflow step must not collapse into one stale investigation.
  const detail = diagnostic?.schemaVersion === 1 && diagnostic.code === 'REPAIR_PREPARATION_FAILED'
    ? { code: diagnostic.code, articleId: /^kb\d+$/.test(diagnostic.articleId ?? '') ? diagnostic.articleId : null, message: String(diagnostic.message ?? '').slice(0, 1200) }
    : null
  return { id: repairHash({ kind: 'repair-workflow-failure', failed: [...failed].sort(), detail }), detail }
}

export function updateFailureOccurrence(body, { runId, url, detail, failed }) {
  const safe = value => String(value).replace(/[<>&@`]/g, char => `&#${char.charCodeAt(0)};`)
  const start = '<!-- latest-catalog-failure -->', end = '<!-- /latest-catalog-failure -->'
  const occurrence = `${start}\nLatest failed run: [${runId}](${url}).\n\nFailed steps: ${failed.map(safe).join(', ') || 'unknown'}.\n${detail ? `\nCause: ${safe(detail.message)}\n` : ''}${end}`
  const first = body.indexOf(start), last = body.indexOf(end, first)
  return first >= 0 && last >= first ? body.slice(0, first) + occurrence + body.slice(last + end.length) : body + '\n\n' + occurrence
}
