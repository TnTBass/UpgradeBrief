import { readFileSync } from 'node:fs'
import { normalizeReviewedSecurityMainArticle, observeReviewedSecurityArticle } from './scripts/lib/reviewed-security-advisories.mjs'
import { fetchSecurityFeedPages, inferSecurityArticleProducts, buildSecurityArticleClassifications, classifySecurityFeedArticles } from './scripts/lib/security-feed-coverage.mjs'
import { securityClassificationOverrides } from './scripts/lib/catalog-refresh-registry.mjs'
const init={signal:AbortSignal.timeout(60000)}
const page=await fetch('https://www.veeam.com/kb4966',init)
if(page.status!==200 || new URL(page.url).pathname!=='/kb4966') throw Error('Article unavailable')
const html=await page.text()
console.log('KB4966_REVIEW',normalizeReviewedSecurityMainArticle(html))
console.log('OBSERVATION',JSON.stringify(observeReviewedSecurityArticle('kb4966',html)))
const feed=await fetchSecurityFeedPages({minimumArticleCount:46,fetchPage:async({offset,limit})=>(await fetch('https://www.veeam.com/services/kb-articles?'+new URLSearchParams({type:'security',offset,limit}),init)).json()})
const article=feed.articles.find(a=>a.id.toLowerCase()==='kb4966')
if(!article)throw Error('KB4966 absent from live feed')
console.log('SOURCE_METADATA',JSON.stringify(article))
console.log('INFERRED',JSON.stringify(inferSecurityArticleProducts(article)))
console.log('CLASSIFIED',JSON.stringify(classifySecurityFeedArticles({articles:[article],classifications:buildSecurityArticleClassifications([article],securityClassificationOverrides)})))
const prod=await fetch('https://upgradebrief.com/catalog-health.json?review=kb4966',init)
const health=await prod.json()
console.log('PRODUCTION',JSON.stringify({status:prod.status,commit:health.commit,generatedAt:health.generatedAt,products:health.productValidation?.map(p=>[p.productId,p.state,p.failureCodes])}))
const data=JSON.parse(readFileSync('scripts/data/reviewed-security-advisories.json','utf8'))
if(data.observationSpecs.kb4966.classification!=='dedicated') throw Error('Missing reviewed classification')
