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
  kb4575: {
    expectedCves: ['CVE-2024-29212'],
    expectedBuilds: ['7.0.0.19551', '8.0.0.19552'],
    remediation: 'Update VSPC 7 to 7.0.0.19551 or VSPC 8 to 8.0.0.19552. Upgrade unsupported releases to a supported VSPC version.',
    affectedBuildRanges: [
      { versionPrefix: '7.', throughBuild: '7.0.0.18899' },
      { versionPrefix: '8.', throughBuild: '8.0.0.19236' },
    ],
    conditions: ['Veeam reissued the May 2024 patches; use the final enhanced builds, not the initial 7.0.0.18899 or 8.0.0.19236 patches.'],
  },
  kb4679: {
    expectedCves: ['CVE-2024-42448', 'CVE-2024-42449'],
    expectedBuilds: ['8.1.0.21377', '8.1.0.21999'],
    fixedBuild: '8.1.0.21999',
    affectedVersionPrefixes: ['4.', '5.', '6.'],
    affectedBuildRanges: [
      { versionPrefix: '7.', throughBuild: '7.0.0.19551' },
      { versionPrefix: '8.', throughBuild: '8.1.0.21377' },
    ],
    conditions: [
      'Veeam identifies an authorized management agent as the precondition. Verify it; this does not downgrade the upgrade reason.',
      'Veeam states that unsupported releases are not tested but are likely affected and should be considered vulnerable.',
    ],
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
}

function parseRecords(html, articleId, expectedCves) {
  const headings = [...html.matchAll(/<h([45])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].flatMap((heading) => {
    const cve = decodeHtml(heading[2]).match(/CVE-\d{4}-\d+/i)?.[0]
    return cve ? [{ index: heading.index, cve: cve.toUpperCase() }] : []
  })
  assertExpectedCves(articleId, headings.map((heading) => heading.cve), expectedCves)

  return headings.map((heading, index) => {
    const block = html.slice(heading.index, headings[index + 1]?.index)
    const paragraphs = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => decodeHtml(match[1]))
    const title = paragraphs.find((paragraph) => !/^(Severity:|CVSS|Source:|This vulnerability (?:was )?(?:reported|detected))/i.test(paragraph))
    const score = Number(decodeHtml(block).match(/CVSS\s+v(?:3(?:\.1)?|4(?:\.0)?)(?:\s+Score)?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1])
    if (!title || !Number.isFinite(score)) throw new Error(`${articleId} could not parse ${heading.cve} safely.`)
    return { cve: heading.cve, title, cvssScore: score }
  })
}

export function selectVspcLegacySecurityArticles(feed) {
  if (!Array.isArray(feed.articles)) throw new Error('Security feed does not include an articles array.')
  return feed.articles.filter((article) =>
    article.type === 'security'
    && Object.hasOwn(articleConfig, normalizedArticleId(article))
    && (article.product ?? []).some((product) => product.title === 'Veeam Service Provider Console'),
  )
}

export function parseVspcLegacySecurityArticle(html, article) {
  const articleId = normalizedArticleId(article)
  const config = articleConfig[articleId]
  if (!config) throw new Error(`${articleId || 'Unknown article'} is not a supported legacy VSPC security article.`)

  const text = decodeHtml(html)
  for (const build of config.expectedBuilds) {
    if (!text.includes(build)) throw new Error(`${articleId} no longer documents expected VSPC build ${build}.`)
  }

  return {
    source: sourceFor(article),
    fixedBuild: config.fixedBuild,
    remediation: config.remediation,
    affectedVersionPrefixes: config.affectedVersionPrefixes,
    affectedBuildRanges: config.affectedBuildRanges,
    records: parseRecords(html, articleId, config.expectedCves).map((record) => ({
      ...record,
      conditions: config.conditions,
    })),
  }
}

export function mergeVspcLegacySecurityArticles(catalog, advisories) {
  const next = structuredClone(catalog)
  const sourceIds = new Set(advisories.map((advisory) => advisory.source.id))
  const retained = next.securityFindings.filter((finding) =>
    !(finding.productId === 'vspc' && finding.sourceIds.some((sourceId) => sourceIds.has(sourceId))),
  )
  const findings = advisories.flatMap((advisory) => {
    const fixedReleaseId = advisory.fixedBuild
      ? next.releases.find((release) => release.productId === 'vspc' && release.aliases.includes(advisory.fixedBuild))?.id
      : undefined
    if (advisory.fixedBuild && !fixedReleaseId) throw new Error(`${advisory.source.id} fixed build ${advisory.fixedBuild} is missing from KB4464 data.`)
    if (!fixedReleaseId && !advisory.remediation) throw new Error(`${advisory.source.id} does not provide a fixed build or remediation.`)
    return advisory.records.map((record) => ({
      id: `vspc-${record.cve.toLowerCase()}`,
      productId: 'vspc',
      title: record.title,
      cves: [record.cve],
      affectedReleaseIds: [],
      ...(advisory.affectedVersionPrefixes ? { affectedVersionPrefixes: advisory.affectedVersionPrefixes } : {}),
      affectedBuildRanges: advisory.affectedBuildRanges,
      ...(fixedReleaseId ? { fixedReleaseId } : { remediation: advisory.remediation }),
      cvssScore: record.cvssScore,
      isCisaKev: false,
      conditions: record.conditions,
      sourceIds: [advisory.source.id],
    }))
  })

  next.securityFindings = [...retained, ...findings]
  return { catalog: next, findings: findings.length }
}
