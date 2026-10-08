export const AI_LIMITS = Object.freeze({ requests: 6, inputTokens: 8000, outputTokens: 2000, dailyNeurons: 5000 })
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
// Published Workers AI rates, checked 2026-10-07. No automatic model fallback.
export const AI_RATES = Object.freeze({ inputPerMillion: 26668, outputPerMillion: 204805 })

export function validateBudgetState(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.reservations) || state.reservations.length > 200) throw new Error('AI budget state is missing or invalid')
  const ids = new Set()
  for (const item of state.reservations) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !/^\d{4}-\d{2}-\d{2}$/.test(item.day) || !Number.isSafeInteger(item.neurons) || item.neurons <= 0 || item.model !== AI_MODEL) throw new Error('AI budget reservation is invalid')
    ids.add(item.id)
  }
  return state
}

export function reserveInference(state, { id, now = new Date(), inputTokenUpperBound, outputTokens = AI_LIMITS.outputTokens }) {
  validateBudgetState(state)
  if (!Number.isSafeInteger(inputTokenUpperBound) || inputTokenUpperBound < 1 || inputTokenUpperBound > AI_LIMITS.inputTokens || !Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > AI_LIMITS.outputTokens) throw new Error('AI request exceeds token limits')
  if (typeof id !== 'string' || !id || state.reservations.some(item => item.id === id)) throw new Error('AI reservation identity must be new')
  const day = now.toISOString().slice(0, 10)
  const today = state.reservations.filter(item => item.day === day)
  const neurons = Math.ceil((inputTokenUpperBound * AI_RATES.inputPerMillion + outputTokens * AI_RATES.outputPerMillion) / 1_000_000)
  if (today.length >= AI_LIMITS.requests || today.reduce((sum, item) => sum + item.neurons, 0) + neurons > AI_LIMITS.dailyNeurons) throw new Error('AI daily budget exhausted')
  // Reservations survive errors, timeouts and ambiguous responses. Never refund.
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  return { ...structuredClone(state), reservations: [...state.reservations.filter(item => item.day >= cutoff), { id, day, neurons, model: AI_MODEL }] }
}
