import { describe, expect, it } from 'vitest'
import { formatExecutiveRoute, formatLifecycleHeading } from './executive-summary-format'

describe('executive summary formatting', () => {
  it('uses sentence capitalization for lifecycle states', () => {
    expect(formatLifecycleHeading('end-of-fix')).toBe('End of fix')
    expect(formatLifecycleHeading('end-of-support')).toBe('End of support')
  })

  it('uses a PDF-safe route arrow', () => {
    expect(formatExecutiveRoute(['12.1 (build 12.1.0.2131)', '12.3.2', '13.0.2 (build 13.0.2.29)']))
      .toBe('12.1 (build 12.1.0.2131) -> 12.3.2 -> 13.0.2 (build 13.0.2.29)')
  })
})
