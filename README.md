# Upgrade Brief

Independent, evidence-based upgrade guidance for Veeam software.

Upgrade Brief is a static community tool. It helps operators find official upgrade paths, lifecycle references, and curated security reasons for upgrading. It is not affiliated with Veeam, does not inspect an environment, and does not certify upgrade safety.

## Current MVP scope

- Product lookup for Veeam Backup & Replication, Veeam Backup Enterprise Manager, Veeam ONE, Veeam Recovery Orchestrator, and Veeam Service Provider Console.
- Exact-match, source-linked upgrade routes for the releases in the committed catalog.
- Conservative security model: CVSS 9+, CISA KEV, or Veeam-confirmed active exploitation is critical; CVSS 7–8.9 is high. Environment controls never downgrade a matching advisory.
- Visible partial-coverage warnings. The MVP must never imply that no displayed CVE means no risk.

The committed catalog is the runtime source of truth. Cloudflare Pages builds it as static files and never fetches vendor content. Scheduled GitHub Actions validates the last-known-good snapshot; live source adapters will be enabled only with committed, reviewed parser fixtures.

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
