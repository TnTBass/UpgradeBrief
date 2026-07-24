# Upgrade Brief

Independent, evidence-based upgrade guidance for Veeam software.

Upgrade Brief is an independent community tool, not affiliated with or endorsed by Veeam. It uses only publicly available information and does not access hidden, confidential, proprietary, or customer environment data. It does not assess your environment or certify upgrade safety.

## What it does today

- Looks up Veeam Backup & Replication, Veeam Backup Enterprise Manager, Veeam ONE, Veeam Recovery Orchestrator, Veeam Service Provider Console, and Veeam Backup for Microsoft 365 versions and builds.
- Shows source-linked lifecycle status, documented upgrade routes, and supporting upgrade instructions when Veeam publishes an applicable path.
- Highlights documented capabilities available in the recommended target release, with links to the corresponding What's New and release-note material.
- Presents build-aware security reasons to upgrade. CVSS 9+, CISA KEV, or Veeam-confirmed active exploitation is critical; CVSS 7–8.9 is high. Environment controls never downgrade a matching advisory.
- Exports a concise executive-summary PDF for a selected release.
- Keeps coverage limits visible. A result never means that an undisplayed CVE, lifecycle restriction, or upgrade constraint does not exist.

## How the catalog stays current

The committed catalog is the runtime source of truth for the static site. Cloudflare Pages builds and deploys the site; it does not fetch vendor data at runtime.

Scheduled GitHub Actions refreshes publicly available Veeam and CISA information, including:

- Build numbers for VBR, Veeam ONE, VRO, VSPC, and their tracked Enterprise Manager companion builds.
- Veeam security advisories, Veeam lifecycle information, and CISA KEV exploitation status.
- VBR release-information records and current Help Center What's New and release-note materials for the tracked products.

Release materials are fingerprinted so changes to a version family’s What's New or release notes can be detected. Feature highlights are generated only from statements the official source material directly supports. The refresh validates the candidate catalog before automatically committing a changed snapshot to `main` for Cloudflare Pages deployment. If a source cannot be safely parsed or validated, the last known-good catalog remains in place.

## Project status and limits

Upgrade Brief is actively maintained, but its coverage is intentionally conservative and partial. It does not infer undocumented upgrade paths, certify a build as safe, or make environment-specific claims. Always review the linked official sources before acting.

Source code and issue tracking: [TnTBass/UpgradeBrief](https://github.com/TnTBass/UpgradeBrief).

## Local development

Requires Node 24.

```sh
npm ci
npm run validate:catalog
npm test -- --run
npm run lint
npm run build
npm run dev
```

## Deployment

Connect the public GitHub repository to Cloudflare Pages with:

- Build command: `npm run build`
- Build output directory: `dist`
- Node version: from `.nvmrc`

No Pages Function or Worker is required.
