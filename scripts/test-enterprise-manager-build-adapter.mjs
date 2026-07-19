import { mergeEnterpriseManagerBuilds } from './lib/enterprise-manager-builds.mjs'

const base = {
  products: [{ id: 'enterprise-manager', recommendedReleaseId: 'em-old' }],
  releases: [
    { id: 'vbr-old', productId: 'vbr', name: '12.3.0', aliases: ['12.3.0.310'], sourceIds: ['kb2680'] },
    { id: 'vbr-1231', productId: 'vbr', name: '12.3.1', aliases: ['12.3.1.1139'], sourceIds: ['kb2680', 'kb4696'] },
    { id: 'vbr-1301', productId: 'vbr', name: '13.0.1 P2', aliases: ['13.0.1.2067'], sourceIds: ['kb2680', 'kb4738'] },
  ],
}

const merged = mergeEnterpriseManagerBuilds(base)
const emBuilds = merged.catalog.releases.filter((release) => release.productId === 'enterprise-manager')
if (merged.additions !== 2 || emBuilds.some((release) => release.aliases.includes('12.3.0.310'))) throw new Error('Enterprise Manager build adapter included an unsupported historical VBR build.')
if (!emBuilds.some((release) => release.name === '12.3.1 (build 12.3.1.1139)') || !emBuilds.some((release) => release.name === '13.0.1 P2 (build 13.0.1.2067)')) throw new Error('Enterprise Manager build adapter did not preserve version and patch labels.')
if (merged.catalog.products[0].recommendedReleaseId !== 'em-build-13-0-1-2067') throw new Error('Enterprise Manager build adapter did not select the newest source-backed build.')

console.log('Enterprise Manager build adapter fixture test passed.')
