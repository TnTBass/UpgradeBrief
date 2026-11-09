import type { Catalog } from './lib/catalog-types'

const noticeDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
})

export default function SecurityNotices({ catalog, now = new Date() }: { catalog: Catalog; now?: Date }) {
  const notices = (catalog.securityNotices ?? [])
    .filter(notice => Date.parse(notice.publishedAt) <= now.getTime() && now.getTime() < Date.parse(notice.displayUntil))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3)

  if (!notices.length) return null
  return (
    <aside className="security-notices" aria-label="Recent vendor security notices">
      {notices.map(notice => {
        const source = catalog.sources.find(source => notice.sourceIds.includes(source.id))
        if (!source) return null
        return (
          <div className="security-notice" key={notice.id}>
            <svg className="security-notice-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6" /><circle cx="12" cy="7.5" r=".75" fill="currentColor" stroke="none" />
            </svg>
            <div>
              <p><strong>{notice.title}:</strong> {notice.summary}</p>
              <p className="security-notice-source">
                <a href={source.url} target="_blank" rel="noreferrer">Veeam advisory <span aria-hidden="true">↗</span></a>
                <span aria-hidden="true"> · </span>
                <time dateTime={notice.publishedAt}>{noticeDate.format(new Date(notice.publishedAt))}</time>
              </p>
            </div>
          </div>
        )
      })}
    </aside>
  )
}
