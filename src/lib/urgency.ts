import type { UrgencyInput } from './urgency-fields'
import type { Urgency } from './catalog-types'

export function classifyUrgency(finding: UrgencyInput): Urgency {
  if (finding.isCisaKev || finding.veeamConfirmedActiveExploitation || (finding.cvssScore ?? 0) >= 9) {
    return 'critical'
  }

  if ((finding.cvssScore ?? 0) >= 7) {
    return 'high'
  }

  return 'standard'
}
