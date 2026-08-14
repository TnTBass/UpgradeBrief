const PRODUCT_ID = 'vspc'

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .trim()
}

function normalizedArticleId(article) {
  return String(article?.id ?? article?.url?.match(/\/kb\d+(?:[/?#]|$)/i)?.[0]?.match(/kb\d+/i)?.[0] ?? '').toLowerCase()
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function sectionMarkers(html) {
  const markers = []
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    markers.push({
      index: match.index,
      end: match.index + match[0].length,
      level: Number(match[1]),
      label: decodeHtml(match[2]),
      kind: 'heading',
    })
  }

  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const boldOnly = match[1].match(/^\s*<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>\s*$/i)
    if (!boldOnly) continue
    const label = decodeHtml(boldOnly[2])
    if (!label || label !== decodeHtml(match[1])) continue
    markers.push({
      index: match.index,
      end: match.index + match[0].length,
      level: 7,
      label,
      kind: 'bold-paragraph',
    })
  }

  return markers.sort((left, right) => left.index - right.index)
}

function itemsInSection(html) {
  const listItems = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
    text: decodeHtml(match[1]),
  }))
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].flatMap((match) =>
    listItems.some((item) => match.index >= item.index && match.index < item.end)
      ? []
      : [{ index: match.index, text: decodeHtml(match[1]) }],
  )
  const items = [...listItems, ...paragraphs]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.text)
    .filter(Boolean)
  if (items.length) return items
  const text = decodeHtml(html)
  return text ? [text] : []
}

function sectionKey(articleId, build, context, ordinal) {
  const base = `${articleId}:${build ?? 'article'}:${slug(context || 'article') || 'article'}`
  return ordinal > 1 ? `${base}:${ordinal}` : base
}

const PARENT_SECTION_PATTERN = /^(?:New Features and Enhancements|Resolved Issues)$/i

/**
 * Extract Security-labelled subsections from a complete Veeam KB HTML page.
 * Both heading-based release notes and the bold-paragraph labels used by KB4788
 * are supported. Context is included so repeated sections remain distinguishable.
 */
export function extractVspcReleaseSecuritySections(html, article) {
  if (typeof html !== 'string') throw new TypeError('VSPC release KB content must be a string.')
  const articleId = normalizedArticleId(article)
  if (!articleId) throw new TypeError('VSPC release KB article must include a KB id or URL.')

  const markers = sectionMarkers(html)
  const sections = []
  const ordinals = new Map()
  let build
  let context = ''

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    const markerBuild = marker.kind === 'heading' && marker.level === 3
      ? marker.label.match(/\b\d+(?:\.\d+){3}\b/)?.[0]
      : undefined
    if (markerBuild) {
      build = markerBuild
      context = ''
    } else if (PARENT_SECTION_PATTERN.test(marker.label)) {
      context = marker.label
    } else if (marker.kind === 'heading' && marker.level <= 4) {
      context = marker.label
    }

    if (marker.label.toLowerCase() !== 'security') continue
    const base = `${articleId}:${build ?? 'article'}:${slug(context || 'article') || 'article'}`
    const ordinal = (ordinals.get(base) ?? 0) + 1
    ordinals.set(base, ordinal)
    const sectionHtml = html.slice(marker.end, markers[index + 1]?.index ?? html.length)
    const items = itemsInSection(sectionHtml)
    if (!items.length) continue
    sections.push({
      key: sectionKey(articleId, build, context, ordinal),
      articleId,
      ...(build ? { build } : {}),
      context: context || undefined,
      items,
      text: items.join(' '),
    })
  }

  return sections
}

const ARTICLE_REVIEW = Object.freeze({
  kb4163: Object.freeze({
    observationOnly: true,
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4163:article:resolved-issues',
        items: Object.freeze(['The configured encryption password used in backup policies is reset after upgrading to Veeam Service Provider Console v5.']),
      }),
    ]),
  }),
  kb4223: Object.freeze({
    source: Object.freeze({
      id: 'kb4223',
      title: 'Veeam KB4223: Veeam Service Provider Console v5 Patch 4',
      url: 'https://www.veeam.com/kb4223',
    }),
    fixedBuild: '5.0.0.7151',
    requiredBuilds: Object.freeze(['5.0.0.6726', '5.0.0.7151']),
    affectedBuildRanges: Object.freeze([{ versionPrefix: '5.', throughBuild: '5.0.0.6959' }]),
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4223:article:resolved-issues',
        items: Object.freeze([
          'Under certain conditions, backup portal users who do not have any access to the VSPC server can call an endpoint to download specific files from the server.',
          'When running a remote backup agent patch operation, backup portal users can upload files to the VSPC server without having any access to the machine.',
        ]),
      }),
    ]),
    records: Object.freeze([
      Object.freeze({ sectionKey: 'kb4223:article:resolved-issues', itemIndex: 0, key: 'unauthorized-server-file-download' }),
      Object.freeze({ sectionKey: 'kb4223:article:resolved-issues', itemIndex: 1, key: 'unauthorized-server-file-upload' }),
    ]),
    conditions: Object.freeze(['KB4223 lists these issues under Security and states that the post-update VSPC server build is 5.0.0.7151. It does not assign CVEs or publish CVSS scores for them.']),
  }),
  kb4277: Object.freeze({
    source: Object.freeze({
      id: 'kb4277',
      title: 'Veeam KB4277: Release Information for Veeam Service Provider Console v6 Patch 1',
      url: 'https://www.veeam.com/kb4277',
    }),
    fixedBuild: '6.0.0.8787',
    requiredBuilds: Object.freeze(['6.0.0.7739', '6.0.0.8787']),
    affectedBuildRanges: Object.freeze([{ versionPrefix: '6.', throughBuild: '6.0.0.7739' }]),
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4277:article:resolved-issues',
        items: Object.freeze(['Resellers can see data about Veeam Cloud Connect repositories on the Infrastructure Overview tab belonging to tenants managed by other resellers or a service provider.']),
      }),
    ]),
    records: Object.freeze([
      Object.freeze({ sectionKey: 'kb4277:article:resolved-issues', itemIndex: 0, key: 'cross-reseller-repository-data-exposure' }),
    ]),
    conditions: Object.freeze(['KB4277 lists this issue under Security and states that the post-update VSPC server build is 6.0.0.8787. It does not assign a CVE or publish a CVSS score for it.']),
  }),
  kb4441: Object.freeze({
    observationOnly: true,
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4441:article:resolved-issues',
        items: Object.freeze(['Due to an unsafe deserialization method used by the Veeam Service Provider Console (VSPC) server in communication between the management agent and its components, under certain conditions, it is possible to achieve Remote Code Execution (RCE) on the VSPC server machine.']),
      }),
    ]),
  }),
  kb4509: Object.freeze({
    observationOnly: true,
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4509:8.0.0.19236:resolved-issues',
        items: Object.freeze(['Due to an unsafe deserialization method used by the Veeam Service Provider Console (VSPC) server in communication between the management agent and its components, under certain conditions, it is possible to achieve Remote Code Execution (RCE) on the VSPC server machine.']),
      }),
      Object.freeze({
        key: 'kb4509:8.0.0.18054:what-s-new',
        items: Object.freeze(['Overall stability and product security has been improved.']),
      }),
    ]),
  }),
  kb4788: Object.freeze({
    source: Object.freeze({
      id: 'kb4788',
      title: 'Veeam KB4788: Release History for Veeam Service Provider Console 9',
      url: 'https://www.veeam.com/kb4788',
    }),
    fixedBuild: '9.1.0.30713',
    requiredBuilds: Object.freeze(['9.1.0.30636', '9.1.0.30713']),
    affectedBuilds: Object.freeze(['9.1.0.30345', '9.1.0.30636']),
    sections: Object.freeze([
      Object.freeze({
        key: 'kb4788:9.2.1.33875:resolved-issues',
        items: Object.freeze([
          'CVE-2026-32998 | Severity: Critical (9.4) A vulnerability in Veeam Service Provider Console allows for remote code execution.',
          'CVE-2026-64635 | Severity: Medium (5.3) A vulnerability in Veeam Service Provider Console that allows an unauthenticated attacker to hijack the password reset link and take over a user account.',
          'Third-party libraries and packages used in Veeam Service Provider Console and its components have been updated to their latest versions to address discovered vulnerabilities. (See: KB4856)',
        ]),
      }),
      Object.freeze({
        key: 'kb4788:9.1.0.30713:new-features-and-enhancements',
        items: Object.freeze(['The reset user password functionality has been optimized to further minimize the possibility of user data hijacking.']),
      }),
      Object.freeze({
        key: 'kb4788:9.1.0.30713:resolved-issues',
        items: Object.freeze(["When logging into the web PowerShell console in the backup portal, the session always runs under the account used by the management agent service (e.g., Local System), not the actual user’s credentials who started the PowerShell session. This allows privilege escalation for any authenticated user."]),
      }),
    ]),
    records: Object.freeze([
      Object.freeze({ sectionKey: 'kb4788:9.1.0.30713:resolved-issues', itemIndex: 0, key: 'web-powershell-privilege-escalation' }),
    ]),
    conditions: Object.freeze(['KB4788 lists this issue under Resolved Issues for VSPC 9.1.0.30713. It does not assign a CVE or publish a CVSS score for it.']),
  }),
})

export const REVIEWED_VSPC_RELEASE_SECURITY_ARTICLES = ARTICLE_REVIEW

export class VspcReleaseSecurityObservationError extends Error {
  constructor(articleId, issues) {
    const summary = issues.map((issue) => `${issue.type}:${issue.key ?? articleId}`).join(', ')
    super(`VSPC release Security coverage changed for ${articleId}: ${summary}`)
    this.name = 'VspcReleaseSecurityObservationError'
    this.code = 'VSPC_RELEASE_SECURITY_SECTION_CHANGED'
    this.articleId = articleId
    this.issues = structuredClone(issues)
  }
}

function equalItems(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/**
 * Fail-closed observation for a full VAC/VSPC KB page. Unknown pages are quiet
 * only while they contain no Security-labelled section.
 */
export function observeVspcReleaseSecurityArticle(html, article, { reviewedArticles = ARTICLE_REVIEW } = {}) {
  const articleId = normalizedArticleId(article)
  if (!articleId) throw new TypeError('VSPC release KB article must include a KB id or URL.')
  const sections = extractVspcReleaseSecuritySections(html, article)
  const review = reviewedArticles[articleId]
  const issues = []

  if (!review) {
    for (const section of sections) issues.push({ type: 'unexpected-section', key: section.key, observedItems: section.items })
  } else {
    const expectedByKey = new Map(review.sections.map((section) => [section.key, section]))
    const observedByKey = new Map(sections.map((section) => [section.key, section]))
    for (const expected of review.sections) {
      const observed = observedByKey.get(expected.key)
      if (!observed) issues.push({ type: 'missing-section', key: expected.key, expectedItems: [...expected.items] })
      else if (!equalItems(observed.items, expected.items)) issues.push({ type: 'changed-section', key: expected.key, expectedItems: [...expected.items], observedItems: observed.items })
    }
    for (const observed of sections) {
      if (!expectedByKey.has(observed.key)) issues.push({ type: 'unexpected-section', key: observed.key, observedItems: observed.items })
    }
  }

  if (issues.length) throw new VspcReleaseSecurityObservationError(articleId, issues)
  return { articleId, sections }
}

function cvesIn(value) {
  return [...new Set([...value.matchAll(/\bCVE\s*-?\s*(\d{4})\s*-?\s*(\d{4,7})\b/gi)]
    .map((match) => `CVE-${match[1]}-${match[2]}`))]
}

/**
 * Extend an observation review with one newly parsed, CVE-only VSPC article.
 * A mixed Security section remains unreviewed so the refresh fails closed and
 * its CVE-less disclosure must be modeled explicitly.
 */
export function createVspcReleaseSecurityReviewFromParsedCves(html, article, advisory, { reviewedArticles = ARTICLE_REVIEW } = {}) {
  const articleId = normalizedArticleId(article)
  if (!articleId) throw new TypeError('VSPC release KB article must include a KB id or URL.')
  const issues = []
  if (Object.hasOwn(reviewedArticles, articleId)) issues.push({ type: 'already-reviewed-article', key: articleId })
  if (advisory?.productId !== PRODUCT_ID) issues.push({ type: 'advisory-product-mismatch', key: articleId, observedProductId: advisory?.productId })
  if (String(advisory?.source?.id ?? '').toLowerCase() !== articleId) issues.push({ type: 'advisory-source-mismatch', key: articleId, observedSourceId: advisory?.source?.id })

  const sections = extractVspcReleaseSecuritySections(html, article)
  if (!sections.length) issues.push({ type: 'missing-security-section', key: articleId })
  const modeledCves = new Set((advisory?.records ?? []).flatMap((record) => [
    ...(record.cve ? [record.cve] : []),
    ...(record.cves ?? []),
  ]).map((cve) => String(cve).toUpperCase()))

  sections.forEach((section) => section.items.forEach((item, itemIndex) => {
    const observedCves = cvesIn(item)
    if (!observedCves.length) {
      issues.push({ type: 'cve-less-item', key: section.key, itemIndex, observedItem: item })
      return
    }
    for (const cve of observedCves) {
      if (!modeledCves.has(cve)) issues.push({ type: 'unmodeled-cve', key: section.key, itemIndex, cve, observedItem: item })
    }
  }))

  if (issues.length) throw new VspcReleaseSecurityObservationError(articleId, issues)
  const review = Object.freeze({
    sections: Object.freeze(sections.map((section) => Object.freeze({
      key: section.key,
      items: Object.freeze([...section.items]),
    }))),
  })
  return Object.freeze({ ...reviewedArticles, [articleId]: review })
}

export function parseVspcReleaseSecurityArticle(html, article) {
  const articleId = normalizedArticleId(article)
  const review = ARTICLE_REVIEW[articleId]
  if (!review) throw new Error(`${articleId || 'Unknown article'} is not a reviewed VSPC release security article.`)
  if (review.observationOnly) throw new Error(`${articleId} is reviewed as observation-only and does not define a distinct finding.`)
  const observation = observeVspcReleaseSecurityArticle(html, article)
  const text = decodeHtml(html)
  for (const build of review.requiredBuilds) {
    if (!text.includes(build)) throw new Error(`${articleId} no longer documents expected VSPC build ${build}.`)
  }

  const sectionByKey = new Map(observation.sections.map((section) => [section.key, section]))
  const records = review.records.map((record) => {
    const title = sectionByKey.get(record.sectionKey)?.items[record.itemIndex]
    if (!title) throw new Error(`${articleId} could not map reviewed Security evidence ${record.sectionKey} item ${record.itemIndex}.`)
    return { key: record.key, title, cves: [], conditions: [...review.conditions] }
  })

  return {
    productId: PRODUCT_ID,
    source: structuredClone(review.source),
    fixedBuild: review.fixedBuild,
    ...(review.affectedBuilds ? { affectedBuilds: [...review.affectedBuilds] } : {}),
    ...(review.affectedBuildRanges ? { affectedBuildRanges: structuredClone(review.affectedBuildRanges) } : {}),
    records,
  }
}

/** Audit every supplied full page, then parse the reviewed finding-bearing pages. */
export function parseVspcReleaseSecurityPages(pages, options) {
  if (!Array.isArray(pages)) throw new TypeError('VSPC release KB pages must be an array.')
  const observations = []
  const advisories = []
  for (const page of pages) {
    const observation = observeVspcReleaseSecurityArticle(page.html, page.article, options)
    observations.push(observation)
    if (Object.hasOwn(ARTICLE_REVIEW, observation.articleId) && !ARTICLE_REVIEW[observation.articleId].observationOnly) {
      advisories.push(parseVspcReleaseSecurityArticle(page.html, page.article))
    }
  }
  const sources = advisories.map((advisory) => structuredClone(advisory.source))
  return { advisories, sources, observations }
}

export function mergeVspcReleaseSecurityArticles(catalog, advisories, { checkedAt } = {}) {
  if (!catalog || !Array.isArray(catalog.releases) || !Array.isArray(catalog.securityFindings)) throw new TypeError('Catalog must include releases and securityFindings arrays.')
  if (!Array.isArray(advisories)) throw new TypeError('VSPC release security advisories must be an array.')
  if (catalog.sources !== undefined && !Array.isArray(catalog.sources)) throw new TypeError('Catalog sources must be an array when provided.')

  const next = structuredClone(catalog)
  next.sources ??= []
  const sourceIds = new Set(advisories.map((advisory) => advisory.source.id))
  const retained = next.securityFindings.filter((finding) =>
    !(finding.productId === PRODUCT_ID && (finding.sourceIds ?? []).some((sourceId) => sourceIds.has(sourceId))),
  )
  const findings = advisories.flatMap((advisory) => {
    if (advisory.productId !== PRODUCT_ID) throw new Error(`${advisory.source.id} is not a VSPC advisory.`)
    const fixedReleaseId = next.releases.find((release) => release.productId === PRODUCT_ID && release.aliases?.includes(advisory.fixedBuild))?.id
    if (!fixedReleaseId) throw new Error(`${advisory.source.id} fixed build ${advisory.fixedBuild} is missing from KB4464 data.`)
    const affectedReleaseIds = (advisory.affectedBuilds ?? []).map((build) => {
      const affectedRelease = next.releases.find((release) => release.productId === PRODUCT_ID && release.aliases?.includes(build))
      if (!affectedRelease) throw new Error(`${advisory.source.id} affected build ${build} is missing from KB4464 data.`)
      return affectedRelease.id
    })
    return advisory.records.map((record) => ({
      id: `vspc-${advisory.source.id}-${record.key}`,
      productId: PRODUCT_ID,
      title: record.title,
      cves: [],
      affectedReleaseIds,
      ...(advisory.affectedBuildRanges ? { affectedBuildRanges: structuredClone(advisory.affectedBuildRanges) } : {}),
      fixedReleaseId,
      isCisaKev: false,
      conditions: [...(record.conditions ?? [])],
      sourceIds: [advisory.source.id],
    }))
  })
  const findingIds = findings.map((finding) => finding.id)
  if (new Set(findingIds).size !== findingIds.length) throw new Error('VSPC release security advisories produced duplicate finding IDs.')

  next.securityFindings = [...retained, ...findings]
  let sourceChanges = 0
  for (const advisory of advisories) {
    const existingIndex = next.sources.findIndex((source) => source.id === advisory.source.id)
    const source = {
      ...(existingIndex >= 0 ? next.sources[existingIndex] : {}),
      ...advisory.source,
      ...(checkedAt ? { checkedAt } : {}),
    }
    if (existingIndex >= 0) next.sources[existingIndex] = source
    else next.sources.push(source)
    sourceChanges += 1
  }

  return { catalog: next, findings: findings.length, sources: sourceChanges }
}
