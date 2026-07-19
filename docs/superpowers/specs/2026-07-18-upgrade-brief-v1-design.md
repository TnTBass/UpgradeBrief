# Upgrade Brief v1 Design

## Intent

Upgrade Brief is an independent community web application that explains *why* a customer should upgrade a supported Veeam product, then provides the official, supported upgrade path and source-linked planning material.

It is not affiliated with or endorsed by Veeam Software. It does not scan an environment, certify a deployment as safe, or perform an upgrade.

## Users and v1 scope

The public, anonymous v1 accepts an installed product and precise version/build for:

- Veeam Backup & Replication (VBR)
- Veeam Backup Enterprise Manager
- Veeam ONE
- Veeam Recovery Orchestrator (VRO)
- Veeam Service Provider Console (VSPC)

The primary user is a Veeam administrator or service provider who needs evidence to justify, plan, or prioritize an upgrade.

## User journey

1. A visitor selects a product and enters a version or build number.
2. Upgrade Brief normalizes the input to a canonical product release.
3. It returns a cited upgrade brief containing:
   - current lifecycle/support state;
   - every applicable Veeam-published security finding;
   - a prioritized explanation of upgrade reasons;
   - the official supported upgrade hops to the selected current target;
   - relevant upgrade checklist, release notes, and source links;
   - the evidence-catalog refresh timestamp.
4. The visitor can open a permalink that encodes the selected product and release, but no environment data is collected or stored.

## Recommendation and security policy

Each finding has a source, affected product/build range, fixed-in release, conditions, and evidence URL. The tool only reports a CVE when the selected canonical release is explicitly within the vendor's affected range and a later release is identified as a fix.

Security urgency is intentionally conservative:

| Output urgency | Rule |
| --- | --- |
| Critical | Matching CVE has CVSS 9.0-10.0, or is in CISA KEV / has vendor-confirmed active exploitation. |
| High | Matching CVE has CVSS 7.0-8.9, or Veeam identifies a material exploitable condition without a CVSS score. |
| Planned | Security improvements exist after the selected build, but the conditions above do not apply. |
| Supportability | Lifecycle/support reason with no matching security finding. |

Network isolation, access controls, claimed mitigations, or a visitor's belief that a precondition is absent **never lower or suppress** a matching security finding. Where the vendor states a precondition, the result displays it as a verification requirement. For example: "Applies to domain-joined backup servers. Verify this condition independently; it is not used to defer remediation."

Lifecycle is an independent reason: End of Fix and End of Support are never hidden by a newer product release or by an absent CVE.

The UI must never state that a deployment is "safe," "not vulnerable," or "not affected" based only on its limited catalog. It says that no matching published finding is currently in the catalog, with the catalog timestamp and source coverage.

## Data and evidence model

The repository stores a versioned, human-readable JSON evidence catalog. The generated static site consumes a compiled client-safe form of that catalog.

Core entities:

- `product`: canonical product id, display name, aliases, product family, and input help.
- `release`: product, marketing version, build number, release date, and source evidence.
- `lifecycle`: product/version range, End of Fix, End of Support and Security Fix, source URL, source retrieval date.
- `securityFinding`: CVE ids when supplied, CVSS version/score, advisory title, affected release ranges, fixed release, known-exploited flag, stated conditions, and source URL.
- `upgradePath`: source release range, ordered required intermediary releases, target release, conditions, and source URL.
- `resource`: checklist, release notes, What's New, product build catalog, or other planning source.

Every entity has `sourceUrl`, `sourceTitle`, and `observedAt`. Records derived from a source also preserve the source's published/modified date when available.

Source priority:

1. Veeam product security advisories and build/version KBs.
2. Veeam product lifecycle and official upgrade-path KBs/user guides.
3. Official release notes and What's New documentation.
4. CISA KEV only as an exploit-status enrichment; Veeam remains the authority for affected/fixed product ranges.

The first collector sources include VBR build numbers (KB2680), VBR upgrade paths (KB2053), Veeam ONE paths (KB4646), Veeam product lifecycle, the VBR upgrade checklist, Veeam security advisory listings, and the equivalent official source set for Enterprise Manager, VRO, and VSPC.

## Automatic refresh

A daily GitHub Actions workflow retrieves the configured official sources, normalizes the data, and validates the compiled catalog. It is automatic: no per-change human approval is required for v1.

It must:

1. Fetch each source with an explicit source manifest and record retrieval metadata.
2. Parse only the documented fields needed by the catalog; preserve links rather than republishing substantial source text.
3. Validate references, release ordering, build-number uniqueness, path continuity, and no dangling fixed-in releases.
4. Compare the generated catalog against the prior catalog and create a commit/pull request only when the validated data changed.
5. Leave the last known-good catalog deployed when a fetch, parse, or validation step fails.
6. Publish a visible data-status value: current, stale, or refresh failed, including last successful refresh time.

The static runtime never fetches Veeam or CISA directly. This keeps visitor results reproducible and avoids live-source failures changing results in flight.

## Application architecture

v1 is a static TypeScript web application built and deployed to Cloudflare Pages.

- The app bundle includes the compiled evidence catalog.
- Lookup, range matching, urgency evaluation, and route selection occur in the browser.
- The URL stores only product/release query state.
- No authentication, database, Pages Function, Worker, telemetry SDK, cookie banner, or visitor environment data is required for v1.
- Cloudflare Pages Free serves the static site; GitHub Actions drives catalog refresh and Pages build/deploy through Git integration.

This static-first design keeps the application within the intended free-tier limits and makes all visible results reproducible from the committed data revision.

## Product presentation

The visual identity is neutral and independent. The product name is **Upgrade Brief**.

Required footer/result disclaimer:

> Upgrade Brief is an independent community tool and is not affiliated with or endorsed by Veeam Software.

The homepage promise:

> Enter your Veeam product and build. Get the security, lifecycle, and support evidence behind your recommended upgrade path.

## Acceptance criteria

1. A known VBR build normalizes to its exact canonical release and links to its build-number evidence.
2. An affected release displays every matching catalogued security finding, its CVE/CVSS when provided, fixed-in release, stated conditions, and source link.
3. A matching CVSS 9.0+ or KEV finding produces a Critical upgrade reason without an environment-based downgrade path.
4. A lifecycle-only result explains the support state and source, without suggesting that the system is safe.
5. A release with a multi-hop official route lists the hops in order and preserves applicable conditions.
6. Unsupported, ambiguous, or unrecognized input does not invent a route; it explains what version/build information is needed and links to the relevant product build catalog where available.
7. Every result shows data freshness and the independent-tool disclaimer.
8. The generated production site is static and deploys successfully to Cloudflare Pages Free.

## Explicit non-goals

- Vulnerability scanning, network discovery, or integration with customer environments.
- Automated upgrade execution or change-window scheduling.
- A claim of compliance, safety, exploitability in a specific environment, or Veeam endorsement.
- Support for all Veeam products in v1.
- Runtime scraping of vendor sources.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Official source markup or availability changes | Source manifest, parser fixtures, daily validation, last-known-good deployment, visible freshness status. |
| Incorrect route or affected-range interpretation | Preserve source evidence, test representative fixtures, and fail validation on dangling or discontinuous graph data. |
| Users misread caveats as a reason to ignore risk | Never lower urgency from visitor claims; phrase conditions as verification requirements. |
| Implied Veeam affiliation | Neutral identity, explicit footer/result disclaimer, and no Veeam logo/brand styling without permission. |
| Static catalog becomes stale | Daily automatic refresh and visible last-success timestamp. |
