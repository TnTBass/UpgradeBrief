const supported = new Set(['kb3103', 'kb4856', 'kb4858', 'kb4962', 'kb4857'])
// Only prepend release blocks; preserve every existing release and its guidance.
export function supportedInventoryExpansion(articleId, before, after) {
  if (!supported.has(articleId)) return false
  const marker = ' Security Fixes and Improvements '
  const index = before.indexOf(marker)
  if (index < 0 || after.indexOf(marker) !== index) return false
  const prefix = before.slice(0, index + marker.length)
  const previous = before.slice(prefix.length)
  if (!after.startsWith(prefix) || !after.endsWith(previous)) return false
  const added = after.slice(prefix.length, after.length - previous.length).trim()
  if (!added) return false
  const blocks = added.split(/(?<!\S)(?=\d+\.\d+\.\d+\.\d+\s)/)
  const oldBuild = previous.match(/^\d+\.\d+\.\d+\.\d+\b/)?.[0]
  const compare = (a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); for(let i=0;i<4;i++) if(x[i]!==y[i]) return x[i]-y[i]; return 0 }
  let preceding
  for (const block of blocks) {
    const build = block.match(/^(\d+\.\d+\.\d+\.\d+) /)?.[1]
    if (!build || !oldBuild || compare(build,oldBuild)<=0 || (preceding && compare(preceding,build)<=0)) return false
    preceding = build
    let text = block.slice(build.length).trim()
    let count = 0
    while (text) {
      const item = text.match(/^(?:CVE-\d{4}-\d+ vulnerability was fixed\.|[A-Za-z@][\w@./-]*(?: \/ [A-Za-z][\w.-]*)* upgraded to version \d+\.\d+\.\d+(?:\.\d+)?)(?:\s+|$)/)
      if (!item) return false
      if (articleId === 'kb4857' && item[0].startsWith('CVE-')) return false
      text = text.slice(item[0].length).trim(); count++
    }
    if (!count) return false
  }
  return true
}
