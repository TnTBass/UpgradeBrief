function decodeHtml(value) {
  return value.replace(/<br\s*\/?>(\s*)/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

function cellsForRow(row) {
  return [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/gis)].map((match) => decodeHtml(match[1]))
}

export function parseProductBuilds(html, productName) {
  const records = []
  for (const row of html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)) {
    const [release, build] = cellsForRow(row[1])
    if (!release?.startsWith(`${productName} `) || !/^\d+(?:\.\d+)+$/.test(build ?? '')) continue
    records.push({ label: release.slice(productName.length).trim(), build })
  }
  return records.filter((record, index) => records.findIndex((candidate) => candidate.build === record.build) === index)
}

function idForBuild(productId, build) {
  return `${productId}-build-${build.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
}

function compareBuild(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) return Math.sign(delta)
  }
  return 0
}

export function mergeProductBuilds(catalog, { productId, sourceId, records }) {
  const next = structuredClone(catalog)
  let additions = 0
  for (const record of records) {
    const existing = next.releases.find((release) => release.productId === productId && release.aliases.some((alias) => alias.toLowerCase() === record.build.toLowerCase()))
    if (existing) {
      if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId)
      continue
    }
    next.releases.push({ id: idForBuild(productId, record.build), productId, name: `${record.label} (build ${record.build})`, aliases: [record.build, record.label], sourceIds: [sourceId] })
    additions += 1
  }

  const latest = records.reduce((winner, record) => !winner || compareBuild(record.build, winner.build) > 0 ? record : winner, undefined)
  if (latest) {
    const latestRelease = next.releases.find((release) => release.productId === productId && release.aliases.includes(latest.build))
    const product = next.products.find((item) => item.id === productId)
    if (latestRelease && product) product.recommendedReleaseId = latestRelease.id
  }
  return { catalog: next, additions }
}
