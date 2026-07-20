import { describe, expect, it } from 'vitest'
import { buildUpgradeSummary, summarizeAdvisoryUrgencies } from './upgrade-summary'

const target = { id: 'target', productId: 'vbr' as const, name: '13.0.2', aliases: ['13.0.2'], sourceIds: [] }
const criticalFinding = { id: 'critical', productId: 'vbr' as const, title: 'Critical issue', cves: [], affectedReleaseIds: [], fixedReleaseId: 'target', conditions: [], sourceIds: [], cvssScore: 9 }
const lifecycle = { productId: 'vbr' as const, state: 'end-of-support' as const, summary: 'Outside support', sourceIds: [] }

describe('buildUpgradeSummary', () => {
  it('prioritizes matching critical security advisories', () => {
    const summary = buildUpgradeSummary({ findings: [criticalFinding], lifecycle, targetRelease: target, isCurrentCatalogRelease: false, hasDocumentedPath: true })

    expect(summary.urgency).toBe('critical')
    expect(summary.detail).toContain('1 matching cataloged security advisory')
    expect(summary.detail).toContain('13.0.2')
  })

  it('treats an unsupported release as critical when no advisory is curated', () => {
    const summary = buildUpgradeSummary({ findings: [], lifecycle, targetRelease: target, isCurrentCatalogRelease: false, hasDocumentedPath: false })

    expect(summary.urgency).toBe('critical')
    expect(summary.heading).toBe('This release is outside support.')
  })

  it('explains the documented path to a newer recommended release', () => {
    const summary = buildUpgradeSummary({ findings: [], targetRelease: target, isCurrentCatalogRelease: false, hasDocumentedPath: true })

    expect(summary.heading).toBe('A newer recommended release is available.')
    expect(summary.detail).toContain('13.0.2')
  })

  it('groups advisories by urgency in the displayed order', () => {
    const highFinding = { ...criticalFinding, id: 'high', cvssScore: 8 }
    const standardFinding = { ...criticalFinding, id: 'standard', cvssScore: 6 }

    expect(summarizeAdvisoryUrgencies([standardFinding, highFinding, criticalFinding])).toEqual([
      { urgency: 'critical', count: 1 },
      { urgency: 'high', count: 1 },
      { urgency: 'standard', count: 1 },
    ])
  })
})
