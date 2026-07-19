import type { Release } from './catalog-types'

export interface ReleaseOption {
  value: string
  label: string
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
  const numericAliases = release.aliases.filter((alias) => /^\d+(?:\.\d+)+$/.test(alias))
  return numericAliases.sort((left, right) => compareVersionLike(right, left))[0]
    ?? release.aliases.find((alias) => /^\d+(?:\.\d+)*$/.test(alias))
    ?? release.aliases[0]
}

export function releaseOptions(releases: Release[]): ReleaseOption[] {
  return releases
    .map((release) => ({ release, value: canonicalInput(release) }))
    .sort((left, right) => compareVersionLike(right.value, left.value) || right.release.name.localeCompare(left.release.name))
    .map(({ release, value }) => ({ value, label: release.name }))
}
