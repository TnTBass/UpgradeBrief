// Maintained validation code is deliberately separate from repairable data.
const PRODUCTS = new Set(['vbr', 'enterprise-manager', 'veeam-one', 'vro', 'vspc', 'vb365'])
const KB = /^kb\d+$/
const CVE = /^CVE-\d{4}-\d{4,}$/
const HASH = /^sha256:[a-f0-9]{64}$/
const ID = /^[a-z0-9][a-z0-9.-]*$/
const REASONS = new Set(['NO_VENDOR_VULNERABILITY_FINDING', 'SUPERSEDED_BY_TRACKED_ADVISORY', 'UNTRACKED_MANAGED_COMPONENT'])

export function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid catalog repair data: ${message}`)
}

export function exactKeys(value, allowed, required, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  requireCondition(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${label} has an invalid prototype`)
  for (const key of Object.keys(value)) requireCondition(allowed.includes(key), `${label} has unknown field ${key}`)
  for (const key of required) requireCondition(Object.hasOwn(value, key), `${label} is missing ${key}`)
}

function string(value, label, pattern) {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= 20_000 && (!pattern || pattern.test(value)), label)
}

function strings(value, label, pattern) {
  requireCondition(Array.isArray(value) && value.length <= 500, label)
  for (const item of value) string(item, label, pattern)
  requireCondition(new Set(value).size === value.length, `${label} contains duplicates`)
}

function ranges(value) {
  requireCondition(Array.isArray(value) && value.length > 0 && value.length <= 100, 'affected build ranges')
  for (const range of value) {
    exactKeys(range, ['versionPrefix', 'throughBuild'], ['versionPrefix', 'throughBuild'], 'build range')
    string(range.versionPrefix, 'version prefix', /^\d+(?:\.\d+)*\.$/)
    string(range.throughBuild, 'through build', /^\d+(?:\.\d+)+$/)
    requireCondition(range.throughBuild.startsWith(range.versionPrefix), 'through build is outside its version prefix')
  }
}

function applicability(value) {
  if (value.affectedBuildRanges !== undefined) ranges(value.affectedBuildRanges)
  if (value.affectedVersionPrefixes !== undefined) strings(value.affectedVersionPrefixes, 'affected version prefixes', /^\d+(?:\.\d+)*\.?$/)
  if (value.affectedReleaseIds !== undefined) strings(value.affectedReleaseIds, 'affected release IDs', ID)
  if (value.fixedReleaseId !== undefined) string(value.fixedReleaseId, 'fixed release ID', ID)
  if (value.conditions !== undefined) strings(value.conditions, 'conditions')
  if (value.remediation !== undefined) string(value.remediation, 'remediation')
}

export function validateSecurityNotice(notice) {
  const keys = ['scope', 'impact', 'title', 'summary', 'publishedAt', 'displayUntil']
  exactKeys(notice, keys, keys, 'security notice')
  requireCondition(notice.scope === 'vendor-wide' && notice.impact === 'not-affected', 'security notice scope and impact')
  for (const key of ['title', 'summary']) {
    string(notice[key], 'security notice ' + key)
    requireCondition(notice[key].length <= (key === 'title' ? 100 : 300), 'security notice length')
  }
  for (const key of ['publishedAt', 'displayUntil']) {
    const value = notice[key]
    requireCondition(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'security notice date')
  }
  const duration = Date.parse(notice.displayUntil) - Date.parse(notice.publishedAt)
  requireCondition(duration > 0 && duration <= 30 * 86_400_000, 'security notice display window must be at most 30 days')
}

function validateComponentModel(spec) {
  const m = spec.componentAdvisory
  const keys = ['schemaVersion', 'kind', 'cve', 'cvssScore', 'kernel', 'productIds', 'privateFixes', 'recoveryMedia', 'workerUpdates', 'orchestrator']
  exactKeys(m, keys, keys, 'component advisory')
  requireCondition(spec.classification === 'dedicated' && spec.multiProduct === true && m.schemaVersion === 1 && m.kind === 'linux-kernel-helper-appliances', 'component advisory kind')
  string(m.cve, 'component CVE', CVE)
  string(spec.contentFingerprint, 'component source fingerprint', HASH)
  string(m.kernel, 'component kernel', /^[\w.+-]+$/)
  requireCondition(Number.isFinite(m.cvssScore) && m.cvssScore > 0 && m.cvssScore <= 10, 'component score')
  requireCondition(['pending-legacy', 'download-legacy', 'additional-downloads'].includes(m.recoveryMedia), 'component recovery media')
  requireCondition(['legacy-summary', 'automatic-on-launch'].includes(m.workerUpdates), 'component worker updates')
  requireCondition(Array.isArray(m.privateFixes) && m.privateFixes.length === 2, 'component fixes')
  for (const [i, fix] of m.privateFixes.entries()) {
    const keys = fix.status === 'pending' ? ['family', 'status'] : ['family', 'status', 'prerequisiteBuild', 'filename', 'sha256']
    exactKeys(fix, keys, keys, 'component fix')
    requireCondition(fix.family === ['13.1', '12.3'][i] && ['pending', 'available'].includes(fix.status) && (i === 1 || fix.status === 'available'), 'component fix family')
    if (fix.status === 'available') {
      string(fix.prerequisiteBuild, 'component prerequisite', /^\d+\.\d+\.\d+\.\d+$/)
      requireCondition(fix.prerequisiteBuild.startsWith(fix.family + '.'), 'component prerequisite family')
      string(fix.filename, 'component filename', /^VeeamBackup&Replication_\d+\.\d+\.\d+\.\d+_\d{8}_PrivateFix\.exe$/)
      requireCondition(fix.filename.startsWith('VeeamBackup&Replication_' + fix.prerequisiteBuild + '_'), 'component filename build')
      string(fix.sha256, 'component checksum', /^[A-F0-9]{64}$/)
    }
  }
  if (m.orchestrator !== null) {
    exactKeys(m.orchestrator, ['version', 'embeddedBuild'], ['version', 'embeddedBuild'], 'embedded VBR')
    string(m.orchestrator.version, 'orchestrator version', /^13\.1\.\d+\.\d+$/)
    requireCondition(m.orchestrator.embeddedBuild === m.privateFixes[0].prerequisiteBuild, 'embedded prerequisite')
  }
  const products = m.orchestrator ? ['vbr', 'vro'] : ['vbr']
  requireCondition(JSON.stringify(m.productIds) === JSON.stringify(products) && JSON.stringify(Object.keys(spec.productCves).sort()) === JSON.stringify(products), 'component product mapping')
  requireCondition(Object.values(spec.productCves).every(cves => JSON.stringify(cves) === JSON.stringify([m.cve])), 'component CVE mapping')
}

export function validateReviewedSecurityData(data) {
  exactKeys(data, ['schemaVersion', 'advisories', 'observationSpecs'], ['schemaVersion', 'advisories', 'observationSpecs'], 'reviewed data')
  requireCondition(data.schemaVersion === 1, 'unsupported reviewed data schema')
  requireCondition(Array.isArray(data.advisories) && data.advisories.length <= 1000, 'advisories')
  const specs = data.observationSpecs
  exactKeys(specs, Object.keys(specs ?? {}), [], 'observation specs')
  for (const [articleId, spec] of Object.entries(specs)) {
    string(articleId, 'article ID', KB)
    exactKeys(spec, ['classification', 'productCves', 'ignoredCveIds', 'allowNoCves', 'informationalReason', 'contentFingerprint', 'multiProduct', 'notice', 'componentAdvisory'], ['classification', 'productCves'], articleId)
    requireCondition(['dedicated', 'inventory', 'informational', 'out-of-scope'].includes(spec.classification), 'classification')
    exactKeys(spec.productCves, [...PRODUCTS], [], 'product CVEs')
    const productIds = Object.keys(spec.productCves)
    requireCondition(spec.classification === 'out-of-scope' ? productIds.length === 0 : productIds.length > 0, 'classification product scope')
    for (const cves of Object.values(spec.productCves)) strings(cves, 'product CVE IDs', CVE)
    if (spec.ignoredCveIds !== undefined) {
      strings(spec.ignoredCveIds, 'ignored CVE IDs', CVE)
      const mapped = Object.values(spec.productCves).flat()
      requireCondition(!spec.ignoredCveIds.some(cve => mapped.includes(cve)), 'CVE is both mapped and ignored')
    }
    if (spec.componentAdvisory !== undefined) validateComponentModel(spec)
    if (spec.notice !== undefined) {
      validateSecurityNotice(spec.notice)
      requireCondition(spec.classification === 'informational' && spec.informationalReason === 'NO_VENDOR_VULNERABILITY_FINDING', 'notice requires a reviewed no-impact classification')
      requireCondition(productIds.length === PRODUCTS.size && Object.values(spec.productCves).every(cves => cves.length === 0), 'vendor-wide notice must cover every product without vulnerability findings')
    }
    for (const key of ['allowNoCves', 'multiProduct']) if (spec[key] !== undefined) requireCondition(typeof spec[key] === 'boolean', key)
    if (productIds.length > 1) requireCondition(spec.multiProduct === true, 'multi-product scope must be explicit')
    if (spec.classification === 'informational') {
      requireCondition(REASONS.has(spec.informationalReason), 'informational reason')
      string(spec.contentFingerprint, 'informational fingerprint', HASH)
    } else {
      requireCondition(spec.informationalReason === undefined, 'unexpected informational policy')
      if (spec.contentFingerprint !== undefined) {
        requireCondition(spec.classification === 'dedicated', 'content fingerprint requires a reviewed advisory')
        string(spec.contentFingerprint, 'reviewed advisory fingerprint', HASH)
      }
    }
  }
  const seen = new Set()
  for (const advisory of data.advisories) {
    exactKeys(advisory, ['articleId', 'productId', 'source', 'affectedBuildRanges', 'affectedVersionPrefixes', 'affectedReleaseIds', 'fixedReleaseId', 'records', 'conditions', 'remediation'], ['articleId', 'productId', 'source', 'records'], 'advisory')
    string(advisory.articleId, 'article ID', KB)
    requireCondition(['vbr', 'enterprise-manager', 'veeam-one', 'vro'].includes(advisory.productId), 'advisory product has no maintained finding adapter')
    const key = `${advisory.articleId}:${advisory.productId}`
    requireCondition(!seen.has(key), 'duplicate advisory')
    seen.add(key)
    const spec = specs[advisory.articleId]
    requireCondition(spec && Object.hasOwn(spec.productCves, advisory.productId), 'advisory is outside reviewed scope')
    exactKeys(advisory.source, ['id', 'title', 'url'], ['id', 'title', 'url'], 'source')
    requireCondition(advisory.source.id === advisory.articleId && advisory.source.url === `https://www.veeam.com/${advisory.articleId}`, 'advisory source identity')
    string(advisory.source.title, 'source title')
    applicability(advisory)
    requireCondition(Array.isArray(advisory.records) && advisory.records.length <= 500, 'records')
    const recordKeys = new Set()
    for (const record of advisory.records) {
      exactKeys(record, ['cve', 'key', 'title', 'cvssScore', 'conditions', 'affectedBuildRanges', 'remediation'], ['title'], 'vulnerability record')
      requireCondition((record.cve === undefined) !== (record.key === undefined), 'record requires exactly one CVE or key')
      string(record.cve ?? record.key, 'record identity', record.cve ? CVE : ID)
      string(record.title, 'record title')
      if (record.cve) requireCondition(spec.productCves[advisory.productId].includes(record.cve), 'record CVE missing from product coverage')
      const recordKey = record.cve ?? record.key
      requireCondition(!recordKeys.has(recordKey), 'duplicate vulnerability record')
      recordKeys.add(recordKey)
      if (record.cvssScore !== undefined) requireCondition(Number.isFinite(record.cvssScore) && record.cvssScore >= 0 && record.cvssScore <= 10, 'CVSS score')
      applicability(record)
    }
  }
  return data
}

