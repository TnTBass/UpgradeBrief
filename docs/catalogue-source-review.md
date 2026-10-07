# Catalogue source review

The refresh keeps accepted article text in `scripts/data/security-review-baselines.json`, outside the browser bundle. Each entry has the original normalized article text, its content fingerprint, a comparison fingerprint, and (for informational articles) the independently reviewed policy fingerprint. Git history retains earlier accepted text.

The comparison permits only:

- Existing HTML/whitespace normalization and page-furniture exclusions.
- A change to the labelled `Last Modified` date in the article metadata. Publication dates and dates in security guidance remain significant.
- The article-specific naming rules in `scripts/lib/security-review-baselines.mjs`. These were proved against the exact accepted hashes on September 23, 2026: KB4261 Azure metadata, KB4374 Google Cloud wording, KB4712 AWS/Google Cloud wording, and KB4924 AWS metadata. These rules are not global product equivalences.

An equivalent comparison reconciles only the content fingerprint for that run. It does not override product scope, route/classification continuity, expected CVEs, build/version interpretation, or downstream security coverage. Unknown wording, including changed mitigation with unchanged CVEs, still blocks publication. Missing or inconsistent baselines cannot authorize a changed article.

The live refresh explicitly disables the former inventory-CVE-expansion exception: adding CVEs to a fingerprinted inventory article no longer exempts changed text from review. Automatic parsers and their coverage checks still run after reviewed continuity passes.

The refresh writes `artifacts/catalog-review/review.json` and `review.md`. GitHub Actions uploads them as `catalogue-source-review` for 30 days and adds a summary to the run. Reports contain source URLs, affected finding IDs, structured gate errors, full before/after text, the changed span, capture time, the Actions base commit when available, and failure triage. They are diagnostic evidence, not instructions or automatic approval. No issues or pull requests are posted automatically. The planned seven-day retention starts only once durable review manifests are published automatically.

Accepted baselines are installed with the catalogue only after all coverage checks and catalogue validation pass. Both files are committed by the workflow. Fetch or coverage failures leave the accepted files untouched. File-write failures attempt to restore both prior files and fail the run. Workflow concurrency prevents overlapping scheduled/manual refreshes.

## Reviewing a substantive change

1. Download the failed run's source-review artifact. Compare the accepted and fetched text and the official article, including CVEs, scope, affected/fixed builds, severity, mitigation and relevant links.
2. Update the source-backed advisory/parser and regression tests where required. Do not add a normalization rule that erases a meaningful security difference.
3. For an approved change, update the article's snapshot page-state fingerprint and saved baseline together using `createSecurityReviewBaseline`. If it has an informational policy fingerprint in `scripts/data/reviewed-security-advisories.json`, update that fingerprint and the baseline's `reviewedFingerprint` together. A missing baseline may be captured automatically only after the original gates pass.
4. Run the baseline tests, all relevant adapter/coverage checks, catalogue validation and application checks, followed by a live refresh. Confirm the generated diff, GitHub verification, refresh result and final public deployment.

The initial migration reconstructs four historical accepted texts with exact hash equality. Other articles acquire their first saved text only when the existing gates validate them. New wording rules require explicit source review and tests; the refresh never learns new aliases from untrusted article content.

## Repair foundation and current limits

The reviewed advisory definitions and observation specifications now live in `scripts/data/reviewed-security-advisories.json`. Maintained parsing, interpretation, schema validation, and acceptance rules remain in code. The migration parity fixture records the original export and merge-result hashes so this initial extraction can be checked without accessing live sources.

Two existing source decisions remain significant: KB4879's Updater fix is automatically deployed to connected appliances, and its independent component version is outside this product-build lookup, so the source is retained without an all-13.x vulnerability finding. The September 22 KB4902 mitigation review added post-upgrade credential rotation guidance while preserving the then-reviewed affected/fixed builds; the archived October 7 changes still require separate semantic repair.

Run `npm run test:catalog-repair` for offline evidence, schema, candidate, migration, and failure-family replay. The corpus includes the complete normalized October 7 before/after report and compact reconstructions of the 13 previously inspected failed runs. Older reconstructions prove triage behavior only; they are not full historical semantic repair examples. The summary explicitly marks live AI evaluation as not run. Additional semantic fixtures and adapters are still required before broader automatic acceptance.

To export evidence from a clean checkout at the failed run's exact commit:

```sh
npm run prepare:catalog-repair -- --report artifacts/catalog-review/review.json --run-id <failed-run-id>
```

New reports include `baseCommit` and `capturedAt`. For legacy reports, supply the actual `--base-commit <40-character SHA>` and `--captured-at <ISO timestamp>` from the archived run evidence. These identify the captured run; do not substitute the current commit for an older report. Local source edits must be committed before candidate preparation so its base is reproducible.

The version 1 proposal contract contains `schemaVersion`, `evidenceId`, `baseCommit`, and one `articles` entry for every changed article. Each entry has `articleId`, `kind` (`equivalent`, `vulnerability`, `informational`, or `classification`), `rationale`, exact `evidence` spans (`sectionId`, `start`, `end`, `quote`), and an `unresolved` string array. Offsets are JavaScript string indices. Legacy normalized reports have one whole-article section; they do not preserve vulnerability-section boundaries. The latter three variants currently identify changes requiring investigation; they cannot submit or apply new advisory records.

Pass a saved proposal with `--proposal <proposal.json>` to emit a review brief and a candidate under a unique `artifacts/catalog-repair/result-*` directory. The builder accepts only the existing article-specific wording/date equivalences, validates the base, policy, accepted text, source hashes, quote offsets, complete article inventory and review holds, and returns no candidate files if any article is blocked. Paths are fixed by maintained code. It never installs into the working checkout, merges a PR, publishes, calls an AI service, or treats quoted evidence as semantic proof. Candidate readiness still requires full catalog checks and a new live refresh before publication; its manifest lists those checks as not run.

Failed release-document discovery now makes at most two delayed refetches (three total attempts) of the affected endpoint when a valid response names the expected product but the exact parser finds no current document. Wrong-product responses, parser errors, malformed JSON and HTTP failures are not retried by this layer. Existing source-fetch HTTP retries remain unchanged.

Cloudflare setup uses the repository secret `CLOUDFLARE_WORKERS_AI_TOKEN` and repository variable `CLOUDFLARE_ACCOUNT_ID`. The provider, persistent usage budget, automatic PR/publication path, notifications, and trusted feedback intake are subsequent implementation stages. Saving credentials does not enable those stages. Review the implementation plan for their activation and correction requirements.
