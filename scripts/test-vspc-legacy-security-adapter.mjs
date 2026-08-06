import { readFile } from 'node:fs/promises'
import { mergeVspcLegacySecurityArticles, parseVspcLegacySecurityArticle, selectVspcLegacySecurityArticles } from './lib/vspc-legacy-security.mjs'

const feed = { articles: [
  { id: 'kb4163', type: 'security', url: '/kb4163', seoTitle: 'Veeam Service Provider Console v5 Patch 3', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4575', type: 'security', url: '/kb4575', seoTitle: 'Veeam Service Provider Console Vulnerability (CVE-2024-29212)', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4679', type: 'security', url: '/kb4679', seoTitle: 'Veeam Service Provider Console Vulnerability (CVE-2024-42448 | CVE-2024-42449)', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4856', type: 'security', url: '/kb4856', seoTitle: 'List of Security Fixes and Improvements in Veeam Service Provider Console', product: [{ title: 'Veeam Service Provider Console' }] },
] }

const articles = selectVspcLegacySecurityArticles(feed)
if (articles.length !== 2 || articles.some((article) => ['kb4163', 'kb4856'].includes(article.id))) throw new Error('Legacy VSPC discovery did not isolate the two CVE advisories.')

const fixtures = {
  kb4575: '../src/data/fixtures/vspc-kb4575-security.fixture.html',
  kb4679: '../src/data/fixtures/vspc-security.fixture.html',
}
const advisories = []
for (const article of articles) {
  const fixture = await readFile(new URL(fixtures[article.id], import.meta.url), 'utf8')
  advisories.push(parseVspcLegacySecurityArticle(fixture, article))
}

if (advisories.flatMap((advisory) => advisory.records).length !== 3) throw new Error('Legacy VSPC parser did not retain all three CVEs.')
if (advisories.some((advisory) => advisory.productId !== 'vspc')) throw new Error('Legacy VSPC parser did not identify its coverage product.')
const kb4575 = advisories.find((advisory) => advisory.source.id === 'kb4575')
if (kb4575.fixedBuild || !kb4575.remediation.includes('7.0.0.19551') || !kb4575.remediation.includes('8.0.0.19552') || kb4575.affectedBuildRanges[0].throughBuild !== '7.0.0.18899') throw new Error('KB4575 parallel enhanced fixed builds were not retained.')
const kb4679 = advisories.find((advisory) => advisory.source.id === 'kb4679')
if (kb4679.records.length !== 2 || kb4679.affectedVersionPrefixes.join(',') !== '4.,5.,6.' || kb4679.affectedBuildRanges[0].throughBuild !== '7.0.0.19551') throw new Error('KB4679 did not include unsupported releases or every documented VSPC 7 build.')

const base = {
  releases: [
    { id: 'vspc-build-8-0-0-19552', productId: 'vspc', aliases: ['8.0.0.19552'] },
    { id: 'vspc-build-8-1-0-21999', productId: 'vspc', aliases: ['8.1.0.21999'] },
  ],
  securityFindings: [
    { id: 'replace', productId: 'vspc', sourceIds: ['kb4679'] },
    { id: 'keep', productId: 'vspc', sourceIds: ['kb4649'] },
  ],
}
const merged = mergeVspcLegacySecurityArticles(base, advisories)
const kb4575Finding = merged.catalog.securityFindings.find((finding) => finding.id === 'vspc-cve-2024-29212')
if (merged.findings !== 3 || merged.catalog.securityFindings.length !== 4 || merged.catalog.securityFindings.some((finding) => finding.id === 'replace') || kb4575Finding.fixedReleaseId || !kb4575Finding.remediation) throw new Error('Legacy VSPC findings were not merged safely.')

console.log('Legacy VSPC security adapter fixture test passed.')
