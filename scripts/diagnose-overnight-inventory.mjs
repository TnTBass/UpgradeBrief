import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { normalizeReviewedSecurityMainArticle } from './lib/reviewed-security-advisories.mjs'
const source = (await readFile(new URL('./lib/vspc-kb-cve-coverage.mjs', import.meta.url), 'utf8')).replace("'./reviewed-security-advisories.mjs'", JSON.stringify(new URL('./lib/reviewed-security-advisories.mjs', import.meta.url).href)).replace('    allCveIds,','    evidenceSegments,\n    allCveIds,')
const { inspectVspcKbArticleSecurityEvidence } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const current=JSON.parse(await readFile('src/data/catalog.snapshot.json','utf8'))
const baselines=JSON.parse(await readFile('scripts/data/security-review-baselines.json','utf8'))
const fetcher=createCatalogSourceFetcher()
for(const before of current.vspcKbCvePageStates) {
 const html=await (await fetcher.request('https://www.veeam.com/'+before.articleId,{sourceId:before.articleId})).text()
 const after=inspectVspcKbArticleSecurityEvidence(html,before.articleId)
 const text=normalizeReviewedSecurityMainArticle(html)
 const baseline=baselines.articles[before.articleId]?.normalizedText
 console.log(JSON.stringify({articleId:before.articleId,before,after,mainUnchanged:baseline===text,baseline,main:text,digest:createHash('sha256').update(html).digest('hex')}))
}
let audit
try { audit=execFileSync('npm',['audit','--json'],{encoding:'utf8'}) } catch(error) { audit=error.stdout }
console.log('DEPENDENCY_AUDIT '+audit)
