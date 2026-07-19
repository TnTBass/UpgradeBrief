# Upgrade Brief v1 MVP Implementation Plan

## Scope and delivery boundary

Deliver a static, publicly deployable Upgrade Brief MVP for Cloudflare Pages. The first shipped catalog must support the five agreed products only where their source manifests have complete, pinned official evidence. Unsupported or incomplete coverage is explicit in the UI.

The MVP is a browser-only lookup tool backed by a committed evidence catalog. The GitHub Actions refresh workflow is build-time automation, not a visitor-facing service.

## Task 1 — Static application foundation

Create a TypeScript React/Vite project configured for a static Pages build. Pin the Node 24 toolchain, all direct package versions, and their resolved transitive dependencies in `package-lock.json`; CI must install with `npm ci`.

Files:

- `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`
- `package-lock.json`, `.nvmrc`
- `src/main.tsx`, `src/App.tsx`, `src/styles.css`
- `.github/workflows/refresh-catalog.yml`
- `README.md`

Verification:

- `npm ci && npm run build`
- `npm run lint`

## Task 2 — Evidence-domain contracts and tests

Define TypeScript models for products, releases, lifecycle, security findings, upgrade paths, resources, source manifests, and freshness metadata.

Implement pure functions for:

- normalizing product aliases and version/build input;
- matching exact releases and stated version/build ranges;
- classifying urgency without environment-based downgrade, using only the explicit allowlist in `urgency-fields.ts`: `cvssScore`, `isCisaKev`, and `veeamConfirmedActiveExploitation`;
- selecting the shortest valid, source-backed upgrade path;
- calculating `current`, `stale`, and `outdated` catalog status.

Files:

- `src/lib/catalog-types.ts`
- `src/lib/lookup.ts`
- `src/lib/urgency.ts`
- `src/lib/urgency-fields.ts`
- `src/lib/freshness.ts`
- `src/lib/*.test.ts`

Verification:

- `npm test -- --run`
- Representative unit tests for CVSS 9+, KEV, Veeam-confirmed active exploitation, CVSS 7-8.9, range mismatch, 36-hour staleness, and 7-day outdated status.

## Task 3 — Source manifest and initial catalog

Add a source manifest with direct official URLs, expected fields, parser fixture names, and an explicit per-product coverage state for each agreed product. Add a minimal curated catalog that exercises all result states without claiming unsupported coverage. A product without complete security, lifecycle, and route evidence must display an incomplete-coverage banner and cannot be presented as fully covered.

Initial data must include:

- VBR releases/builds and paths verified from KB2680/KB2053;
- Veeam ONE release/path evidence from KB4646;
- Enterprise Manager ordering and upgrade constraints from the Enterprise Manager/VBR guides;
- VRO 7.2.1-to-13 constraint from the VRO 13 guide;
- VSPC 9.1-or-later in-place constraint from the VSPC 9.2 deployment guide;
- lifecycle fields sourced from Veeam Product Lifecycle;
- a clearly identified security-finding fixture from a Veeam advisory with no invented CVEs or ranges.

Files:

- `src/data/source-manifest.ts`
- `src/data/catalog.snapshot.json` (the committed last-known-good runtime catalog)
- `src/data/catalog.ts`
- `src/data/fixtures/*`
- `scripts/validate-catalog.mjs`

Verification:

- `npm run validate:catalog`
- Tests reject unknown fixed-in releases, overlapping release identity, route cycles, missing sources, and catalog data that fails schema validation.
- Every adapter test uses a committed fixture only; no unit or integration test may request a live vendor or CISA endpoint. Adding an adapter requires its matching fixture.
- A UI fixture proves that incomplete product coverage renders the required warning rather than a fully covered result.

## Task 4 — Lookup interface and cited results

Build the neutral, accessible static UI:

- product picker, build/version input, and input hints;
- result summary with urgency and lifecycle state;
- security findings with affected/fixed releases, conditions, and source URLs;
- ordered upgrade route and planning resources;
- visible freshness status and independent-tool disclaimer;
- explicit unsupported/ambiguous input result.

Do not use Veeam logos or visual styling that suggests endorsement. Encode lookup state in a shareable URL query string only.

Files:

- `src/components/*`
- `src/App.tsx`
- `src/styles.css`

Verification:

- Unit tests for representative lookup flows.
- Production build inspected locally for responsive layout and source-link presence.

## Task 5 — Automated catalog refresh

Implement a scheduled GitHub Actions workflow and a deterministic refresh script.

- Run daily and on manual dispatch.
- Fetch only sources in the manifest.
- Write source retrieval metadata.
- Validate parsed/compiled data before creating a change.
- Commit or open a pull request only when catalog data differs.
- The scheduled refresh runs independently of Cloudflare Pages builds. It fetches, parses, and validates candidate data first, then atomically replaces `src/data/catalog.snapshot.json` only after all validations succeed; any error leaves that committed snapshot untouched.
- Cloudflare Pages builds only committed repository data and never fetches vendor or CISA sources.
- Fail closed: a failure cannot publish a replacement catalog.
- Preserve test fixtures so parser changes are reviewed independently from source content changes.

Files:

- `scripts/refresh-catalog.mjs`
- `scripts/lib/source-adapters/*`
- `.github/workflows/refresh-catalog.yml`

Verification:

- Fixture-based refresh test.
- A forced bad fixture fails validation without changing `src/data/catalog.snapshot.json`.

## Task 6 — Cloudflare and GitHub delivery

- Create public `UpgradeBrief` GitHub repository.
- Push `main` after the MVP passes local checks.
- Connect it to Cloudflare Pages Free.
- Configure build command and output directory.
- Verify the `pages.dev` deployment, then add `UpgradeBrief.com` once DNS/domain control is available.

Verification:

- Pages production deployment loads.
- A direct permalink produces the same results as the interactive lookup.
- Site has no Pages Function or Worker dependency.

## Review and verification gates

- Review the implementation plan before Task 1.
- Run focused implementation review after Tasks 2-4 and again after Task 5.
- Before publication, run the Pages build plus the catalog-validation and test suites, then verify the deployed static asset path and freshness metadata.

## Open implementation decisions

- Whether the refresh workflow commits directly to `main` or opens an automated pull request. Default: pull request, to preserve an auditable diff without requiring per-change content approval.
- Exact initial security advisory records depend on source-fixture availability. Default: only include records whose version/build range and fixed release can be extracted and validated without inference.
