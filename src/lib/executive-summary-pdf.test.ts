import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildExecutiveSummaryPdf, type ExecutiveSummaryPdfInput } from './executive-summary-pdf'

const patchReleaseInput: ExecutiveSummaryPdfInput = {
  productName: 'Veeam Backup & Replication',
  installedRelease: '13.0.1 (build 13.0.1.180)',
  preparedOn: '7/21/2026',
  recommendation: {
    heading: 'Critical security fixes are available.',
    detail: 'This build has 12 matching cataloged security advisories, including critical-risk findings. Follow the documented route below to 13.0.2 (build 13.0.2.29).',
  },
  lifecycle: {
    heading: 'Supported',
    detail: 'Veeam Backup & Replication 13 is listed with support and security fixes through November 2028.',
  },
  upgradeRoute: {
    heading: 'Recommended target: 13.0.2 (build 13.0.2.29)',
    detail: '13.0.1 (build 13.0.1.180) > 13.0.2 (build 13.0.2.29)',
  },
  securitySummary: '12 matching cataloged security advisories, including 4 Critical, 7 High Priority, 1 Standard. Individual advisory details are excluded from this executive summary.',
  targetUpdates: {
    label: 'Patch release updates',
    heading: 'Documented resolved issues in 13.0.2',
    detail: 'This is a patch release, not a new feature release. Veeam documents resolved issues across console administration, repository operations, and protection workflows.',
    items: [{ title: 'Remote Console' }, { title: 'High Availability' }, { title: 'NFS Repository' }, { title: 'And more' }],
  },
  sources: [{ title: 'Veeam KB4738: Release Information for Veeam Backup & Replication 13 and updates', url: 'https://www.veeam.com/kb4738' }],
}

describe('executive summary PDF', () => {
  it('includes a decision summary and patch-release updates', async () => {
    const document = buildExecutiveSummaryPdf(patchReleaseInput)
    const pdf = new TextDecoder('latin1').decode(document.output('arraybuffer'))

    expect(pdf).toContain('DECISION SUMMARY')
    expect(pdf).toContain('PATCH RELEASE UPDATES')
    expect(pdf).toContain('Remote Console')
    expect(document.getNumberOfPages()).toBe(1)

    if (process.env.EXECUTIVE_SUMMARY_PREVIEW) {
      await writeFile(process.env.EXECUTIVE_SUMMARY_PREVIEW, new Uint8Array(document.output('arraybuffer')))
    }
  })

  it('uses capability highlights for a feature release', () => {
    const document = buildExecutiveSummaryPdf({
      ...patchReleaseInput,
      installedRelease: '11a (build 11.0.1.1261)',
      recommendation: {
        heading: 'Critical security fixes are available.',
        detail: 'This build has 35 matching cataloged security advisories, including critical-risk findings. Follow the documented route below to 13.0.2 (build 13.0.2.29).',
      },
      targetUpdates: {
        label: 'What the target can add',
        heading: 'Feature highlights',
        detail: 'Veeam documents the following capability improvements in the recommended target release.',
        items: [
          { title: 'Strengthen cyber resilience', summary: 'Choose a managed Veeam Software Appliance deployment option to reduce operating system maintenance and manual hardening work.' },
          { title: 'Modernize backup management', summary: 'Use the web UI, enhanced role-based access control, and SAML single sign-on to give teams a simpler way to operate backup.' },
        ],
      },
    })
    const pdf = new TextDecoder('latin1').decode(document.output('arraybuffer'))

    expect(pdf).toContain('WHAT THE TARGET CAN ADD')
    expect(pdf).toContain('Strengthen cyber resilience')
    expect(pdf).toContain('Modernize backup management')
  })

  it('omits target-specific content for the current cataloged release', () => {
    const document = buildExecutiveSummaryPdf({
      ...patchReleaseInput,
      installedRelease: '13.0.2 (build 13.0.2.29)',
      recommendation: {
        heading: 'This is the current cataloged release.',
        detail: 'No newer target is currently recorded. Continue to review vendor guidance and security advisories for subsequent patches.',
      },
      upgradeRoute: undefined,
      targetUpdates: undefined,
    })
    const pdf = new TextDecoder('latin1').decode(document.output('arraybuffer'))

    expect(pdf).toContain('This is the current cataloged release.')
    expect(pdf).not.toContain('UPGRADE ROUTE')
    expect(pdf).not.toContain('PATCH RELEASE UPDATES')
    expect(pdf).not.toContain('Recommended target:')
  })
})
