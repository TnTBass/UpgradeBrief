import { describe, expect, it } from 'vitest'
import { classifyUrgency } from './urgency'

describe('classifyUrgency', () => {
  it('marks CVSS 9 and higher as critical', () => {
    expect(classifyUrgency({ cvssScore: 9 })).toBe('critical')
  })

  it('marks KEV and vendor-confirmed exploitation as critical regardless of score', () => {
    expect(classifyUrgency({ isCisaKev: true, cvssScore: 6.1 })).toBe('critical')
    expect(classifyUrgency({ veeamConfirmedActiveExploitation: true })).toBe('critical')
  })

  it('marks CVSS 7 to 8.9 as high', () => {
    expect(classifyUrgency({ cvssScore: 8.9 })).toBe('high')
  })
})
