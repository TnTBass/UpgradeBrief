# October 31 inventory retirement recovery

The scheduled refresh [41192587789](https://github.com/TnTBass/UpgradeBrief/actions/runs/41192587789) stopped at 2026-10-31 10:24:57 UTC (04:24 MDT) with `VSPC_INVENTORY_TRUNCATED`. No new catalog was committed or published. The repair workflow opened [issue 25](https://github.com/TnTBass/UpgradeBrief/issues/25) and correctly declined to synthesize a correction without source evidence.

## Cause and impact

A complete live query in [diagnostic run 41244102443](https://github.com/TnTBass/UpgradeBrief/actions/runs/41244102443) returned 71 VSPC articles, compared with 72 in accepted commit `e8b2d1d2693d139174ac97da86e8a90d41120405`. Only KB4131 was missing; there were no additions. A direct request returned Veeam's unavailable-page content, and a separate browser retrieval confirmed a redirect to `https://www.veeam.com/404.html`.

The indexed historical [official KB4131 page](https://www.veeam.com/kb4131?ad=in-text-link) describes a monthly license-report failure in VSPC 5, resolved in patch 2. Its historical publication date was 2021-03-18 and last modification 2024-02-22. This evidence establishes the old page's topic, not Veeam's reason for removing it.

The accepted snapshot has no CVE page state, security feed route, source definition, ownership or catalog citation for KB4131. Its only content dependency is the previously fetched full-inventory page revision, digest `319b07f4cd0fff2395436e9c2708be6fd9db17e5a1ee0702f7a99ba65d9ce95c`.

The global continuity gate intentionally stops all transactions when a previously observed inventory article disappears. That prevents incomplete source discovery from silently losing security evidence. It had no reviewed retirement mechanism and its new preflight discarded the missing ID, so the automated investigation contained only a generic error.

Production retained the October 30 20:45 UTC catalog. The October 31 20:39 UTC production monitor still reported all six products healthy, at about 24 hours old. This incident interrupted refreshes, not website availability.

## Correction and prevention

- Both the discovery preflight and full VSPC coverage validator use the same inventory continuity policy.
- Permit only the reviewed KB4131 retirement, bound to its exact previously accepted fetched revision and VSPC validation evidence.
- Refuse retirement if the prior revision differs, evidence is absent, or any accepted catalog/security/ownership record references the article.
- Continue to reject all other unexplained missing articles, duplicate entries, incomplete pagination, missing CVEs and changed security scope.
- If KB4131 returns to the inventory, it goes through ordinary page and CVE validation; the retirement does not skip its content.
- Missing-article errors now carry the exact KB ID plus previous/current inventory counts through source-review and repair evidence. Triage classifies them as coverage investigations.

The incident inventory and prior revision are archived in `scripts/fixtures/catalog-repair/2026-10-31-inventory-retirement.json`. The regression suite covers the exact retirement, altered provenance, added security/citation dependencies, a second missing article, repair diagnostic serialization, and a reintroduced page with an unmodeled CVE.

Validation: [live job 124669280699](https://github.com/TnTBass/UpgradeBrief/actions/runs/41245944469/job/124669280699) completed a full refresh, confirmed atomic equivalence and passed all 35 repository checks. All six products are validated at 2026-10-31T22:01:17.118Z; the catalog retains 272 releases and 110 security findings, with unchanged release/security records. The accepted catalog hash is `2bdeb12fe6cbff4b22da5443cf6df049a8d889296fbbb2b67f48f32f647e5b7a` and policy hash is `4b1b5159ce3fa6653414658b14fabb12531f3e8704b0eb9702e3c7b1d5d0a6af`.

## Additional blockers found during recovery

The first complete live attempt passed inventory continuity and then stopped on nine changed VSPC fingerprints. [Source comparison](https://github.com/TnTBass/UpgradeBrief/actions/runs/41245188650) showed that the version-2 fingerprint included global navigation and footer text. The six pages with accepted normalized-text baselines matched those baselines exactly. The other three pages were reviewed against their existing coverage: KB4539's server-side Veeam Intelligence exclusion; KB4651's two vulnerabilities also documented in unchanged KB4679; and KB4788's release security sections, already covered by the catalog and release-security adapters.

Fingerprint version 3 scopes evidence to the article, excludes navigation/footer/support-feedback components, and preserves security metadata. Migration from the nine accepted version-2 hashes is pinned to exact reviewed version-3 hashes and also requires unchanged CVE sets, catalog fingerprints and parsed-model fingerprints. Unknown transitions continue to block. The captured evidence is in `2026-10-31-fingerprint-scope.json`; the KB4893 HTML regression fixture verifies the exact transition and rejects changed applicability, baseline hashes and parser models. Synthetic fixtures verify that later menu/footer edits do not trigger a failure while article and metadata changes still do.

The all-transactions-blocked and atomic-blocked paths now retain each underlying article finding in the review artifact. This prevents a detailed source failure from being replaced with an uninformative aggregate error.

The dependency check also identified a newly indexed moderate advisory, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), in the development-only minimatch dependency chain. It is unrelated to the live catalog source failure. The accepted remediation upgrades ESLint to 10.14.0, @eslint/js to 10.0.1, typescript-eslint to 8.72.1 and compatible React lint plugins, with minimatch pinned to 11.0.3. The isolated dependency candidate passed lint, all 35 repository checks and an audit with zero findings ([run 41246105093](https://github.com/TnTBass/UpgradeBrief/actions/runs/41246105093)). The new linter identified one redundant initial PDF layout assignment, which was removed without changing output. No audit threshold is relaxed and no forced downgrade is used.
