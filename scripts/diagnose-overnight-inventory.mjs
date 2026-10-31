import { readFile } from 'node:fs/promises'
import { fetchVspcKbInventory } from './lib/vspc-kb-cve-coverage.mjs'
import { createCatalogSourceFetcher } from './lib/source-fetch.mjs'
import { normalizeReviewedSecurityMainArticle } from './lib/reviewed-security-advisories.mjs'
const current = JSON.parse(await readFile('src/data/catalog.snapshot.json', 'utf8'))
const fetcher = createCatalogSourceFetcher()
const inventory = await fetchVspcKbInventory({
  minimumArticleCount: 69,
  fetchPage: async ({ offset, limit }) => (await fetcher.request('https://www.veeam.com/services/kb-articles?' + new URLSearchParams({product:'VAC',offset:String(offset),limit:String(limit)}), {sourceId:'vspc-kb-inventory-'+offset})).text(),
})
const ids = inventory.articles.map(x=>x.id).sort()
const missing = current.vspcKbArticleIds.filter(id=>!ids.includes(id))
console.log(JSON.stringify({status:'inventory-diagnosis',at:new Date().toISOString(),total:inventory.totalSize,pageCount:inventory.pageCount,ids,missing,added:ids.filter(id=>!current.vspcKbArticleIds.includes(id))}))
for(const id of missing) {
  const response = await fetcher.request('https://www.veeam.com/'+id,{sourceId:id})
  const text = normalizeReviewedSecurityMainArticle(await response.text())
  console.log(JSON.stringify({status:'missing-article',id,text}))
}
