import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { releaseOptions } from './release-options'

describe('release options', () => {
  it('offers canonical builds newest first', () => {
    const options = releaseOptions(catalog.releases.filter((release) => release.productId === 'vbr'))

    expect(options.slice(0, 4).map((option) => option.value)).toEqual([
      '13.0.2.29',
      '13.0.1.2067',
      '13.0.1.1071',
      '13.0.1.180',
    ])
    expect(options.filter((option) => option.label.includes('11a P20230227'))).toHaveLength(1)
  })

  it('collapses overlapping release entries and omits retracted builds from suggestions', () => {
    const options = releaseOptions(catalog.releases.filter((release) => release.productId === 'veeam-one'))

    expect(options.filter((option) => option.label.startsWith('13.0.2'))).toEqual([
      { value: '13.0.2.6723', label: '13.0.2 (build 13.0.2.6723)' },
    ])
    expect(options.some((option) => option.label.includes('retracted'))).toBe(false)
  })

  it('labels Enterprise Manager suggestions with their canonical version and build', () => {
    const options = releaseOptions(catalog.releases.filter((release) => release.productId === 'enterprise-manager'))

    expect(options[0]).toEqual({ value: '13.0.2.29', label: '13.0.2 (build 13.0.2.29)' })
  })
})
