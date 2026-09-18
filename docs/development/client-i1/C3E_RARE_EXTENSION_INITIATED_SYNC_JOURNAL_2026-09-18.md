# C3E — Rare extension-initiated synchronization journal

**Work ID:** `SA-I1-C2-3-C3E-RARE-EXTENSION-INITIATED-SYNC-JOURNAL-20260918-01`

**Status:** `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP`. The implementation,
focused suites, server unit/migration checks, OpenAPI checks, deterministic
package, and complete extension checker pass. PostgreSQL integration and
native MV3 service-worker browser runs were unavailable in this environment.
This document does not accept C3E and does not start C3F.

## Boundary and source of truth

C3E starts from accepted local C3D `2b2ca0cdd322b0b180ee348fd9d5deb54141a487`
(tree `167beb9d98f720f3836a89d51de411defe3d5e08`). C3D remains the sole Work
state machine and local authority. A local lifecycle mutation commits first;
the journal observes that committed result afterward. A journal write or server
ACK never decides whether Start, Resume, rebind, Finish, command execution, or
delivery happened locally.

The extension initiates `/v1/sync`. The server does not poll extensions, hold
dialogue leases, require a heartbeat, or replay business work. Clean
installations have no sync timer. A dirty journal schedules one durable browser
alarm; after the queue becomes clean the alarm is not recreated.

## Journal model

The single local storage record is `seller_agents_sync_journal_v1`:

- durable `sequence`, `serverRevisions`, and bounded `entries` map;
- one stable `requestId` per independently retryable mutation;
- `mutationId`, `mutationGeneration`, `entityId`, `baseRevision`, and local
  sequence ordering;
- operation kind, allowlisted payload, creation/attempt data, retry state,
  conflict state, and last safe error code;
- at most 256 entries and 32 entries per transport batch.

An entity is the current binding ID when available, otherwise the SHA-256
digest of the accepted local conversation identity. The journal never stores
the raw conversation key. A newer unsent mutation may replace older unsent
metadata for that entity. An in-flight mutation is retained. An older ACK
removes only its matching entry and may advance the base revision of a newer
unsent entry; it cannot clear, overwrite, or retry that newer entry. Conflicts
and unsafe failures remain durable and do not blind-retry. ACKed entries are
removed.

## Allowlist

The payload kinds are:

- `BINDING_UPSERT`: conversation digest, binding ID/revision, store ID,
  marketplace, and credential revision;
- `FINISH`: the same compact binding/store context and explicit terminal kind;
- `DELIVERY_MARKER`: the same current binding/store context plus one compact
  delivery marker ID.

The transport envelope adds only `requestId`, `mutationId`, `entityId`,
`baseRevision`, `localSequence`, and `mutationGeneration`. Account and
installation scope are taken from the authenticated control client; the client
does not accept caller-supplied account identity.

The journal and `/v1/sync` reject or never accept seller tokens, authorization
headers, raw command text, report JSON, file bytes, AI message text, storage
state, Health envelopes, or arbitrary diagnostic objects. No server column is
provided for any of those values.

## Lifecycle observation points

- successful C3D binding creation/change records `BINDING_UPSERT` after local
  binding/session completion;
- explicit Finish records `FINISH` after local Finish, including cancellation
  of a pending Start when a current binding exists;
- successful batch/report delivery records one binding-scoped
  `DELIVERY_MARKER`;
- store and marketplace rebind continue through the existing local warning,
  Finish, target binding, and Start flow. The target binding is journaled when
  the canonical binding mutation completes.

Successful delivery does not call the network synchronously. The marker is
available to a later pending sync. C3E does not select a cross-browser winner,
preferred executor, or global last-delivered result.

## Retry and restart behavior

The durable schedule targets 5 s, 15 s, 30 s, 1 m, 2 m, then at most 5 m.
Each delay has deterministic bounded jitter of 0.90–1.10 of the target. The
same `requestId` is retained across attempts. One journal has one single-flight
transport; the batch is marked `IN_FLIGHT` durably before the request. Browser
alarms wake due work, and `notifyNetworkRecovery()` can accelerate one attempt
without creating a concurrent request. The browser is not kept alive.

On restart, `PENDING`, `RETRY_WAIT`, `IN_FLIGHT`, `CONFLICT`, and `FAILED`
records remain durable. An uncertain transport result is treated as retryable
with the same identity. A malformed control response, request-id conflict,
account/device mismatch, authentication denial, or durable storage corruption
fails closed. Known authentication/revocation denial uses the existing
`SellerAgentsControlClient.localReset()` invalidation path; it is not a second
revocation model.

## Server contract and persistence

`POST /v1/sync` is authenticated with the existing Seller Agents extension
bearer principal. The request is `seller_agents_sync_v1`, names the authenticated
installation, and contains 1–32 strict entries. The server validates account,
device, installation, request identity, mutation identity, and base revision.
Each entity is processed independently in a short PostgreSQL transaction.

The C3E migration adds `sync_entities` and `sync_request_receipts` with:

- account/entity uniqueness and account/install/request uniqueness;
- monotonic integer server revision;
- bounded JSON state containing only the contract allowlist;
- receipt fingerprint and mutation identity for exact idempotency;
- account and updated-time indexes.

The first matching request advances one entity revision exactly once. An exact
duplicate returns the stored deterministic result. Conflicting reuse fails
closed. A stale `baseRevision` returns `CONFLICT` with the minimum current
allowlisted state and does not overwrite server state. C3E retains the local
desired state and stops blind retry. C3F owns the later reconciliation choice.

## C3F integration boundary

C3F receives local pending/ACK/conflict status, server revision/current compact
state, binding revision/state, installation identity, compact delivery markers,
and deterministic local mutation ordering. C3E does not implement preferred
executor selection, last-delivered winner logic, clock-skew ordering, global
exactly-once, or a multi-browser lease.

## Stream 2 boundary

The dedicated Health/change-monitor and marketplace API watcher remain owned by
parallel Stream 2. No Stream-2 implementation or schedule was changed. The
existing Health client was consumed only as the already-accepted optional
authority observation dependency; C3E adds no Health polling or monitoring
agent.

## Initial RED batch

The pre-change source audit reproduced the reachable C3E failures: no durable
metadata after binding/Finish/delivery; no restart-safe request identity or
retry scheduler; no idempotent server path; no ACK-generation protection; no
explicit stale-base conflict; no failure isolation; no delivery marker; no
privacy allowlist; and no server contract/persistence. These are recorded as
C3E-RED-01 through C3E-RED-15 in the work terminal report:

1. binding mutation had no durable pending metadata;
2. pending state had no restart recovery;
3. retry identity was not durable/stable;
4. duplicate requests had no server idempotency receipt;
5. older ACKs had no generation guard;
6. stale base revision had no explicit conflict result;
7. sync failure was not isolated from local Work;
8. delivery had no compact marker boundary;
9. no bounded durable retry/backoff existed;
10. clean installs had no explicit no-heartbeat policy;
11. no sync path could enforce zero business replay;
12. no metadata allowlist prevented prohibited payloads;
13. one entity had no independent outcome boundary;
14. request-id reuse had no conflicting-content rejection;
15. authoritative denial had no separate fail-closed classification.

Root causes were the absent journal boundary, absent authenticated sync
contract, and no separation between local Work authority and later service
reconciliation.

## Evidence

Focused client source/extracted journal suite:
`node tests/regression/extension-core/client-i1/client-c3e-sync-journal.mjs`
(six scenarios, PASS 6/6 for both candidates). C3D autonomous lifecycle is a
separate PASS 18/18 suite for both candidates. Server contract tests in
`packages/server/sync/src/index.test.ts` PASS 4/4; DB unit/migration tests PASS
12/12; contracts PASS 9/9; API PASS 225/225; OpenAPI check PASS; the complete
extension I1 checker PASS with 126 subprocess checks. The final ZIP is
`/tmp/c3e-final-TzdPXk/package/SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`,
1,938,095 bytes, SHA-256
`b7c92c1630db11e983de53c99ebb49392412320325a5144e685a2764b393c9a8`;
repeat-archive and source/extracted-byte parity both PASS, with 39 runtime and
39 extracted files.

Toolchain: Node `/root/.nvm/versions/node/v24.20.0/bin/node` v24.20.0 and
pnpm 10.34.5. Native Chromium and database results are reported precisely if
the environment does not provide them. `google-chrome --version` reports
147.0.7727.116, but the native MV3 harness timed out waiting for the service
worker (the broader C1 harness also failed its initial authenticated-worker
assertion). PostgreSQL integration was not run because `DATABASE_URL` is not
set; no database server was available via `pg_isready`.

## Validation and deferred items

`pnpm docs:check` reports only pre-existing historical failures under
`repro/sa-i1-c2-3c1-r1-20260918`,
`repro/sa-i1-c2-3c1-r2-20260918`, and
`repro/sa-i1-c2-3c2-offline-continuation-authority-20260918-01`; no C3E file
adds a documentation error. The final candidate commit SHA/tree are recorded
in the terminal report after commit. Remote publication is deferred because no
legitimate publication process was available. Existing deferred ledger entries
remain: `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917`,
`PROVISIONAL_OWNER_REVIEW-HEALTH-TTL-20260917`,
`PROVISIONAL_OWNER_REVIEW-OFFLINE-ACTIVE-CONTINUATION-20260918 =
SUPERSEDED_BY_OWNER`, `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`, and
`PREEXISTING_DOCS_CHECK_FAILURES`. Health and marketplace monitoring remain
`OWNED_BY_PARALLEL_STREAM_2`; no Stream 2 implementation was changed.

Candidate commit/tree, package receipt, complete regression results, and any
pre-existing documentation failures are filled after the final validation run.
