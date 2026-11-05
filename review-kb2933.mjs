import { readFileSync } from 'node:fs'
import { fetchVspcKbInventory } from './scripts/lib/vspc-kb-cve-coverage.mjs'
const cat=JSON.parse(readFileSync('src/data/catalog.snapshot.json','utf8'))
const init={headers:{'user-agent':'UpgradeBrief catalog source review'},signal:AbortSignal.timeout(60000)}
const kb='https://www.veeam.com/kb2933'
const urls=[kb,'https://upgradebrief.com/catalog-health.json?commit='+encodeURIComponent(cat.generatedAt)]
for(const u of urls){
 const first=await fetch(u,{...init,redirect:'manual'})
 console.log('FIRST', u, first.status, first.headers.get('location'))
 const resp=await fetch(u,init), body=await resp.text()
 if(u===kb) console.log('ARTICLE',JSON.stringify({status:resp.status,url:resp.url,title:body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],h1:body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.slice(0,350),cves:[...new Set(body.match(/CVE-\d{4}-\d+/gi)||[])],canonical:body.match(/<link[^>]*rel="canonical"[^>]*>/i)?.[0],main:body.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1]?.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,2200)}))
 else {const p=JSON.parse(body);console.log('PRODUCTION',JSON.stringify({status:resp.status,commit:p.commit,generatedAt:p.generatedAt,products:p.productValidation?.map(x=>[x.productId,x.state,x.failureCodes])}))}
}
const inv=await fetchVspcKbInventory({minimumArticleCount:69,fetchPage:async({offset,limit})=>(await fetch('https://www.veeam.com/services/kb-articles?'+new URLSearchParams({product:'VAC',offset,limit}), init)).json()})
const ids=new Set(inv.articles.map(x=>x.id))
console.log('INVENTORY',JSON.stringify({count:inv.totalSize,pages:inv.pageCount,prior:cat.vspcKbArticleIds.length,removed:cat.vspcKbArticleIds.filter(x=>!ids.has(x)),added:[...ids].filter(x=>!cat.vspcKbArticleIds.includes(x))}))
