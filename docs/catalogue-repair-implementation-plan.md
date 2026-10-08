# Intelligent catalogue repair implementation plan

Status: October 7 implementation is built and locally verified. The current source repair is published in PR #4. Bounded Workers AI, durable state/evidence, supported semantic adapters, exact-commit PR publication, ordinary-language feedback and scoped reverts are implemented. Live AI and isolated publication/correction trials are the remaining activation gates.

Build an automatic repair workflow for Veeam source changes. GitHub Actions will collect evidence, Cloudflare Workers AI will propose structured advisory updates, and repository code will validate and apply eligible repairs through a traceable pull request and publication process. Routine validated repairs proceed without waiting for Tyler to review each one. Tyler receives the approach, evidence, and outcome afterward and can request a correction or revert in ordinary language. Unsupported or uncertain repairs remain blocked with a specific investigation report.

The initial scope is triage of every catalog-refresh failure and validated data repairs for supported security article changes. Existing harmless-change handling and successful scheduled refreshes continue normally. The public site remains static. Parser repairs, additional supported products, and general autonomous code editing remain separate development work.

The current failure should be repaired separately using the existing source-review process; the automation project must not prolong the refresh blockage. Preserve its diagnostic evidence before accepting new baselines so it also becomes a regression case.

**Architecture and acceptance boundary**

The refresh retains its current validation and atomic installation of the catalog and accepted baselines. On a source-review failure it passes an evidence bundle to the proposal workflow. A source-review failure remains a failed refresh even when proposal generation succeeds.

Each bundle records the base commit, failed run, source URLs, fetch times, old and new article hashes, complete normalized article text, section boundaries, and every structured coverage finding. Article text and model responses are untrusted data. Fetching uses the existing source policy and approved official hosts; the model has no tools, credentials, or authority to execute instructions from article text.

The model returns a typed proposal with separate variants for vulnerability records, informational articles with no CVEs, and article classification changes, including new and out-of-scope articles. Vulnerability records contain CVE, product, affected and fixed versions, severity, applicability conditions, mitigation, and exact evidence spans for each proposed field. Every variant must account for observed CVEs and identify unresolved wording. Evidence spans must exist in the captured source and belong to the relevant vulnerability section. Matching words alone does not establish the correct relationship between a product, CVE, and build.

The validator applies maintained product mappings, version rules, coverage rules, and change policy. Unsupported relationships remain unresolved. Neither a model confidence score nor agreement between two model calls authorizes acceptance. Model output alone cannot authorize expanded product scope or changed ignored-CVE policy. The model cannot modify test expectations or rewrite its validator.

Proposed advisory data, article classifications and route baselines, page-state fingerprints, policy fingerprints where applicable, and accepted-text baselines are updated together only in an isolated candidate checkout. Existing refresh and catalog checks then run against that candidate. An eligible repair may merge and publish after those checks and the automation policy pass; individual human review is not a prerequisite. Final merge validation must ensure that the source evidence and base commit are still current and that no change request blocks the repair. Branch protection remains enforced; activation must explicitly configure a compatible policy rather than silently bypassing it.

**Delivery milestones**

| Order | Deliverable | Completion gate |
| --- | --- | --- |
| 1 | Evidence corpus and offline evaluation harness | Historical failures and deliberately unsafe changes have independently reviewed expected outcomes; replay requires no network or AI credentials. |
| 2 | Data contract and deterministic candidate builder | Migrated existing records preserve catalog behavior; malformed, incomplete, unsupported, or unrelated changes are rejected. |
| 3 | Bounded Cloudflare AI extraction | Recorded-response tests pass, then a small live benchmark measures correctness, abstention, token usage, and latency. |
| 4 | GitHub repair and publication workflow | A controlled eligible change is validated, merged, published, and reported to Tyler with a skim brief and durable evidence; repeats create no duplicate PR or notification. |
| 5 | Review and correction loop | Ordinary feedback on a repair produces a linked correction or scoped revert with renewed validation and an outcome notification. |
| 6 | Expand supported repair classes | Historical and held-out results justify each additional class; unresolved source or parser behavior continues to produce an investigation report. |

**Milestone 1 establishes what correct means**

Capture the October 7 KB4902, KB3103, and KB3108 comparisons, plus the newly discovered KB4934 source from the same report. Include the earlier KB4902 mitigation addition and established harmless naming/date changes. Store compact fixtures with source provenance and human-reviewed expected mappings; remove unrelated page furniture.

The historical suite must also cover the July KB2680 HTTP 403 refusals; the September 3 empty release-document discovery response; KB4857 informational changes with zero CVEs; the KB4236 article-route continuity failure; the August KB3108, KB3109, and KB4852 content changes; and the September product-alias/scope changes. Include the earlier new-KB classification repairs, Salesforce KB4926 as out-of-scope, and Related Articles contamination of product/CVE detection. Preserve raw boundary examples needed to test page-furniture removal. Replay every historical failure family and repeated identical failures before the first release.

Add adversarial examples for a changed build digit, negation such as "not affected," removed CVEs, severity reductions, changed mitigation, multiple products in one article, misleading related articles, truncated fetches, and instructions embedded in source text. Separate prompt-development examples from held-out cases. Model-produced answers must never become their own expected results.

Report field-level correctness, missing CVEs, incorrect product/build assignments, unsupported claims, appropriate abstentions, and false eligibility for automatic publication. Zero false eligibility on the maintained suite is required for promotion but does not prove universal correctness.

**Milestone 2 makes repairs data driven**

Introduce versioned schemas for evidence, proposals, review results, and the supported declarative advisory records. Migrate only the relevant data from `scripts/lib/reviewed-security-advisories.mjs`; keep parsing and interpretation functions in maintained code. Avoid a wholesale rewrite of the catalog pipeline.

Implement an offline candidate builder that accepts a bundle and proposal, verifies hashes and evidence, checks semantic relationships supported by existing adapters, and emits a bounded data diff. Known out-of-scope products retain their reviewed treatment. A new exception to product or ignored-CVE policy needs explicit justification and policy support; it cannot be silently accepted as an ordinary data repair.

The approved output allowlist consists of the migrated advisory data, the catalog snapshot, accepted baselines, and a small evidence manifest. The model cannot choose paths. Unknown changed security wording prevents the proposal being labelled complete. Verify existing lookup and urgency behavior, including affected-build boundaries and preservation of existing mitigation.

**Milestone 3 adds AI with explicit limits**

Call Workers AI directly from the GitHub job through a small provider module. Start the benchmark with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, which supports JSON mode. Select the production model using the held-out results, not its name or a confidence claim. Validate returned JSON independently; malformed, truncated, refused, unavailable, or unsupported answers produce an unresolved result.

Send changed vulnerability sections with enough surrounding product and version context. Account for the rest of the article deterministically; do not silently truncate evidence to fit a token limit. Cache successful extraction results by full evidence hash, model ID, prompt version, schema version, and validator version. Revalidation still runs when applying cached output.

Initial limits: six requests per UTC day, including retries, at most 8,000 input tokens and 2,000 output tokens per request, and a conservative 5,000-neuron daily application budget. Oversized bundles require deliberate chunking or an unresolved result. Reserve the maximum request cost before sending it and retain that reservation after an ambiguous timeout. Serialize callers and persist reservations across runs in a small bot-owned Git notes ref outside deployment branches. If usage state cannot be read, disable inference for that run. Changes to model pricing require updating the budget calculation.

The first implementation should make at most one retry for a transient inference failure. Limit model calls to scheduled trusted runs; manual dispatch defaults to replaying saved evidence without inference. Any enabled live dispatch must use the same daily ledger. Paid fallback models are excluded.

**Milestone 4 connects the existing workflows**

Extend `refresh-catalog.yml` with a failure classifier and a proposal path for recognized review failures. Distinguish transient retrieval, empty release-document discovery, HTTP access refusal, reviewed-content changes, article-classification changes, parser defects, and missing diagnostic evidence. Retain existing bounded network retries. Add at most two delayed refetches of affected discovery endpoints for a valid response that lacks required documents, rerunning the exact parser and full completeness check. A persistent empty result or mismatched product remains blocked. HTTP 403 gets a diagnostic escalation, with no model-driven access workaround. Parser defects receive a reproducible development report. Generate and validate proposals using trusted repository code in an isolated checkout. Give only the publication job permission to create a bot branch and PR; keep the Cloudflare credential in the inference job.

Use `codex/catalog-repair-<bundle-hash>` for a proposal branch and deduplicate by base/evidence/policy identity. Reuse an existing bot-owned PR when appropriate; do not overwrite human edits. When main or source content changes, mark the earlier proposal stale and regenerate after revalidation. Unchanged source evidence must not cause a new daily inference request merely because the failed run ID changed.

A complete PR describes the source change, product/CVE/build mappings, evidence links, uncertainty, exact candidate commit, and validation results. An incomplete proposal produces an action-needed issue containing the same review brief and the blocking evidence. Neither outcome may leave the owner with only a failed Actions run to inspect.

**Notification and review contract**

Use GitHub as the durable review inbox. Label repair PRs and investigation issues `catalog-review`, with a separate state such as `applied-awaiting-review`, `needs-investigation`, `changes-requested`, `stale`, or `corrected`. Keep each implementation PR as the code audit trail and maintain a linked review issue for the notification, discussion, and correction lifecycle after merge. Assign the verified owner account and mention that account once in the initial actionable brief. A pending post-implementation review does not block an eligible repair's merge or publication; a specific change request blocks further automatic acceptance for the disputed item until it is resolved.

GitHub assignments, mentions, and review requests support the notification inbox; email and mobile delivery depend on the owner's settings. Use the linked issue for review after merge, without depending on requesting a formal PR review after a PR is already merged. Activation must verify the chosen notification route and a controlled end-to-end delivery test, including that its link opens the correct brief. An API success or a workflow summary does not prove delivery. A failed notification action remains an operational failure and must be retried within a small limit and surfaced on the workflow; retain an undelivered event for a later retry. [GitHub notifications](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications)

Begin every PR or issue with a brief that takes about a minute to skim:

| Field | Required content |
| --- | --- |
| What changed | Article and product, previous interpretation, new source facts, and practical catalog impact. |
| Approach proposed or taken | The actual data or logic change, why it follows from the source, and the publication state. Clearly distinguish proposed from already deployed work. |
| Evidence | Relevant before/after excerpts, official links, source hashes, and the exact candidate commit. |
| Verification | Checks actually run, their outcome and links, checks not run, and any remaining uncertainty. |
| Review or action | Skim the implemented approach, flag a correction, or resolve a named blocker. State whether the repair is applied, awaiting publication, or blocked. |

The deeper review material includes the exact diff, structured proposal and validator decisions, all affected CVE/product/build relationships, source snapshots already retained by the baseline process, model/prompt/schema versions, rejected alternatives when they explain a tradeoff, and a rollback description. Store concise Markdown and JSON review manifests at a versioned path such as `docs/catalog-reviews/<bundle-id>/` on the proposal branch and link to them by commit SHA. Keep the material required to assess the decision available after short-lived Actions artifacts expire; exclude credentials and unnecessary logs. Generate the skim brief and machine-readable manifest from the same record and check that they agree.

Notify on the first actionable result, a materially changed approach, newly failed validation, and resolution/publication. Combine implementation and publication into one outcome notification when possible. An unchanged daily failure updates internal observation state without generating another comment, review request, or PR. After requested changes are addressed, update the brief and notify Tyler of the correction. A new candidate commit or changed source invalidates earlier review evidence; identify the new version and rerun validation. Track `notifiedAt`, the notified source/candidate identity, and the latest decision so scheduled reruns do not create noise. An unanswered post-implementation review remains visible as unreviewed; it neither grants new authority nor revokes the standing authorization for eligible repairs.

For optional Dot review, Tyler can share the PR link directly or later assign Dot responsibility for open `catalog-review` items. Dot must be able to read the connected GitHub repository, the pinned diff/manifests, and supporting sources. Verify those capabilities in Tyler's actual environment before relying on them; public repository access does not establish that every attached artifact is readable. A durable Markdown manifest also supports a manual handoff when a connector cannot read an artifact.

The review task is to independently assess whether the evidence supports the proposed or implemented product/build mappings, exclusions, mitigation, and chosen repair, including whether a simpler or safer approach exists. Its result should identify the reviewed commit and source hashes, give a supported/changes-needed/insufficient-evidence verdict, list concrete findings and missed cases, and state what it could not verify. Reading the bot's brief or observing passing tests alone is insufficient. Dot's review is advisory and does not expand publication authority. Tyler can use its findings to redirect a repair, or authorize Dot to submit change requests on his behalf.

Official OpenAI documentation supports giving a dot ongoing responsibilities and using connected apps, including GitHub, subject to available permissions. Automated GitHub event delivery into Dot is not assumed. A user-initiated link review works as the first integration; a scheduled or event-driven review requires separate setup, confirmation, and a verified run. Dot usage belongs to Tyler's ChatGPT account and is separate from the GitHub/Cloudflare free-tier budget. [Dot responsibilities](https://learn.chatgpt.com/docs/dots/getting-started), [Dot app access](https://learn.chatgpt.com/docs/dots/computers-and-apps)

Before activation, test six notification scenarios: one applied repair, one incomplete repair, one repeated unchanged failure, one correction requested after publication, one successful correction or revert, and one notification delivery failure followed by recovery. Confirm that human and Dot reviewers can identify the exact reviewed version and that missing access results in an explicit incomplete review.

**Flagging and correcting a repair**

Ordinary feedback such as "change this," "that assumption is wrong," or "use a different approach" is sufficient. No command syntax or special phrase is required. Accept feedback from Tyler in the linked GitHub issue or PR, or from an explicitly authorized reviewer. Chat feedback is acted on by the assistant receiving it and recorded against the same repair; GitHub is not assumed to observe ChatGPT conversations automatically. If the target repair is ambiguous, identify the likely candidates and ask which one before modifying an unrelated repair.

Persist the repair ID, reviewed commit, request author, requested change, and lifecycle state. A scheduled intake step reads new comments since its cursor and handles missed events; a GitHub comment event or explicit workflow dispatch may provide faster processing. Verify the author against a configured trusted identity before treating a comment as a change request. Public comments, source text, bot summaries, and model output cannot authorize changes. Do not execute comment text as shell code or run untrusted PR code in a privileged comment-triggered workflow.

Mark the disputed repair `changes-requested` and record a hold so the normal refresh cannot immediately recreate a rejected result. A clear correction within supported data rules can proceed automatically with the same evidence and validation requirements. An unsupported approach becomes a focused implementation task. Ambiguous wording or inadequate source evidence gets a precise clarification request; explicit feedback is not an excuse to invent vulnerability facts.

Implement the correction through a linked follow-up PR and notify Tyler with the revised approach, checks, resulting commit, and publication status. Record the prior repair as superseded or reverted and clear its hold only when the correction has been reconciled with refresh policy. A requested revert must preserve newer unrelated work and restore a mutually consistent advisory, route, snapshot, and baseline state. If a safe revert cannot be isolated, report that constraint and prepare the necessary corrective patch. Add accepted corrections to regression cases so the same rejected approach is not repeatedly proposed.

Handle GitHub's token-trigger behavior explicitly. Bot pushes using `GITHUB_TOKEN` do not start ordinary push workflows, and bot-created PR checks can require approval. Add a trusted `workflow_dispatch` verification route for the exact candidate commit, or use a narrowly scoped GitHub App if required by branch protection. Test that checks attach to the candidate SHA and satisfy the actual merge rules; a successful job on a different commit is insufficient. Avoid introducing a broad personal access token as the default solution. [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

**Milestones 5 and 6 establish operating confidence**

Begin with offline evaluation and a controlled end-to-end run, then enable automatic application for the supported classes that meet all deterministic checks. Observe at least ten distinct substantive bundles across those classes, with review allowed after implementation; repeated identical daily failures do not count. This is an observation target, not a prerequisite for Tyler to approve every change or a statistical guarantee. Preserve reviewer corrections as labelled evaluation cases and hold out new cases before revising prompts.

Encode the initial publication policy explicitly: existing harmless equivalences, additions to already supported advisory structures whose CVE/product/build relationships are completely validated, and informational dependency-note updates with unchanged supported scope and no new vulnerability semantics. Each class needs historical and held-out tests before activation. Initially block CVE removals, risk reductions, changed mitigation, changed product/classification scope, conflicting official sources, unaccounted text, and parser changes when the validator cannot establish a supported repair. Send a concrete investigation report for those cases. Extend the supported policy through tested code changes rather than allowing the model to enlarge its own authority. Refresh the official evidence immediately before publication and revalidate if it changed.

After every merge permitted by the policy, verify GitHub checks, the live refresh, any workflow-generated snapshot commit, the corresponding Cloudflare deployment, and the public site's catalog timestamp and intended advisory behavior. Provide separate toggles for AI proposal generation and automatic application without disabling normal refreshes or bypassing holds on disputed repairs. Reverting an accepted repair must restore the associated advisory data, route state, snapshot, and baselines together, followed by the normal validation gates.

**Planned implementation surfaces**

| Surface | Responsibility |
| --- | --- |
| `scripts/lib/security-review-baselines.mjs` and `scripts/lib/security-feed-coverage.mjs` | Preserve existing acceptance gates; expose complete evidence and unresolved changes. |
| `scripts/lib/reviewed-security-advisories.mjs` and new data under `scripts/data/` | Load validated declarative records while preserving current behavior. |
| New `scripts/lib/catalog-repair-*.mjs` modules | Evidence/schema validation, AI adapter, budget/cache handling, candidate building, publication policy, trusted feedback intake, and correction holds. |
| New `scripts/evaluate-catalog-repair.mjs`, tests, and fixtures | Offline replay, adversarial tests, and measured live evaluation. |
| `.github/workflows/refresh-catalog.yml`, `.github/workflows/verify.yml`, and a narrowly scoped feedback workflow | Failure handoff, isolated validation, deduplicated PR/issue creation, policy-controlled publication, exact-commit verification, and comment intake. |
| `docs/catalogue-source-review.md` | Operator setup, decision rules, review-after-implementation behavior, ordinary-language change requests, disablement, and recovery. |

Prefer the repository's Node scripts and existing test style. Run focused checks while developing; run the full Verify set and candidate live refresh at a durable implementation gate. Network/model evaluation is a separate opt-in check so ordinary PR tests remain repeatable and free of credentials.

**Free tier and activation requirements**

The repository is public. Standard GitHub-hosted Actions runners are free for public repositories; artifact storage has separate plan limits. Retain compact diagnostic artifacts for seven days, with approved fixtures and evidence manifests in Git, and avoid storing model weights. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Workers AI provides 10,000 free neurons per day. At the published Llama 3.3 70B rates, six requests of 8,000 input and 2,000 output tokens cost approximately 3,738 neurons. This is a budget example, not measured workload usage. The account allowance is shared with other AI workloads. On Workers Free, exceeding the allowance fails requests; an existing Paid account requires checking total account usage as well as this application's cap. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

The deployed site uses Cloudflare Workers Builds, whose Free plan includes 3,000 build minutes per month. State and blocked evidence use Git notes refs, verified not to trigger builds. Deploy only meaningful catalog changes and validated repairs; proposal previews still consume build minutes. [Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)

Live activation needs a Cloudflare account ID and an API token scoped to Workers AI, stored as GitHub configuration and a secret respectively. Confirm the repository settings and token permissions for PR/issue creation and policy-controlled merging, actual branch-protection requirements, trusted reviewer identities, and notification delivery. A GitHub App is a fallback if the existing token/branch rules cannot support the intended flow. The REST API avoids adding a Worker server or database. [Workers AI REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)

Use these repository-level GitHub Actions configuration names for implementation:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_WORKERS_AI_TOKEN` | A token with Workers AI Read and Edit permissions, scoped to the intended Cloudflare account. |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | That Cloudflare account's ID, not a zone ID. |

Create the token through Cloudflare Workers AI's Use REST API setup and enter it directly into the repository's Actions secrets; do not place it in chat, source files, or logs. Saving configuration does not activate the proposed automation. The repository's Allow GitHub Actions to create and approve pull requests setting must permit PR creation when using `GITHUB_TOKEN`; retain the restricted default token permissions and declare required permissions per job. This setting does not replace branch protection or independent candidate validation. Verify authentication through a trusted workflow after the provider implementation is ready.

The implementation now includes the offline corpus, validated data migration, bounded provider, isolated semantic candidate builder, publication workflow and feedback/revert path. Supported initial semantic classes remain deliberately narrow; broader source interpretation is held for investigation. Local gates pass. Live authentication, exact-commit workflow execution, preview publication, notification delivery and correction trials must be recorded before enabling routine automatic application.
