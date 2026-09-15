import { mergeVbrReleaseInformation, parseVbrReleaseInformation } from './lib/vbr-release-information.mjs'

const builds = parseVbrReleaseInformation('<h3>12.3.2.4465</h3><h3>12.3.2.4165</h3><h3>13.0.0.4967</h3><h3>Not a build</h3>')
if (builds.length !== 3 || !builds.includes('12.3.2.4465') || !builds.includes('13.0.0.4967')) throw new Error('Release-information build headings were not parsed correctly.')

const base = {
  releases: [
    { id: 'vbr-4465', productId: 'vbr', aliases: ['12.3.2.4465'], sourceIds: ['kb2680'] },
    { id: 'vbr-13', productId: 'vbr', aliases: ['13.0.0.4967'], sourceIds: ['kb2680'] },
    { id: 'one-4465', productId: 'veeam-one', aliases: ['12.3.2.4465'], sourceIds: ['kb4357'] },
  ],
}
const merged = mergeVbrReleaseInformation(base, builds, 'kb4696')
if (merged.attachments !== 2 || !merged.catalog.releases[0].sourceIds.includes('kb4696') || !merged.catalog.releases[1].sourceIds.includes('kb4696') || merged.catalog.releases[2].sourceIds.includes('kb4696')) {
  throw new Error('Release-information source was not attached only to matching VBR builds.')
}

const updateCatalog = {
  products: [{ id: 'vbr', recommendedReleaseId: 'vbr-13.1.1' }],
  releases: [
    { id: 'vbr-vsa-13', productId: 'vbr', name: '13 Veeam Software Appliance', aliases: ['13.0.0.4967'], sourceIds: ['kb2680'] },
    { id: 'vbr-13.1', productId: 'vbr', aliases: ['13.1.0.411', '13.1'], sourceIds: ['kb2680'] },
    { id: 'vbr-13.1.1', productId: 'vbr', aliases: ['13.1.1.18', '13.1.1'], sourceIds: ['kb2680'] },
    { id: 'vbr-13.0.3', productId: 'vbr', aliases: ['13.0.3.63', '13.0.3'], sourceIds: ['kb2680'] },
  ],
  upgradePaths: [{ id: 'vbr-13.0.0-vsa-to-13.0.2', productId: 'vbr', fromReleaseId: 'vbr-vsa-13', toReleaseId: 'vbr-13.0.2', hopReleaseIds: ['vbr-13.0.2'], notes: [], howToSourceIds: ['kb4738'], sourceIds: ['kb4738'] }],
}
const updatesMerged = mergeVbrReleaseInformation(updateCatalog, ['13.1.1.18', '13.1.0.411', '13.0.3.63', '13.0.0.4967'], 'kb4738', { applianceUpdateHowToSourceId: 'vsa-update', updateHowToSourceId: 'vbr-update' })
const updatePath = updatesMerged.catalog.upgradePaths.find((path) => path.fromReleaseId === 'vbr-13.1')
const appliancePath = updatesMerged.catalog.upgradePaths.find((path) => path.fromReleaseId === 'vbr-vsa-13')
if (updatesMerged.paths !== 2 || updatePath.toReleaseId !== 'vbr-13.1.1' || updatePath.howToSourceIds.join() !== 'vbr-update') {
  throw new Error('VBR release information did not create the documented same-family update path.')
}
if (appliancePath.toReleaseId !== 'vbr-13.1.1' || appliancePath.hopReleaseIds.join() !== 'vbr-13.1.1' || appliancePath.howToSourceIds.join() !== 'vsa-update') {
  throw new Error('VBR release information did not advance the appliance update path to the recommended release.')
}

console.log('VBR release-information adapter fixture test passed.')
