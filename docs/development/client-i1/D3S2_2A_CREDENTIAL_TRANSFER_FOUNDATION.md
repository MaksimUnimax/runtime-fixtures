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

| Threat | Control | Result |
|---|---|---|
| Account or device substitution | Principal account/device checks plus recipient-device FK | Fail closed |
| Public-key or request substitution | Idempotent request equality and immutable logical request key | Fail closed |
| Wrong source or recipient | Bound source device, recipient device, account, and AAD | Fail closed |
| Expiry, logout, or revoke race | Active-device fence and server-side expiry on every mutation | Fail closed |
| Packet tampering or wrong private key | AES-GCM authentication with request-bound AAD | Fail closed |
| Replay after ACK/expiry | Terminal lifecycle and relay deletion | Fail closed |
| Server restart or relay loss | In-memory-only relay; metadata remains incomplete | Packet lost safely; retry allowed while valid |
| Page/content-script secret access | Privileged worker-only encryption/import; safe result projections | No raw credential crossing |
| Log/trace/error leakage | Opaque packet relay and no packet serialization fields | No packet persistence path |
| Store conflict/tombstone/provider mismatch | Stable storeId, revision, lifecycle, marketplace/provider checks | No silent overwrite |

Transfer provider count and AI send count are zero; Stream-2 implementation
overlap is zero.

Before architect acceptance, run actual unpacked Chromium recipient/source
persistent contexts for source/generated and extracted/package extensions with
PostgreSQL inspection, server loss/retry, all substitution/tamper/replay and
expiry cases, Ozon Seller-only, Ozon Seller+Performance, WB, safe import and
conflict UI, zero provider calls, and zero AI sends. Then review the retention
default and final conflict-choice UX. A24 remains separate.

## R1 installed acceptance-closure evidence — 2026-09-18

This section is appended to preserve the original 2A history. The bounded R1
work started at `fe7d02c9374314ca827749fb4d8dfe71fbdb7f4d` (tree
`f69a36a4f114c318d6b2e85c73343025c6ef3133`) on
`feature/d3s2-credential-transfer-foundation-2026-09-18`, with
`f642b5c60c95b74f126f3f77c62921f2ce9234cb` as the accepted ancestor.

### Service-worker differential

The complete pre-patch failure batch was collected before production edits.
System Google Chrome 147.0.7727.116, using the earlier actual-unpacked
invocation, loaded the extension ID/blessed extension context but emitted no
MV3 service-worker target for both accepted f642 source/generated and
extracted/package, and for both pre-R1 fe7d source/generated and
extracted/package. No manifest error, worker parse/import error, CSP/permission
error, startup exception, or missing-file error was reported. This is
`PRE_EXISTING_BROWSER_ENVIRONMENT_FAILURE` with a
`PRE_EXISTING_HARNESS_FAILURE` route mismatch, not a candidate regression.

The canonical Playwright Chromium 151.0.7922.34 procedure then registered a
worker for all four routes: f642 source/generated and extracted/package, and
fe7d source/generated and extracted/package. The candidate worker exposed the
transfer runtime in both package forms. Therefore the exact answer is: the
failure was present on accepted f642, was not introduced by 2A, and the
canonical installed harness is functional. The R1 product fixes were the real
recipient UI/runtime receive path, production route read, and `storeId` to
catalog `id` adaptation discovered by the installed run.

### Installed two-context transfer

The new harness uses two persistent Playwright Chromium profiles, separate
unpacked installations, the real popup/application UI, real HTTP routes, a
same-account synthetic identity, and distinct authenticated devices. It does
not call transfer helpers directly. Both forms completed the Ozon Seller plus
optional Performance happy path:

| Case | Browser | Result | Request / store | Provider / AI |
|---|---|---|---|---|
| source/generated | Chromium 151.0.7922.34 | PASS: consent, request, discovery, encrypt, relay, decrypt, import, ACK, completed | `385ab525-6a6d-459d-b9dc-27014847d641` / `r1-source-generated-ozon` | 0 / 0 |
| extracted/package | Chromium 151.0.7922.34 | PASS: same installed flow | `bbafd3c4-15c4-46d7-bd39-6afa3d645ac2` / `r1-extracted-package-ozon` | 0 / 0 |

The recipient explicitly clicked `Получить передачу` after the consent UI;
recipient key material was generated and retained by the privileged worker.
The source discovered the request through the production read route and did
not require a second confirmation. The installed receipt records only
ciphertext request hashes (`bbd54c2d…8526bc` and `3a5e763a…6883ee`), never
the packet bytes. The test starts with a blank target store and verifies the
provider-shaped Ozon import and optional Performance section.

The individually requested installed cases are classified as follows:

| Cases | Installed result |
|---|---|
| TR-BR-01–04 | PASS in both package forms: UI consent/request, source discovery, Ozon Seller, Seller+Performance |
| TR-BR-05 | NOT RUN installed: WB remains covered by transfer/domain tests, not this two-context receipt |
| TR-BR-06 | NOT RUN as an installed process-kill; lower relay test is PASS for loss and safe retry |
| TR-BR-07–18 | NOT RUN as the complete installed adversarial matrix; lower HTTP/domain coverage is PASS |
| TR-BR-19–24 | NOT RUN as installed conflict matrix; lower import/domain coverage is PASS and fail-closed |
| TR-BR-25–26 | NOT RUN as installed source-offline/wake; lower lifecycle coverage is PASS and no permanent poller exists |

This distinction is intentional: the two happy-path installations are green,
but R1 does not self-accept the unexecuted installed adversarial and lifecycle
cases.

### Crypto and confidentiality review

The implementation uses WebCrypto ECDH P-256, HKDF-SHA-256, and AES-256-GCM.
Each packet has a fresh source ephemeral ECDH key, a fresh 16-byte HKDF salt,
and a fresh 12-byte AES-GCM IV with a 128-bit tag. HKDF `info` and AES-GCM AAD
are the same explicit versioned binding containing `version`, `accountId`,
`requestId`, `sourceDeviceId`, `recipientDeviceId`, and `packetId`. Public keys
are strict SPKI DER/base64 values; malformed keys fail at WebCrypto import.
The envelope is `credential_transfer_envelope_v1`, and the server bounds its
serialized size at 131072 bytes. Recipient private CryptoKey material remains
in the privileged worker's in-memory map and is not sent to page/server or
persisted. Plaintext and keys are not logged.

Supported server-confidentiality claim: with normal protocol state persisted
or available, the server has metadata, the recipient public key, and opaque
ciphertext, but no recipient private key; it therefore cannot decrypt by
following the normal protocol. This does not claim resistance to a fully
malicious server that rewrites application code.

### Persistence, loss, and privacy

The request table contains durable request/status metadata only: account,
device, request/status identifiers, public key, expiry, revision/idempotency,
and lifecycle timestamps. Ciphertext is absent from PostgreSQL schema/rows,
durable queues/jobs, C3E state, and structured server fields. The relay is
bounded process memory only. The lower process-loss test is green: relay loss
leaves metadata incomplete, no invented packet/completion appears, and a valid
retry creates a new ephemeral delivery. The installed happy-path receipts
were searched for unique plaintext/ciphertext markers; no marker or packet
bytes were written to evidence, logs, or database rows.

Retention remains provisional under
`PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-METADATA-RETENTION-20260918`: bounded
metadata-only retention sufficient for idempotency/security, not indefinite
transfer history, and independent of ciphertext. Crypto remains provisional
under `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-CRYPTO-20260918`.

### Full verification receipts

- PostgreSQL integration after all five fixture corrections: **40 files,
  1,533 tests passed**, single-fork sequential run, exit 0; migrations through
  0018 applied.
- DB unit: 3 files / 12 passed. API unit: 18 files / 225 passed. Transfer
  domain: 9 / 9 passed. OpenAPI generation/drift: PASS. Typecheck, lint,
  format, build, and bridge guard: PASS.
- E2E server suite: **88 tests passed**, single-worker Playwright run, exit 0,
  against the task-owned ephemeral PostgreSQL database.
- Extension Core: PASS, 111 gate processes. Extension I1: all AUT-01–46 and
  AUT-48–50 pass; AUT-47 remains the known native system-Chrome registration
  environment check and is separately classified environment-deferred. The
  canonical Playwright installed differential above is green.
- Final package: deterministic repeat build PASS; source/generated and
  extracted/package byte parity PASS; 2,048,125 bytes; SHA-256
  `4208f4d4115cd2ecbaf2bba78574f2cfade774a65e43306260fb05b32c381505`.

### Safety and non-overlap

Transfer caused zero marketplace-provider requests and zero AI sends in both
installed runs. Ordinary Ozon/WB mandatory authorization and ordinary AI
delivery control calls remained zero in the transfer harness. No production
provider call, AI send, permanent polling, WebSocket, or heartbeat was added;
P3 remains one bounded wake task where applicable. C3E remains exactly one
journal and C3F exactly one reconciliation model. No files under
`apps/health-runner/**`, `packages/server/health/**`, or `tooling/api-watch/**`
were modified. No Stream-2 overlap was found.

### R1 status

A22 is `PARTIAL_AUTOMATED`: installed consent, source availability path,
encrypted ephemeral relay, and two-package happy path are proven, while the
installed loss/offline/adversarial matrix and full durable-artifact inspection
are not all executed through two browser contexts.

A23 is `PARTIAL_AUTOMATED`: installed authenticated import/ACK is proven and
lower tests cover substitution, expiry, logout/revoke, replay, and conflict
fail-closed behavior; the complete requested installed security/conflict matrix
is not claimed. Remaining blockers before architect acceptance are the explicit
TR-BR-05–26 installed cases marked NOT RUN above, final E2E receipt, and owner
review of the two provisional decisions. A24, Stream 2, deployment, and store
publication remain out of scope.
