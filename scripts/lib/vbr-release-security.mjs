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

export function selectProductReleaseSecurityArticles(feed, productName) {
  if (!Array.isArray(feed.articles)) throw new Error('Security feed does not include an articles array.')
  return feed.articles.filter((article) =>
    article.type === 'security' &&
    (new RegExp(productName, 'i').test(article.seoTitle ?? '') || (article.product ?? []).some((product) => product.title === productName)) &&
    /^\/kb\d+$/i.test(article.url ?? ''),
  )
}

export const selectVbrSecurityArticles = (feed) => selectProductReleaseSecurityArticles(feed, 'Veeam Backup & Replication')

export function parseProductReleaseSecurityArticle(html, article, { productId, productName }) {
  const text = decodeHtml(html)
  const productPattern = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fixedBuild = text.match(new RegExp(`resolved in.*?${productPattern}\\s+(\\d+(?:\\.\\d+){3})`, 'i'))?.[1]
  const affected = text.match(new RegExp(`affect\\s+${productPattern}\\s+(\\d+(?:\\.\\d+){3})\\s+and\\s+all\\s+earlier\\s+version\\s+(\\d+)\\s+builds`, 'i'))
  if (!fixedBuild || !affected) throw new Error(`${article.id} does not state a supported ${productName} fixed and affected build range.`)

  const headings = [...html.matchAll(/<h[45]\b[^>]*>[\s\S]*?(CVE-\d{4}-\d+)[\s\S]*?<\/h[45]>/gi)]
  const records = headings.map((heading, index) => {
    const block = html.slice(heading.index, headings[index + 1]?.index)
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1]))
    const title = paragraphs.find((paragraph) => !/^Severity:/i.test(paragraph) && !/^Please,? try again later\.?$/i.test(paragraph))
    const score = Number(decodeHtml(block).match(/CVSS\s+v3\.1\s+Score:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1])
    const deploymentType = decodeHtml(block).match(/Affected Deployment Type:\s*(.*?)(?:\s+Source:|$)/i)?.[1]
    if (!title || !Number.isFinite(score)) throw new Error(`${article.id} could not parse ${heading[1]} safely.`)
    return {
      cve: heading[1].toUpperCase(),
      title,
      cvssScore: score,
      conditions: deploymentType ? [`Veeam lists affected deployment type: ${deploymentType}. Verify applicability; this does not downgrade the upgrade reason.`] : [],
    }
  })
  if (!records.length) throw new Error(`${article.id} contains no parseable CVEs.`)

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

export const parseVbrReleaseSecurityArticle = (html, article) => parseProductReleaseSecurityArticle(html, article, { productId: 'vbr', productName: 'Veeam Backup & Replication' })

export function mergeProductReleaseSecurityArticles(catalog, advisories) {
  const next = structuredClone(catalog)
  const sourceIds = new Set(advisories.map((advisory) => advisory.source.id))
  const productIds = new Set(advisories.map((advisory) => advisory.productId))
  const retained = next.securityFindings.filter((finding) =>
    !(productIds.has(finding.productId) && (finding.sourceIds.includes('security-kb') || finding.sourceIds.some((sourceId) => sourceIds.has(sourceId)))),
  )

  const findings = advisories.flatMap((advisory) => {
    const fixedReleaseId = next.releases.find((release) => release.productId === advisory.productId && release.aliases.includes(advisory.fixedBuild))?.id
    if (!fixedReleaseId) throw new Error(`${advisory.source.id} fixed build ${advisory.fixedBuild} is missing from KB2680 data.`)
    return advisory.records.map((record) => ({
      id: `vbr-${record.cve.toLowerCase()}`,
      productId: advisory.productId,
      title: record.title,
      cves: [record.cve],
      affectedReleaseIds: [],
      affectedBuildRanges: [advisory.affectedBuildRange],
      fixedReleaseId,
      cvssScore: record.cvssScore,
      conditions: record.conditions,
      sourceIds: ['security-kb', advisory.source.id],
    }))
  })

  next.securityFindings = [...retained, ...findings]
  return { catalog: next, findings: findings.length }
}

export const mergeVbrReleaseSecurityArticles = (catalog, advisories) => mergeProductReleaseSecurityArticles(catalog, advisories)
