# Product refresh isolation — 2026-10-30

Implementation: [PR #24](https://github.com/TnTBass/UpgradeBrief/pull/24).

The refresher validates four initial groups: VBR with Enterprise Manager, ONE with VRO, VSPC, and VB365. Each validator receives an isolated copy of the accepted catalog and a collector that returns the same bytes to every consumer. Changed shared security evidence joins its consumers. Changes to parser or review policy, and shared global dataset revisions, conservatively join all affected products.

Global security-feed discovery and classification, VSPC inventory continuity, KEV completeness and lifecycle coverage must pass before transaction validation. Unknown source scope or an unclassified new CVE in a failed transaction blocks the composite. Existing per-CVE, applicability, fix-boundary, source-continuity and VSPC official-record gates remain in the adapters.

Schema 2 records the assembly time separately from each product's successful validation time. The compatibility timestamp is the oldest product validation. A failed transaction retains its entire partition, accepted evidence and original validation time. Product hashes bind source revisions and citation definitions. Fresh observations are separate from accepted evidence. A complete refresh is compared with the atomic adapters over the same fetched responses before acceptance.

The page, upgrade journey and PDF identify selected-product freshness. Retained data warns immediately; ages of 36 and 72 hours trigger warning and critical states. Health metadata includes all six products. Monitoring checks the expected repository commit and catalog hash as well as per-product age and retention.

Every composite passes the existing whole-catalog, application, adapter, lint, TypeScript and build checks before a normal fast-forward push. A moved main branch prevents publication. Exact production commit/hash verification runs before a partial refresh is reported as requiring repair. Partial-refresh evidence is rebound to the newly published base commit so the failed group's investigation cannot be closed by another group's success.

Automatic repair publication uses atomic mode. Review policy changes leave accepted catalog/baseline evidence intact until a complete live refresh succeeds. A requested revert restores the entire affected product group with its earlier validation time, marks it retained, and rejects intervening changes in that group. Historical manifests without sufficient product provenance require manual investigation.

Validation evidence:

- Local application tests, all adapter/repair suites, lint and TypeScript pass.
- The first live run matched isolated output to atomic output, validated all six products, then injected an incomplete VB365 build page. Only VB365 retained data; the composite passed whole-catalog validation with 272 releases and 110 security findings.
- The acceptance matrix covers paired/shared failures, new-release rejection on failed security validation, all-failed and atomic behavior, unknown CVEs, malformed metadata, source-definition integrity, recovery, whole-group rollback and overlapping-change refusal.
- Chromium checks all three executive-summary exports and the reviewed journey under both normal and 73-hour-old retained data.
- [Live acceptance run 41125274358](https://github.com/TnTBass/UpgradeBrief/actions/runs/41125274358) passed the atomic comparison, VB365 failure injection and all 35 repository checks. The accepted schema-2 snapshot was validated at 2026-10-30T20:45:43.715Z and committed as edaa745ec68dacb6480c065c237a914eb9c5bddd. Its catalog hash is c4825e9042012b600c9581a910aa257294ab5b6a748225a5a6af3af76416d9fb.
- Deterministic tests additionally reject unmapped CVEs and contradictory official product/source records globally. Provenance retains the identity of the policy that actually validated the accepted snapshot; a subsequent policy change requires a complete refresh.
- Deployment identity is recorded in the PR and the publication-verification workflow.

Operational fallback: run the live refresher with `--atomic`. This requires every transaction to succeed while retaining schema-2 provenance. To roll application code back to schema 1, restore a fully validated compatible catalog and matching code together; never replace retained validation times with the rollback time.

