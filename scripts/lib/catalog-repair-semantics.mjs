import { normalizeSecurityReviewText } from './security-review-baselines.mjs'

const cves = text => [...new Set(text.match(/CVE-\d{4}-\d{4,}/g) ?? [])].sort()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const compareVersion = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta) return Math.sign(delta)
  }
  return 0
}

// Intentionally narrow grammar. Every byte outside a supported change must
// match the accepted article after maintained metadata normalization.
function sections(text) {
  const matches = [...text.matchAll(/CVE-\d{4}-\d{4,} (?=A (?:vulnerability|reflected cross-site scripting vulnerability)\b)/g)]
  return matches.map((match, i) => ({ start: match.index, end: matches[i + 1]?.index ?? text.length, text: text.slice(match.index, matches[i + 1]?.index ?? text.length).trim() }))
}

function parseSection(section) {
  const match = section.text.match(/^(CVE-\d{4}-\d{4,}) (A (?:vulnerability|reflected cross-site scripting vulnerability) .+?) Severity: (Low|Medium|High|Critical) CVSS v[34]\.\d Score: (\d+(?:\.\d+)?) (CVSS:(?:[34]\.\d\/)?(?:[A-Z]+:[A-Z]+\/)*[A-Z]+:[A-Z]+) (.*?)Affected Product (.+?) Solution (This vulnerability was fixed starting in the following builds?: .+)$/)
  if (!match) return null
  const [, cve, description, severity, numericScore, , context, affected, fixed] = match
  const score = Number(numericScore)
  if (score < 0.1 || score > 10 || severity !== (score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : 'Low')) return null
  const source = context.match(/^(?:Affected Deployment Type: (.+?) )?Source: Reported through HackerOne\. $/)
  if (!source || /Impact Mitigation|CVE-|\b(?:except|unless)\b/i.test(fixed)) return null
  return { cve, description, severity: `Severity: ${severity} CVSS v${section.text.includes('CVSS v4.') ? '4.0' : '3.1'} Score: ${numericScore}`, score, conditions: source[1] ?? '', affected, fixed }
}

function dependencyChange(article, spec) {
  if (article.articleId !== 'kb4857' || spec.classification !== 'informational' || spec.informationalReason !== 'NO_VENDOR_VULNERABILITY_FINDING'
    || !same(Object.keys(spec.productCves), ['vro']) || cves(article.before).length || cves(article.after).length) return null
  const beforeVersions = [], afterVersions = []
  const pattern = /\b(axios|follow-redirects|form-data|happy-dom|react-router-dom|vite|dompurify|MailKit|Microsoft\.AspNetCore\.DataProtection\.Extensions|Microsoft\.PowerShell\.SDK|MimeKit) upgraded to version (\d+\.\d+\.\d+)\b/g
  const normalize = (text, output) => normalizeSecurityReviewText(article.articleId, text).replace(pattern, (_, component, version) => {
    output.push({ component, version }); return `${component} upgraded to version [dependency version]`
  })
  if (normalize(article.before, beforeVersions) !== normalize(article.after, afterVersions) || !beforeVersions.length || beforeVersions.length !== afterVersions.length) return null
  let changed = 0
  for (let i = 0; i < beforeVersions.length; i++) {
    if (beforeVersions[i].component !== afterVersions[i].component || compareVersion(afterVersions[i].version, beforeVersions[i].version) < 0) return null
    if (afterVersions[i].version !== beforeVersions[i].version) changed++
  }
  return changed ? { kind: 'informational', checks: ['known-zero-CVE-dependency-note', 'unchanged-article-scope', 'only-dependency-version-increases'], excerpt: '', records: [] } : null
}

export function inspectSemanticChange(article, reviewedData) {
  if (!article.before) return null
  const spec = reviewedData.observationSpecs[article.articleId]
  if (!spec) return null
  const dependency = dependencyChange(article, spec)
  if (dependency) return dependency
  // Initial vulnerability support is additions to an existing single-product
  // VBR advisory with exactly the same source-backed applicability and fix.
  if (spec.classification !== 'dedicated' || !same(Object.keys(spec.productCves), ['vbr']) || spec.ignoredCveIds?.length) return null
  const advisory = reviewedData.advisories.find(item => item.articleId === article.articleId && item.productId === 'vbr')
  if (!advisory) return null
  const previousCves = cves(article.before), nextCves = cves(article.after)
  if (previousCves.some(cve => !nextCves.includes(cve)) || !same([...spec.productCves.vbr].sort(), previousCves)) return null
  const additions = nextCves.filter(cve => !previousCves.includes(cve))
  if (!additions.length || additions.length > 4) return null
  const oldSections = sections(article.before), newSections = sections(article.after)
  const addedSections = newSections.filter(section => additions.includes(section.text.split(' ')[0]))
  if (addedSections.length !== additions.length) return null
  let remainder = article.after
  for (const section of [...addedSections].reverse()) remainder = remainder.slice(0, section.start) + remainder.slice(section.end)
  if (normalizeSecurityReviewText(article.articleId, remainder) !== normalizeSecurityReviewText(article.articleId, article.before)) return null
  const records = []
  for (const section of addedSections) {
    const parsed = parseSection(section)
    if (!parsed || cves(section.text).length !== 1 || !/^Veeam Backup & Replication /.test(parsed.affected)) return null
    const anchor = oldSections.map(parseSection).find(old => old && old.affected === parsed.affected && old.fixed === parsed.fixed && old.conditions === parsed.conditions)
    const existing = anchor && advisory.records.find(record => record.cve === anchor.cve)
    if (!existing || /CVE-/.test(JSON.stringify({ ...advisory, records: [], source: undefined })) || /CVE-/.test(JSON.stringify({ ...existing, cve: undefined, title: undefined }))) return null
    records.push({ ...parsed, template: existing, product: 'Veeam Backup & Replication', section })
  }
  return { kind: 'vulnerability', checks: ['only-new-CVE-sections', 'unchanged-existing-findings', 'same-reviewed-product-applicability-and-fix'], excerpt: addedSections.map(section => section.text).join('\n\n'), records }
}

export function applySemanticChange({ article, reviewedData, extraction }) {
  const result = inspectSemanticChange(article, reviewedData)
  if (!result) return null
  if (result.kind === 'vulnerability') {
    if (extraction?.kind !== 'vulnerability' || extraction.unresolved.length || extraction.records.length !== result.records.length) return null
    for (const record of result.records) {
      const quoted = extraction.records.filter(item => item.cve === record.cve)
      if (quoted.length !== 1 || quoted[0].product !== record.product || quoted[0].description !== record.description || quoted[0].affected !== record.affected
        || quoted[0].fixed !== record.fixed || quoted[0].conditions !== record.conditions || quoted[0].severity !== record.severity || quoted[0].mitigation !== '') return null
    }
  }
  const next = structuredClone(reviewedData)
  if (result.kind === 'vulnerability') {
    const advisory = next.advisories.find(item => item.articleId === article.articleId && item.productId === 'vbr')
    for (const record of result.records) {
      advisory.records.push({ ...record.template, cve: record.cve, title: record.description, cvssScore: record.score })
      next.observationSpecs[article.articleId].productCves.vbr.push(record.cve)
    }
  }
  return { reviewedData: next, checks: result.checks, kind: result.kind }
}
