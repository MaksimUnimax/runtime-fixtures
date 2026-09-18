# D3S2-2A Credential Transfer Foundation

Work ID: `D3S2-2A-CREDENTIAL-TRANSFER-CONTROL-PLANE-AND-EPHEMERAL-RELAY-FOUNDATION-2026-09-18`

Status: `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED`. This bounded local
receipt is not architect acceptance of A22/A23 and does not implement A24.

## Source of truth

- Repository: `MaksimUnimax/runtime-fixtures`.
- Start HEAD/tree: `f642b5c60c95b74f126f3f77c62921f2ce9234cb` /
  `0f896c4c28b468e7ae4288f070073a62b8af0b02`.
- Branch: `feature/d3s2-credential-transfer-foundation-2026-09-18`.
- Remote heads checked: `origin/main`/`origin/HEAD` are
  `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; the current integration head is
  `origin/integration/i1-c1-srv5-2026-09-16` at
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`. This candidate is not
  remote-verified.
- Migration audit: every active worktree checked; `0017_i1_c3e_sync_journal.sql`
  was latest and no active worktree had an `0018` allocation.
- Stream-2 protected paths were not modified:
  `apps/health-runner/**`, `packages/server/health/**`, `tooling/api-watch/**`.

Read sources included D3S2-1/R0 evidence, auth/device and extension-auth,
contracts, Fastify API composition, DB schema/repositories/migrations, C3E/C3F,
P3 scheduler, privileged control client, catalog, popup/runtime composition,
and existing API/OpenAPI tests.

## Design

Reused primitives are the authenticated `ExtensionPrincipal`, active
session/device revocation fence, Zod versioned contracts, request UUID
conventions, Drizzle/PostgreSQL, stable D3S2 store IDs and revisions, the
existing C3E/C3F models, popup-to-worker privileged boundary, and the single
P3 coordinator. No second sync journal or scheduler was created.

Decision marker: `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-CRYPTO-20260918`.

Crypto is browser WebCrypto ECDH P-256 with a fresh source ephemeral key,
HKDF-SHA-256 with a fresh 16-byte salt, and AES-256-GCM with a fresh 12-byte
IV and 128-bit tag. Recipient public keys are SPKI DER/base64. AAD is the
exact `{version, accountId, requestId, sourceDeviceId, recipientDeviceId,
packetId}` object; those bytes are also HKDF info. X25519 was deferred because
P-256 is the repository's broadly deployed WebCrypto baseline; RSA-OAEP was
deferred because it adds wrapping complexity. The choice is reversible only at
a new envelope version boundary.

The envelope max is 131,072 characters; request lifetime is 60–900 seconds,
default 300 seconds. The payload version preserves Ozon `{seller,
performance?}` and Wildberries `{token}` shapes. There is no secret-derived
hash or fingerprint.

Lifecycle: `REQUESTED → SOURCE_SEEN → PACKET_AVAILABLE_EPHEMERAL →
DELIVERED_TO_RECIPIENT → COMPLETED`; terminal `EXPIRED` and `CANCELLED`.
Source selection binds the first active source device. Every mutation checks
account, device, active auth/device, expiry, and lifecycle. Completion and
expiry cannot reopen.

Contracts are `POST` create, status read, bounded source discovery, source
claim, opaque packet submit, recipient packet receive, ACK/import decision, and
cancel under authenticated extension bearer access. Stable errors include
`SOURCE_OFFLINE`, `TRANSFER_EXPIRED`, `TRANSFER_REPLAY`,
`TRANSFER_ACCOUNT_MISMATCH`, and `TRANSFER_CONFLICT`.

## Durable metadata and ephemeral relay

Migration `0018_d3s2_credential_transfer_foundation.sql` adds only
`request_id`, `account_id`, `recipient_device_id`, nullable
`source_device_id`, `recipient_public_key_spki`, bounded
`selected_store_ids varchar(128)[]` (≤16), `state`, `revision`, `created_at`,
and `expires_at`, with account/device FKs, lifecycle/expiry indexes, and
bounded checks.

There is explicitly no ciphertext, envelope, plaintext credential, token
hash, credential hash, provider secret, decrypted payload, arbitrary secret
JSON, queue/job column, or sync-journal column in the durable schema.

`EphemeralTransferRelay` is an in-process `Map<requestId, opaque packet>`.
It is not serialized, persisted, queued, cached durably, logged, traced,
metric-labelled, error-serialized, or included in C3E. A process restart loses
packet bytes while request metadata remains. A valid active bound source may
retry with a new packet while the request is valid; a completed/expired
request cannot reopen. The repository exposes bounded `expireDue` cleanup.
Metadata retention default is 24 hours after terminal state for idempotency
and security review, then deletion:
`PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-METADATA-RETENTION-20260918`.

## UX, store safety, and autonomy

Recipient UI requires an explicit consent checkbox and states same-account
scope, encrypted Seller Agents transport, active-source requirement,
non-persistence, and separate A24 fallback. Source discovery encrypts without
a second confirmation. Only popup-origin messages reach transfer runtime;
raw credentials remain in the privileged worker and never enter content/page
messages or DOM.

Selection is by stable `storeId`. New stores preserve provider shape. Same
revision is `SAME_CURRENT`; another existing revision is `CONFLICT`;
tombstone, marketplace, provider identity, malformed, and account conflicts
fail closed. No conflicting/newer local credential is silently overwritten.

No idle timer, global polling, long-poll, WebSocket, heartbeat, provider call,
AI send, Work authority, binding revision, provider replay, or delivery replay
was added. There remains exactly one C3E journal and one C3F reconciliation
model.

## Red-first / green

The complete reachable matrix is mapped in
`packages/server/credential-transfer/src/credential-transfer.test.ts`:

- TR-01–08 request consent/idempotency/account/device/key binding;
- TR-09–14 discovery, offline, expiry, revoke/account fences, no polling;
- TR-15–23 Ozon Seller, optional Performance, WB, tamper, wrong key/AAD,
  replay and expiry;
- TR-24–30 metadata-only DB boundary, process loss, safe retry;
- TR-31–38 recipient validation-before-write, ACK, replay, logout/revoke and
  account switch fences;
- TR-39–48 stable IDs, provider-specific shapes, revision/tombstone/identity
  and marketplace conflict state;
- TR-49–60 zero provider/AI/ordinary-Work effects and privacy boundaries.

The initial red batch was created before implementation as eight grouped
executable cases covering all ranges; all eight initially failed at the absent
transfer service/crypto/relay boundary. Final result is 9/9 transfer tests
green, including process-loss retry. Synthetic secrets only.

Focused green receipts: transfer typecheck PASS; DB typecheck PASS; API
typecheck PASS; DB unit 12/12 PASS; API 225/225 PASS after expected route and
OpenAPI updates; OpenAPI check PASS; extension JS syntax PASS under Node 24.
The isolated PostgreSQL migration suite is 3/3 PASS. The broader PostgreSQL
integration run reached 36/40 files and 1,528/1,533 tests before five stale
count/hash expectations were corrected; the four affected files then passed
individually: auth 14/14, commercial final 80/80, admin security 77/77, and
adapter registry 7/7. Workspace `pnpm test`, recursive typecheck, lint,
format, API build, and bridge guard are PASS. `docs:check` remains red only on
pre-existing unrelated `repro/` missing-newline/broken-link evidence.

## Package and installed status

Existing deterministic composition was rebuilt with source/generated and
extracted/package parity:

- `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`;
- 2,045,982 bytes;
- SHA-256 `092a9a5dfeb075b93cf5552279b55d80800c54bd1797ddd570fc04c99b53ee38`;
- repeat archive match PASS; source/extracted byte match PASS.

The crypto helper is present in the generated worker prelude. Google Chrome
was available, but the unpacked MV3 service worker did not register in the
headless/Xvfb probe for either runtime or extracted package, so a native
two-persistent-context installed end-to-end transfer run was not available in
this bounded execution. Therefore source/generated and extracted/package
transfer acceptance, PostgreSQL ciphertext absence under installed flow,
server restart, logout/revoke, conflict import, and A22/A23 are not claimed.
No other browser family is inferred.

## Security review and next boundary

Account/device/request/key/source substitution, expiry, replay, tampering,
wrong recipient, logout/revoke, process restart, page/content-script access,
and logging/tracing serialization were reviewed. All fail closed in the
domain tests or contract boundary. Transfer provider count and AI send count
are zero; Stream-2 implementation overlap is zero.

Before architect acceptance, run actual unpacked Chromium recipient/source
persistent contexts for source/generated and extracted/package extensions with
PostgreSQL inspection, server loss/retry, all substitution/tamper/replay and
expiry cases, Ozon Seller-only, Ozon Seller+Performance, WB, safe import and
conflict UI, zero provider calls, and zero AI sends. Then review the retention
default and final conflict-choice UX. A24 remains separate.
