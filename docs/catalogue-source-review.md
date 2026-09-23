# Catalogue source review

The refresh keeps accepted article text in `scripts/data/security-review-baselines.json`, outside the browser bundle. Each entry has the original normalized article text, its content fingerprint, a comparison fingerprint, and (for informational articles) the independently reviewed policy fingerprint. Git history retains earlier accepted text.

The comparison permits only:

- Existing HTML/whitespace normalization and page-furniture exclusions.
- A change to the labelled `Last Modified` date in the article metadata. Publication dates and dates in security guidance remain significant.
- The article-specific naming rules in `scripts/lib/security-review-baselines.mjs`. These were proved against the exact accepted hashes on September 23, 2026: KB4261 Azure metadata, KB4374 Google Cloud wording, KB4712 AWS/Google Cloud wording, and KB4924 AWS metadata. These rules are not global product equivalences.

An equivalent comparison reconciles only the content fingerprint for that run. It does not override product scope, route/classification continuity, expected CVEs, build/version interpretation, or downstream security coverage. Unknown wording, including changed mitigation with unchanged CVEs, still blocks publication. Missing or inconsistent baselines cannot authorize a changed article.

The live refresh explicitly disables the former inventory-CVE-expansion exception: adding CVEs to a fingerprinted inventory article no longer exempts changed text from review. Automatic parsers and their coverage checks still run after reviewed continuity passes.

The refresh writes `artifacts/catalog-review/review.json` and `review.md`. GitHub Actions uploads them as `catalogue-source-review` for 30 days and adds a summary to the run. Reports contain source URLs, affected finding IDs, structured gate errors, full before/after text, and the changed span. They are diagnostic evidence, not instructions or automatic approval. No issues or pull requests are posted automatically.

Accepted baselines are installed with the catalogue only after all coverage checks and catalogue validation pass. Both files are committed by the workflow. Fetch or coverage failures leave the accepted files untouched. File-write failures attempt to restore both prior files and fail the run. Workflow concurrency prevents overlapping scheduled/manual refreshes.

## Reviewing a substantive change

1. Download the failed run's source-review artifact. Compare the accepted and fetched text and the official article, including CVEs, scope, affected/fixed builds, severity, mitigation and relevant links.
2. Update the source-backed advisory/parser and regression tests where required. Do not add a normalization rule that erases a meaningful security difference.
3. For an approved change, update the article's snapshot page-state fingerprint and saved baseline together using `createSecurityReviewBaseline`. If it has an informational policy fingerprint in `reviewed-security-advisories.mjs`, update that fingerprint and the baseline's `reviewedFingerprint` together. A missing baseline may be captured automatically only after the original gates pass.
4. Run the baseline tests, all relevant adapter/coverage checks, catalogue validation and application checks, followed by a live refresh. Confirm the generated diff, GitHub verification, refresh result and final public deployment.

The initial migration reconstructs four historical accepted texts with exact hash equality. Other articles acquire their first saved text only when the existing gates validate them. New wording rules require explicit source review and tests; the refresh never learns new aliases from untrusted article content.
