# Catalogue source review

The refresh keeps accepted article text in `scripts/data/security-review-baselines.json`, outside the browser bundle. Each entry has the original normalized article text, its content fingerprint, a comparison fingerprint, and (for informational articles) the independently reviewed policy fingerprint. Git history retains earlier accepted text.

The comparison permits only:

- Existing HTML/whitespace normalization and page-furniture exclusions.
- A change to the labelled `Last Modified` date in the article metadata. Publication dates and dates in security guidance remain significant.
- The article-specific naming rules in `scripts/lib/security-review-baselines.mjs`. These were proved against the exact accepted hashes on September 23, 2026: KB4261 Azure metadata, KB4374 Google Cloud wording, KB4712 AWS/Google Cloud wording, and KB4924 AWS metadata. These rules are not global product equivalences.

An equivalent comparison reconciles only the content fingerprint for that run. It does not override product scope, route/classification continuity, expected CVEs, build/version interpretation, or downstream security coverage. Unknown wording, including changed mitigation with unchanged CVEs, still blocks publication. Missing or inconsistent baselines cannot authorize a changed article.

The live refresh explicitly disables the former inventory-CVE-expansion exception: adding CVEs to a fingerprinted inventory article no longer exempts changed text from review. Automatic parsers and their coverage checks still run after reviewed continuity passes.

The refresh writes `artifacts/catalog-review/review.json` and `review.md`. Actions keeps these diagnostics for seven days. Reports include complete before/after text, source URLs, hashes, capture time, the actual checked-out commit, and structured failures. Failed refreshes hand off to the Catalog repair workflow; failure remains visible on the original run. Repair PRs and investigation issues link durable evidence in Git.

Accepted baselines are installed with the catalogue only after all coverage checks and catalogue validation pass. Both files are committed by the workflow. Fetch or coverage failures leave the accepted files untouched. File-write failures attempt to restore both prior files and fail the run. Workflow concurrency prevents overlapping scheduled/manual refreshes.

## Reviewing a substantive change

1. Download the failed run's source-review artifact. Compare the accepted and fetched text and the official article, including CVEs, scope, affected/fixed builds, severity, mitigation and relevant links.
2. Update the source-backed advisory/parser and regression tests where required. Do not add a normalization rule that erases a meaningful security difference.
3. For an approved change, update the article's snapshot page-state fingerprint and saved baseline together using `createSecurityReviewBaseline`. If it has an informational policy fingerprint in `scripts/data/reviewed-security-advisories.json`, update that fingerprint and the baseline's `reviewedFingerprint` together. A missing baseline may be captured automatically only after the original gates pass.
4. Run the baseline tests, all relevant adapter/coverage checks, catalogue validation and application checks, followed by a live refresh. Confirm the generated diff, GitHub verification, refresh result and final public deployment.

The initial migration reconstructs four historical accepted texts with exact hash equality. Other articles acquire their first saved text only when the existing gates validate them. New wording rules require explicit source review and tests; the refresh never learns new aliases from untrusted article content.

## Automatic repair and review

The reviewed advisory definitions and observation specifications live in `scripts/data/reviewed-security-advisories.json`. Maintained code owns parsing, product scope, validation, paths and publication policy. AI never edits code or chooses output paths.

Supported automatic candidates are maintained metadata/naming equivalences; dependency-version increases in the known zero-CVE KB4857 structure with every other word unchanged; and additions to an existing single-product VBR advisory whose affected-product text, deployment conditions and fixed-build text exactly match a previously reviewed CVE section. Existing vulnerability sections must remain unchanged. New or mixed-product classifications, ignored-CVE changes, removed CVEs, reduced existing risk, changed mitigation, unknown wording and parser changes produce an investigation. Whole-article comparison accounts for all text; the semantic adapter separately proves the new section boundaries and relationships.

Workers AI extracts exact field quotes for supported vulnerability additions. Independent code must agree with every required field and the complete CVE inventory. There is no confidence threshold, model self-approval, arbitrary code execution, paid fallback, or online training from unreviewed feedback. The historical corpus contains four full October articles and reconstructions of thirteen failure families for triage. Source-derived semantic cases are explicitly labelled reconstructions. Passing them does not prove universal correctness.

Run `npm run verify:catalog-repair` for the complete local gate. `prepare:catalog-repair` remains an offline exporter: it writes a unique result directory and never installs a candidate. Its JSON result always says publication still requires further checks.

The live publisher reconstructs the candidate independently in a verified isolated worktree, runs a full live refresh and the complete local gate, refetches changed articles, opens a PR with an immutable manifest, and dispatches Verify for that exact candidate commit. It checks fresh trusted feedback before merging. A non-forced Git ref update publishes a merge commit with the tested candidate tree and exact observed base; concurrent main changes are rejected and branch protection is never disabled. Cloudflare must serve the expected commit and catalog hash in `catalog-health.json` before publication is reported as verified.

## Configuration and free-tier controls

| GitHub Actions setting | Purpose |
| --- | --- |
| Secret `CLOUDFLARE_WORKERS_AI_TOKEN` | Workers AI Read/Edit token scoped to the account. Present only in inference/benchmark steps. |
| Variable `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier. |
| Variable `CATALOG_REPAIR_AI_ENABLED=true` | Permit bounded AI calls after scheduled refresh failures. Missing/false disables inference. |
| Variable `CATALOG_REPAIR_AUTO_APPLY=true` | Permit eligible verified candidates to merge before human review. Missing/false leaves a validated PR. |

The provider permits at most six calls per UTC day, including retries, 8,000 conservatively bounded input tokens and 2,000 output tokens per call, and 5,000 reserved neurons daily. It reserves maximum cost durably before sending a request, never refunds ambiguous failures, caches valid extraction by evidence/model/prompt/schema/validator identity, and retries a transient failure at most once. Missing or conflicting state stops inference. These are application limits; the account's free AI allowance is shared with other workloads.

State lives at `refs/notes/catalog-repair-state`; blocked evidence gets immutable `refs/notes/catalog-repair-evidence/<hash>` refs. Fast-forward writes prevent lost concurrent updates. Notes refs were verified not to start Cloudflare builds. This uses Workers Builds, not Pages: the documented Free allowance is 3,000 build minutes monthly. No Worker service or database was added. [Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)

The existing repository configuration permits Actions PR creation and has no main branch protection. If protections are introduced, configure compatible checks/permissions; failures must remain blocked. `Catalog repair verified` is attached to the candidate SHA by a trusted dispatch workflow because ordinary bot pushes do not start push workflows. Candidate code is executed only after its changes are proved to be allowed data/manifest files against current trusted main.

## Reviewing and correcting

Use the `catalog-review` GitHub inbox. Briefs explain what changed, the approach, checks and unresolved issues, with source hashes, exact commits and complete evidence. Bot comments mention Tyler once per meaningful outcome. Comments are read back and deduplicated; pending notifications and publication status are retried by feedback intake. A recorded comment is not proof that an email or device notification arrived.

A normal comment such as “that assumption is wrong” or “use a different approach” is a change request. No special phrase is required. The configured trusted identity is Tyler's immutable GitHub user ID 1081294. Public and bot comments cannot authorize repairs. Adding another reviewer, including a Dot identity, requires an explicit maintained policy change. PR review requests and inline comments are also checked by the scheduled intake. Comment events give fast intake; the half-hour scan catches missed events. Jobs share one control-state concurrency group, while exact candidate verification runs separately.

A trusted concern holds the repair and its articles. A clear “Please revert this” request creates a linked scoped revert, preserving newer unrelated work and refusing overlapping security changes. It restores advisory, route, page-state and baseline data together, reruns the complete local gate, verifies the exact commit and deployment, and reports the outcome. It deliberately retains the source hold: running live refresh during the revert would recreate the disputed change. A different or ambiguous approach produces a linked implementation issue with the exact feedback and constraint. Closing an issue or saying “approved” does not silently clear an unresolved source hold. Reconcile the corrected policy and regression case before clearing it through the state store.

Chat feedback is handled by the receiving assistant and linked to the repair; GitHub cannot observe private ChatGPT chats. Dot can independently review a linked manifest/commit, but automated delivery into Dot is not configured. Ask it for a supported/changes-needed/insufficient-evidence verdict, exact reviewed hashes and concrete missed cases. Missing source or repository access must be reported rather than inferred as approval.

## Operator trials and recovery

The Catalog repair dispatch defaults to offline `replay`. `benchmark` requires explicit `allow_live_ai=true` and uses the same durable budget. `repair` fetches current official sources and prepares a repair only if they fail review. Manual AI calls require the explicit input even when scheduled inference is enabled.

`trial` seeds a clearly labelled reconstructed dependency-note change on `codex/catalog-repair-trial`, exercises the normal candidate/verification/merge path there, and verifies the Cloudflare preview URL returned by its build check. Trial evidence identities and source holds are isolated from production. Production main is not seeded or changed. An existing different trial branch is preserved rather than reset.

To pause new automatic application, set `CATALOG_REPAIR_AUTO_APPLY=false`; set `CATALOG_REPAIR_AI_ENABLED=false` to stop scheduled inference as well. Ordinary refresh and feedback remain available. Explicit trusted revert requests still authorize corrections. Do not reset or recreate a missing usage ledger to bypass its daily budget; recover the existing notes ref/history. Durable evidence and PRs remain reviewable after diagnostic artifacts expire.
