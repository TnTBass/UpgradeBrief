import type { Release } from './catalog-types'

export interface ReleaseOption {
  value: string
  label: string
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function versionParts(value: string): number[] {
  const match = value.match(/\d+(?:\.\d+)*/)
  return match ? match[0].split('.').map(Number) : []
}

function compareVersionLike(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function canonicalInput(release: Release): string {
  const declaredBuild = release.name.match(/\bbuild\s+(\d+(?:\.\d+)+)/i)?.[1]
  if (declaredBuild && release.aliases.includes(declaredBuild)) return declaredBuild
  const numericAliases = release.aliases.filter((alias) => /^\d+(?:\.\d+)+$/.test(alias))
  return numericAliases.sort((left, right) => compareVersionLike(right, left))[0]
    ?? release.aliases.find((alias) => /^\d+(?:\.\d+)*$/.test(alias))
    ?? release.aliases[0]
}

function releaseKeys(release: Release): Set<string> {
  const stem = release.name
    .replace(/\s*\(build[^)]*\)\s*$/i, '')
    .replace(/\s*\(Veeam Data Platform[^)]*\)/gi, '')
  return new Set([...release.aliases, stem].map(normalize))
}

function hasSharedKey(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((key) => right.has(key))
}

export function releaseOptions(releases: Release[]): ReleaseOption[] {
  const groups: Array<{ releases: Release[]; keys: Set<string> }> = []

  for (const release of releases.filter((item) => !/retracted/i.test(item.name))) {
    const keys = releaseKeys(release)
    const matches = groups.filter((group) => hasSharedKey(group.keys, keys))
    const group = matches.shift() ?? { releases: [], keys: new Set<string>() }
    for (const match of matches) {
      group.releases.push(...match.releases)
      for (const key of match.keys) group.keys.add(key)
      groups.splice(groups.indexOf(match), 1)
    }
    group.releases.push(release)
    for (const key of keys) group.keys.add(key)
    if (!groups.includes(group)) groups.push(group)
  }

  return groups
    .map((group) => group.releases.map((release) => ({ release, value: canonicalInput(release) }))
      .sort((left, right) => compareVersionLike(right.value, left.value) || right.release.name.localeCompare(left.release.name))[0])
    .sort((left, right) => compareVersionLike(right.value, left.value) || right.release.name.localeCompare(left.release.name))
    .map(({ release, value }) => ({ value, label: release.name }))
}
