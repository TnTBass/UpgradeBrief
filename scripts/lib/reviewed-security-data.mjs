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

export function validateReviewedSecurityData(data) {
  exactKeys(data, ['schemaVersion', 'advisories', 'observationSpecs'], ['schemaVersion', 'advisories', 'observationSpecs'], 'reviewed data')
  requireCondition(data.schemaVersion === 1, 'unsupported reviewed data schema')
  requireCondition(Array.isArray(data.advisories) && data.advisories.length <= 1000, 'advisories')
  const specs = data.observationSpecs
  exactKeys(specs, Object.keys(specs ?? {}), [], 'observation specs')
  for (const [articleId, spec] of Object.entries(specs)) {
    string(articleId, 'article ID', KB)
    exactKeys(spec, ['classification', 'productCves', 'ignoredCveIds', 'allowNoCves', 'informationalReason', 'contentFingerprint', 'multiProduct'], ['classification', 'productCves'], articleId)
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
    for (const key of ['allowNoCves', 'multiProduct']) if (spec[key] !== undefined) requireCondition(typeof spec[key] === 'boolean', key)
    if (productIds.length > 1) requireCondition(spec.multiProduct === true, 'multi-product scope must be explicit')
    if (spec.classification === 'informational') {
      requireCondition(REASONS.has(spec.informationalReason), 'informational reason')
      string(spec.contentFingerprint, 'informational fingerprint', HASH)
    } else {
      requireCondition(spec.informationalReason === undefined && spec.contentFingerprint === undefined, 'unexpected informational policy')
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
