# D3S2-1 Store Metadata/State — implementation evidence

Work ID: `D3S2-1-STORE-METADATA-STATE-2026-09-18`

Status: `IMPLEMENTED_CANDIDATE / R1_CLOSURE_EVIDENCE / REMOTE_NOT_VERIFIED`

This document records bounded local implementation evidence. It is not an
architect acceptance, production deployment, browser-store publication, or
live provider certification.

## Base and safety

- Start HEAD: `57f872b84bd121959c368d571d6bf9b80fdb3839`
- Start tree: `c1fdc6a2ed3dd77af499bdb3fed14d7fb471d050`
- Start classification: `ACCEPTED_BOUNDED_AUDIT / REMOTE_NOT_VERIFIED`
- Branch: `feature/d3s2-store-metadata-state-2026-09-18`
- R0 evidence preservation commit: `a5a9e64dea363bdd0e777fe3e79e8176eb5999de`
- R0 evidence tree: `6b59b3d6c163f2adc4c0c614cbebefb2d44a1e64`

The R0 files preserved in that commit are `D3S2_R0_SOURCE_OF_TRUTH.md`,
`D3S2_R0_RESIDUAL_MATRIX.md`, `D3S2_R0_DEPENDENCY_MAP.md`, and
`D3S2_R0_QA.md`. The A03 correction preserves the historical
`PASS_AUTOMATED_CURRENT_SCOPE`: local deletion ends/fences local work and a
late result does not attach to another store. Broader D3/S2 store-state
convergence is documented as an extension, not a rewrite of that acceptance.

Remote heads checked before implementation:

- `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- `origin/docs/roadmap-autonomy-correction-2026-09-18` = `6a48af8cd19137aaa10688c36cb064d3c4b16969`

No newer legitimate Stream-1 descendant was found. Existing unrelated
`repro/` and server/shared untracked symlink entries were preserved and were
not staged.

## Red-first receipt

The complete reachable batch is
`tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs`:
59 cases covering STORE-01..32, SYNC-33..40, BIND-41..45, REPLAY-46..50,
PRIV-51..55, and CALL-56..59.

Initial red batch: 24 failures — STORE-03, 05, 06, 07, 14, 15, 16, 17,
19, 23, 24, 25, 26, 27, 28, 29, 30; SYNC-33, 34, 37, 38; BIND-41;
PRIV-51, 54. The remaining 35 cases were existing guards that stayed green.

Root-cause groups were: catalog lacked lifecycle/provider metadata; credential
revision was not represented as an opaque fence across metadata; C3E had no
typed store operation path; C3F/server reconciliation only handled binding and
delivery state; tombstone dominance was absent; and privacy allowlisting did
not cover the new state.

Focused green receipts:

- D3/S2 matrix: 59/59 passed.
- Direct C3E journal test: rename, offline retention, tombstone compaction,
  recovery ACK projection all passed.
- Server sync tests: 16/16 passed across the D3/S2, existing index, and
  reconciliation suites.

## Architecture delta

The local catalog now represents account-scoped stable `storeId`, marketplace,
label, lifecycle, metadataRevision, opaque credentialRevision, confirmed or
unconfirmed provider identity, and local `credentialsStale` state. Credentials
remain local only. Rename changes metadataRevision and name but does not change
storeId, marketplace, provider identity, or credentialRevision.

Credential revisions are opaque UUID fencing values for new credential changes;
unchanged credentials retain their revision. No new synchronized value is a
credential hash or secret-derived fingerprint. WB execution now relies on the
existing execution-context guard for the opaque revision; the historical WB
hash check is retained only for old local 64-hex fixture snapshots.

Provider identity is confirmed only from an explicit provider result field.
Labels, token shape/equality, timing, browser state, and unconfirmed failures
cannot bind identity. A confirmed different provider account fails closed.

Delete is locally immediate, clears local credentials, hides/denies the store,
fences active work, and records a metadata-only tombstone. C3E carries
`STORE_UPSERT` and `STORE_TOMBSTONE` using the existing requestId,
baseRevision, durable journal, ACK/conflict, compaction, retry, and P3 wake
paths. Tombstones dominate stale upsert/rename/update/ACK and recreation uses a
new storeId.

C3F gains store-specific deterministic reconciliation classes for compatible
state, stale revision, confirmed identity mismatch, tombstone dominance, and
unknown remote installation state. BindingRevision, explicit Finish, store
switch, last-delivered eligibility, and preferredExecutor logic remain on the
existing reconciliation path.

Server contracts accept only the minimum store metadata fields. Existing
`sync_entities` JSONB persistence is sufficient; no migration was required.
No new endpoint, queue, scheduler, heartbeat, WebSocket, lease, provider retry,
secret channel, transfer, or export/import path was added.

## Files and persistence

Changed implementation areas:

- `packages/bridge-core/src/stores/catalog.js`
- `packages/bridge-core/src/sync/reconciliation.js`
- `packages/contracts/src/index.ts`
- `packages/server/sync/src/reconciliation.ts`
- `packages/server/sync/src/index.ts`
- `apps/extension/src/application/runtime.js`
- `apps/extension/src/application/sync-journal.js`
- `packages/marketplaces/wildberries/src/adapter.js`

Added tests:

- `tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs`
- `tests/regression/extension-core/client-i1/client-d3s2-c3e-store-journal.mjs`
- `packages/server/sync/src/d3s2-store-metadata.test.ts`

No database migration changed. No Stream-2 implementation path was modified;
the overlap check covered `apps/health-runner/**`, `packages/server/health/**`,
and `tooling/api-watch/**`.

## Regression and package evidence

- Client D3/S2 matrix: PASS, 59/59.
- C3E direct test: PASS.
- Extension application regression: PASS, APP-00..10 and C3A-01..04.
- Full Extension I1 checker: all source, C3D, C3F, C3G, P1/P2/P3 and C3H
  assertions pass except AUT-47, the externally deferred native unpacked
  Chromium MV3 registration gate.
- Server sync/index/reconciliation tests: PASS, 16/16.
- R0 recorded the full server unit suite as 73 files and 1,552 tests and
  deferred PostgreSQL-backed suites because `DATABASE_URL` was not configured;
  the R1 rerun and database receipts supersede that environment-limited
  snapshot below.
- R0 recorded the API suite as 17/18 files and 224/225 tests and described the
  OpenAPI drift as pre-existing. R1's base-vs-candidate differential below
  corrects that classification: the accepted base artifact was clean, while
  the candidate artifact was stale after the legitimate D3S2 contract change.
- Typecheck: contracts, server sync, server DB, and API all PASS under Node
  24.8.0.
- Deterministic composition: repeat archive equality and source/extracted byte
  parity PASS. Latest checker package: 2,030,077 bytes,
  SHA-256 `2f2e3719f66a479a25a5ac64ba30a0875d9a80900c5349af9c3f1e4a24f5d9da`.
- Live provider calls: 0. Real unpacked Chromium PASS is deferred; no other
  browser-family PASS is claimed.

The ordinary command/delivery control-call instrumentation remains zero in the
existing AUT-42/AUT-43 and application no-control-call fixtures for both Ozon
and WB command paths and ordinary delivery. Store-state reconciliation itself
does not call either provider adapter and has zero provider calls in the D3/S2
and replay receipts.

Privacy review found no marketplace credentials, raw provider responses, seller
reports, provider files, AI text, or secret-derived credential fingerprint in
the new sync payload or server persistence. Synthetic credentials only were
used in tests.

## R1 acceptance-closure receipt

Work ID: `D3S2-1-R1-STORE-METADATA-ACCEPTANCE-CLOSURE-2026-09-18`

R1 started from implementation candidate `83c2feaa1223770839d3d5c67f478723a4d35746`,
tree `d22f4b92a5af83741fc6dcf38530315687c72210`, on the same feature branch.
The final receipt commit and tree are recorded by the terminal report; this
document remains evidence, not an acceptance decision.

The complete initial gap batch was reproduced before correction:

- API: 224/225; the failing test was
  `src/openapi.test.ts > OpenAPI foundation > accepts the tracked artifact when
  it is generated from the current routes`.
- PostgreSQL: no Compose binary was present, so the supported repository
  `postgres:18.0` configuration was provisioned as a task-owned disposable
  loopback container instead of using an owner database.
- Chromium: bundled Playwright Chromium 151.0.7922.34 launched and the
  current source/generated and extracted/package extension fixtures executed.

The OpenAPI differential was made in detached temporary worktrees. The
accepted base generated SHA-256
`d263ab2aaa816d04f8b6fe0ce0b2f3e44d10617f92f917593eadaf45ad8e7414` and matched
its tracked artifact. The pre-R1 candidate generated
`626e7d799b49cb51553b6c1f471dcefac4d6820f093b7524706410892d5665c1`, while its
tracked artifact was still the base hash. The generated diff added only the
D3S2 store mutation enum and metadata schemas; route count remained 106. The
classification is `EXPECTED_GENERATED_ARTIFACT_NOT_UPDATED`, exposed by the
legitimate D3S2 contract change, not an unrelated pre-existing failure and not
a design drift. The supported `pnpm openapi:generate` command updated the
canonical artifact, and the exact stale hash in the integration acceptance
fixture was updated only after verifying that contract diff. New artifact SHA:
`626e7d799b49cb51553b6c1f471dcefac4d6820f093b7524706410892d5665c1`.

Post-correction receipts:

- API: 18 files, 225/225; `pnpm openapi:check` PASS.
- PostgreSQL 18.0: task-owned container, migrations PASS through `0017_i1_c3e_sync_journal.sql`; inventory 18 rows; affected sync integration 1 file, 6/6; full relevant integration 40 files, 1533/1533.
- E2E: disposable loopback database named `e2e`, 88/88 PASS. The initial
  safety rejection against the non-`e2e` database was expected and recorded;
  no owner or production database was used.
- Server unit/full local suite: 108 files, 2027/2027; database unit subset
  3 files, 12/12. Typecheck, lint, format, build, OpenAPI, and bridge guard
  PASS.
- Extension Core checker: PASS, 111 gate processes. Extension I1 checker:
  PASS, 138 gate processes, with the real-unpacked proof flag for AUT-47.
- D3/S2 matrix: 59/59. Direct C3E journal: rename/offline/tombstone/recovery
  PASS. C3F source and extracted/package: 28/28 each; C3G: 12/12; C3H:
  50/50; P1: 10 scenarios each; P2: 9 scenarios each; lower-layer P3:
  7/7, 100 wake deliveries, zero duplicate wake runs.

The actual unpacked Chromium receipt used Chromium 151.0.7922.34 and covered
both source/generated and extracted/package runtimes. C1 was 36/36 on each;
P1 and P2 were PASS on each. It exercised signed authority, multiple stores,
store selection/rebind, restart/recovery persistence, stale credentialRevision
fencing, delayed Finish/Health races, no historical command autorun, and
ordinary no-control-call behavior. Metadata rename/delete/tombstone and
server-recovery behavior are recorded separately as automated lower-layer
proof; they are not mislabeled as Chromium-proven. The existing native P3
harness remains a scenario mismatch: it schedules `now + 60s` and immediately
expects a future item to drain. It failed only at that assertion; the
lower-layer P3 model passed. No product patch was made for that harness issue.

Package receipt: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`,
2,030,077 bytes, SHA-256
`2f2e3719f66a479a25a5ac64ba30a0875d9a80900c5349af9c3f1e4a24f5d9da`;
repeat-archive equality and source/generated/extracted inventory parity PASS.
The separately injected browser-fixture archive was also source/extracted
byte-identical and was used only for synthetic local Chromium authority.

The architecture recheck found one C3E-derived journal, one C3F-derived
reconciliation model, no heartbeat/WebSocket/lease/polling extension, and no
mandatory ordinary command/delivery control call. Ozon, WB, and ordinary AI
delivery mandatory control-call counts were all zero. Provider UNKNOWN replay,
known-response provider replay, delivery UNKNOWN automatic resend, and
confirmed delivery duplicates were all zero. Revision-dominant tombstones
cannot be resurrected by stale metadata; a recreated shop receives a new
storeId. Provider/account uncertainty remains explicit and secrets remain
local. Stream-2 implementation paths were untouched.

R1 changed only the canonical generated OpenAPI artifact, its verified exact
hash in the integration fixture, and this evidence update. No implementation
commit was amended. No transfer, export/import, production publication, or
Stream-2 work was started. Remote heads were read back and matched the
preflight values, but no publication was attempted; remote publication remains
`ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`. Architect acceptance remains open.

Transfer (`A22/A23`), export/import (`A24`), browser-family certification,
live provider certification, owner-authenticated AI tests, Health/DOM monitor,
API watcher, publication, and production deployment were not implemented.

## R2 acceptance closure — 2026-09-18

Work ID: `D3S2-1-R2-INSTALLED-METADATA-AND-P3-DIFFERENTIAL-CLOSURE-2026-09-18`.

The R2 start was branch
`feature/d3s2-store-metadata-state-2026-09-18`, HEAD
`8132894b536a644d8751b51d586ec983fa5e633c`, tree
`232e1703a0d65862e3572715134d5589ffb9c66f`. The bounded harness/evidence
commit is `fc35ede35deb5f470b9a3524f263e3f9ee90a671`, tree
`8f9da870a86ca395f87b03efed0ee68e1843bf17`; the documentation commit that
records this section is the final R2 HEAD reported with this evidence.
Existing R0/R1 commits were preserved.

### Actual-unpacked Chromium metadata matrix

The harness used Playwright with native Chromium `151.0.7922.34`, a real MV3
service worker, popup product path, persistent profiles, and synthetic signed
Ed25519 authority. Both source/generated and extracted/package runtimes were
loaded as unpacked extensions. No jsdom, mocked Chrome API, lower-layer-only
substitution, or static package inspection was used for this matrix.

| Scenario | Source/generated | Extracted/package |
|---|---|---|
| BR-STORE-01 distinct stable stores/isolation | PASS | PASS |
| BR-STORE-02 popup rename, stable storeId/revision, other store unchanged | PASS | PASS |
| BR-STORE-03 offline rename, pending metadata journal, ordinary Work usable | PASS | PASS |
| BR-STORE-04 restart preserves rename and pending journal | PASS | PASS |
| BR-STORE-05 popup delete, immediate local fence, unrelated store survives | PASS | PASS |
| BR-STORE-06 compact tombstone/pending metadata only | PASS | PASS |
| BR-STORE-07 restart preserves tombstone/no recreation | PASS | PASS |
| BR-STORE-08 stale rename/upsert cannot resurrect tombstone | PASS | PASS |
| BR-STORE-09 late ACK/stale revision cannot roll tombstone back | PASS | PASS |
| BR-STORE-10 second persistent context converges tombstone and preserves unrelated store | PASS | PASS |
| BR-STORE-11 old credentialRevision Work is fenced; revision has no credential | PASS | PASS |
| BR-STORE-12 restart/recovery does not autorun historical commands | PASS | PASS |
| BR-STORE-13 metadata reconciliation has no provider/AI/ordinary mandatory calls | PASS | PASS |

BR-STORE-08/09/10 used the real production
`SellerAgentsActiveStoreCatalog.applyRemoteMetadata` reconciliation surface in
the unpacked service worker with synthetic stale-upsert, late-ACK, and
second-context recovery fixtures. BR-STORE-03 used the real popup rename path
while the control fixture was unavailable; Work admission remained local.

The installed `/v1/sync` HTTP round-trip was attempted with the test-only
control fixture. The real MV3 sync path reached
`SellerAgentsSyncJournal.syncNow`, but the existing journal write/readback
condition (`SYNC_JOURNAL_WRITE_READBACK_FAILED`) occurred before a transport
request, so the fixture recorded zero `/v1/sync` requests. This was not
worked around by mutating hidden production state, weakening fencing, or
claiming a transport proof. The browser layer reached the real worker/journal
and reconciliation layers; lower-layer C3E/C3F tests prove the sync transport
semantics. Installed sync-HTTP round-trip evidence remains deferred to a
future harness repair/acceptance stage.

### Native P3 differential and correction

The exact original native P3 check was run with equivalent inputs on both
`57f872b84bd121959c368d571d6bf9b80fdb3839` and
`8132894b536a644d8751b51d586ec983fa5e633c`. Both failed identically at
`Timed out: P3 durable wake drain`: the harness scheduled `now + 60s` and
immediately expected the future item to drain. The accepted base therefore
proves this is not a D3S2 regression. Classification:
`P3_PRE_EXISTING_EXPECTED_SEMANTIC_MISMATCH` and `P3_HARNESS_DEFECT`.

The bounded correction is test-only: the native harness first asserts that an
early wake does not execute the future entry, then installs an explicit test
clock and advances it past the due time before waking. Product timing was not
weakened. Current-candidate native P3 is PASS for source/generated and
extracted/package: one restart, two duplicate-wake attempts safely coalesced,
zero marketplace requests, and zero periodic scheduler alarms. Lower-layer
P3 is PASS, 7/7 scenarios and 100 wake deliveries with zero duplicate wake
runs. UNKNOWN provider outcomes are not replayed; UNKNOWN AI delivery is not
automatically resent; the scheduler creates no Start/Resume/command.

### R2 receipts and boundaries

- D3/S2 lower layer: 59/59 PASS; C3E rename/offline/tombstone/recovery PASS;
  C3F 28/28 on both runtimes.
- Native C1: 36/36 on source/generated and extracted/package. Native P1 and
  P2: PASS on both runtimes. C3G/C3H, API, integration, E2E, and production
  suites were not rerun because R2 changed only test infrastructure; their R1
  green receipts remain unchanged.
- Package: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, 2,030,077
  bytes, SHA-256
  `2f2e3719f66a479a25a5ac64ba30a0875d9a80900c5349af9c3f1e4a24f5d9da`;
  repeat archive and source/generated/extracted parity PASS.
- Metadata reconciliation receipt: ordinary Ozon mandatory control calls 0,
  ordinary WB mandatory control calls 0, ordinary AI delivery mandatory calls
  0, provider UNKNOWN replay 0, AI delivery UNKNOWN automatic resend 0.
- Privacy: all values were synthetic; no marketplace credential, token,
  session, report, or AI body was stored or committed. Sync request count was
  0 and the inspected fixture payload was secret-free. No Stream-2 file was
  modified (`apps/health-runner/**`, `packages/server/health/**`, and
  `tooling/api-watch/**` are untouched).

R2 does not self-accept D3S2-1. No product defect was found and no production
semantics were weakened. Remaining blockers/boundaries are architect review,
remote publication, the installed sync-HTTP round-trip harness condition
described above, and separately scoped browser-family/live-provider/owner-AI
evidence. Transfer and export/import were not started.

## Deferred and next work

Deferred: architect review/acceptance; remote publication/readback; real
unpacked Chromium MV3 registration; Firefox/Safari/Opera/Yandex environments;
live Ozon/WB provider certification; owner-authenticated AI evidence.

Remaining D3/S2 work after this bounded step is the separately scoped transfer
and export/import work, later browser/live gates, and any architect-requested
follow-up. This candidate does not self-mark D3S2-1 accepted.

Known architectural risk: legacy local WB fixture snapshots may still carry a
historical secret-derived 64-hex revision and therefore use the compatibility
check; new D3/S2 synchronized state uses opaque revisions and must not regress
to the legacy representation.

## R3 acceptance-closure rework — 2026-09-18

Work ID: `D3S2-1-R3-INSTALLED-C3E-SYNC-TRANSPORT-CLOSURE-2026-09-18`.

R3 started from the R2 candidate `5b9ba9184434e7d5da94bea8ed545925cdb5ba3c`,
tree `c6042e24ed4928115c0006567936c5b514478921`, on
`feature/d3s2-store-metadata-state-2026-09-18`. The accepted pre-D3S2 base was
`57f872b84bd121959c368d571d6bf9b80fdb3839`, tree
`c1fdc6a2ed3dd77af499bdb3fed14d7fb471d050`. Existing R0/R1/R2 commits and
untracked symlink/repro entries were preserved. Stream-2 paths remained
untouched.

### Failure batch and differential

The initial installed failure was reproduced in native Chromium 151.0.7922.34
on both source/generated and extracted/package runtimes. A popup-created Ozon
store was renamed, producing the production `STORE_UPSERT` journal operation;
the same failure was also reproduced by production `syncNow` while marking the
pending batch `IN_FLIGHT`. The storage backend/key was
`chrome.storage.local` / `seller_agents_sync_journal_v1`. `chrome.storage.local.set`
resolved successfully. The immediate readback contained the same values, but
Chrome returned object keys in a different order. The guard compared raw
`JSON.stringify` output, so it raised `SYNC_JOURNAL_WRITE_READBACK_FAILED`.
The write/readback occurred in one live worker with no worker restart between
the two calls; the worker identity was the existing fallback
`worker-unknown`. The synthetic server was running and reachable, but the
HTTP request count stayed zero because the exception happened before
`SellerAgentsControlClient.synchronizeMetadata`.

The equivalent accepted-base C3E `BINDING_UPSERT` operation was run through
the same unpacked Chromium harness on both source and extracted runtimes. It
failed with the identical readback code, on the same storage backend/key, with
zero `/v1/sync` requests. Classification:
`PRE_EXISTING_C3E_RUNTIME_DEFECT`, specifically an order-sensitive durability
readback comparison. It was not a D3S2 store-payload serialization defect,
service-worker lifecycle race, or test-server fixture defect.

The production fix keeps the guard and its failure code, but compares a
canonical recursive representation that sorts object keys while preserving
all values and array order. The C3E test storage adapter now deliberately
returns Chrome-like reordered objects, making this boundary regression-visible.
No sleep, bypass, hidden write, second queue, or weakened readback check was
introduced.

### Installed transport proof

The corrected actual-unpacked source/generated and extracted/package runtimes
used the popup mutation path, the live MV3 worker, the production C3E journal,
the production `SellerAgentsControlClient.synchronizeMetadata` client, and
the loopback synthetic Seller Agents server. The server saw authenticated
JSON `POST /v1/sync` requests; only safe header facts were retained
(`authorization_present=true`, `content-type=application/json`), never bearer
bytes.

| Scenario | Source/generated | Extracted/package |
|---|---|---|
| SYNC-BR-01 STORE_UPSERT rename, ACK, compaction | PASS; 1 intended request, pending 0 | PASS; 1 intended request, pending 0 |
| SYNC-BR-02 offline rename, restart, P3 wake recovery | PASS; pending survived restart, due wake sent and compacted | PASS; pending survived restart, due wake sent and compacted |
| SYNC-BR-03 STORE_TOMBSTONE, ACK, compaction | PASS; 1 intended request, pending 0 | PASS; 1 intended request, pending 0 |
| SYNC-BR-04 stale upsert after tombstone | Supplementary installed stale-reconciliation PASS; transport conflict remains not independently automated | Same |
| SYNC-BR-05 second-installation convergence | Supplementary installed persistent-context tombstone convergence PASS; pull/reconciliation transport not independently automated | Same |
| SYNC-BR-06 credentialRevision metadata/fence | Installed credential edit/fence PASS; metadata-only wire audit PASS; cross-install revision convergence not independently automated | Same |
| SYNC-BR-07 duplicate requestId | C3E/C3H/server idempotence suites PASS; installed duplicate transport not independently automated | Same |
| SYNC-BR-08 late ACK/newer local revision | C3E/C3H installed-adjacent/lower-layer guards PASS; dedicated delayed installed ACK not independently automated | Same |
| SYNC-BR-09 zero side effects | PASS for exercised installed matrix: provider 0, AI resend 0, ordinary mandatory control calls 0 | Same |

The direct installed transport receipt sent three requests per runtime in the
combined rename/delete run (one seed, one intended upsert, one intended
tombstone). The intended request payloads contained only the allowlisted
metadata keys: `requestId`, `baseRevision`, operation identity, store ID,
marketplace, name, metadata revision, lifecycle, opaque credential revision,
and provider-identity metadata. ACKs were processed by production code and
removed the real pending entries. Tombstone local state remained dominant and
its stored credential object was empty.

The offline/restart proof retained one pending `STORE_UPSERT` and one
`sync:pending` technical task across worker restart. An early wake did not
execute future work; the due wake sent the real `/v1/sync` request and left no
pending entry or scheduler task. There was no periodic timer or duplicate
task registration. The installed P3 scheduler smoke passed on source and
extracted/package with one restart, two duplicate-wake attempts, zero
marketplace requests, and zero periodic alarms.

Stale tombstone dominance, duplicate request idempotence, late-ACK fencing,
second-context convergence, and credential-revision fencing remain covered by
the existing C3E/C3F/C3H/server receipts; the rows marked supplementary above
are not mislabeled as fresh real-HTTP installed proofs. This is the remaining
automated boundary for architect review.

### R3 regression and package receipt

- C3E store journal: PASS; reordered readback, offline retention, tombstone,
  recovery ACK; D3/S2: 59/59 PASS.
- C3F and C3G: PASS in the composed Extension I1 checker.
- C3H: all AUT-01..46 and AUT-48..50 PASS; AUT-47 remains the pre-existing
  externally deferred browser-family registration gate.
- Extension I1 checker: all reached gates PASS except the same AUT-47
  deferral; source/generated and extracted composition parity passed.
- Native D3S2 browser matrix: BR-STORE-01..13 PASS on both runtimes; the
  transport-specific R3 receipts above add real `/v1/sync` counts.
- Native P3: PASS on both runtimes.
- Dynamic local-development package used for installed proof:
  `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, 2,031,175 bytes,
  SHA-256 `58562922c3b95833cf27c049d389900093423f070eaea41e6c0385477a83b8f6`;
  repeat archive equality and source/extracted byte parity PASS.
- The full API, PostgreSQL integration, E2E, OpenAPI, and unrelated production
  suites were not rerun because the only production change is the extension
  journal comparison and the R1 receipts remain unchanged. The focused
  composed Extension I1 regression was rerun; its only failure is the known
  AUT-47 environment deferral.

Privacy audit: synthetic values only; no Ozon, Performance, or WB token,
token hash/fingerprint, session secret, provider response/file, seller report,
AI content, storage state, or raw credentials appeared in the inspected sync
bodies or committed evidence. Provider requests were 0, automatic AI resend
was 0, and ordinary mandatory control-call count was 0.

R3 does not self-accept D3S2-1. Remaining blockers are the architect decision,
remote publication/readback, AUT-47/browser-family environment evidence, and
the four rows explicitly identified above as existing lower-layer or
supplementary installed coverage. Transfer, relay, export/import, Q1, S1.2,
Stream 2, deployment, and browser-store publication were not started.
