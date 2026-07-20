import { createHash } from 'node:crypto'

const trackedKinds = new Map([
  ['resourcetype:techdoc/releasenotes', 'release-notes'],
  ['resourcetype:techdoc/whatsnew', 'whats-new'],
])

function compact(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function releaseMaterialFamily(value) {
  const match = compact(value).match(/\d+(?:\.\d+)?/)
  if (!match) return undefined
  const [major, minor = '0'] = match[0].split('.')
  return `${major}.${minor}`
}

function selectedVersion(payload) {
  const versionFilter = payload?.payload?.filters?.find((filter) => filter.id === 'version')
  const versions = versionFilter?.groups?.flatMap((group) => group.groupItems ?? []) ?? []
  return versions.find((version) => version.selected && releaseMaterialFamily(version.title))
    ?? versions.find((version) => releaseMaterialFamily(version.title))
}

export function parseReleaseMaterials(payload, productId) {
  const version = selectedVersion(payload)
  const releaseFamily = version && releaseMaterialFamily(version.title)
  const product = payload?.payload?.products?.[0]
  if (!product || !releaseFamily) return []

  return (product.documentGroups ?? []).flatMap((group) => {
    const kind = trackedKinds.get(group.resourceType)
    if (!kind) return []
    return (group.documents ?? []).flatMap((document) => {
      const url = document.links?.html ?? document.links?.pdf
      if (!url) return []
      return [{
        productId,
        releaseFamily,
        kind,
        title: `${product.productTitle} ${version.title} ${document.documentTitle}`,
        url,
      }]
    })
  })
}

export function contentFingerprint(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function sourceIdForReleaseMaterial(material) {
  return `release-material-${material.productId}-${slug(material.releaseFamily)}-${material.kind}`
}

export function mergeReleaseMaterials(catalog, materials, checkedAt) {
  const next = structuredClone(catalog)
  let additions = 0
  let changes = 0

  for (const material of materials) {
    const index = next.sources.findIndex((source) => source.url === material.url)
    const existing = index >= 0 ? next.sources[index] : undefined
    const source = {
      id: existing?.id ?? sourceIdForReleaseMaterial(material),
      title: material.title,
      url: material.url,
      checkedAt,
      productId: material.productId,
      releaseFamily: material.releaseFamily,
      materialKind: material.kind,
      contentHash: material.contentHash,
      contentChangedAt: existing?.contentHash === material.contentHash ? existing.contentChangedAt : checkedAt,
    }

    if (!existing) {
      next.sources.push(source)
      additions += 1
    } else {
      if (existing.contentHash !== material.contentHash || existing.title !== source.title || existing.releaseFamily !== source.releaseFamily) changes += 1
      next.sources[index] = { ...existing, ...source }
    }
  }

  return { catalog: next, additions, changes }
}

function toText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|li|h[1-6]|tr|div|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>(?:\r?\n)?/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split(/\r?\n/)
    .map(compact)
    .filter(Boolean)
    .join('\n')
}

function splitCandidates(text) {
  return [...text.matchAll(/(?:^|\n)\s*(?:[•*\-]\s*)?([^\n]{12,120})/g)]
    .map((match) => compact(match[1]))
    .filter((value) => /[a-z]/i.test(value))
    .filter((value) => !/^(table of contents|what'?s new|release notes|contents|overview|introduction)$/i.test(value))
    .filter((value) => !/^\d+(?:\.\d+)*$/.test(value))
}

export function extractSourceSupportedHighlights(text, material) {
  const marker = /what'?s new|new features|enhancements/i
  const markerIndex = text.search(marker)
  if (markerIndex < 0) return []
  const window = text.slice(markerIndex, markerIndex + 12_000)
  const candidates = splitCandidates(window)
  const unique = [...new Set(candidates.map((candidate) => candidate.replace(/\s+\d{1,3}$/, '').trim()))]
    .filter((candidate) => !/^(new features|other enhancements)$/i.test(candidate))
  return unique.slice(0, 5).map((title, index) => ({
    id: `auto-${material.productId}-${slug(material.releaseFamily)}-${slug(title)}`,
    productId: material.productId,
    family: `source-${material.releaseFamily}-${slug(title)}`,
    title,
    summary: `Veeam lists ${title} in its ${material.kind === 'whats-new' ? "What's New" : 'release notes'} material for version ${material.releaseFamily}.`,
    introducedIn: material.releaseFamily,
    priority: 60 - index,
    sourceIds: [material.sourceId],
    generated: true,
  }))
}

export async function textFromDocument(content, contentType = '', url = '') {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  const isPdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(url)
  if (!isPdf) return toText(new TextDecoder().decode(bytes))

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const items = (await page.getTextContent()).items.filter((item) => 'str' in item && item.str.trim())
    const lines = new Map()
    for (const item of items) {
      const y = Math.round(item.transform[5])
      lines.set(y, [...(lines.get(y) ?? []), { x: item.transform[4], text: item.str }])
    }
    pages.push([...lines.entries()]
      .sort(([left], [right]) => right - left)
      .map(([, line]) => line.sort((left, right) => left.x - right.x).map((item) => item.text).join(' '))
      .join('\n'))
  }
  return pages.join('\n')
}

export function mergeSourceSupportedHighlights(catalog, highlights, refreshedSourceIds = []) {
  const next = structuredClone(catalog)
  if (refreshedSourceIds.length) {
    next.capabilities = next.capabilities.filter((capability) => !capability.generated || !capability.sourceIds.some((sourceId) => refreshedSourceIds.includes(sourceId)))
  }
  let additions = 0
  const manualFamilies = new Set(next.capabilities.filter((capability) => !capability.generated).map((capability) => `${capability.productId}:${releaseMaterialFamily(capability.introducedIn)}`))

  for (const highlight of highlights) {
    if (manualFamilies.has(`${highlight.productId}:${highlight.introducedIn}`)) continue
    const existing = next.capabilities.findIndex((capability) => capability.id === highlight.id)
    if (existing < 0) {
      next.capabilities.push(highlight)
      additions += 1
    } else next.capabilities[existing] = highlight
  }

  return { catalog: next, additions }
}

export function textFromHtml(html) {
  return toText(html)
}
