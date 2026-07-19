import { useEffect, useMemo, useState } from 'react'
import { catalog } from './data/catalog'
import type { ProductId, SecurityFinding } from './lib/catalog-types'
import { catalogFreshness } from './lib/freshness'
import { checklistSourceIds, findingAppliesToRelease, findLifecycleNotice, findRelease, findUpgradePath, isRecommendedRelease, sourceById } from './lib/lookup'
import { classifyUrgency } from './lib/urgency'

const initialProduct = (new URLSearchParams(window.location.search).get('product') as ProductId) || 'vbr'
const initialVersion = new URLSearchParams(window.location.search).get('version') || ''

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
  const versionOptions = useMemo(() => {
    const seen = new Set<string>()
    return catalog.releases
      .filter((item) => item.productId === productId)
      .flatMap((item) => item.aliases.map((alias) => ({ alias, name: item.name })))
      .filter(({ alias }) => {
        const key = alias.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [productId])
  const release = useMemo(() => (submitted ? findRelease(catalog, productId, version) : undefined), [productId, submitted, version])
  const path = release ? findUpgradePath(catalog, release) : undefined
  const isCurrentCatalogRelease = release ? isRecommendedRelease(catalog, release) : false
  const freshness = catalogFreshness(catalog.generatedAt)
  const findings = release ? catalog.securityFindings.filter((finding) => findingAppliesToRelease(finding, release)) : []
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
              {versionOptions.map(({ alias, name }) => <option key={alias} value={alias} label={name} />)}
            </datalist>
          </label>
          <button type="submit">Build my upgrade brief</button>
        </form>
        <p className="hint">Use the exact release/build when available. Results are limited to the source-backed records shown below.</p>
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
