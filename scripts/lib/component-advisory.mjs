import { createHash } from 'node:crypto'

const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sorted = values => [...values].sort()
const ENVELOPE_HASH = 'sha256:a63673c278d583338f6cc6f1be039d5353d9768067bb04c17372bfa12200d3b4'
const FIX_CHECK = 'To check the version, open the Main Menu (≡) in the Veeam Backup & Replication Console and select Help > About.'
const ISO = 'New installations use the repacked Veeam Backup & Replication 13.1.2 ISO, which includes the fix. Installation files are downloaded from My Account .'
const VRO_ROW = 'Veeam Recovery Orchestrator 13.1 (embedded Veeam Backup & Replication helper appliances) Yes, until the private fix is installed Install the private fix '
const MEDIA_OLD = 'Veeam Recovery Media for Veeam Agent for Linux For Veeam Agent for Linux 13.1, the updated recovery media is delivered through Veeam Updater and available for download from this Veeam webpage . For the Veeam Agent for Linux version included with Veeam Backup & Replication 12.3, the updated recovery media is '
const MEDIA_NEW = 'Veeam Recovery Media for Veeam Agent for Linux Updated recovery media for Veeam Agent for Linux is available in the Additional Downloads section of the Veeam Recovery Media Download page.'
const SOURCE_TITLE = 'Linux kernel TCP/IPv4 use-after-free vulnerability in Veeam Linux components.'

function once(text, expression) {
  const matches = [...text.matchAll(new RegExp(expression.source, expression.flags.replace('g', '') + 'g'))]
  return matches.length === 1 ? matches[0] : null
}

// Recognized facts are removed from the article only after their relationships
// have been checked. The remaining envelope must match maintained vendor prose.
// Unknown paragraphs, negations, exclusions and additional products fail closed.
export function inspectComponentEnvelope(articleId, input) {
  if (typeof input !== 'string' || input.length > 100_000) return null
  let text = input.replace(/\s+/g, ' ').trim()
  const title = text.match(/^(CVE-\d{4}-\d{4,}) Impact Statement KB ID: (\d+) Product: /)
  if (!title || articleId !== 'kb' + title[2]) return null
  const cve = title[1]
  if (!same([...new Set(text.match(/CVE-\d{4}-\d{4,}/g))], [cve])) return null
  const score = once(text, /\(CVSS (\d+(?:\.\d+)?)\)/)
  if (!score || +score[1] <= 0 || +score[1] > 10) return null
  const kernel = once(text, /\(kernel ([\w.+-]+) \)/)
  if (!kernel) return null
  const quotes = [score[0], kernel[0]]
  const privateFixes = []
  for (const family of ['13.1', '12.3']) {
    const start = text.indexOf('Private Fixes Veeam Backup & Replication 13.1')
    if (start < 0) return null
    const segment = text.slice(start)
    const prefix = 'Veeam Backup & Replication ' + family + ' '
    const ending = family === '13.1' ? 'Veeam Backup & Replication 12.3 ' : 'More Information '
    const begin = segment.indexOf(prefix), end = segment.indexOf(ending, begin + prefix.length)
    if (begin < 0 || end < 0) return null
    const block = segment.slice(begin, end).trim()
    if (family === '12.3' && block === prefix + 'The private fix will be made available soon.') {
      privateFixes.push({ family, status: 'pending' })
    } else {
      const pattern = /^Veeam Backup & Replication (13\.1|12\.3) Before installing the private fix, ensure that (?:Windows-based )?Veeam Backup & Replication (\d+\.\d+\.\d+\.\d+) is installed\. (.+) Download (\d+\.\d+\.\d+) Private Fix Filename: (VeeamBackup&Replication_(\d+\.\d+\.\d+\.\d+)_(\d{8})_PrivateFix\.exe) SHA256: ([A-F0-9]{64})$/
      const m = block.match(pattern)
      if (!m || m[1] !== family || !m[2].startsWith(family + '.') || m[2] !== m[6] || m[4] !== m[2].split('.').slice(0, 3).join('.')
        || m[3] !== FIX_CHECK + (family === '13.1' ? ' ' + ISO : '')) return null
      privateFixes.push({ family, status: 'available', prerequisiteBuild: m[2], filename: m[5], sha256: m[8] })
    }
    quotes.push(block)
    text = text.replace(block, 'Veeam Backup & Replication ' + family + ' [private-fix facts]')
  }
  const row = once(text, /Veeam Backup & Replication 12\.3 \(Linux-based helper appliances\) Yes, until the private fix is installed (Install the private fix|Private fix will be made available soon)/)
  if (!row || (privateFixes[1].status === 'available') !== (row[1] === 'Install the private fix')) return null
  text = text.replace(row[0], 'Veeam Backup & Replication 12.3 [private-fix row]')
  let orchestrator = null
  const vro = once(text, /Veeam Recovery Orchestrator 13\.1 Veeam Recovery Orchestrator (13\.1\.\d+\.\d+) includes Veeam Backup & Replication (13\.1\.\d+\.\d+) as an embedded component\. New installations use the repacked Veeam Data Platform Premium 13\.1 ISO, which includes the fix\. Installation files are downloaded from My Account \. On existing Veeam Recovery Orchestrator (13\.1\.\d+\.\d+) servers, the Veeam Backup & Replication 13\.1\.2 private fix must be installed\./)
  if (vro) {
    if (vro[1] !== vro[3] || vro[2] !== privateFixes[0].prerequisiteBuild || !text.includes(VRO_ROW)) return null
    orchestrator = { version: vro[1], embeddedBuild: vro[2] }
    quotes.push(VRO_ROW.trim(), vro[0])
    text = text.replace(VRO_ROW, '').replace(vro[0] + ' ', '')
  } else if (text.includes('Veeam Recovery Orchestrator')) return null
  const media = once(text, /Veeam Recovery Media for Veeam Agent for Linux 13\.1 Yes, for media created before the update (Install the update through Veeam Updater or download from this Veeam webpage \.|Download from this Veeam webpage \.) Veeam Recovery Media for (the Veeam Agent for Linux version included with Veeam Backup & Replication 12\.3|Veeam Agent for Linux 6\.3) Yes, for media created before the update (Private fix will be made available soon|Install the private fix or download from this Veeam webpage \.|Download from this Veeam webpage \.)/)
  if (!media) return null
  let recoveryMedia
  if (media[2] === 'Veeam Agent for Linux 6.3') {
    if (media[1] !== 'Download from this Veeam webpage .' || media[3] !== 'Download from this Veeam webpage .' || !text.includes(MEDIA_NEW)) return null
    recoveryMedia = 'additional-downloads'
    text = text.replace(MEDIA_NEW, '[recovery-media instructions]')
    quotes.push(MEDIA_NEW)
  } else {
    recoveryMedia = privateFixes[1].status === 'pending' ? 'pending-legacy' : 'download-legacy'
    const body = MEDIA_OLD + (recoveryMedia === 'pending-legacy' ? 'delivered through the private fix .' : 'available for download from this Veeam webpage .')
    if (media[1] !== 'Install the update through Veeam Updater or download from this Veeam webpage .' ||
      (media[3] === 'Private fix will be made available soon') !== (recoveryMedia === 'pending-legacy') || !text.includes(body)) return null
    text = text.replace(body, '[recovery-media instructions]')
    quotes.push(body)
  }
  quotes.push(media[0])
  text = text.replace(media[0], '[recovery-media rows]')
  text = text.replaceAll(cve, '[CVE]').replace('KB ID: ' + title[2], 'KB ID: [article]')
    .replace(/Published: \d{4}-\d{2}-\d{2} Last Modified: \d{4}-\d{2}-\d{2}/, 'Published: [date] Last Modified: [date]')
    .replace(score[0], '(CVSS [score])').replace(kernel[0], '(kernel [version])')
  const model = { schemaVersion: 1, kind: 'linux-kernel-helper-appliances', cve, cvssScore: +score[1], kernel: kernel[1],
    productIds: orchestrator ? ['vbr', 'vro'] : ['vbr'], privateFixes, recoveryMedia, orchestrator }
  return { model, quotes, envelopeHash: hash(text) }
}

export function parseComponentAdvisory(articleId, text) {
  const result = inspectComponentEnvelope(articleId, text)
  return result?.envelopeHash === ENVELOPE_HASH ? result : null
}

export function supportedComponentTransition(before, after) {
  if (!after) return false
  if (!before) return true
  if (before.cve !== after.cve || before.cvssScore !== after.cvssScore || before.kernel !== after.kernel
    || before.productIds.some(id => !after.productIds.includes(id))
    || (before.orchestrator && !same(before.orchestrator, after.orchestrator))) return false
  for (const old of before.privateFixes) {
    const next = after.privateFixes.find(fix => fix.family === old.family)
    // Available patch identities cannot be silently replaced or withdrawn.
    if (!next || (old.status === 'available' && !same(old, next))) return false
  }
  return ['pending-legacy', 'download-legacy', 'additional-downloads'].indexOf(after.recoveryMedia) >=
    ['pending-legacy', 'download-legacy', 'additional-downloads'].indexOf(before.recoveryMedia)
}

export function componentAdvisories(articleId, model, existing = []) {
  const private12 = model.privateFixes.find(fix => fix.family === '12.3')
  const private13 = model.privateFixes.find(fix => fix.family === '13.1')
  const media = model.recoveryMedia === 'additional-downloads'
    ? 'Download updated recovery media for Veeam Agent for Linux 13.1 or 6.3 from Additional Downloads on the Veeam Recovery Media Download page and replace old media.'
    : 'Replace old recovery media using the delivery instructions in the advisory.'
  return model.productIds.map(productId => {
    const old = existing.find(record => record.productId === productId)
    const remediation = productId === 'vbr'
      ? 'For Software/Infrastructure Appliance 13.1, install the kernel update through Veeam Updater. For Windows VBR 13.1, install ' + private13.prerequisiteBuild + ' and the ' + articleId.toUpperCase() + ' private fix, or use the repacked installation ISO for a new installation. ' +
        (private12.status === 'pending' ? 'The VBR 12.3 private fix is pending.' : 'For VBR 12.3, install ' + private12.prerequisiteBuild + ' and the ' + articleId.toUpperCase() + ' private fix.') + ' Redeploy persistent helper appliances. ' + media
      : 'On existing Veeam Recovery Orchestrator ' + model.orchestrator.version + ' servers, install the VBR 13.1.2 private fix for the embedded VBR ' + model.orchestrator.embeddedBuild + ' component, as directed in ' + articleId.toUpperCase() + '. New installations use the repacked Veeam Data Platform Premium 13.1 ISO. Redeploy persistent helper appliances as directed in the advisory.'
    return {
      ...(old ?? { articleId, productId, source: { id: articleId, title: 'Veeam ' + articleId.toUpperCase() + ': ' + model.cve + ' Impact Statement', url: 'https://www.veeam.com/' + articleId },
        affectedVersionPrefixes: productId === 'vbr' ? ['12.3.', '13.1.'] : ['13.1.'],
        conditions: ['Applies to the Linux helper appliances documented in the advisory. The product build alone does not establish remediation; component patches require separate verification.'],
        records: [{ cve: model.cve, title: SOURCE_TITLE, cvssScore: model.cvssScore }] }),
      remediation,
    }
  })
}

export function inspectComponentChange(article, reviewedData) {
  const after = parseComponentAdvisory(article.articleId, article.after)
  const before = article.before === null ? null : parseComponentAdvisory(article.articleId, article.before)
  if (!after || (article.before !== null && !before) || !supportedComponentTransition(before?.model, after.model)) return null
  const existing = reviewedData.advisories.filter(item => item.articleId === article.articleId)
  if (article.before === null && (existing.length || reviewedData.observationSpecs[article.articleId])) return null
  if (existing.some(item => !before?.model.productIds.includes(item.productId) || item.fixedReleaseId ||
    !same(item.affectedVersionPrefixes, item.productId === 'vbr' ? ['12.3.', '13.1.'] : ['13.1.']) ||
    item.records.length !== 1 || item.records[0].cve !== after.model.cve || item.records[0].cvssScore !== after.model.cvssScore)) return null
  return { kind: 'component', model: after.model, quotes: after.quotes, records: [],
    checks: ['recognized-component-advisory-envelope', 'explicit-component-product-mapping', 'private-fix-prerequisites-not-fixed-builds', 'no-removed-products-or-patch-regressions'],
    summary: after.model.productIds.join(', ') + ': component patch instructions for ' + after.model.cve + '; private fix availability and recovery media independently verified.' }
}

export function applyComponentChange(article, reviewedData) {
  const change = inspectComponentChange(article, reviewedData)
  if (!change) return null
  const next = structuredClone(reviewedData)
  const existing = next.advisories.filter(item => item.articleId === article.articleId)
  next.advisories = [...next.advisories.filter(item => item.articleId !== article.articleId), ...componentAdvisories(article.articleId, change.model, existing)]
  next.observationSpecs[article.articleId] = { classification: 'dedicated', productCves: Object.fromEntries(change.model.productIds.map(id => [id, [change.model.cve]])),
    multiProduct: true, contentFingerprint: hash(article.after), componentAdvisory: change.model }
  return { reviewedData: next, ...change }
}

export function reviewedComponentScope({ articleId, text, previousText, policy }) {
  const after = parseComponentAdvisory(articleId, text)
  const before = previousText ? parseComponentAdvisory(articleId, previousText) : null
  if (!after || (previousText && !before) || !policy?.componentAdvisory || policy.contentFingerprint !== hash(text) ||
    !same(policy.componentAdvisory, after.model) || !supportedComponentTransition(before?.model, after.model) ||
    !same(sorted(Object.keys(policy.productCves)), sorted(after.model.productIds)) ||
    Object.values(policy.productCves).some(cves => !same(cves, [after.model.cve]))) return null
  return { productIds: after.model.productIds, hasOutOfScopeProduct: true }
}

