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

export function parseVbrBuilds(html) {
  const records = []
  for (const row of html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)) {
    const [release, build] = cellsForRow(row[1])
    if (!release || !build || !release.startsWith('Veeam Backup & Replication ')) continue

    const label = release.replace('Veeam Backup & Replication ', '').trim()
    if (!/^\d/.test(build)) continue
    records.push({ label, build })
  }

  return records.filter((record, index) => records.findIndex((candidate) => candidate.build === record.build) === index)
}

function idForBuild(build) {
  return `vbr-build-${build.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
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

export function mergeVbrBuilds(catalog, records) {
  const next = structuredClone(catalog)
  let additions = 0

  for (const record of records) {
    const existing = next.releases.find((release) => release.productId === 'vbr' && release.aliases.some((alias) => alias.toLowerCase() === record.build.toLowerCase()))
    if (existing) {
      if (!existing.sourceIds.includes('kb2680')) existing.sourceIds.push('kb2680')
      continue
    }

    next.releases.push({
      id: idForBuild(record.build),
      productId: 'vbr',
      name: `${record.label} (build ${record.build})`,
      aliases: [record.build, record.label],
      sourceIds: ['kb2680'],
    })
    additions += 1
  }

  const latest = records.reduce((winner, record) => !winner || compareBuild(record.build, winner.build) > 0 ? record : winner, undefined)
  const latestRelease = latest && next.releases.find((release) => release.productId === 'vbr' && release.aliases.includes(latest.build))
  const product = next.products?.find((item) => item.id === 'vbr')
  if (product && latestRelease) product.recommendedReleaseId = latestRelease.id

  return { catalog: next, additions }
}
