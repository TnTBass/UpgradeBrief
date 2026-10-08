# Catalog repair activation validation

Implementation: [PR #3](https://github.com/TnTBass/UpgradeBrief/pull/3), with live-trial fixes in [PR #6](https://github.com/TnTBass/UpgradeBrief/pull/6). The concurrent October source updates were independently reviewed and published in [PR #4](https://github.com/TnTBass/UpgradeBrief/pull/4).

## Verified behavior

- The complete maintained gate runs 33 checks, including 83 application tests, source adapters, repair safety cases, catalog validation, TypeScript, and the production build. GitHub ran the same gate on the implementation commits.
- Cloudflare serves a catalog health record containing the deployed commit, canonical catalog hash, and generation time. Publication waits for the matching record.
- Durable budget and control state are stored in a Git notes ref. Actual state writes produced no Workers Builds check runs, avoiding a site build for each ledger update.
- GitHub delivered bot mentions into the owner's notification inbox for the benchmark failure and interrupted isolated trial. This verifies inbox delivery; email and mobile delivery depend on personal GitHub settings.

## Workers AI evaluation

The benchmark uses a source-derived reconstruction of a new CVE section with already reviewed product applicability and fixed builds. It is an integration smoke test, not a statistical accuracy estimate or proof of historical coverage.

| Run | Result | Measured use |
| --- | --- | --- |
| [37720044443](https://github.com/TnTBass/UpgradeBrief/actions/runs/37720044443) | Rejected: incomplete severity quote and explicit version exclusion marked unresolved. | 54.88 neurons |
| [37721660556](https://github.com/TnTBass/UpgradeBrief/actions/runs/37721660556) | Schema descriptions alone did not correct the extraction; rejected again. | 54.88 neurons |
| [37721837394](https://github.com/TnTBass/UpgradeBrief/actions/runs/37721837394) | Prompt version 4 passed: all eight evidence fields matched, no CVEs missing, no unresolved claims. | 10.746 seconds; 543 input and 205 output tokens; 56.47 neurons |

The validator was not relaxed. A rejected live response remains a regression fixture. The durable ledger retained conservative reservations of 498, 512, and 523 neurons for these calls. Routine inference is capped at six requests per UTC day, including retries, and 5,000 reserved neurons; Cloudflare's account allowance is shared with other workloads.

## Isolated publication and correction trial

The trial reconstructs a dependency note changing from 8.0.7 to the current official 8.0.8 on `codex/catalog-repair-trial`. It cannot seed production data. Trial identities and source holds are isolated from production.

The first [trial run](https://github.com/TnTBass/UpgradeBrief/actions/runs/37720084795) created [PR #7](https://github.com/TnTBass/UpgradeBrief/pull/7), then stopped because an API path guard rejected GitHub's valid comparison separator. The regression fix retains traversal protection. PR #7 is closed and marked stale; its evidence is preserved.

The repeated [trial run 37722116043](https://github.com/TnTBass/UpgradeBrief/actions/runs/37722116043) passed. It independently refreshed current sources, ran the complete gate, created [PR #8](https://github.com/TnTBass/UpgradeBrief/pull/8), dispatched [exact-commit verification](https://github.com/TnTBass/UpgradeBrief/actions/runs/37723296314), and merged to the trial branch. Cloudflare preview verification matched commit `6fbbe8267ca45d96b2ffa6bef11ac307dd5fa029` and catalog hash `373fbc652fce0850a44df81d7ab1023968334a112a16d9c4cf39148126f22e3a`. The owner inbox received the bot mention for PR #8. Production retained commit `bf34a8403d2e6ac2ecedc59b1b862d9b70538214` and its original catalog hash.

The ordinary comment "Please take a different approach here." was processed by [feedback run 37723494630](https://github.com/TnTBass/UpgradeBrief/actions/runs/37723494630). It held the original repair and only `trial:kb4857`, then created linked [issue #9](https://github.com/TnTBass/UpgradeBrief/issues/9).

A plain "Please revert this." request on that linked issue reached the original repair. [Feedback run 37723589107](https://github.com/TnTBass/UpgradeBrief/actions/runs/37723589107) created and merged [scoped revert PR #10](https://github.com/TnTBass/UpgradeBrief/pull/10), after [exact-commit validation](https://github.com/TnTBass/UpgradeBrief/actions/runs/37723644445). Its Cloudflare preview matched commit `17c471ea172ee9d288760ecbacfbc1b838af236a` and catalog hash `b6c4f2a8d6ec57c56c45b6af7613381f6c04bc7773bf50fa10e4ea76d7bde25b`. The original repair is recorded as reverted, with the trial source hold retained. Production's catalog hash remained unchanged throughout both trials.

"Looks good" on PR #10 was recorded as reviewed by [feedback run 37723987888](https://github.com/TnTBass/UpgradeBrief/actions/runs/37723987888). The test follow-up issue is closed. The final brief-status helper was exercised against the completed trial records: GitHub read-back confirmed "corrected" on PR #8 and "reviewed" on PR #10, while the source hold remained intact.

## Scope and review

Initial automatic acceptance supports maintained metadata equivalence, a known zero-CVE dependency-note class, and narrowly specified additions to an existing single-product VBR advisory with unchanged reviewed applicability and fixes. Unknown semantics, changes to existing findings, ambiguous relationships, product scope changes, and incomplete evidence stop for investigation.

The historical regression corpus covers known failure families, including retrieval, parser, coverage, applicability, and route failures. Some fixtures are explicitly reconstructed; this does not claim every previous semantic source revision can now be repaired automatically.

Each repair PR is the durable review conversation, with a concrete change summary, approach, exact commit, source evidence, and checks. An unsupported change request creates a linked implementation issue. Normal owner comments request changes; a clear revert request uses the scoped correction path. A hold survives issue closure or a plain approval until the underlying policy is reconciled. Dot can review the supplied link; automatic delivery into a private ChatGPT conversation is not configured.

## Activation status

The live publication, notification, ordinary-comment, linked-issue, and scoped-revert trials passed. Final normal refresh verification is in progress. Both production activation variables remain false; automatic approval review rejected their activation pending more explicit authorization of the persistent production settings.
