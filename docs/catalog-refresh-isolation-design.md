# Safe product-scoped catalog refresh

Status: implemented by [#24](https://github.com/TnTBass/UpgradeBrief/pull/24). [Live acceptance](https://github.com/TnTBass/UpgradeBrief/actions/runs/41125274358) passed; see [implementation and operations](catalog-repairs/2026-10-30-product-isolation.md). Reviewed against commit `388aad25e06d2115d38acb8f4da41e61d139b33b` on 2026-10-30. Implements the design deliverable in [#18](https://github.com/TnTBass/UpgradeBrief/issues/18).

## Decision

Publish one immutable catalog, assembled from independently validated product groups. Retain a failed group's entire last accepted data and its validation time. A new deployment or successful HTTP fetch must never make retained security evidence appear fresh.

The schema, validation, UI, monitoring and publication changes below ship together; --atomic remains the fallback mode. Catching exceptions around existing merge functions is not a safe partial-refresh implementation.

## Source ownership and transaction boundaries

Start with these units, grounded in the current adapters and catalog:

| Base unit | Members | Required evidence |
| --- | --- | --- |
| Backup platform | VBR, Enterprise Manager | KB2680 builds; Enterprise Manager derivation; KB2053 paths; KB4696/KB4738 release information; shared KB4934, KB3103, KB4581 and KB4682 applicability |
| Monitoring/orchestration | ONE, VRO | KB4357/KB4358 builds; ONE and VRO paths; KB4508 standalone/embedded-component applicability; KB4858/KB4857 inventories |
| Service provider | VSPC | KB4464 builds; VSPC upgrade guidance; KB4856 inventory; complete product KB inventory and official CVE-record reconciliation |
| Microsoft 365 | VB365 | KB4106 builds; KB4098 paths; product security articles and release materials |

Each unit also requires its lifecycle, release materials, security findings and coverage proofs. The evidence registry must declare both article owners and parser consumers; `Source.productId` alone is insufficient because many shared sources have no product ID.

A shared document is not necessarily a shared semantic change. Reuse a successfully validated, unchanged source revision across units without joining every unit on every run. However:

- A changed shared article, parser/adapter version, reviewed model, applicability rule or classification joins all affected units into one transaction.
- A shared source fetch or validation failure blocks all of its known consumers.
- Use the union of previous reviewed ownership, current reviewed classification and parser outputs. Newly observed scope must be reconciled before it can shrink or split a transaction.
- Unknown ownership, a removed product reference, an unclassified CVE, or an unexplained source disappearance blocks publication globally until reviewed. Do not infer independence from an empty parser result.
- Changes to a global informational notice (for example KB4233, KB4254 or KB4953) join all six products unless a reviewed schema explicitly partitions its applicability.
- KB4649 spans VBR, ONE and VSPC. Its changes join the backup, monitoring/orchestration and service-provider units. KB4508 then preserves ONE/VRO coherence. Other reviewed cross-product sources may join additional units.
- Mentions of other products in navigation or unrelated prose are not automatically ownership. Preserve the existing distinction between observed scope, classified scope and accepted applicability; unexpected differences remain blockers.

This design deliberately offers limited isolation for shared-source incidents. A VB365-only parser failure can leave other groups eligible, while an unclassified security-feed addition can still stop the entire refresh.

## Global and group validation

Run discovery and trust gates before partitioning: complete security-feed pagination, inventory continuity, classification completeness, source identity, available CISA KEV data, lifecycle parsing, and an acyclic, complete source-consumer registry. A failed global gate publishes nothing. Preserve the current minimum-count and continuity checks; do not replace them with merely nonempty responses.

After global discovery, fetch once with existing throttling/retries and construct immutable observations. Scope the existing gates by the proven registry, without relaxing their semantics:

- Parsed and fingerprinted article contracts remain distinct.
- Every observed in-scope CVE must have accepted parsed or reviewed applicability.
- Existing findings, fix boundaries, deployment conditions and embedded-component coverage cannot disappear without reviewed evidence.
- VSPC retains both its full KB/CVE inventory and official CVE-record coverage gates.
- New releases require recalculating relevant finding applicability in the same transaction. A newly discovered release cannot be published beside older, unvalidated security mappings.
- Scope/route continuity checks use both the accepted snapshot and fetched evidence. Failed observations never update accepted baselines.

Each transaction produces either a complete proposed partition or a structured failure. It cannot return a partly updated partition. The partition includes products, releases, recommendations, routes, security findings, lifecycle/operational notices, capabilities, improvements, accepted source revisions and all related continuity/baseline records.

## Schema and timestamp contract

Introduce catalog schema version 2 and an explicit migration. Keep `generatedAt` as the conservative oldest successful product-validation time for compatibility; use `assembledAt` for the new composite's creation time.

Proposed metadata:

```ts
type ProductValidation = {
  productId: ProductId
  transactionId: string
  validatedAt: string
  attemptedAt: string
  state: 'validated' | 'retained'
  partitionHash: string
  evidenceIds: string[]
  failureCodes: string[]
}
```

Store one record for every product. Products in a transaction share its validation outcome. Use stable typed failure codes with article IDs; keep raw fetched text and detailed diagnostics in run artifacts.

Separate `sourceObservations` (fetched time, content digest, response identity) from accepted `sourceRevisions` (digest, parser/review version and validated consumers). A shared source can have a newly observed revision while a blocked transaction still references its accepted revision. Key revisions by source ID plus digest. Do not overwrite one global `Source.checkedAt` with the latest successful fetch when some consumers retained older evidence.

The first schema-2 snapshot comes from a fully successful atomic refresh. Seed each product's `validatedAt` from that verified refresh, not from migration time or file modification time. Reject missing products, unknown states, invalid/future timestamps and unresolved evidence references.

## Assembly and publication

1. Bind the run to a specific base commit and accepted catalog hash. Record adapter/review-policy versions.
2. Complete global discovery. Determine transaction closure from changed and failed evidence.
3. Validate each transaction in an isolated copy; retain the whole previous partition on failure. Do not mutate the base or shared parser objects.
4. Assemble successful partitions plus retained partitions. Preserve retained findings and recommendations exactly, including applicability and source revision references.
5. Run whole-catalog validation on the composite: uniqueness, references, every product's freshness metadata, global CVE coverage, cross-product component coherence, and reproducible partition hashes. Do not rewrite the expected coverage set to make a failed group disappear.
6. Run the full existing application, adapter, lint, TypeScript and build verification on the exact composite. A failure prevents all publication.
7. Commit catalog and accepted baseline changes together with a base-commit lease. If main moved, discard/recompute against the new base; do not combine stale candidate results with newer main.
8. Verify the deployed commit and full catalog hash as today. The health endpoint additionally exposes schema-2 per-product validation metadata, with no private diagnostics.

If no group validates, do not create a catalog commit just to advance `assembledAt`. Persist the failed attempt in workflow artifacts and update its investigation. An identical successful refresh may legitimately advance validation time, but only after every required observation and gate for that group succeeds.

Automation must report `complete`, `partial`, or `blocked` explicitly. A partial result must not count as a successful repair of a blocked group's investigation. Deduplicate alerts by group, accepted validation time and failure identity; successful groups cannot close other groups' issues.

## User-visible freshness and monitoring

Update `src/App.tsx`, product results and PDF export to show the selected product's last validated date and retained-data warning. The overall page says when the catalog was assembled and identifies blocked groups; it cannot label the entire catalog fresh from `assembledAt`.

Retain existing 36-hour warning and 72-hour critical thresholds, evaluated per product on both main and the public endpoint. The aggregate state is the worst product/deployment state. Immediately show a failed-attempt warning even while the retained data is younger than 36 hours. Never let a stale product display a reassuring current-security verdict without the visible freshness qualifier.

Update `scripts/lib/catalog-health.mjs`, `scripts/check-catalog-freshness.mjs`, the Vite health artifact and publication verifier together. Missing product health, invalid metadata, unavailable public health or a commit/hash mismatch remains a failure. A freshly deployed composite with one old partition is still stale for that product.

## Required acceptance tests

| Scenario | Required result |
| --- | --- |
| VB365-only parser failure; other transactions pass | Other groups update; VB365 data and validation time remain identical; partial warning visible |
| ONE source fails | Both ONE and VRO retain accepted data |
| Changed KB4934; Enterprise Manager validation fails | Both VBR and Enterprise Manager retain the previous revision and findings |
| Changed KB4649; VSPC validation fails | Every transaction consuming the changed source retains its accepted revision |
| Unchanged shared article; independent VB365 failure | Validated consumers can refresh without rewriting VB365 evidence |
| Shared article gains/removes product scope or includes an unknown CVE | No unreviewed split; unknown ownership blocks the whole run |
| Security feed truncated, page missing, KEV/lifecycle unavailable | No publication; previous accepted data/baselines unchanged |
| New release while that group's CVE applicability fails | Neither the release nor recommendation is published |
| All groups fail | No new catalog commit or freshness reset |
| Blocked source recovers | Entire group advances together; alert closes only after public verification |
| New composite retains a partition older than 72 hours | Main, UI, PDF and public monitor report that product critical |
| Main advances during assembly or deployment differs | Recompute or fail; never publish/verify against the wrong base |
| Cross-product regression or whole-app check fails | No composite or baseline publication |
| Schema-1 migration, missing metadata, invalid timestamp | Only verified migration accepted; malformed snapshots rejected |

Use the October incident fixture to replay source changes, plus deterministic mixed-outcome fixtures. Tests must compare retained partitions and source references, not only their counts. Include end-to-end freshness/publication tests and a browser/PDF check of the stale warning.

## Delivery order and rollback

First add the registry, schema-2 validators and fixture tests without changing publication. Then add per-product UI/PDF/health consumers and monitoring. Extract the monolithic refresher into pure collection, transaction-validation and assembly stages. Run the proposed assembler in shadow mode beside atomic refresh and compare fully successful outputs. Enable partial publication only after the mixed-outcome acceptance matrix passes and shadow output matches.

An operator can switch back to atomic publication without dropping schema-2 metadata. If application code must roll back to schema 1, restore the last fully validated compatible snapshot and matching code together. Never flatten retained timestamps to the time of rollback.
