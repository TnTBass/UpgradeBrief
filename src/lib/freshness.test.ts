import { describe, expect, it } from 'vitest'
import { catalogFreshness, productFreshness } from './freshness'
import type { Catalog } from './catalog-types'
import snapshot from '../data/catalog.snapshot.json'
import { buildExecutiveSummaryPdf } from './executive-summary-pdf'

describe('product freshness', () => {
  const now = new Date('2026-10-30T12:00:00.000Z')
  it('uses the same inclusive 36/72-hour thresholds as monitoring', () => {
    expect(catalogFreshness('2026-10-29T00:00:00.001Z', now)).toBe('current')
    expect(catalogFreshness('2026-10-29T00:00:00.000Z', now)).toBe('stale')
    expect(catalogFreshness('2026-10-27T12:00:00.000Z', now)).toBe('outdated')
    expect(catalogFreshness('invalid', now)).toBe('outdated')
    expect(catalogFreshness('2099-01-01', now)).toBe('outdated')
  })
  it('warns immediately after failure and uses selected product validation time in PDF', () => {
    const catalog = structuredClone(snapshot) as Catalog
    catalog.schemaVersion = 2
    catalog.generatedAt = '2026-10-27T12:00:00.000Z'
    catalog.assembledAt = now.toISOString()
    catalog.productValidation = [
      { productId: 'vbr', state: 'retained', validatedAt: catalog.generatedAt, attemptedAt: now.toISOString(), transactionId: 'fixture', partitionHash: 'fixture', evidenceIds: ['fixture'], failureCodes: ['PARSER_FAILURE'] },
      { productId: 'vb365', state: 'validated', validatedAt: now.toISOString(), attemptedAt: now.toISOString(), transactionId: 'fixture', partitionHash: 'fixture', evidenceIds: ['fixture'], failureCodes: [] },
    ]
    const status = productFreshness(catalog, 'vbr', now)
    expect(status.state).toBe('outdated')
    expect(status.detail).toContain('2026-10-27')
    expect(productFreshness(catalog, 'vb365', now).state).toBe('current')
    expect(productFreshness(catalog, 'vro', now).state).toBe('outdated')
    const document = buildExecutiveSummaryPdf({
      productName: 'VBR', installedRelease: '13', preparedOn: '2026-10-30',
      freshness: status, recommendation: { heading: 'Recommended', detail: 'Based on retained evidence' },
      lifecycle: { heading: 'Supported', detail: 'Retained lifecycle statement' }, sources: [],
    })
    const pdf = new TextDecoder('latin1').decode(document.output('arraybuffer'))
    expect(pdf).toContain('Critical: product data is outdated')
    expect(pdf.indexOf('DATA FRESHNESS')).toBeLessThan(pdf.indexOf('DECISION SUMMARY'))
    catalog.productValidation[0].validatedAt = now.toISOString()
    expect(productFreshness(catalog, 'vbr', now).state).toBe('stale')
    expect(productFreshness(catalog, 'vbr', now).heading).toContain('retained')
  })
})

