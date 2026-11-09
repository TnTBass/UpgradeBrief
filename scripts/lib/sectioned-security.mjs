import { normalizeReviewedSecurityMainArticle } from './reviewed-security-advisories.mjs'

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const compare = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta) return Math.sign(delta)
  }
  return 0
}

export function hasSectionedSecurityLayout(content) {
  return /Issue Details CVE-\d{4}-\d+ A vulnerability\b/.test(normalizeReviewedSecurityMainArticle(content))
    && /Affected Product .+? Solution /.test(normalizeReviewedSecurityMainArticle(content))
}

// Every CVE section must be consumed, with explicit product/build boundaries.
// Unknown mitigation, exception or trailing prose needs review, not inference.
export function parseSectionedSecurityArticle(content, article, { productId, productName }) {
  const text = normalizeReviewedSecurityMainArticle(content)
  const body = text.split(' Issue Details ')[1]
  const fail = message => { throw new Error(`${article.id}: ${message}`) }
  if (!body) fail('missing per-CVE issue details')
  const starts = [...body.matchAll(/\bCVE-\d{4}-\d+ (?=A vulnerability\b)/g)]
  if (!starts.length || starts[0].index !== 0) fail('unsupported CVE section boundary')
  const product = escape(productName)
  const records = starts.map((start, index) => {
    const section = body.slice(start.index, starts[index + 1]?.index).trim()
    const match = section.match(/^(CVE-\d{4}-\d+) (A vulnerability .+?) Severity: (Low|Medium|High|Critical) CVSS v(?:3\.1|4\.0) Score: (\d+(?:\.\d+)?) CVSS:\s*(\S+) (?:Affected Deployment Type: (.+?) )?Source: (.+?) Affected Product (.+?) Solution (.+)$/)
    if (!match) fail('unsupported CVE section format')
    const [, cve, title, severity, numericScore, vector, deployment, attribution, affected, solution] = match
    const score = Number(numericScore)
    if (!/^(?:[34]\.\d\/)?(?:[A-Z]+:[A-Z]+\/)*[A-Z]+:[A-Z]+$/.test(vector)
      || /CVE-|Affected Product|Solution/.test(attribution)
      || score <= 0 || score > 10 || severity !== (score >= 9 ? 'Critical' : score >= 7 ? 'High' : score >= 4 ? 'Medium' : 'Low')) fail(`${cve}: invalid severity or attribution`)
    const ranges = []
    let remainder = affected.replace(new RegExp(`${product} (\\d+(?:\\.\\d+){3}) and all earlier version (\\d+(?:\\.\\d+)*) builds\\s*\\.`, 'g'), (_, throughBuild, family) => {
      if (!throughBuild.startsWith(family + '.')) fail(`${cve}: inconsistent version family`)
      ranges.push({ versionPrefix: family + '.', throughBuild }); return ''
    }).trim()
    const conditions = []
    if (deployment) conditions.push(`Veeam lists affected deployment type: ${deployment}. Verify applicability; this does not downgrade the upgrade reason.`)
    if (remainder) {
      if (!/^Note: (?:Older versions \(e\.g\., [\d.x, and]+\) are not affected\.|Unsupported product versions were not tested, but are likely affected and should be considered vulnerable\.)$/.test(remainder)) fail(`${cve}: unsupported applicability condition`)
      conditions.push(remainder)
      remainder = ''
    }
    const fixed = solution.match(new RegExp(`^This vulnerability was fixed starting in the following builds?: (${product} .+)$`))
    if (!ranges.length || !fixed) fail(`${cve}: missing explicit affected or fixed builds`)
    const fixedBuilds = []
    const remainingFix = fixed[1].replace(new RegExp(`${product} \\d+(?:\\.\\d+)*(?:[a-z]| (?:Patch \\d+|P\\d+|U\\d+))? \\(build (\\d+(?:\\.\\d+){3})\\)`, 'g'), (_, build) => { fixedBuilds.push(build); return '' }).trim()
    if (remainingFix || !fixedBuilds.length || ranges.some(range => !fixedBuilds.some(build => compare(build, range.throughBuild) > 0))) fail(`${cve}: unsupported fixed-build relationship`)
    return { cve, title, cvssScore: score, affectedBuildRanges: ranges, fixedBuild: fixedBuilds.sort((a,b) => compare(b,a))[0], conditions }
  })
  const allCves = [...new Set(text.match(/CVE-\d{4}-\d+/g) ?? [])].sort()
  const parsedCves = records.map(record => record.cve).sort()
  if (new Set(parsedCves).size !== parsedCves.length || JSON.stringify(allCves) !== JSON.stringify(parsedCves)) fail('incomplete or duplicate CVE coverage')
  return { productId, source: { id: article.id.toLowerCase(), title: `Veeam ${article.id.toUpperCase()}: ${article.seoTitle}`, url: `https://www.veeam.com/${article.id.toLowerCase()}` }, records }
}
