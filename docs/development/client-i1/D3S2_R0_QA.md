# D3/S2 R0 — QA, contradiction, and privacy review

## Contradictions and duplicate-model risks

1. The local candidate is exact and accepted by the carried-forward task
   status, but local roadmap/status prose still uses pending-review wording for
   parts of the Early-I1 line. This audit follows exact local evidence and the
   explicit current handoff; it does not rewrite history.
2. Remote `main` and the remote roadmap branch are behind the accepted local
   C3E/C3F/P1/P2/P3 line. Remote status is historical context, not current
   implementation truth.
3. The architecture docs describe future shop metadata and transfer endpoints,
   but no store domain route, transfer route, export/import module, or transfer
   migration exists in the verified tree.
   Existing legacy “download diagnostics” actions are not SA-KEY-02: they do
   not provide an encrypted all-store credential export/import format.
4. A future `STORE_METADATA`/tombstone extension must use the existing C3E
   journal, request receipts, entity repository, and C3F reconciliation rules.
   A second sync queue, server lease, heartbeat, or competing winner algorithm
   would violate the accepted architecture.
5. `preferredExecutor` is metadata only. It cannot authorize transfer, grant
   Work, become a quota lease, or cause provider/result replay.
6. Transfer ciphertext cannot be placed in the ordinary sync JSONB state:
   that state is durable by design, while SA-KEY-01 requires secret payloads to
   remain ephemeral and absent from DB/queues/logs/traces/backups.

## Security and privacy review

### Existing safe boundaries

- C3E payload allowlist excludes seller tokens, command text, reports, files,
  AI text, Health envelopes, storageState, and arbitrary diagnostics.
- C3F persists only compact binding/reconciliation/marker metadata.
- P1 stores technical provider-attempt state without raw request/response
  bodies and never automatically replays UNKNOWN provider outcomes.
- P2 result recovery is bounded, sanitized, local, and no-provider-replay.
- P3 scheduler stores identity-only wake metadata and does not become authority.
- Local catalog credentials are account-scoped and exposed to the popup only as
  presence/identity projections, not server sync payloads.

### Transfer requirements that remain missing

- recipient ephemeral/public-key generation and recipient-bound authenticated
  encryption;
- same-account/device/request/expiry validation;
- source reachability and clear source-offline behavior;
- ephemeral in-memory relay with no durable ciphertext path;
- ACK/consume state and fail-closed expiry/logout/revoke/substitution/replay;
- diagnostics and traces that prove metadata-only handling without printing
  ciphertext or decrypted values.

Synthetic test values only are permitted. Real Ozon/WB credentials, refresh or
access secrets, storageState, raw reports, AI bodies, and decrypted transfer
payloads must not be placed in code, logs, fixtures, or evidence.

### Export/import requirements that remain missing

- versioned all-store envelope;
- standard password KDF and WebCrypto/library authenticated encryption;
- strict field allowlist and unknown executable-semantics rejection;
- bounded byte/record/nesting limits;
- explicit conflict reporting and old-format adapters;
- pre-write integrity verification and no automatic Work/provider start.

## Recommended RED tests for the first implementation

These are the starting RED tests for
`D3S2-EXT-C3E-C3F-STORE-METADATA-STATE-2026-09-18`; they are not claimed as
implemented by R0:

- `STORE-RED-01`: two stores of the same marketplace retain distinct stable
  IDs, metadata, credentialRevision values, and server entity identities;
- `STORE-RED-02`: Ozon Seller-only metadata is valid without Performance, while
  Performance metadata never authorizes Seller or crosses into WB;
- `STORE-RED-03`: WB token metadata follows WB rules and cannot be interpreted
  as Ozon credentials;
- `STORE-RED-04`: changing credentials increments/replaces credentialRevision,
  invalidates affected local work, and never silently changes providerAccountId;
- `STORE-RED-05`: a confirmed providerAccountId mismatch is rejected or
  requires an explicit new store, never relabeled under the old store ID;
- `STORE-RED-06`: delete produces a bounded tombstone/equivalent state that
  converges to other installations without storing credentials or a report;
- `STORE-RED-07`: duplicate requestId/mutationId ACK is idempotent; conflicting
  request reuse fails closed;
- `STORE-RED-08`: stale and out-of-order ACKs cannot erase a newer store
  mutation, bindingRevision, Finish, or tombstone;
- `STORE-RED-09`: one store metadata conflict/backlog does not block another
  store, dialogue, or ordinary provider command;
- `STORE-RED-10`: disconnected installation state is UNKNOWN, not inferred as
  deleted/revoked or permission-denied;
- `STORE-RED-11`: sync rows contain metadata only and reject token, report,
  file, AI body, authorization header, Health, storageState, and ciphertext;
- `STORE-RED-12`: ordinary command and delivery control-call delta remains zero
  when metadata sync is pending or unavailable;
- `STORE-RED-13`: bindingRevision/store change/Finish continues to outrank
  late delivery markers and preferred-executor metadata;
- `STORE-RED-14`: account A cannot read, mutate, or reconcile account B store
  metadata, tombstones, credentials, or revisions;
- `STORE-RED-15`: no server lease, heartbeat, WebSocket, provider replay,
  result replay, or AI resend is introduced by the extension.

## Acceptance boundary

The next feature should be accepted only after scoped contract/schema tests,
real or task-owned PostgreSQL migration/integration checks where applicable,
source/package extension tests, privacy scans, and preserved C3E/C3F/P1/P2/P3
regressions. Live provider-account identity, full browser-family, Stream 2,
remote publication, and production deployment remain separate gates.

R0 therefore reports a recoverable dependency boundary, not a new product PASS.
The historical A03 bounded automated acceptance remains
`PASS_AUTOMATED_CURRENT_SCOPE` for local delete ending/fencing local work and
rejecting a late result from attaching to another store. D3/S2 store-state
convergence is an extension beyond that bounded scope; it does not revoke or
rewrite the A03 result.

## No duplicated accepted models

This recovery artifact explicitly does not duplicate or replace any accepted
C3E/C3F/P1/P2/P3 model. It recommends extending their existing boundaries and
preserving their authority, no-replay, reconciliation, privacy, and scheduler
semantics.
