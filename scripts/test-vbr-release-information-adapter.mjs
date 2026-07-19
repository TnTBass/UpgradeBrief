import { mergeVbrReleaseInformation, parseVbrReleaseInformation } from './lib/vbr-release-information.mjs'

const builds = parseVbrReleaseInformation('<h3>12.3.2.4465</h3><h3>12.3.2.4165</h3><h3>Not a build</h3>')
if (builds.length !== 2 || !builds.includes('12.3.2.4465')) throw new Error('Release-information build headings were not parsed correctly.')

const base = {
  releases: [
    { id: 'vbr-4465', productId: 'vbr', aliases: ['12.3.2.4465'], sourceIds: ['kb2680'] },
    { id: 'one-4465', productId: 'veeam-one', aliases: ['12.3.2.4465'], sourceIds: ['kb4357'] },
  ],
}
const merged = mergeVbrReleaseInformation(base, builds, 'kb4696')
if (merged.attachments !== 1 || !merged.catalog.releases[0].sourceIds.includes('kb4696') || merged.catalog.releases[1].sourceIds.includes('kb4696')) {
  throw new Error('Release-information source was not attached only to matching VBR builds.')
}

console.log('VBR release-information adapter fixture test passed.')
