export function parseCisaKev(payload) {
  if (!payload || !Array.isArray(payload.vulnerabilities)) throw new Error('CISA KEV payload does not contain vulnerabilities')
  return new Set(payload.vulnerabilities.map((item) => item.cveID).filter((cve) => /^CVE-\d{4}-\d+$/i.test(cve)))
}

export function mergeCisaKev(catalog, kevCves) {
  const next = structuredClone(catalog)
  let matches = 0
  next.securityFindings = next.securityFindings.map((finding) => {
    const isCisaKev = finding.cves.some((cve) => kevCves.has(cve))
    if (isCisaKev) matches += 1
    const sourceIds = finding.sourceIds.filter((sourceId) => sourceId !== 'cisa-kev')
    if (isCisaKev) sourceIds.push('cisa-kev')
    return { ...finding, isCisaKev, sourceIds }
  })
  return { catalog: next, matches }
}
