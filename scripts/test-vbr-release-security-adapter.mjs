import { readFile } from 'node:fs/promises'
import { mergeVbrReleaseSecurityArticles, parseVbrReleaseSecurityArticle, selectVbrSecurityArticles } from './lib/vbr-release-security.mjs'

const fixture = await readFile(new URL('../src/data/fixtures/vbr-13.0.1.2067-security.fixture.html', import.meta.url), 'utf8')
const feed = { articles: [
  { id: 'kb4831', type: 'security', url: '/kb4831', seoTitle: 'Vulnerabilities Resolved in Veeam Backup & Replication 13.0.1.2067', product: [{ title: 'Veeam Backup & Replication' }] },
  { id: 'kb4853', type: 'security', url: '/kb4853', seoTitle: 'Vulnerability Resolved in Veeam Service Provider Console 9.2.1', product: [{ title: 'Veeam Service Provider Console' }] },
] }
const [article] = selectVbrSecurityArticles(feed)
if (selectVbrSecurityArticles(feed).length !== 1 || article.id !== 'kb4831') throw new Error('VBR security article discovery did not filter the official feed correctly.')

const advisory = parseVbrReleaseSecurityArticle(fixture, article)
if (advisory.fixedBuild !== '13.0.1.2067' || advisory.affectedBuildRange.throughBuild !== '13.0.1.1071' || advisory.records.length !== 2) throw new Error('VBR release security advisory was not parsed correctly.')
if (advisory.records[0].cve !== 'CVE-2026-21669' || advisory.records[0].cvssScore !== 9.9) throw new Error('Critical VBR CVE was not retained.')

const base = {
  releases: [{ id: 'vbr-build-13-0-1-2067', productId: 'vbr', aliases: ['13.0.1.2067'] }],
  securityFindings: [{ id: 'old', productId: 'vbr', sourceIds: ['security-kb'] }, { id: 'keep', productId: 'vbr', sourceIds: ['kb4649'] }],
}
const merged = mergeVbrReleaseSecurityArticles(base, [advisory])
if (merged.findings !== 2 || merged.catalog.securityFindings.length !== 3 || merged.catalog.securityFindings[1].fixedReleaseId !== 'vbr-build-13-0-1-2067') throw new Error('VBR release security findings were not merged safely.')
console.log('VBR release security adapter fixture test passed.')
