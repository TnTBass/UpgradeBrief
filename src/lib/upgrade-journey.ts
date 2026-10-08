import type { Catalog, Release, UpgradePath } from './catalog-types'
import { journeyItems, journeySources } from '../data/upgrade-journey'

export interface JourneyGroup { title: string; note?: string; itemIds: string[] }
export interface JourneyStage { id: string; label: string; title: string; intro: string; groups: JourneyGroup[] }
export interface UpgradeJourney {
  route: Release[]
  stages: JourneyStage[]
  retentionAlreadyApplies: boolean
}

function versionParts(release: Release): number[] {
  const numeric = release.aliases.find((alias) => /^\d+\.\d+/.test(alias)) ?? release.name
  return (numeric.match(/^\d+(?:\.\d+)*/)?.[0] ?? '').split('.').map(Number)
}

export function journeyReleaseLabel(release: Release): string {
  return `V${release.name.split(' (build')[0]}`
}

// Editorial guidance is reviewed for this destination. Catalog refreshes must not
// silently apply these considerations to a new, unreviewed target release.
export function buildUpgradeJourney(catalog: Catalog, release: Release, path?: UpgradePath): UpgradeJourney | undefined {
  const major = versionParts(release)[0]
  if (release.productId !== 'vbr' || ![11, 12].includes(major) || !path || path.productId !== 'vbr' || path.toReleaseId !== 'vbr-build-13-1-1-18') return
  const hops = path.hopReleaseIds.map((id) => catalog.releases.find((item) => item.id === id))
  if (!hops.length || hops.some((hop) => !hop || hop.productId !== 'vbr') || hops.at(-1)?.id !== path.toReleaseId) return
  const destinations = hops as Release[]
  // Only show guidance for the reviewed route shape, using the actual catalog hops.
  if (destinations.slice(0, -1).some((hop) => versionParts(hop)[0] !== 12)) return
  if (major === 11 && versionParts(destinations[0])[0] !== 12) return

  const hasV12Hop = destinations.some((hop) => versionParts(hop)[0] === 12)
  const stages: JourneyStage[] = [{
    id: 'prepare', label: 'Prepare now', title: 'What you can do before the first hop',
    intro: 'Start on your installed version. Each hop separates work to complete before installation from work to do afterward.',
    groups: [{ title: 'Prepare on your current version', itemIds: ['retention', 'baseline', ...(hasV12Hop ? ['legacyPlan'] : ['conversion', 'agentBridge']), 'dependencies', 'appliance'] }],
  }]
  let previousMajor = major
  destinations.forEach((hop) => {
    const [hopMajor, minor] = versionParts(hop)
    const label = journeyReleaseLabel(hop)
    const enteringV12 = previousMajor === 11 && hopMajor === 12
    const groups: JourneyGroup[] = []
    if (hopMajor === 12) {
      const before = enteringV12 ? ['retention', 'rollback', 'licensing'] : []
      if (minor === 3) before.push('database')
      if (before.length) groups.push({ title: `Before installing ${label}`, note: enteringV12 ? 'Complete this while still on V11.' : undefined, itemIds: before })
      if (minor === 0) groups.push({ title: `After installing ${label}`, itemIds: ['components'] })
      else groups.push({ title: 'While on V12, before installing V13', note: 'Begin earlier in V12 where the documented procedure supports it.', itemIds: ['conversion', 'agentBridge', 'appliance'] })
    } else {
      groups.push({ title: `Before installing ${label}`, itemIds: ['prereqs', 'removed', 'deprecated', 'processing'] }, { title: `After installing ${label}`, itemIds: ['finish'] })
    }
    stages.push({ id: hop.id, label: `${label} hop`, title: `Prepare for ${label}`, intro: hopMajor === 12 ? 'Review the changes for this hop, then complete the work needed for the next release.' : 'Complete prerequisites on V12. Finish component work and validate protection after V13 is installed.', groups })
    previousMajor = hopMajor
  })
  return { route: [release, ...destinations], stages, retentionAlreadyApplies: major >= 12 }
}

export { journeyItems, journeySources }
