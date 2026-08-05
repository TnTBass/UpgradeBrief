import { readFile } from 'node:fs/promises'
import { mergeProductReleaseSecurityArticles, mergeVbrReleaseSecurityArticles, parseProductReleaseSecurityArticle, parseVbrReleaseSecurityArticle, selectVbrSecurityArticles, selectVeeamOneReleaseSecurityArticles, selectVspcReleaseSecurityArticles } from './lib/vbr-release-security.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-13.0.1.2067-security.fixture.html', import.meta.url), 'utf8')
const v4Fixture = await readFile(new URL('../src/data/fixtures/vbr-12.3.2.4854-security.fixture.html', import.meta.url), 'utf8')
const veeamOneV4Fixture = await readFile(new URL('../src/data/fixtures/veeam-one-13.1-security.fixture.html', import.meta.url), 'utf8')
const vspc921Fixture = await readFile(new URL('../src/data/fixtures/vspc-9.2.1-security.fixture.html', import.meta.url), 'utf8')
const vspc93Fixture = await readFile(new URL('../src/data/fixtures/vspc-9.3-security.fixture.html', import.meta.url), 'utf8')
const feed = { articles: [
  { id: 'kb4831', type: 'security', url: '/kb4831', seoTitle: 'Vulnerabilities Resolved in Veeam Backup & Replication 13.0.1.2067', product: [{ title: 'Veeam Backup & Replication' }] },
  { id: 'kb4649', type: 'security', url: '/kb4649', seoTitle: 'Veeam Security Bulletin (September 2024)', product: [{ title: 'Veeam Backup & Replication' }, { title: 'Veeam ONE' }] },
  { id: 'kb4853', type: 'security', url: '/kb4853', seoTitle: 'Vulnerability Resolved in Veeam Service Provider Console 9.2.1', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4893', type: 'security', url: '/kb4893', seoTitle: 'Vulnerabilities Resolved in Veeam Service Provider Console 9.3', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4163', type: 'security', url: '/kb4163', seoTitle: 'Veeam Service Provider Console v5 Patch 3', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4575', type: 'security', url: '/kb4575', seoTitle: 'Veeam Service Provider Console Vulnerability (CVE-2024-29212)', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4679', type: 'security', url: '/kb4679', seoTitle: 'Veeam Service Provider Console Vulnerability', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4856', type: 'security', url: '/kb4856', seoTitle: 'List of Security Fixes and Improvements in Veeam Service Provider Console', product: [{ title: 'Veeam Service Provider Console' }] },
  { id: 'kb4858', type: 'security', url: '/kb4858', seoTitle: 'List of Security Fixes and Improvements in Veeam ONE', product: [{ title: 'Veeam ONE' }] },
  { id: 'kb4892', type: 'security', url: '/kb4892', seoTitle: 'Vulnerabilities Resolved in Veeam ONE 13.1', product: [{ title: 'Veeam ONE' }] },
] }
const [article] = selectVbrSecurityArticles(feed)
if (selectVbrSecurityArticles(feed).length !== 1 || article.id !== 'kb4831') throw new Error('VBR security article discovery did not filter the official feed or exclude the sectioned KB4649 bulletin correctly.')

const advisory = parseVbrReleaseSecurityArticle(fixture, article)
if (advisory.fixedBuild !== '13.0.1.2067' || advisory.affectedBuildRange.throughBuild !== '13.0.1.1071' || advisory.records.length !== 2) throw new Error('VBR release security advisory was not parsed correctly.')
if (advisory.records[0].cve !== 'CVE-2026-21669' || advisory.records[0].cvssScore !== 9.9) throw new Error('Critical VBR CVE was not retained.')

const v4Advisory = parseVbrReleaseSecurityArticle(v4Fixture, { id: 'kb4869', type: 'security', url: '/kb4869', seoTitle: 'Vulnerability Resolved in Veeam Backup & Replication 12.3.2.4854' })
if (v4Advisory.fixedBuild !== '12.3.2.4854' || v4Advisory.affectedBuildRange.throughBuild !== '12.3.2.4465' || v4Advisory.records[0].cve !== 'CVE-2026-44963' || v4Advisory.records[0].cvssScore !== 9.4) throw new Error('CVSS v4 VBR advisory was not parsed correctly.')

const [veeamOneArticle] = selectVeeamOneReleaseSecurityArticles(feed)
if (selectVeeamOneReleaseSecurityArticles(feed).length !== 1 || veeamOneArticle.id !== 'kb4892') throw new Error('Veeam ONE release advisory discovery did not exclude non-CVE security-improvement articles.')
const veeamOneAdvisory = parseProductReleaseSecurityArticle(veeamOneV4Fixture, veeamOneArticle, { productId: 'veeam-one', productName: 'Veeam ONE' })
if (veeamOneAdvisory.fixedBuild !== '13.1.0.7034' || veeamOneAdvisory.affectedBuildRange.throughBuild !== '13.0.2.6723' || veeamOneAdvisory.records.length !== 6 || veeamOneAdvisory.records[0].cvssScore !== 10) throw new Error('CVSS v4.0 Veeam ONE 13.1 advisory was not parsed correctly.')

const vspcArticles = selectVspcReleaseSecurityArticles(feed)
if (vspcArticles.length !== 2 || vspcArticles.map((article) => article.id).join(',') !== 'kb4853,kb4893') throw new Error('VSPC release advisory discovery did not exclude legacy and inventory articles.')
const vspcAdvisories = [
  parseProductReleaseSecurityArticle(vspc921Fixture, vspcArticles[0], { productId: 'vspc', productName: 'Veeam Service Provider Console' }),
  parseProductReleaseSecurityArticle(vspc93Fixture, vspcArticles[1], { productId: 'vspc', productName: 'Veeam Service Provider Console' }),
]
if (vspcAdvisories[0].records.length !== 2 || vspcAdvisories[1].records.length !== 4 || vspcAdvisories[1].records[0].cvssScore !== 9.5) throw new Error('VSPC release advisories were not parsed completely.')
const vspcMerged = mergeProductReleaseSecurityArticles({
  releases: [
    { id: 'vspc-build-9-2-1-33875', productId: 'vspc', aliases: ['9.2.1.33875'] },
    { id: 'vspc-build-9-3-0-35057', productId: 'vspc', aliases: ['9.3.0.35057'] },
  ],
  securityFindings: [{ id: 'keep', productId: 'vspc', sourceIds: ['kb4679'] }],
}, vspcAdvisories)
if (vspcMerged.findings !== 6 || vspcMerged.catalog.securityFindings.length !== 7) throw new Error('VSPC release advisories were not merged safely.')

const base = {
  releases: [{ id: 'vbr-build-13-0-1-2067', productId: 'vbr', aliases: ['13.0.1.2067'] }],
  securityFindings: [{ id: 'old', productId: 'vbr', sourceIds: ['security-kb'] }, { id: 'keep', productId: 'vbr', sourceIds: ['kb4649'] }],
}
const merged = mergeVbrReleaseSecurityArticles(base, [advisory])
if (merged.findings !== 2 || merged.catalog.securityFindings.length !== 3 || merged.catalog.securityFindings[1].fixedReleaseId !== 'vbr-build-13-0-1-2067') throw new Error('VBR release security findings were not merged safely.')
console.log('VBR release security adapter fixture test passed.')
