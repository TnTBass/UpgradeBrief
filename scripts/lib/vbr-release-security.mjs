function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function findReleaseId(catalog, build) {
  return catalog.releases.find((release) => release.productId === 'vbr' && release.aliases.includes(build))?.id
}

function articleId(url) {
  return url.match(/\/kb(\d+)$/i)?.[0] ?.slice(1).toLowerCase()
}

export function selectProductReleaseSecurityArticles(feed, productNames) {
  if (!Array.isArray(feed.articles)) throw new Error('Security feed does not include an articles array.')
  const names = Array.isArray(productNames) ? productNames : [productNames]
  return feed.articles.filter((article) =>
    article.type === 'security' &&
    (names.some((productName) => new RegExp(productName, 'i').test(article.seoTitle ?? '')) || (article.product ?? []).some((product) => names.includes(product.title))) &&
    /^\/kb\d+$/i.test(article.url ?? ''),
  )
}

export const selectVbrSecurityArticles = (feed) => selectProductReleaseSecurityArticles(feed, 'Veeam Backup & Replication')
  .filter((article) => article.id.toLowerCase() !== 'kb4649')

const knownVeeamOneNonReleaseArticleIds = new Set(['kb3144', 'kb3221', 'kb4508', 'kb4649', 'kb4858'])
export const selectVeeamOneReleaseSecurityArticles = (feed) => selectProductReleaseSecurityArticles(feed, 'Veeam ONE')
  .filter((article) => !knownVeeamOneNonReleaseArticleIds.has(article.id.toLowerCase()))

const knownVspcNonReleaseArticleIds = new Set(['kb4163', 'kb4575', 'kb4649', 'kb4679', 'kb4856'])
export const selectVspcReleaseSecurityArticles = (feed) => selectProductReleaseSecurityArticles(feed, 'Veeam Service Provider Console')
  .filter((article) => !knownVspcNonReleaseArticleIds.has(article.id.toLowerCase()))

function applyVspcMitigationScope(text, records, legacyVersionPrefixes) {
  const mitigationBuild = text.match(/all\s+builds\s+prior\s+to\s+(\d+(?:\.\d+){3})\s*\(e\.g\.,\s*9\.1,\s*9\.0,\s*and\s*8\)\s+are\s+affected/i)?.[1]
  if (!mitigationBuild || !/alarm\s+script\s+execution/i.test(text)) return records

  const rceRecords = records.filter((record) => /remote\s+code\s+execution/i.test(record.title))
  if (rceRecords.length !== 1 || !legacyVersionPrefixes.length) {
    throw new Error('VSPC mitigation documents an expanded legacy scope that could not be assigned safely.')
  }

  return records.map((record) => record === rceRecords[0] ? {
    ...record,
    affectedVersionPrefixes: [...legacyVersionPrefixes],
    conditions: [
      ...record.conditions,
      `VSPC ${mitigationBuild} is affected only when alarm script execution is enabled. Earlier builds do not support this mitigation and must be upgraded.`,
    ],
  } : record)
}

export function parseProductReleaseSecurityArticle(html, article, { productId, productName, legacyVersionPrefixes = [] }, { vulnerabilityHtml = html } = {}) {
  const text = decodeHtml(html)
  const productPattern = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fixedBuild = text.match(new RegExp(`resolved in.*?${productPattern}\\s+(\\d+(?:\\.\\d+){3})`, 'i'))?.[1]
  const affected = text.match(new RegExp(`affect\\s+${productPattern}\\s+(\\d+(?:\\.\\d+){3})\\s+and\\s+all\\s+earlier\\s+version\\s+(\\d+)\\s+builds`, 'i'))
  if (!fixedBuild || !affected) throw new Error(`${article.id} does not state a supported ${productName} fixed and affected build range.`)

  const headings = [...vulnerabilityHtml.matchAll(/<h([45])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].flatMap((heading) => {
    const cve = decodeHtml(heading[2]).match(/CVE-\d{4}-\d+/i)?.[0]
    return cve ? [{ index: heading.index, cve }] : []
  })
  let records = headings.map((heading, index) => {
    const block = vulnerabilityHtml.slice(heading.index, headings[index + 1]?.index)
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1]))
    const title = paragraphs.find((paragraph) => !/^Severity:/i.test(paragraph) && !/^Please,? try again later\.?$/i.test(paragraph))
    const score = Number(decodeHtml(block).match(/CVSS\s+v(?:3\.1|4(?:\.0)?)\s+Score:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1])
    const deploymentType = decodeHtml(block).match(/Affected Deployment Type:\s*(.*?)(?:\s+Source:|$)/i)?.[1]
    if (!title || !Number.isFinite(score)) throw new Error(`${article.id} could not parse ${heading.cve} safely.`)
    return {
      cve: heading.cve.toUpperCase(),
      title,
      cvssScore: score,
      conditions: deploymentType ? [`Veeam lists affected deployment type: ${deploymentType}. Verify applicability; this does not downgrade the upgrade reason.`] : [],
    }
  })
  if (!records.length) throw new Error(`${article.id} contains no parseable CVEs.`)
  if (productId === 'vspc') records = applyVspcMitigationScope(text, records, legacyVersionPrefixes)

  return {
    productId,
    source: {
      id: articleId(article.url),
      title: `Veeam ${article.id.toUpperCase()}: ${article.seoTitle}`,
      url: new URL(article.url, 'https://www.veeam.com').toString(),
    },
    fixedBuild,
    affectedBuildRange: { versionPrefix: `${affected[2]}.`, throughBuild: affected[1] },
    records,
  }
}

export const parseVbrReleaseSecurityArticle = (html, article, options) => parseProductReleaseSecurityArticle(html, article, { productId: 'vbr', productName: 'Veeam Backup & Replication' }, options)

export function mergeProductReleaseSecurityArticles(catalog, advisories) {
  const next = structuredClone(catalog)
  const sourceIds = new Set(advisories.map((advisory) => advisory.source.id))
  const productIds = new Set(advisories.map((advisory) => advisory.productId))
  const findingKeyCounts = advisories.flatMap((advisory) => advisory.records.map((record) => `${advisory.productId}:${record.cve}`))
    .reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map())
  const retained = next.securityFindings.filter((finding) =>
    !(productIds.has(finding.productId) && (finding.sourceIds.includes('security-kb') || finding.sourceIds.some((sourceId) => sourceIds.has(sourceId)))),
  )

  const findings = advisories.flatMap((advisory) => {
    const fixedReleaseId = next.releases.find((release) => release.productId === advisory.productId && release.aliases.includes(advisory.fixedBuild))?.id
    if (!fixedReleaseId) throw new Error(`${advisory.source.id} fixed build ${advisory.fixedBuild} is missing from KB2680 data.`)
    return advisory.records.map((record) => ({
      id: `${advisory.productId}-${record.cve.toLowerCase()}${findingKeyCounts.get(`${advisory.productId}:${record.cve}`) > 1 ? `-${advisory.source.id}` : ''}`,
      productId: advisory.productId,
      title: record.title,
      cves: [record.cve],
      affectedReleaseIds: [],
      ...(record.affectedVersionPrefixes ? { affectedVersionPrefixes: record.affectedVersionPrefixes } : {}),
      affectedBuildRanges: record.affectedBuildRanges ?? [advisory.affectedBuildRange],
      fixedReleaseId,
      cvssScore: record.cvssScore,
      isCisaKev: false,
      conditions: record.conditions,
      sourceIds: ['security-kb', advisory.source.id],
    }))
  })

  next.securityFindings = [...retained, ...findings]
  return { catalog: next, findings: findings.length }
}

export const mergeVbrReleaseSecurityArticles = (catalog, advisories) => mergeProductReleaseSecurityArticles(catalog, advisories)
