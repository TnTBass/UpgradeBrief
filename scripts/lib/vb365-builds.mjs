function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellsForRow(row) {
  return [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/gis)].map((match) => decodeHtml(match[1]))
}

function productLabel(value) {
  return value
    .replace(/^Veeam Backup\s+for Microsoft (?:Office )?365\s*/i, '')
    .trim()
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

function idForBuild(build) {
  return `vb365-build-${build.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '')}`.toLowerCase()
}

export function parseVb365Builds(html) {
  const records = []
  for (const row of html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)) {
    const [release, consoleBuild, logBuild] = cellsForRow(row[1])
    if (!/^Veeam Backup\s+for Microsoft (?:Office )?365\s+/i.test(release ?? '')) continue
    if (!/^\d+(?:\.\d+){3}$/.test(consoleBuild ?? '') || !/^\d+(?:\.\d+){3}$/.test(logBuild ?? '')) continue
    const label = productLabel(release)
    if (!label) continue
    records.push({ label, consoleBuild, logBuild })
  }
  return records.filter((record, index) => records.findIndex((candidate) => candidate.consoleBuild === record.consoleBuild) === index)
}

export function mergeVb365Builds(catalog, records, sourceId = 'kb4106') {
  const next = structuredClone(catalog)
  let additions = 0
  for (const record of records) {
    const aliases = [record.consoleBuild, record.logBuild, record.label]
    const existing = next.releases.find((release) =>
      release.productId === 'vb365' && release.aliases.some((alias) => aliases.includes(alias)),
    )
    if (existing) {
      for (const alias of aliases) if (!existing.aliases.includes(alias)) existing.aliases.push(alias)
      if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId)
      continue
    }
    next.releases.push({
      id: idForBuild(record.consoleBuild),
      productId: 'vb365',
      name: `${record.label} (build ${record.consoleBuild})`,
      aliases,
      sourceIds: [sourceId],
    })
    additions += 1
  }

  const latest = records.reduce((winner, record) => !winner || compareBuild(record.consoleBuild, winner.consoleBuild) > 0 ? record : winner, undefined)
  const product = next.products.find((item) => item.id === 'vb365')
  const latestRelease = latest && next.releases.find((release) => release.productId === 'vb365' && release.aliases.includes(latest.consoleBuild))
  if (product && latestRelease) product.recommendedReleaseId = latestRelease.id
  return { catalog: next, additions }
}
