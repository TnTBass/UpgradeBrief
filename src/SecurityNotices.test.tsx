import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { catalog } from './data/catalog'
import SecurityNotices from './SecurityNotices'
import type { Catalog } from './lib/catalog-types'

const notice = {
  id: 'kb4953', scope: 'vendor-wide' as const, impact: 'not-affected' as const,
  title: 'PHP2Shell', summary: 'Veeam confirms its products and SaaS services are unaffected.',
  publishedAt: '2026-10-22', displayUntil: '2026-11-21', sourceIds: ['kb4953'],
}
const withNotice: Catalog = { ...catalog, securityNotices: [notice], sources: [
  ...catalog.sources.filter(source => source.id !== 'kb4953'),
  { id: 'kb4953', title: 'PHP2Shell', url: 'https://www.veeam.com/kb4953', checkedAt: '2026-10-23T00:00:00Z' },
] }
const render = (date: string, data = withNotice) => renderToStaticMarkup(<SecurityNotices catalog={data} now={new Date(date)} />)

describe('recent vendor security notices', () => {
  it('shows a brief sourced statement with the publication date', () => {
    const html = render('2026-10-23T00:00:00Z')
    expect(html).toContain('PHP2Shell:')
    expect(html).toContain(notice.summary)
    expect(html).toContain('href="https://www.veeam.com/kb4953"')
    expect(html).toContain('Oct 22, 2026')
    expect(html).not.toContain('security-panel')
  })
  it('shows only during the publication window, with an exclusive UTC expiry', () => {
    expect(render('2026-10-21T23:59:59Z')).toBe('')
    expect(render('2026-10-22T00:00:00Z')).toContain('PHP2Shell')
    expect(render('2026-11-20T23:59:59Z')).toContain('PHP2Shell')
    expect(render('2026-11-21T00:00:00Z')).toBe('')
    expect(render('2026-10-23T00:00:00Z', { ...withNotice, securityNotices: [] })).toBe('')
  })
  it('never renders an unsupported statement without a source', () => {
    expect(render('2026-10-23T00:00:00Z', { ...withNotice, sources: [] })).not.toContain('PHP2Shell')
  })
})
