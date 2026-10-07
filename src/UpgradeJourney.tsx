import { useState } from 'react'
import type { Release, UpgradePath } from './lib/catalog-types'
import { journeyItems, journeyReleaseLabel, journeySources, type UpgradeJourney } from './lib/upgrade-journey'
import { journeyReviewedAt, type JourneySourceId } from './data/upgrade-journey'
import './upgrade-journey.css'

function GuidanceSources({ ids }: { ids: JourneySourceId[] }) {
  return <ul className="source-list">{ids.map((id) => <li key={id}><a href={journeySources[id].url} target="_blank" rel="noreferrer">{journeySources[id].title}</a></li>)}</ul>
}

function RetentionGuidance({ alreadyApplies }: { alreadyApplies: boolean }) {
  return <article className={`journey-retention${alreadyApplies ? '' : ' upcoming'}`} aria-label="Backup retention review">
    <p className="journey-retention-label">{alreadyApplies ? 'Retention reminder · Already applies in V12' : 'Retention review · Introduced in V12'}</p>
    <h4>{alreadyApplies ? 'Review retention for backups you intend to keep' : 'Check backup retention before installing V12'}</h4>
    <p>{alreadyApplies ? 'This behavior already applies to your installed V12 version. It is not introduced by the upgrade to V13.' : 'Installing V12 introduces background retention for disabled-job and orphaned backups.'}</p>
    <p>Background retention uses the last known time-based retention policy. Restore points in disabled-job and orphaned backups can expire and be deleted, even when their jobs no longer run.</p>
    <p className="journey-retention-action"><strong>{alreadyApplies ? 'If you keep backups as archives' : 'Before the V12 hop'}</strong>Review their retention settings and confirm how required restore points will be preserved. A disabled job is not a retention safeguard.</p>
    <details><summary>Scope, exceptions &amp; official guidance</summary><div className="journey-detail">
      <p>For orphaned chains with retention set in days, all outdated files can be removed. Backups still linked to jobs have minimum-file rules. Imported, exported, copied and VeeamZIP backups have documented exclusions; immutable files remain protected until their immutability ends.</p>
      <p>{alreadyApplies ? 'If you need to preserve backups independently of their existing retention, review the available copy options.' : 'Plan preservation before installing V12.'} Veeam describes Copy Backup, available in V12, for independent copies. Review the full retention rules for the selected release before choosing a method.</p>
      <GuidanceSources ids={['retentionChange', 'retention']} />
    </div></details>
  </article>
}

export default function UpgradeJourneyPage({ journey, release, path, backHref }: { journey: UpgradeJourney; release: Release; path: UpgradePath; backHref: string }) {
  const [stageId, setStageId] = useState('prepare')
  const stage = journey.stages.find((item) => item.id === stageId) ?? journey.stages[0]
  const stageIndex = journey.stages.indexOf(stage)
  const previous = journey.stages[stageIndex - 1]
  const next = journey.stages[stageIndex + 1]
  const count = stage.groups.reduce((total, group) => total + group.itemIds.length, 0)

  function goToStage(id: string) {
    setStageId(id)
    document.querySelector<HTMLButtonElement>(`[data-journey-stage="${id}"]`)?.focus()
  }

  return <section className="result upgrade-journey" aria-labelledby="journey-heading">
    <a className="journey-back" href={backHref}>← Back to upgrade results</a>
    <p className="journey-context">Veeam Backup &amp; Replication · Installed: <strong>{release.name}</strong></p>
    <section className="upgrade-path-card journey-route" aria-label="Documented Windows upgrade path">
      <p className="eyebrow">Your route to the latest version · Windows</p>
      <div className="journey-route-heading">
        <ol className="journey-route-list">{journey.route.map((item, index) => <li key={item.id}>{index > 0 && <span aria-hidden="true">→</span>}<span>{journeyReleaseLabel(item)}</span></li>)}</ol>
        <a href={journeySources.route.url} target="_blank" rel="noreferrer">View route source ↗</a>
      </div>
      {path.guidanceNote && <p className="journey-route-note">{path.guidanceNote}</p>}
    </section>
    <header className="journey-heading"><p className="eyebrow">Plan the journey</p><h2 id="journey-heading">What to consider along the way</h2><p>Review the conditions that apply to your deployment. This selected guidance accompanies the full vendor checklists.</p></header>
    <nav className="journey-stage-nav" aria-label="Upgrade guidance stages">{journey.stages.map((item, index) => <button type="button" key={item.id} data-journey-stage={item.id} aria-pressed={stage.id === item.id} aria-controls="journey-stage" onClick={() => setStageId(item.id)}><span>{index + 1}</span>{item.label}</button>)}</nav>
    <section id="journey-stage" key={stage.id} aria-labelledby="journey-stage-heading">
      <div className="journey-stage-heading"><h3 id="journey-stage-heading">{stage.title}</h3><span>{count} considerations</span></div>
      <p className="journey-muted">{stage.intro}</p>
      {stage.groups.map((group) => <section key={group.title} aria-label={group.title}>
        <h4 className="journey-phase-title">{group.title}</h4>
        {group.note && <p className="journey-muted">{group.note}</p>}
        {group.itemIds.map((id) => {
          if (id === 'retention') return <RetentionGuidance key={id} alreadyApplies={journey.retentionAlreadyApplies} />
          const item = journeyItems[id]
          return <article className="journey-item" key={id}>
            <div><h4>{item.title}</h4><p>{item.text}</p></div>
            <div className="journey-item-meta"><span className={`journey-tag ${item.tone ?? ''}`}>{item.kind}</span><span>{item.due}</span></div>
            <details><summary>Details &amp; official guidance</summary><div className="journey-detail"><p>{item.detail}</p><GuidanceSources ids={item.refs} /></div></details>
          </article>
        })}
      </section>)}
    </section>
    {(previous || next) && <nav className="journey-pagination" aria-label="Previous and next stages">
      {previous && <button type="button" aria-label={`Previous: ${previous.label}`} aria-controls="journey-stage" onClick={() => goToStage(previous.id)}>Previous</button>}
      {next && <button className="journey-forward" type="button" aria-label={`Next: ${next.label}`} aria-controls="journey-stage" onClick={() => goToStage(next.id)}>Next</button>}
    </nav>}
    <p className="journey-announcement" role="status">Showing {stage.label}: {count} considerations.</p>
    <footer className="journey-sources"><p>Selected guidance · Reviewed {journeyReviewedAt}<br />Review the full vendor checklist before each hop.</p><GuidanceSources ids={['v12', 'v123', 'v13']} /></footer>
  </section>
}
