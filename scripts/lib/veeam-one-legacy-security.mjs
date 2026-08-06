function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

const articleConfig = {
  kb3144: {
    expectedCves: ['CVE-2020-10914', 'CVE-2020-10915'],
    affectedVersionPrefixes: ['9.5.4.', '10.0.0.'],
    remediation: 'Apply the KB3144 hotfix that matches Veeam ONE 10 build 10.0.0.750 or 9.5 Update 4a build 9.5.4.4587. Veeam ONE 9.5 Update 4 build 9.5.4.4566 must be upgraded first.',
    conditions: ['The main Veeam ONE build does not change after this hotfix. Verify that the Veeam ONE Agent component is 10.0.1.750 or 9.5.5.4587, as applicable.'],
  },
  kb3221: {
    expectedCves: ['CVE-2020-15418', 'CVE-2020-15419'],
    affectedVersionPrefixes: ['9.5.4.', '10.0.0.'],
    remediation: 'Apply the KB3221 hotfix that matches Veeam ONE 10 build 10.0.0.750 or 9.5 Update 4a build 9.5.4.4587. Veeam ONE 9.5 Update 4 build 9.5.4.4566 must be upgraded first.',
    conditions: ['Veeam labels the article Critical while publishing a CVSS v3 score of 7.5. Veeam does not document a changed Veeam ONE server build after this hotfix; verify the deployed hotfix files.'],
  },
  kb4508: {
    expectedCves: ['CVE-2023-38547', 'CVE-2023-38548', 'CVE-2023-38549', 'CVE-2023-41723'],
    remediation: 'Apply the KB4508 hotfix that matches build 12.0.1.2591, 11.0.1.1880, or 11.0.0.1379. Build 12.0.0.2498 must first be updated to 12.0.1.2591.',
    conditions: ['The hotfix does not change the displayed Veeam ONE build. Validate the deployed file hashes as documented in KB4508. Veeam ONE 12.1 is not affected.'],
  },
}

function normalizedArticleId(article) {
  return String(article.id ?? article.url?.match(/\/kb\d+$/i)?.[0]?.slice(1) ?? '').toLowerCase()
}

function sourceFor(article) {
  const id = normalizedArticleId(article)
  return {
    id,
    title: `Veeam ${id.toUpperCase()}: ${article.seoTitle}`,
    url: new URL(article.url, 'https://www.veeam.com').toString(),
  }
}

function assertExpectedCves(articleId, actual, expected) {
  const sortedActual = [...new Set(actual.map((cve) => cve.toUpperCase()))].sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${articleId} CVE set changed: expected ${sortedExpected.join(', ')}, received ${sortedActual.join(', ') || 'none'}.`)
  }
  return sortedActual
}

function cvssScore(text, articleId, cve) {
  const score = Number(text.match(/CVSS\s+v(?:3(?:\.1)?|4(?:\.0)?)(?:\s+score)?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1])
  if (!Number.isFinite(score)) throw new Error(`${articleId} does not provide a parseable CVSS score for ${cve}.`)
  return score
}

function challengeTitle(html, articleId) {
  const title = decodeHtml(html).match(/\bChallenge\s+(.{20,1000}?)\s+Severity\s*:/i)?.[1]?.trim()
  if (!title || !/vulnerabilit/i.test(title) || !/Veeam ONE/i.test(title)) throw new Error(`${articleId} does not provide a parseable challenge description.`)
  return title
}

function parseSharedArticle(html, article, config) {
  const articleId = normalizedArticleId(article)
  const text = decodeHtml(html)
  const cves = assertExpectedCves(articleId, [...text.matchAll(/CVE-\d{4}-\d+/gi)].map((match) => match[0]), config.expectedCves)
  const title = challengeTitle(html, articleId)
  const score = cvssScore(text, articleId, cves[0])
  return cves.map((cve) => ({ cve, title, cvssScore: score }))
}

function parseKb4508(html, article, config) {
  const articleId = normalizedArticleId(article)
  const headings = [...html.matchAll(/<h([45])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].flatMap((heading) => {
    const cve = decodeHtml(heading[2]).match(/CVE-\d{4}-\d+/i)?.[0]
    return cve ? [{ index: heading.index, cve }] : []
  })
  assertExpectedCves(articleId, headings.map((heading) => heading.cve), config.expectedCves)

  return headings.map((heading, index) => {
    const cve = heading.cve.toUpperCase()
    const block = html.slice(heading.index, headings[index + 1]?.index)
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1]))
    const title = paragraphs.find((paragraph) => !/^(Affected Version|Severity:|CVSS|Note:)/i.test(paragraph))
    if (!title) throw new Error(`${articleId} does not provide a parseable description for ${cve}.`)
    return {
      cve,
      title,
      cvssScore: cvssScore(decodeHtml(block), articleId, cve),
      conditions: paragraphs.filter((paragraph) => /^Note:/i.test(paragraph)),
    }
  })
}

export function selectVeeamOneLegacySecurityArticles(feed) {
  if (!Array.isArray(feed.articles)) throw new Error('Security feed does not include an articles array.')
  return feed.articles.filter((article) =>
    article.type === 'security'
    && Object.hasOwn(articleConfig, normalizedArticleId(article))
    && (article.product ?? []).some((product) => product.title === 'Veeam ONE'),
  )
}

export function parseVeeamOneLegacySecurityArticle(html, article) {
  const articleId = normalizedArticleId(article)
  const config = articleConfig[articleId]
  if (!config) throw new Error(`${articleId || 'Unknown article'} is not a supported legacy Veeam ONE security article.`)
  const records = articleId === 'kb4508' ? parseKb4508(html, article, config) : parseSharedArticle(html, article, config)

  return {
    productId: 'veeam-one',
    source: sourceFor(article),
    records: records.map((record) => ({
      ...record,
      affectedVersionPrefixes: articleId === 'kb4508'
        ? (record.cve === 'CVE-2023-38548' ? ['12.0.'] : ['11.0.0.', '11.0.1.', '12.0.'])
        : config.affectedVersionPrefixes,
      remediation: config.remediation,
      conditions: [...(record.conditions ?? []), ...config.conditions],
    })),
  }
}

export function mergeVeeamOneLegacySecurityArticles(catalog, advisories) {
  const next = structuredClone(catalog)
  const sourceIds = new Set(advisories.map((advisory) => advisory.source.id))
  const retained = next.securityFindings.filter((finding) =>
    !(finding.productId === 'veeam-one' && finding.sourceIds.some((sourceId) => sourceIds.has(sourceId))),
  )
  const findings = advisories.flatMap((advisory) => advisory.records.map((record) => ({
    id: `one-${record.cve.toLowerCase()}`,
    productId: 'veeam-one',
    title: record.title,
    cves: [record.cve],
    affectedReleaseIds: [],
    affectedVersionPrefixes: record.affectedVersionPrefixes,
    cvssScore: record.cvssScore,
    isCisaKev: false,
    remediation: record.remediation,
    conditions: record.conditions,
    sourceIds: [advisory.source.id],
  })))

  next.securityFindings = [...retained, ...findings]
  return { catalog: next, findings: findings.length }
}
