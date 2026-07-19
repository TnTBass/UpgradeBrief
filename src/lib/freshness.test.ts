import { describe, expect, it } from 'vitest'
import { catalogFreshness } from './freshness'

describe('catalogFreshness', () => {
  const now = new Date('2026-07-19T12:00:00.000Z')

  it('is current through 36 hours', () => {
    expect(catalogFreshness('2026-07-18T00:00:00.000Z', now)).toBe('current')
  })

  it('is stale after 36 hours and outdated after seven days', () => {
    expect(catalogFreshness('2026-07-17T23:59:59.000Z', now)).toBe('stale')
    expect(catalogFreshness('2026-07-12T11:59:59.000Z', now)).toBe('outdated')
  })
})
