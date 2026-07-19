function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function sectionFor(html, headingPattern, solutionAnchor) {
  const start = html.search(headingPattern)
  if (start < 0) return ''
  const solution = html.indexOf(`id="${solutionAnchor}"`, start)
  return html.slice(start, solution < 0 ? undefined : solution)
}

function parseSection(html, headingPattern, solutionAnchor) {
  const section = sectionFor(html, headingPattern, solutionAnchor)
  const headings = [...section.matchAll(/<h5\b[^>]*>[\s\S]*?(CVE-\d{4}-\d+)[\s\S]*?<\/h5>/gi)]

  return headings.map((heading, index) => {
    const block = section.slice(heading.index, headings[index + 1]?.index)
    const text = decodeHtml(block)
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1]))
    const title = paragraphs.find((paragraph) => !/^Severity:/i.test(paragraph) && !/^This vulnerability was reported/i.test(paragraph))
    const score = Number(text.match(/CVSS\s+v3\.1\s+Score:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1])
    if (!title || !Number.isFinite(score)) throw new Error(`Could not parse advisory details for ${heading[1]}`)
    return { cve: heading[1].toUpperCase(), title, cvssScore: score }
  })
}

export function parseVbrSecurityBulletin(html) {
  return parseSection(html, /<h2\b[^>]*>[\s\S]{0,120}?Veeam Backup(?:\s|&nbsp;|&amp;nbsp;)+&(?:amp;)?\s*Replication/i, 'vbrsolution')
}

export function parseVeeamOneSecurityBulletin(html) {
  return parseSection(html, /<h2\b[^>]*>[\s\S]{0,120}?Veeam ONE/i, 'vonesolution')
}

const vbrMetadata = {
  productId: 'vbr',
  affectedReleaseIds: ['vbr-11a-p20230227', 'vbr-12.1'],
  affectedVersionPrefixes: ['11.0.1.', '12.0.', '12.1.'],
  fixedReleaseId: 'vbr-12.2',
  conditions: ['Veeam states that unsupported releases are not tested but are likely affected and should be considered vulnerable.'],
  sourceIds: ['kb4649'],
}

const veeamOneMetadata = {
  productId: 'veeam-one',
  affectedReleaseIds: ['one-12.1'],
  affectedVersionPrefixes: ['12.0.', '12.1.'],
  fixedReleaseId: 'one-12.2',
  conditions: ['Veeam states that unsupported releases are not tested but are likely affected and should be considered vulnerable.'],
  sourceIds: ['kb4649'],
}

function mergeBulletin(catalog, records, metadata, idPrefix) {
  const next = structuredClone(catalog)
  const retained = next.securityFindings.filter((finding) => !(finding.productId === metadata.productId && finding.sourceIds.includes('kb4649')))
  const findings = records.map((record) => ({
    id: `${idPrefix}-${record.cve.toLowerCase()}`,
    title: record.title,
    cves: [record.cve],
    cvssScore: record.cvssScore,
    ...metadata,
  }))
  next.securityFindings = [...retained, ...findings]
  return { catalog: next, findings: findings.length }
}

export function mergeVbrSecurityBulletin(catalog, records) {
  return mergeBulletin(catalog, records, vbrMetadata, 'vbr')
}

export function mergeVeeamOneSecurityBulletin(catalog, records) {
  return mergeBulletin(catalog, records, veeamOneMetadata, 'one')
}
