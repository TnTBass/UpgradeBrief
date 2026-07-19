import { useEffect, useMemo, useState } from 'react'
import { catalog } from './data/catalog'
import type { ProductId, SecurityFinding } from './lib/catalog-types'
import { catalogFreshness } from './lib/freshness'
import { checklistSourceIds, findingsForRelease, findLifecycleNotice, findRelease, findUpgradePath, isRecommendedRelease, sourceById } from './lib/lookup'
import { releaseOptions } from './lib/release-options'
import { classifyUrgency } from './lib/urgency'

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

export default function App() {
  const [productId, setProductId] = useState<ProductId>(catalog.products.some((product) => product.id === initialProduct) ? initialProduct : 'vbr')
  const [version, setVersion] = useState(initialVersion)
  const [submitted, setSubmitted] = useState(Boolean(initialVersion))
  const product = catalog.products.find((item) => item.id === productId)!
  const versionOptions = useMemo(() => releaseOptions(catalog.releases.filter((item) => item.productId === productId)), [productId])
  const release = useMemo(() => (submitted ? findRelease(catalog, productId, version) : undefined), [productId, submitted, version])
  const path = release ? findUpgradePath(catalog, release) : undefined
  const isCurrentCatalogRelease = release ? isRecommendedRelease(catalog, release) : false
  const freshness = catalogFreshness(catalog.generatedAt)
  const findings = release ? findingsForRelease(catalog, release) : []
  const lifecycle = release ? findLifecycleNotice(catalog, productId, release.id) : undefined

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('product', productId)
    if (submitted && version) params.set('version', version)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }, [productId, submitted, version])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
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
        <form onSubmit={submit}>
          <label>
            Product
            <select value={productId} onChange={(event) => { setProductId(event.target.value as ProductId); setSubmitted(false) }}>
              {catalog.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Version or build
            <input list="version-options" value={version} onChange={(event) => setVersion(event.target.value)} placeholder={productId === 'vbr' ? 'Example: 12.1 or 13.0.2.29' : 'Start typing a version or build'} required />
            <datalist id="version-options">
              {versionOptions.map(({ value, label }) => <option key={value} value={value} label={label} />)}
            </datalist>
          </label>
          <button type="submit">Build my upgrade brief</button>
        </form>
        <p className="hint">Use the exact release/build when available. Results are limited to the source-backed records shown below.</p>
        <VersionHelp productId={productId} />
      </section>
      <p className={`freshness ${freshness}`}>Catalog {freshness} · checked {new Date(catalog.generatedAt).toLocaleDateString()}</p>

      {submitted && !release && (
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
          </div>

          {Object.values(product.coverage).some((state) => state !== 'complete') && (
            <aside className="coverage-warning">
              <strong>Coverage is incomplete.</strong> This result is not a declaration that there are no other vulnerabilities, lifecycle limits, or supported paths. Verify the linked official sources before acting.
            </aside>
          )}

          <div className="result-grid">
            <article>
              <p className="eyebrow">Lifecycle</p>
              <h3>{lifecycle?.state.replaceAll('-', ' ') ?? 'Source check required'}</h3>
              <p>{lifecycle?.summary ?? 'No release-specific lifecycle statement has been curated for this result.'}</p>
              {lifecycle && <SourceLinks sourceIds={lifecycle.sourceIds} />}
            </article>
            <article>
              <p className="eyebrow">Upgrade path</p>
              {path ? (
                <>
                  <ol className="route">
                    <li>{release.name}</li>
                    {path.hopReleaseIds.map((releaseId) => <li key={releaseId}>{catalog.releases.find((item) => item.id === releaseId)?.name}</li>)}
                  </ol>
                  {path.notes.map((note) => <p key={note}>{note}</p>)}
                  <SourceLinks sourceIds={path.sourceIds} />
                </>
              ) : isCurrentCatalogRelease ? <p>This is the latest release currently recorded for this product. Continue to review the linked vendor guidance and security advisories for subsequent patches.</p>
                : lifecycle?.state === 'end-of-support' && productId === 'veeam-one' ? (
                  <>
                    <p>This Veeam ONE release is outside support. Veeam documents that an end-of-support Veeam ONE release without a supported direct path requires you to install a new version of Veeam ONE. There is no supported path to transfer data to the new installation.</p>
                    <SourceLinks sourceIds={['kb4646']} />
                  </>
                )
                : lifecycle?.state === 'end-of-support' ? <p>This release is outside support. No direct route is asserted here without a source-backed path; use the linked vendor guidance to plan a supported migration or new deployment.</p>
                : <p>No exact path is in the current curated catalog. Use the linked product documentation rather than assuming a direct upgrade is supported.</p>}
            </article>
          </div>

          <section className="security">
            <div>
              <p className="eyebrow">Security reasons to upgrade</p>
              <h2>{findings.length ? `${findings.length} matching ${findings.length === 1 ? 'advisory' : 'advisories'}` : 'No matching advisory is currently curated'}</h2>
            </div>
            {findings.length > 0 ? findings.map((finding) => <SecurityFindingCard key={finding.id} finding={finding} />) : (
              <p className="security-empty">Security coverage for this MVP is intentionally partial. This is not a clean bill of health; check Veeam’s security advisories directly.</p>
            )}
            <SourceLinks sourceIds={['security-kb']} />
          </section>

          <section className="resources">
            <p className="eyebrow">Plan the change</p>
            <h2>Use the vendor checklist and release notes.</h2>
            <SourceLinks sourceIds={[...checklistSourceIds(productId), ...release.sourceIds]} />
          </section>
        </section>
      )}

      <footer>
        <p>Upgrade Brief is an independent community tool, not affiliated with or endorsed by Veeam. It does not assess your environment or certify upgrade safety.</p>
      </footer>
    </main>
  )
}
