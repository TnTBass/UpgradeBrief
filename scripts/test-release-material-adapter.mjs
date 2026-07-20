import { contentFingerprint, extractSourceSupportedHighlights, mergeReleaseMaterials, mergeSourceSupportedHighlights, parseReleaseMaterials, releaseMaterialFamily } from './lib/release-materials.mjs'

const payload = {
  payload: {
    products: [{
      productTitle: 'Veeam Backup & Replication',
      documentGroups: [
        { resourceType: 'resourcetype:techdoc/releasenotes', documents: [{ documentTitle: 'Release Notes', links: { html: 'https://example.test/rn' } }] },
        { resourceType: 'resourcetype:techdoc/whatsnew', documents: [{ documentTitle: "What's New v13.1", links: { pdf: 'https://example.test/wn.pdf' } }] },
      ],
    }],
    filters: [{ id: 'version', groups: [{ groupItems: [{ title: '13.1', value: 'product:8/500', selected: true }] }] }],
  },
}

const materials = parseReleaseMaterials(payload, 'vbr')
if (materials.length !== 2 || materials.some((material) => material.releaseFamily !== '13.1') || releaseMaterialFamily('13.1.2') !== '13.1' || releaseMaterialFamily('13') !== '13.0') {
  throw new Error('Release-material endpoint payload was not normalized to the expected version family.')
}

const fingerprint = contentFingerprint('official source content')
const merged = mergeReleaseMaterials({ sources: [{ id: 'existing', title: 'Old title', url: 'https://example.test/rn', checkedAt: '2026-01-01T00:00:00.000Z' }], capabilities: [] }, materials.map((material) => ({ ...material, contentHash: fingerprint })), '2026-07-20T00:00:00.000Z')
if (merged.catalog.sources.length !== 2 || merged.catalog.sources[0].id !== 'existing' || merged.catalog.sources[0].releaseFamily !== '13.1' || !merged.catalog.sources[0].contentHash) {
  throw new Error('Release-material sources were not fingerprinted and merged by URL.')
}

const sourceId = merged.catalog.sources.find((source) => source.url === 'https://example.test/rn').id
const highlights = extractSourceSupportedHighlights("What's New\n• Faster recovery validation\n• Improved audit reporting", { ...materials[0], sourceId })
const highlighted = mergeSourceSupportedHighlights(merged.catalog, highlights, [sourceId])
if (highlighted.additions !== 2 || !highlighted.catalog.capabilities.every((capability) => capability.sourceIds.includes(sourceId))) {
  throw new Error('Only source-supported highlights should be added for a newly discovered release family.')
}

console.log('Release-material discovery adapter fixture test passed.')
