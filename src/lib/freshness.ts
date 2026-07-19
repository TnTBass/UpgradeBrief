export type FreshnessState = 'current' | 'stale' | 'outdated'

export function catalogFreshness(generatedAt: string, now = new Date()): FreshnessState {
  const ageHours = (now.getTime() - new Date(generatedAt).getTime()) / (1000 * 60 * 60)
  if (!Number.isFinite(ageHours) || ageHours > 168) return 'outdated'
  if (ageHours > 36) return 'stale'
  return 'current'
}
