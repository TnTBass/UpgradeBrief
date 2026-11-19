import { extractWithWorkersAi, makeAiRequest, validateReviewProposal } from './catalog-repair-ai.mjs'

export const MAX_REVIEW_PARTS = 3

// Plan complete coverage before spending any budget. Overlap and the article
// introduction provide context; source offsets make omissions auditable.
export function planReviewExcerpts(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 100_000) throw new Error('Invalid review source')
  const introEnd = text.lastIndexOf(' ', Math.min(700, text.length))
  const intro = text.slice(0, introEnd > 0 ? introEnd : Math.min(700, text.length))
  const parts = []
  let cursor = 0
  while (cursor < text.length) {
    if (parts.length === MAX_REVIEW_PARTS) throw new Error('AI review exceeds three bounded sections; complete source retained for human review')
    const start = Math.max(0, cursor - 300)
    const prefix = start ? intro + '\n\n' : ''
    const excerpt = end => prefix + text.slice(start, end)
    let low = cursor, high = text.length
    while (low < high) {
      const end = Math.ceil((low + high) / 2)
      try { makeAiRequest(excerpt(end), { mode: 'review' }); low = end }
      catch (error) {
        if (!error.message.includes('exceeds token budget')) throw error
        high = end - 1
      }
    }
    let end = low
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end)
      if (boundary > cursor) end = boundary
      if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--
    }
    if (end <= cursor) throw new Error('AI review section cannot fit within the existing budget')
    parts.push({ start, end, excerpt: excerpt(end) })
    cursor = end
  }
  return parts
}

export async function reviewWithWorkersAi({ text, ...options }) {
  const planned = planReviewExcerpts(text)
  const parts = []
  for (const [index, part] of planned.entries()) {
    try {
      const result = await extractWithWorkersAi({ ...options, mode: 'review', excerpt: part.excerpt,
        cacheKey: { ...options.cacheKey, part: index, start: part.start, end: part.end } })
      // A quote spanning a synthetic context separator is not source evidence.
      validateReviewProposal(result.extraction, text)
      parts.push({ start: part.start, end: part.end, proposal: result.extraction })
    } catch (error) {
      return { kind: 'review-batch', complete: false, sourceLength: text.length, plannedParts: planned.length, parts,
        unresolved: ['Review section ' + (index + 1) + ' of ' + planned.length + ': ' + error.message] }
    }
  }
  return { kind: 'review-batch', complete: true, sourceLength: text.length, plannedParts: planned.length, parts, unresolved: [] }
}
