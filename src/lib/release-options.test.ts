import { describe, expect, it } from 'vitest'
import { catalog } from '../data/catalog'
import { releaseOptions } from './release-options'

describe('release options', () => {
  it('offers one canonical value for each release, newest first', () => {
    const options = releaseOptions(catalog.releases.filter((release) => release.productId === 'vbr'))

    expect(options).toHaveLength(catalog.releases.filter((release) => release.productId === 'vbr').length)
    expect(options.slice(0, 4).map((option) => option.value)).toEqual([
      '13.0.2.29',
      '13.0.1.2067',
      '13.0.1.1071',
      '13.0.1.180',
    ])
    expect(options.filter((option) => option.label.includes('11a P20230227'))).toHaveLength(1)
  })
})
