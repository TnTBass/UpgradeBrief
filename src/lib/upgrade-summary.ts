import type { LifecycleNotice, Release, SecurityFinding, Urgency } from './catalog-types'
import { classifyUrgency } from './urgency'

export interface UpgradeSummary {
  urgency: Urgency
  heading: string
  detail: string
}

export interface AdvisoryUrgencyCount {
  urgency: Urgency
  count: number
}

interface UpgradeSummaryInput {
  findings: SecurityFinding[]
  lifecycle?: LifecycleNotice
  targetRelease?: Release
  isCurrentCatalogRelease: boolean
  hasDocumentedPath: boolean
}

function highestUrgency(findings: SecurityFinding[]): Urgency {
  if (findings.some((finding) => classifyUrgency(finding) === 'critical')) return 'critical'
  if (findings.some((finding) => classifyUrgency(finding) === 'high')) return 'high'
  return 'standard'
}

export function summarizeAdvisoryUrgencies(findings: SecurityFinding[]): AdvisoryUrgencyCount[] {
  return (['critical', 'high', 'standard'] as const)
    .map((urgency) => ({ urgency, count: findings.filter((finding) => classifyUrgency(finding) === urgency).length }))
    .filter(({ count }) => count > 0)
}

export function buildUpgradeSummary({ findings, lifecycle, targetRelease, isCurrentCatalogRelease, hasDocumentedPath }: UpgradeSummaryInput): UpgradeSummary {
  if (findings.length > 0) {
    const urgency = highestUrgency(findings)
    const advisoryLabel = `${findings.length} matching cataloged ${findings.length === 1 ? 'security advisory' : 'security advisories'}`
    const urgencyLabel = urgency === 'critical' ? 'including critical-risk findings' : urgency === 'high' ? 'including high-risk findings' : ''
    const nextStep = hasDocumentedPath && targetRelease
      ? ` Follow the documented route below to ${targetRelease.name}.`
      : ' Review the linked vendor advisories and upgrade guidance below.'

    return {
      urgency,
      heading: 'Security fixes are the clear reason to upgrade.',
      detail: `This build has ${advisoryLabel}${urgencyLabel ? `, ${urgencyLabel}` : ''}.${nextStep}`,
    }
  }

  if (lifecycle?.state === 'end-of-support') {
    return {
      urgency: 'critical',
      heading: 'This release is outside support.',
      detail: 'It no longer receives vendor support or security fixes. Treat upgrading or replacing it as critical.',
    }
  }

  if (lifecycle?.state === 'end-of-fix') {
    return {
      urgency: 'standard',
      heading: 'This release has reached end of fix.',
      detail: 'Move to a currently supported release to remain on an active fix path and receive the latest product improvements.',
    }
  }

  if (!isCurrentCatalogRelease && targetRelease) {
    return {
      urgency: 'standard',
      heading: 'A newer recommended release is available.',
      detail: hasDocumentedPath
        ? `The documented route below leads to ${targetRelease.name}.`
        : `The catalog recommends ${targetRelease.name}; use the linked vendor documentation to confirm your supported path.`,
    }
  }

  return {
    urgency: 'standard',
    heading: 'This is the current cataloged release.',
    detail: 'No newer target is currently recorded. Continue to review vendor guidance and security advisories for subsequent patches.',
  }
}
