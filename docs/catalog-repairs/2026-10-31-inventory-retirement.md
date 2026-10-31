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
- A reappearing KB4131 goes through ordinary page and CVE validation; the retirement does not skip its content.
- Missing-article errors now carry the exact KB ID plus previous/current inventory counts through source-review and repair evidence. Triage classifies them as coverage investigations.

The incident inventory and prior revision are archived in `scripts/fixtures/catalog-repair/2026-10-31-inventory-retirement.json`. The regression suite covers the exact retirement, altered provenance, added security/citation dependencies, a second missing article, repair diagnostic serialization, and a reintroduced page with an unmodeled CVE.

Validation: targeted VSPC coverage, product isolation, October recovery replay and changed-file lint passed locally. A complete live refresh and all repository checks must pass on the branch before publication.
