import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { catalog } from './data/catalog'
import type { ProductId, SecurityFinding, Urgency } from './lib/catalog-types'
import { catalogFreshness } from './lib/freshness'
import { checklistSourceIds, documentedFixSourceIds, findingsForRelease, findLifecycleNotice, findRelease, findUpgradePath, isLegacyLifecycleRelease, isRecommendedRelease, releaseImprovementsForRelease, releaseMaterialSourceIds, sourceById, upgradeHighlightsForRelease, upgradeHowToSourceIds, upgradeTargetRelease } from './lib/lookup'
import { releaseOptions } from './lib/release-options'
import { buildUpgradeSummary, summarizeAdvisoryUrgencies } from './lib/upgrade-summary'
import { classifyUrgency } from './lib/urgency'
import { formatExecutiveRoute, formatLifecycleHeading } from './lib/executive-summary-format'

const initialProduct = (new URLSearchParams(window.location.search).get('product') as ProductId) || 'vbr'
const initialVersion = new URLSearchParams(window.location.search).get('version') || ''

const versionHelp: Record<ProductId, { instruction: string; sourceIds: string[] }> = {
  vbr: {
    instruction: 'In the Veeam Backup & Replication console, open Help > About, then copy the complete build number.',
    sourceIds: ['kb2680'],
  },
  'enterprise-manager': {
    instruction: 'Sign in with an administrative account, select Configuration in the upper-right, then open About in the left navigation.',
    sourceIds: ['em-upgrade'],
  },
  'veeam-one': {
    instruction: 'In Veeam ONE Client, open Help > About. Use the Veeam ONE Server build, not the version of a monitored backup server.',
    sourceIds: ['kb4357'],
  },
  vro: {
    instruction: 'Use the Veeam Recovery Orchestrator version/build shown by the Orchestrator server or Web UI. Do not substitute the connected Veeam Backup & Replication version.',
    sourceIds: ['kb4358'],
  },
  vspc: {
    instruction: 'Use the Veeam Service Provider Console server version, not a management agent or a managed backup server. Administrators can also retrieve it from the VSPC About API resource.',
    sourceIds: ['kb4464'],
  },
}

function SourceLinks({ sourceIds }: { sourceIds: string[] }) {
  return (
    <ul className="source-list">
      {sourceIds.map((sourceId) => {
        const source = sourceById(catalog, sourceId)
        return source ? (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
          </li>
        ) : null
      })}
    </ul>
  )
}

function VersionHelp({ productId }: { productId: ProductId }) {
  const help = versionHelp[productId]
  return (
    <details className="version-help">
      <summary>Need help finding your version or build?</summary>
      <div>
        <p><strong>Use the full build when you can.</strong> A release such as <code>13.0.1</code> may include multiple builds; the full value is more likely to produce an exact result.</p>
        <p>{help.instruction}</p>
        {productId === 'enterprise-manager' && (
          <p><a href="https://helpcenter.veeam.com/docs/vbr/em/em_viewing_info_about.html" target="_blank" rel="noreferrer">Veeam’s Enterprise Manager About instructions</a></p>
        )}
        {productId === 'vspc' && (
          <p><a href="https://helpcenter.veeam.com/references/vac/9.2/rest/3.6.2/tag/About/index.html" target="_blank" rel="noreferrer">VSPC About API reference</a></p>
        )}
        <SourceLinks sourceIds={help.sourceIds} />
      </div>
    </details>
  )
}

function SecurityFindingCard({ finding }: { finding: SecurityFinding }) {
  const urgency = classifyUrgency(finding)
  const fixedRelease = catalog.releases.find((release) => release.id === finding.fixedReleaseId)
  return (
    <article className={`security-card ${urgency}`}>
      <p className="eyebrow">{urgency} upgrade reason</p>
      <h3>{finding.title}</h3>
      {finding.cves.length > 0 && <p>{finding.cves.join(', ')}</p>}
      {fixedRelease && <p>Fixed starting in: {fixedRelease.name}</p>}
      {finding.conditions.length > 0 && <p>Verify: {finding.conditions.join(' ')}</p>}
      <SourceLinks sourceIds={finding.sourceIds} />
    </article>
  )
}

function UrgencyIcon({ urgency }: { urgency: Urgency | 'clear' }) {
  const paths = urgency === 'critical'
    ? <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>
    : urgency === 'high'
      ? <><path d="m21.7 18.3-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.7Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>
      : urgency === 'standard'
        ? <><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>
        : <><circle cx="12" cy="12" r="10" /><path d="m8 12 2.5 2.5L16 9" /></>

  return <span className={`urgency-icon ${urgency}`} aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">{paths}</svg></span>
}

export default function App() {
  const [productId, setProductId] = useState<ProductId>(catalog.products.some((product) => product.id === initialProduct) ? initialProduct : 'vbr')
  const [version, setVersion] = useState(initialVersion)
  const [versionPickerOpen, setVersionPickerOpen] = useState(false)
  const [versionFilter, setVersionFilter] = useState('')
  const versionPickerRef = useRef<HTMLDivElement>(null)
  const product = catalog.products.find((item) => item.id === productId)!
  const upgradeHowTo = upgradeHowToSourceIds(productId)
  const versionOptions = useMemo(() => releaseOptions(catalog.releases.filter((item) => item.productId === productId)), [productId])
  const matchingVersionOptions = useMemo(() => {
    const query = versionFilter.trim().toLocaleLowerCase()
    return query ? versionOptions.filter((option) => `${option.value} ${option.label}`.toLocaleLowerCase().includes(query)) : versionOptions
  }, [versionFilter, versionOptions])
  const hasVersion = Boolean(version.trim())
  const release = useMemo(() => (hasVersion ? findRelease(catalog, productId, version) : undefined), [hasVersion, productId, version])
  const path = release ? findUpgradePath(catalog, release) : undefined
  const pathHowTo = path?.howToSourceIds ?? upgradeHowTo
  const pathHowToSource = sourceById(catalog, pathHowTo[0])
  const showPathGuidance = Boolean(path?.guidanceNote && release && path.fromReleaseId === release.id)
  const isCurrentCatalogRelease = release ? isRecommendedRelease(catalog, release) : false
  const freshness = catalogFreshness(catalog.generatedAt)
  const lifecycle = release ? findLifecycleNotice(catalog, productId, release.id) : undefined
  const findings = release ? findingsForRelease(catalog, release) : []
  const advisoryUrgencies = summarizeAdvisoryUrgencies(findings)
  const targetRelease = release ? upgradeTargetRelease(catalog, productId, path) : undefined
  const targetLifecycle = targetRelease ? findLifecycleNotice(catalog, productId, targetRelease.id) : undefined
  const targetMaterialSourceIds = releaseMaterialSourceIds(catalog, productId, targetRelease)
  const targetHighlights = release && targetRelease ? upgradeHighlightsForRelease(catalog, release, targetRelease) : []
  const targetHighlightSourceIds = [...new Set(targetHighlights.flatMap((highlight) => highlight.sourceIds))]
  const targetReleaseImprovements = release && targetRelease ? releaseImprovementsForRelease(catalog, release, targetRelease) : []
  const targetReleaseImprovementSourceIds = [...new Set(targetReleaseImprovements.flatMap((improvement) => improvement.sourceIds))]
  const showVsaConversionGuidance = productId === 'vbr' && Boolean(targetRelease?.name.match(/^13\./))
  const lifecycleNeedsAttention = lifecycle?.state === 'end-of-support' || lifecycle?.state === 'end-of-fix'
  const legacyLifecycleRelease = release ? isLegacyLifecycleRelease(productId, release) : false
  const installedReleaseSourceIds = release ? [...new Set([...release.sourceIds, ...documentedFixSourceIds(catalog, release)])] : []
  const executiveRoute = path && release
    ? formatExecutiveRoute([release.name, ...path.hopReleaseIds.flatMap((releaseId) => catalog.releases.find((item) => item.id === releaseId)?.name ?? [])])
    : undefined
  const executiveSourceIds = release ? [...new Set([
    ...installedReleaseSourceIds,
    ...(lifecycle?.sourceIds ?? []),
    ...(path?.sourceIds ?? []),
    ...pathHowTo,
    ...(targetLifecycle?.sourceIds ?? []),
    ...targetHighlightSourceIds,
    ...targetReleaseImprovementSourceIds,
    ...targetMaterialSourceIds,
  ])] : []
  const executiveSources = executiveSourceIds.flatMap((sourceId) => {
    const source = sourceById(catalog, sourceId)
    return source ? [{ title: source.title, url: source.url }] : []
  })
  const hasLegacySecurityRisk = lifecycle?.state === 'end-of-support' && findings.length === 0
  const upgradeSummary = release ? buildUpgradeSummary({
    findings,
    lifecycle,
    targetRelease,
    isCurrentCatalogRelease,
    hasDocumentedPath: Boolean(path),
  }) : undefined

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('product', productId)
    if (hasVersion) params.set('version', version)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }, [hasVersion, productId, version])

  function changeProduct(nextProductId: ProductId) {
    setProductId(nextProductId)
    setVersion('')
    setVersionPickerOpen(false)
    setVersionFilter('')
  }

  function closeVersionPickerWhenFocusLeaves() {
    window.setTimeout(() => {
      if (!versionPickerRef.current?.contains(document.activeElement)) setVersionPickerOpen(false)
    })
  }

  async function exportExecutiveSummary() {
    if (!release || !upgradeSummary) return
    const { downloadExecutiveSummaryPdf } = await import('./lib/executive-summary-pdf')
    downloadExecutiveSummaryPdf({
      productName: product.name,
      installedRelease: release.name,
      preparedOn: new Date().toLocaleDateString(),
      recommendation: upgradeSummary,
      lifecycle: {
        heading: formatLifecycleHeading(lifecycle?.state),
        detail: lifecycle?.summary ?? 'No release-specific lifecycle statement has been curated for this result.',
      },
      upgradeRoute: {
        heading: targetRelease ? `Recommended target: ${targetRelease.name}` : 'Confirm the supported route',
        detail: executiveRoute ?? 'No exact route is currently curated. Use the linked vendor guidance to plan the next step.',
      },
      securitySummary: findings.length > 0
        ? `${findings.length} matching cataloged ${findings.length === 1 ? 'security advisory' : 'security advisories'}, including ${advisoryUrgencies.map(({ urgency, count }) => `${count} ${urgency === 'high' ? 'High Priority' : `${urgency[0].toUpperCase()}${urgency.slice(1)}`}`).join(', ')}. Individual advisory details are excluded from this executive summary.`
        : undefined,
      highlights: targetHighlights.map(({ title, summary }) => ({ title, summary })),
      sources: executiveSources,
    })
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="brand">Upgrade Brief</p>
          <h1>Upgrade with confidence.</h1>
          <p className="lede">Independent, evidence-based upgrade guidance for Veeam software.</p>
        </div>
      </header>

      <section className="lookup" aria-labelledby="lookup-heading">
        <h2 id="lookup-heading">Look up your installed version</h2>
        <div className="lookup-fields">
          <label>
            Product
            <span className="select-picker">
              <select value={productId} onChange={(event) => changeProduct(event.target.value as ProductId)}>
                {catalog.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <span className="picker-chevron" aria-hidden="true" />
            </span>
          </label>
          <div className="field">
            <span>Version or build</span>
            <div className="version-picker" ref={versionPickerRef} onBlur={closeVersionPickerWhenFocusLeaves}>
              <input
                key={productId}
                aria-controls="version-options"
                aria-expanded={versionPickerOpen}
                aria-haspopup="listbox"
                aria-label="Version or build"
                value={version}
                onChange={(event) => { setVersion(event.target.value); setVersionFilter(event.target.value); setVersionPickerOpen(true) }}
                onFocus={() => { setVersionFilter(''); setVersionPickerOpen(true) }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { setVersionFilter(''); setVersionPickerOpen(true) }
                  if (event.key === 'Escape') setVersionPickerOpen(false)
                }}
                placeholder={productId === 'vbr' ? 'Example: 12.1 or 13.0.2.29' : 'Start typing a version or build'}
              />
              <button className="version-toggle" type="button" aria-label="Show version and build choices" aria-expanded={versionPickerOpen} onClick={() => { setVersionFilter(''); setVersionPickerOpen((isOpen) => !isOpen) }}>
                <span className="picker-chevron" aria-hidden="true" />
              </button>
              {versionPickerOpen && (
                <ul className="version-options" id="version-options" role="listbox" aria-label="Available version and build choices">
                  {matchingVersionOptions.length > 0 ? matchingVersionOptions.map(({ value, label }) => (
                    <li key={value} role="presentation">
                      <button className="version-option" type="button" role="option" aria-selected={value === version} onClick={() => { setVersion(value); setVersionFilter(''); setVersionPickerOpen(false) }}>{label}</button>
                    </li>
                  )) : <li className="version-option-empty">No matching known version or build.</li>}
                </ul>
              )}
            </div>
          </div>
        </div>
        <p className="hint">Use the exact release/build when available. Results are limited to the source-backed records shown below.</p>
        <VersionHelp productId={productId} />
      </section>
      <p className={`freshness ${freshness}`}>Catalog {freshness} · checked {new Date(catalog.generatedAt).toLocaleDateString()}</p>

      {hasVersion && !release && (
        <section className="result empty">
          <h2>We could not match that version safely.</h2>
          <p>Try the exact version or build number. Upgrade Brief does not infer a route when its catalog lacks an exact source-backed match.</p>
          <SourceLinks sourceIds={['kb2680', 'kb4646', 'em-upgrade', 'vro-upgrade', 'vspc-upgrade']} />
        </section>
      )}

      {release && (
        <section className="result" aria-live="polite">
          <div className="result-title">
            <p className="eyebrow">Installed release</p>
            <h2>{product.name} {release.name}</h2>
            {Object.values(product.coverage).some((state) => state !== 'complete') && (
              <p className="source-scope">
                <span className="source-scope-icon" aria-hidden="true">i</span>
                <span>
                  <strong>Source scope:</strong> This brief reflects the linked, source-backed records. Review the official Veeam sources before acting; additional advisories, lifecycle details, or upgrade constraints may apply.
                </span>
              </p>
            )}
            <button className="export-summary" type="button" onClick={exportExecutiveSummary}>Download executive summary (PDF)</button>
          </div>

          {upgradeSummary && (!targetRelease || isCurrentCatalogRelease) && (
            <section className={`upgrade-summary ${upgradeSummary.urgency}`} aria-label="Why upgrade">
              <p className="eyebrow">Why upgrade</p>
              <div className="upgrade-summary-heading">
                {findings.length > 0 && <UrgencyIcon urgency={upgradeSummary.urgency} />}
                <h3>{upgradeSummary.heading}</h3>
              </div>
              <p>{upgradeSummary.detail}</p>
            </section>
          )}

          {targetRelease && !isCurrentCatalogRelease && (
            <section className="upgrade-value" aria-label="What you gain by upgrading">
              <p className="eyebrow">What you gain</p>
              <p className="upgrade-value-target"><strong>Recommended target:</strong> {targetRelease.name}. Upgrade to receive current product improvements and supported security fixes.</p>
              <div className="upgrade-value-grid">
                <article className="feature-highlights-panel">
                  <p className="eyebrow">What this upgrade adds</p>
                  {targetHighlights.length ? (
                    <>
                      <h3>Explore {targetHighlights.length} feature highlights</h3>
                      <p>Veeam documents several improvements in this target release.</p>
                      <ul className="release-highlights">
                        {targetHighlights.map((highlight) => (
                          <li key={highlight.title}>
                            <strong>{highlight.title}</strong>
                            <span>{highlight.summary}</span>
                          </li>
                        ))}
                      </ul>
                      <details className="release-sources-details">
                        <summary>View source materials</summary>
                        <SourceLinks sourceIds={[...new Set([...targetHighlightSourceIds, ...targetMaterialSourceIds])]} />
                      </details>
                    </>
                  ) : targetReleaseImprovements.length > 0 ? targetReleaseImprovements.map((improvement) => (
                    <div className="release-improvement" key={improvement.id}>
                      <p className="eyebrow">Also improved in this release</p>
                      <h3>{improvement.heading}</h3>
                      <p>{improvement.summary}</p>
                      <section className="release-improvement-details" aria-label="Fixes covered in this release">
                        <p className="release-improvement-label">Fixes covered in this release</p>
                        <ul className="release-highlights">
                          {improvement.groups.map((group) => (
                            <li key={group.title}>
                              <strong>{group.title}</strong>
                              <span>{group.summary}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                      <details className="release-sources-details">
                        <summary>View source materials</summary>
                        <SourceLinks sourceIds={[...new Set([...improvement.sourceIds, ...targetMaterialSourceIds])]} />
                      </details>
                    </div>
                  )) : (
                    <>
                      <p>Review Veeam’s documented capabilities and release notes for this target release.</p>
                      <details className="release-sources-details">
                        <summary>View source materials</summary>
                        <SourceLinks sourceIds={targetMaterialSourceIds} />
                      </details>
                    </>
                  )}
                </article>
                <article className="security-support-panel">
                  <p className="eyebrow">Security and support</p>
                  <div className="security-support-heading">
                    {findings.length > 0 && upgradeSummary && <UrgencyIcon urgency={upgradeSummary.urgency} />}
                    <h3>{findings.length > 0 && upgradeSummary ? upgradeSummary.heading : hasLegacySecurityRisk ? 'Unsupported release: assume unpatched security risk' : 'No matching published security advisory is currently cataloged.'}</h3>
                  </div>
                  <p>{findings.length > 0 && upgradeSummary ? upgradeSummary.detail : hasLegacySecurityRisk ? 'This end-of-support release should be treated as an urgent replacement candidate.' : 'Review the linked security resources and the advisory section below as new vendor information is published.'}</p>
                  {findings.length > 0 && <a className="security-support-link" href="#security-reasons">View matching advisories</a>}
                  <div className="target-support-coverage">
                    <p className="eyebrow">Support coverage</p>
                    <h3>{lifecycle ? formatLifecycleHeading(lifecycle.state) : 'Source check required'}</h3>
                    <p>{lifecycle?.summary ?? 'Review the vendor lifecycle record for support coverage of this installed release.'}</p>
                    {lifecycle && <SourceLinks sourceIds={lifecycle.sourceIds} />}
                  </div>
                </article>
              </div>
            </section>
          )}

          <div className="result-grid">
            <article className={`lifecycle-card${legacyLifecycleRelease ? ' legacy' : lifecycleNeedsAttention ? ' needs-attention' : ''}`}>
              <p className="eyebrow">Lifecycle</p>
              <div className="lifecycle-heading">
                <h3>{lifecycle ? formatLifecycleHeading(lifecycle.state) : 'Source check required'}</h3>
                {(legacyLifecycleRelease || lifecycleNeedsAttention) && <span className="lifecycle-attention">{legacyLifecycleRelease ? 'Legacy release' : 'Attention needed'}</span>}
              </div>
              <p>{lifecycle?.summary ?? 'No release-specific lifecycle statement has been curated for this result.'}</p>
              {lifecycle && <SourceLinks sourceIds={lifecycle.sourceIds} />}
            </article>
            <article className="upgrade-path-card">
              <p className="eyebrow">Upgrade path</p>
              {path ? (
                <>
                  {showPathGuidance && (
                    <aside className="path-guidance">
                      <strong>{path.fromVersionPrefixes ? 'Version guidance.' : 'Build-specific guidance.'}</strong> {path.guidanceNote}
                    </aside>
                  )}
                  <ol className="route">
                    <li className="route-step">{release.name}</li>
                    {path.hopReleaseIds.map((releaseId, index) => {
                      const destination = catalog.releases.find((item) => item.id === releaseId)
                      const isFinalDestination = index === path.hopReleaseIds.length - 1
                      return (
                        <Fragment key={releaseId}>
                          <li className="route-arrow" aria-hidden="true">→</li>
                          <li className="route-step">
                            {isFinalDestination && pathHowToSource ? <a href={pathHowToSource.url} target="_blank" rel="noreferrer">{destination?.name}</a> : destination?.name}
                          </li>
                        </Fragment>
                      )
                    })}
                  </ol>
                  <p className="route-recommendation"><strong>Recommended target:</strong> {targetRelease?.name ?? 'the documented target release'}.</p>
                  {path.notes.map((note) => <p key={note}>{note}</p>)}
                  {path.alternatives?.filter((alternative) => alternative.releaseId !== release.id).map((alternative) => {
                    const alternativeRelease = catalog.releases.find((item) => item.id === alternative.releaseId)
                    return (
                      <aside className="upgrade-alternative" key={alternative.releaseId}>
                        <p className="eyebrow">{alternative.heading}</p>
                        <p><strong>{alternativeRelease?.name}</strong> is an available update, but Upgrade Brief recommends <strong>{targetRelease?.name}</strong> as the primary destination.</p>
                        <p>{alternative.note}</p>
                        <SourceLinks sourceIds={alternative.sourceIds} />
                      </aside>
                    )
                  })}
                  <SourceLinks sourceIds={[...new Set([...path.sourceIds, ...pathHowTo])]} />
                </>
              ) : isCurrentCatalogRelease ? <p>This is the latest release currently recorded for this product. Continue to review the linked vendor guidance and security advisories for subsequent patches.</p>
                : lifecycle?.state === 'end-of-support' && productId === 'veeam-one' ? (
                  <>
                    <p>This Veeam ONE release is outside support. Veeam documents that an end-of-support Veeam ONE release without a supported direct path requires you to install a new version of Veeam ONE. There is no supported path to transfer data to the new installation.</p>
                    <SourceLinks sourceIds={[...new Set(['kb4646', ...upgradeHowTo])]} />
                  </>
                )
                : lifecycle?.state === 'end-of-support' ? <><p>This release is outside support. No direct route is asserted here without a source-backed path; use the linked vendor guidance to plan a supported migration or new deployment.</p><SourceLinks sourceIds={upgradeHowTo} /></>
                : <><p>No exact path is in the current curated catalog. Use the linked product documentation rather than assuming a direct upgrade is supported.</p><SourceLinks sourceIds={upgradeHowTo} /></>}
              {showVsaConversionGuidance && (
                <details className="vsa-conversion-guidance">
                  <summary>Planning a Windows-to-VSA conversion?</summary>
                  <p>Veeam’s Windows-to-Veeam Software Appliance configuration migration is currently a limited pilot, not an ordinary in-place upgrade. Preparation includes instance-based VUL licensing, the latest Windows patch level, registration through Veeam’s conversion portal, and proactive support.</p>
                  <p>Review the documented limitations and post-migration considerations before deciding whether this route fits your environment.</p>
                  <SourceLinks sourceIds={['vsa-conversion', 'kb4800']} />
                </details>
              )}
            </article>
          </div>

          <section className="security security-panel" id="security-reasons">
            <div className="security-heading">
              {findings.length === 0 && <UrgencyIcon urgency={hasLegacySecurityRisk ? 'critical' : 'clear'} />}
              <div>
              <p className="eyebrow">Security reasons to upgrade</p>
              {findings.length === 0 && <h2>{hasLegacySecurityRisk ? 'Unsupported release: assume unpatched security risk' : 'No matching published security advisory is currently cataloged.'}</h2>}
              </div>
            </div>
            {findings.length > 0 ? (
              <details className="security-advisories">
                <summary>
                  <strong>
                    {findings.length} matching {findings.length === 1 ? 'advisory' : 'advisories'} - {advisoryUrgencies.map(({ urgency, count }) => `${count} ${urgency === 'high' ? 'High Priority' : `${urgency[0].toUpperCase()}${urgency.slice(1)}`}`).join(', ')}
                  </strong>
                  <span aria-hidden="true" className="security-advisories-toggle">Show details</span>
                </summary>
                <div className="security-advisory-list">
                  {findings.map((finding) => <SecurityFindingCard key={finding.id} finding={finding} />)}
                </div>
              </details>
            ) : (
              hasLegacySecurityRisk ? (
                <article className="security-card critical">
                  <p className="eyebrow">Critical upgrade reason</p>
                  <h3>Unsupported release may contain unpatched vulnerabilities</h3>
                  <p>No matching product advisory is currently curated. That is not evidence that this release is safe: it no longer receives security fixes, so assume it may contain unpatched vulnerabilities beyond this catalogue and treat upgrading or replacing with a new version as absolutely critical.</p>
                  <SourceLinks sourceIds={['lifecycle']} />
                </article>
              ) : <p className="security-empty">No curated vulnerability currently applies to this installed build. This does not mean the release contains no documented fixes; review the installed-release material below and Veeam’s security advisories directly.</p>
            )}
            <SourceLinks sourceIds={['security-kb']} />
          </section>

          <section className="resources release-materials">
            <p className="eyebrow">About this installed release</p>
            <h2>Vendor release notes and documented fixes.</h2>
            <p>These materials describe changes included in {release.name}; they do not mean every fix affected your environment.</p>
            <SourceLinks sourceIds={installedReleaseSourceIds} />
          </section>

          <section className="resources planning-materials">
            <p className="eyebrow">Plan the change</p>
            <h2>Use the vendor checklist and release notes.</h2>
            <SourceLinks sourceIds={checklistSourceIds(productId)} />
          </section>
        </section>
      )}

      <footer>
        <p>Upgrade Brief is an independent community tool, not affiliated with or endorsed by Veeam. It uses only publicly available information and does not access hidden, confidential, proprietary, or customer environment data. It does not assess your environment or certify upgrade safety. <a href="https://github.com/TnTBass/UpgradeBrief">View the project on GitHub</a>.</p>
      </footer>
    </main>
  )
}
