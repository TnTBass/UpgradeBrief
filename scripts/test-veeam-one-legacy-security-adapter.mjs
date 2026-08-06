import { readFile } from 'node:fs/promises'
import { mergeVeeamOneLegacySecurityArticles, parseVeeamOneLegacySecurityArticle, selectVeeamOneLegacySecurityArticles } from './lib/veeam-one-legacy-security.mjs'

const feed = { articles: [
  { id: 'kb3144', type: 'security', url: '/kb3144', seoTitle: 'Veeam ONE Remote Code Execution Vulnerabilities', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb3221', type: 'security', url: '/kb3221', seoTitle: 'Veeam ONE XML External Entity Processing vulnerabilities', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb4508', type: 'security', url: '/kb4508', seoTitle: 'CVE-2023-38547 | CVE-2023-38548 | CVE-2023-38549 | CVE-2023-41723', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb4858', type: 'security', url: '/kb4858', seoTitle: 'List of Security Fixes and Improvements in Veeam ONE', product: [{ title: 'Veeam ONE' }] },
] }

const articles = selectVeeamOneLegacySecurityArticles(feed)
if (articles.length !== 3 || articles.some((article) => article.id === 'kb4858')) throw new Error('Legacy Veeam ONE discovery did not isolate the three CVE advisories.')

const advisories = []
for (const article of articles) {
  const fixture = await readFile(new URL(`../src/data/fixtures/veeam-one-${article.id}-security.fixture.html`, import.meta.url), 'utf8')
  advisories.push(parseVeeamOneLegacySecurityArticle(fixture, article))
}

if (advisories.flatMap((advisory) => advisory.records).length !== 8) throw new Error('Legacy Veeam ONE parser did not retain all eight CVEs.')
if (advisories.some((advisory) => advisory.productId !== 'veeam-one')) throw new Error('Legacy Veeam ONE parser did not identify its coverage product.')
const kb3144 = advisories.find((advisory) => advisory.source.id === 'kb3144')
if (kb3144.records[0].cvssScore !== 9.8 || !kb3144.records[0].remediation.includes('10.0.0.750')) throw new Error('KB3144 shared CVSS and hotfix remediation were not retained.')
const kb4508 = advisories.find((advisory) => advisory.source.id === 'kb4508')
if (kb4508.records.find((record) => record.cve === 'CVE-2023-38548').affectedVersionPrefixes.join(',') !== '12.0.') throw new Error('KB4508 CVE-2023-38548 was not limited to Veeam ONE 12.')

const merged = mergeVeeamOneLegacySecurityArticles({ securityFindings: [
  { id: 'replace', productId: 'veeam-one', sourceIds: ['kb3144'] },
  { id: 'keep', productId: 'veeam-one', sourceIds: ['kb4649'] },
] }, advisories)
if (merged.findings !== 8 || merged.catalog.securityFindings.length !== 9 || merged.catalog.securityFindings.some((finding) => finding.fixedReleaseId)) throw new Error('Legacy Veeam ONE findings were not merged as hotfix remediations.')

console.log('Legacy Veeam ONE security adapter fixture test passed.')
