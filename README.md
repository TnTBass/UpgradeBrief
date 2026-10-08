# Upgrade Brief

Independent, evidence-based upgrade guidance for Veeam software.

Upgrade Brief is an independent community tool, not affiliated with or endorsed by Veeam. It uses only publicly available information and does not access hidden, confidential, proprietary, or customer environment data. It does not assess your environment or certify upgrade safety.

## What it does today

- Looks up Veeam Backup & Replication, Veeam Backup Enterprise Manager, Veeam ONE, Veeam Recovery Orchestrator, Veeam Service Provider Console, and Veeam Backup for Microsoft 365 versions and builds.
- Shows source-linked lifecycle status, documented upgrade routes, and supporting upgrade instructions when Veeam publishes an applicable path.
- Highlights documented capabilities available in the recommended target release, with links to the corresponding What's New and release-note material.
- Presents build-aware security reasons to upgrade. CVSS 9+, CISA KEV, or Veeam-confirmed active exploitation is critical; CVSS 7–8.9 is high. Environment controls never downgrade a matching advisory.
- Exports a concise executive-summary PDF for a selected release.
- Offers a separate, source-linked upgrade journey for reviewed Windows VBR V11/V12 routes to V13.1.1, with preparation, hop-specific timing, feature changes and a prominent retention warning. Open it with “Plan this upgrade” in the results; the product and exact entered version are preserved in the URL.
- Keeps coverage limits visible. A result never means that an undisplayed CVE, lifecycle restriction, or upgrade constraint does not exist.

## How the catalog stays current

The committed catalog is the runtime source of truth for the static site. Cloudflare Workers Builds publishes the site; it does not fetch vendor data at runtime.

Scheduled GitHub Actions refreshes publicly available Veeam and CISA information, including:

- Build numbers for VBR, Veeam ONE, VRO, VSPC, and their tracked Enterprise Manager companion builds.
- Veeam security advisories, Veeam lifecycle information, and CISA KEV exploitation status.
- VBR release-information records and current Help Center What's New and release-note materials for the tracked products.

Release materials are fingerprinted so changes to a version family’s What's New or release notes can be detected. Feature highlights are generated only from statements the official source material directly supports. Veeam-hosted sources are fetched one request at a time per host with a three-second minimum interval; transient network, 408, 429, and 5xx failures are retried up to three times while 403 responses fail immediately with redacted diagnostic headers and a short response preview. The refresh validates the candidate catalog before automatically committing a changed snapshot to `main` for Cloudflare Workers deployment. If a source cannot be safely parsed or validated, the last known-good catalog remains in place.

## Project status and limits

Upgrade Brief is actively maintained, but its coverage is intentionally conservative and partial. It does not infer undocumented upgrade paths, certify a build as safe, or make environment-specific claims. Always review the linked official sources before acting.

Source code and issue tracking: [TnTBass/UpgradeBrief](https://github.com/TnTBass/UpgradeBrief).

Journey guidance is manually reviewed in `src/data/upgrade-journey.ts`. Its route comes from the existing catalog lookup, while `src/lib/upgrade-journey.ts` limits the guidance to the reviewed target. Extending coverage to another destination requires reviewing the linked official sources and updating the applicability tests. Automatic catalog refreshes do not extend this editorial coverage.

## A note on attribution

Upgrade Brief is shared openly, but good etiquette still matters. If this project inspires your own work, or you reuse substantial parts of its code or approach, please credit Upgrade Brief and its original author, Tyler (`TnTBass`). Taking the idea and presenting it as entirely your own without attribution is generally considered pretty uncouth.

## License

Upgrade Brief is licensed under the [Apache License 2.0](LICENSE). Attribution information is provided in [NOTICE](NOTICE).

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

Connect the public GitHub repository to Cloudflare Workers Builds with:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` (static assets come from `dist` via `wrangler.jsonc`)
- Node version: from `.nvmrc`

The Worker in `worker/index.ts` handles only the analytics routes before static asset serving; all other routes retain the existing SPA fallback.

## Audience and usage analytics

Umami Cloud uses the public website ID in `index.html`. Tracking is restricted to `upgradebrief.com` and `www.upgradebrief.com`; local development and deployment previews do not send analytics. No Umami API key or separate analytics database is required.

The browser loads `/stats.js` and sends events to `/api/send` on Upgrade Brief. The Worker proxies the current Umami Cloud script and collector, avoiding direct browser requests to Umami domains. It accepts same-origin production events for this website only, limits request bodies to 16 KiB, forwards the Umami session token and the real User-Agent, and uses Cloudflare's original visitor IP in Umami's `payload.ip`. The explicit IP prevents Cloudflare cross-zone proxy addresses from merging visitors or distorting location; IPs and event bodies are not logged by the Worker. Event responses are never cached; the script can be cached for five minutes. Fetch failures time out after five seconds and are not retried.

Deploy the Worker routes and tracker tag together. Validate routing locally with `npm run build` and `npx wrangler deploy --dry-run`; plain Vite does not run the Worker. The existing production-host gate excludes local and preview visits. The proxy reduces third-party blocking but does not guarantee complete coverage or recover past visits.

The application sends one pageview per document load, grouped as `/` (results) or `/journey`. Product/version changes are events, not extra pageviews. The initial pageview preserves incoming `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, and `utm_id`; selection and journey links preserve campaign parameters. For example: `https://upgradebrief.com/?utm_source=linkedin&utm_medium=social&utm_campaign=upgrade-journey`.

| Event | Meaning | Properties |
| --- | --- | --- |
| `product_selected` | Visitor changes the selected product | `product` |
| `brief_viewed` | A matched release result remains displayed for 600 ms | `product`, catalog `release`, `outcome` (`current`, `upgrade`, `no_route`) |
| `pdf_exported` | PDF generation hands the export to the browser | `product`, catalog `release` |
| `journey_viewed` | A supported journey remains displayed for 600 ms | `product`, catalog `release` |
| `journey_stage_viewed` | A journey stage remains displayed for 700 ms | catalog `release`, `stage` |
| `outbound_clicked` | Visitor follows an external link, including official sources | `product`, matched catalog `release` (when available), `view`, `destination` (origin and path only) |
| `details_opened` | Visitor expands guidance, source materials, or security details | `product`, matched catalog `release` (when available), `view`, `topic`, journey `stage` (when applicable) |

`details_opened` records openings only; closing a section and ordinary rerenders do not add events. Reopening a section records another action. Topics identify version help, release highlights/fixes/materials, appliance conversion requirements, security advisories, and individual journey items (including retention). Journey topic IDs match `src/data/upgrade-journey.ts`; release-fix source topics include the catalog improvement ID. Filter these events and `outbound_clicked` by `product` and `release` to see which guidance people investigate for their installed version. When no release matches, the `release` property is omitted rather than recording free-text input.

Use Umami's traffic/referrer and UTM reports for acquisition, event properties for product/release demand, and visitor-based goals or funnels for `brief_viewed` → `pdf_exported` and `brief_viewed` → `journey_viewed`. Event totals represent actions, not unique people. Repeated identical result renders are suppressed, while revisiting a different selection or stage can record another action. The journey's initial preparation stage is included in stage views.

Raw version text, unknown query parameters, URL fragments, and referrer query strings are not collected (same-site referrers retain campaign parameters). No custom visitor identity, session replay, or keystroke tracking is added. Only matched catalog release names are event properties; do not put personal information in campaign tags. A blocked or failed tracker does not affect the tool.

To exclude your own browser, run `localStorage.setItem('umami.disabled', '1')` in the site's browser console and reload; undo with `localStorage.removeItem('umami.disabled')`. This setting is specific to that browser and origin. See [Umami's exclusion instructions](https://docs.umami.is/docs/exclude-my-own-visits).

After deployment, verify that /stats.js returns JavaScript and /api/send returns a normal Umami cache/session response (HTTP 200 with beep: boop is bot-filtered, not stored). Confirm the proxied visitor session matches a direct diagnostic using the same visitor IP/User-Agent. Then verify a tagged visit, a completed brief, a PDF export, a journey stage, a details expansion, and an outbound link in Umami's realtime/events views. Confirm that expansion and outbound events include the matched release, that closing a section does not add an event, and that changing a version does not add pageviews. Browser blocking can reduce measured traffic; PDF exports mean the browser was asked to save, not that a file was confirmed on disk.
