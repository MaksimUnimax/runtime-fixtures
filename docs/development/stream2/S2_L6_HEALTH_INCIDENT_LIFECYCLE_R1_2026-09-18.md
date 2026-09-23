# S2-L6 Health incident lifecycle R1

Work ID: `S2_L6_HEALTH_INCIDENT_DEDUP_RECOVERY_LIFECYCLE_2026-09-18_R1`

Status: implementation candidate pending architect review. This slice extends
the existing `health_incidents` authority with deterministic lifecycle
behavior. It does not add notifications, alert routing, admin UI, S2-L7,
API-watch, or Stream-1 runtime behavior.

## A. Preflight and ancestry

- Working branch is based directly on accepted scheduler commit
  `43f7e0fac056ce3aab40a092ba66e8857c8bc25b`.
- Accepted scheduler tree: `af10457492640f1416563a006d147eecfaed7219`.
- Accepted scheduler parent: `75011e57127629bad4369878d8e53f4cbe7911ac`.
- Accepted scheduler correction was preserved.
- Accepted L5B: `da779208e4897932f3ec2827f16ba8c726be38f3`.
- Accepted L5A no-session head: `c289534c94063ab72d812e48506668ad008f0cfd`.
- Preflight `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- Preflight `origin/integration/i1-c1-srv5-2026-09-16`:
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head readback: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- Toolchain: Node `v24.20.0`, pnpm `10.34.5`, PostgreSQL `18.0`.
- The root checkout had unrelated dirty Stream-1 credential-transfer files and
  was not modified. Work was performed in a separate clean worktree.

Migration occupancy was audited across every active local worktree. Stream-1
occupies `0017_i1_c3e_sync_journal` and `0018_d3s2_credential_transfer_foundation`;
accepted scheduler occupies `0019_s2_l6_durable_health_scheduler`. No active
worktree contained `0020`, so this slice uses `0020_s2_l6_health_incident_lifecycle`.
The prior scheduler migration collision is resolved; no new shared migration
dependency was found.

## B. Incident authority audit

The existing `health_incidents` table remains the only Health incident
authority. It already owns the UUID, Health-run first/latest references,
`scope_sha256`, status, optional `root_contour_key`, and observation timestamps.
The existing enum remains authoritative:

`OPEN`, `INVESTIGATING`, `CANDIDATE_FIX`, `CANDIDATE_PASS`, `CANARY_ROLLOUT`,
`ROLLOUT`, `RESOLVED`, `FALSE_POSITIVE`, `MAINTENANCE`.

`health_runs.scope_sha256` is SHA-256 of canonical JSON for the complete
persisted `HealthScope`. It includes browser version, extension version, adapter
engine version, profile revision, and Health-suite revision. It is therefore an
immutable run-scope fingerprint and useful linkage to the exact run, but it is
not a stable incident dedup identity: ordinary runtime or accepted definition
revisions can split one continuous product issue.

The implementation keeps `scope_sha256` unchanged and adds one explicit
incident authority rather than a competing hash family:

- `incident_scope_sha256`: stable logical target/layer scope;
- `incident_key_sha256`: stable scope plus deterministic root contour.

The classifier remains the sole Health-state authority. The incident consumer
re-runs the accepted detailed classifier against the immutable persisted suite
and contour results, verifies the stored state, and never rewrites those rows.

## C. Incident identity and root contour

The canonical identity payload is versioned as `1` and contains:

```text
provider             = scope.adapterFamilyKey
surface              = scope.surfaceKey
target               = scope.variant.machineKey or "default"
browserFamily       = scope.browserFamily
healthLevel          = persisted Health level (the monitoring layer)
profileId            = scope.profile.id
healthSuiteMachineKey = scope.healthSuite.machineKey
```

`incident_scope_sha256` is SHA-256 of canonical JSON for that payload.
`incident_key_sha256` is SHA-256 of the same payload with
`rootContourKey` appended. The payload does not contain run UUIDs, timestamps,
evidence UUIDs, browser process IDs, retry attempts, browser/extension/engine
versions, profile revision, or suite revision. Provider/surface/target and
monitoring layer remain distinct. Profile and suite identity are stable
semantic identities; a revision-only change does not split or resolve an
incident. A genuinely different suite machine key or profile identity is a
different semantic authority.

One run with several failing contours creates one episode rooted at one
deterministic contour. Root selection is finding severity first:
`BROKEN` > `DEGRADED` > `DRIFT`; ties use the fixed accepted baseline contour
order `C01` through `C13`, never object insertion or database row order. The
root-qualified key treats a root change (for example C04 to C05) as a new
logical incident scope. The old episode remains historical; the run still
contains all immutable contour and evidence detail.

The database enforces one active row per non-null key with a partial unique
index over exactly `OPEN`, `INVESTIGATING`, `CANDIDATE_FIX`, `CANDIDATE_PASS`,
`CANARY_ROLLOUT`, `ROLLOUT`, and `MAINTENANCE`. `RESOLVED` and
`FALSE_POSITIVE` are not active. The key is non-null, so SQL NULL uniqueness
cannot create a duplicate; a nullable `root_contour_key` on a historical or
manually inserted row does not weaken active-key protection.

## D. Episode and transition policy

An episode is continuous only while its active deterministic key remains open.
Resolution never reopens the old row. A later failure after a proven recovery
creates a new row.

| Current / observation | Automated result |
| --- | --- |
| no row + DRIFT/DEGRADED/BROKEN | create `OPEN` |
| active + same failure | same ID; monotonic latest-failure metadata |
| `OPEN` + HEALTHY | `RESOLVED` |
| `OPEN` + UNKNOWN | no state change |
| `OPEN` + MAINTENANCE | `MAINTENANCE` |
| `MAINTENANCE` + HEALTHY | `RESOLVED` |
| `MAINTENANCE` + same failure | `OPEN`, same episode |
| RESOLVED + late old failure | unchanged |
| RESOLVED + newer failure | new `OPEN` episode |
| FALSE_POSITIVE + later failure | new `OPEN` episode; no permanent suppression |
| manual/candidate active status + repeated failure | preserve status; update observation metadata only |
| no row + MAINTENANCE | no product-break incident |
| no row + UNKNOWN | no product-break incident |

The consumer never enters `INVESTIGATING`, candidate, canary, or rollout
states. It does not auto-enter `FALSE_POSITIVE`. Manual status ownership is
preserved, including when a later automatic observation is healthy.

`first_seen_run_id`, `first_seen_at` are immutable after creation. The
`latest_seen_*` fields mean latest failing observation, not latest recovery.
`last_observed_*` is additive ordering metadata for maintenance/manual safety.
Observation ordering is `(completed_at, run_id)`; equal timestamps use the
lexically greater UUID as the deterministic tie-break. Older runs cannot move
latest failure, last observation, or a resolved episode backward.

## E. Recovery and maintenance

Health `HEALTHY` is the only automatic recovery proof. Resolution writes both
`resolved_by_run_id` and `resolved_at` to the same durable completed Health
run used for the recovery decision. Recovery does not overwrite
`latest_seen_run_id`. Reprocessing the same recovery is a no-op.

Maintenance is accepted Health state, not notification suppression. A
maintenance run with no active incident creates no product-break row. An
active automatic `OPEN` episode moves to `MAINTENANCE` without losing its
first/latest failure references. A later failure returns that same row to
`OPEN`; a later `HEALTHY` run resolves it. Manual/candidate statuses are not
overwritten by maintenance or healthy observations.

`UNKNOWN` is operational observability only in this slice. It neither creates
a product incident nor resolves one, and it is not treated as product
breakage.

## F. Concurrency, replay, and crash boundaries

Incident processing is a PostgreSQL transaction. It locks the completed run
for share, locks matching incident rows for update, and uses the active partial
unique index plus `INSERT ... ON CONFLICT DO NOTHING` for concurrent creation.
Two independent database connections therefore converge on one active row.

The repository is intentionally replay-safe without process memory. A replay
of a create sees the active row, a replay of a repeated failure is not newer,
and a replay of recovery sees no eligible active automatic row. A transaction
rollback before mutation leaves no partial lifecycle state; a worker crash
after commit but before acknowledgement is safe to replay. The real PostgreSQL
suite exercises concurrent open, repeated run, repeated recovery, two newer
failures, older late failure, and the crash/ack-loss replay boundary.

## G. Migration and existing-data survival

Migration: `0020_s2_l6_health_incident_lifecycle.sql`.

It is additive and does not rewrite or delete completed Health data. It adds
the stable and root-qualified hashes, durable last-observation fields,
`resolved_at`, `resolved_by_run_id`, foreign keys to Health runs, checks, the
active partial unique index, and a scope/status lookup index. Existing
incident rows receive deterministic `legacy-v1` 64-hex compatibility
fingerprints (built from PostgreSQL's built-in `md5` halves, so the migration
survives repeated schema resets) and last-observation values from their
existing latest run. Existing status and first/latest FKs
survive. Existing active duplicates are not silently repaired: the unique-index
creation fails the migration, which is the reviewed safe behavior.

## H. Scheduler handoff

The scheduler remains execution authority. A scheduler failure before a
completed Health run exists never creates an incident. Once a Health run is
durably persisted, the same `processCompletedHealthRun(runId)` consumer can be
called for scheduled and on-demand runs; schedule IDs are not part of logical
incident identity. A scheduled run may retain its existing `healthRunId` link,
but incident evidence is reached through the completed Health run and its
safe evidence references.

`SEND_UNCERTAIN` remains scheduler terminal state from the accepted scheduler
foundation. It is not a completed Health classification and does not invoke
incident creation. No notification send or routing was added.

## I. Evidence, immutability, and privacy

Incident rows reference first/latest/recovery Health runs only. The consumer
does not copy artifact bytes or raw result payloads. Existing suite revisions,
completed runs, contour results, classification, and evidence references remain
immutable. PostgreSQL coverage reads evidence before and after lifecycle
processing and proves byte/reference identity.

No incident or migration field stores cookies, storage state, auth headers,
passwords, OTPs, session handles, private conversation IDs, response content,
seller data, raw DOM, or screenshots. Identity uses bounded typed metadata and
SHA-256 values only.

## J. Validation

Focused Health tests: `70/70` pass, including deterministic identity and
adversarial root-order tests. Focused incident PostgreSQL lifecycle:
`7/7` pass. Migration survival/duplicate safety: `2/2` pass. Accepted
scheduler PostgreSQL regression: `17/17` pass. Existing Health persistence
PostgreSQL regression: `22/22` pass after updating its physical-fixture insert
to the additive columns. The database migration-count regression was corrected
from the accepted 18-entry expectation to the current 19-entry journal.

The full requested matrix is recorded in the terminal report after execution;
the complete PostgreSQL integration batch passed `43/43` files and
`1573/1573` tests. Recursive workspace tests exited `0`; no live LLM provider
calls were made and real Send count is `0`.

## K. Boundary and deferred ledger

Changed production/test scope is limited to Health incident identity and the
server DB Health schema/repository/migration/tests, plus this document. No
`apps/extension`, `packages/control-client`, `packages/bridge-core`, product
adapters, auth/bootstrap/session, API-watch, notifications, admin UI, or
S2-L7 code was changed. The only cross-stream relationship is the already
resolved migration numbering boundary at 0017/0018/0019.

Deferred items remain only:

- `ENVIRONMENT_DEFERRED`: Stream-2 remote publication credentials;
- `ENVIRONMENT_DEFERRED`: no provisioned technical LLM sessions for future
  authenticated live validation;
- `ENVIRONMENT_DEFERRED`: Ozon/Wildberries public-document access protection.

PostgreSQL is not deferred. Migration collision from scheduler R2 is not
deferred or reopened.
