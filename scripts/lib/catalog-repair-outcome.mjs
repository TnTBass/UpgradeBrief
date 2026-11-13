export function publicationOutcome(repair) {
  const verified = ['applied-awaiting-review', 'reviewed'].includes(repair?.state) &&
    repair.deployment?.commit === repair.mergeCommit && repair.deployment?.catalogHash === repair.catalogHash &&
    /^[a-f0-9]{40}$/.test(repair.mergeCommit ?? '') && /^[a-f0-9]{64}$/.test(repair.catalogHash ?? '')
  return {
    outcome: verified ? 'recovered' : ['needs-investigation', 'candidate-ready', 'changes-requested'].includes(repair?.state) ? 'needs-review' : 'retained',
    catalogue: verified ? 'published-and-verified' : 'last-validated-data-retained',
    publicationVerified: Boolean(verified),
  }
}

