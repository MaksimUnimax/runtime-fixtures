# D3/S2-3 A24 — encrypted all-stores export/import

Work ID: `D3S2-3-A24-ENCRYPTED-ALL-STORES-EXPORT-IMPORT-2026-09-18`
Candidate: `SA-KEY-02`
Status: `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED / ARCHITECT_REVIEW_REQUIRED`

This is a bounded Stream-1 candidate. It does not self-accept A24, reopen A22/A23, start Q1, start S1.2, modify Stream 2, deploy, publish to a browser store, or add monetization.

## Source of truth and boundaries

- Repository: `MaksimUnimax/runtime-fixtures`.
- Start HEAD/tree: `244e6a5596ed19620a775828b407ade264aac457` / `568f7897d54ee5e404aef596bb89fa0746928c15`.
- Implementation final HEAD/tree: `403b5b3e29cb372b97913f66335720bb266a73ce` / `1d707df227ffe3b5324c04a9eba42ef1c6bffb95`.
- Branch: `feature/d3s2-a24-export-import-2026-09-18`.
- Accepted ancestor verified with `git merge-base --is-ancestor`.
- Remote heads read: `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`; the A24 branch has no remote head.
- Pre-existing untracked fixture directories under `packages/server/**` and `repro/**` were preserved. No Stream-2 implementation file was changed: `apps/health-runner/**`, `packages/server/health/**`, and `tooling/api-watch/**`.
- No server route, OpenAPI contract, migration, or server credential storage was added.

## Historical format investigation

The imported Ozon and WB sources contain real provider-specific credential backups:

| Historical signature | Classification | Adapter |
|---|---|---|
| `ozon-bridge-credentials-backup` v2, checksum-bearing Seller + optional Performance | `SUPPORTED_EXPLICIT_ADAPTER` | Maps the exact fields to one new Ozon local store |
| `ozon-bridge-seller-credentials-backup` v1, checksum-bearing Seller-only | `SUPPORTED_EXPLICIT_ADAPTER` | Maps the exact fields to one new Ozon local store |
| `wildberries-bridge-seller-credentials-backup` v1/v2, checksum-bearing Personal token | `SUPPORTED_EXPLICIT_ADAPTER` | Maps the exact fields to one new WB local store |
| Unknown version, unknown provider signature, similar JSON field names | `AMBIGUOUS_REJECTED` | No conversion |

These historical files are plaintext and have no account binding. Adapters are exact-signature, exact-version, strict-field, checksum-verified paths; they generate a new local store identity and bind the result to the currently authenticated account. The current A24 encrypted format is not a compatibility alias for any of them. No fake legacy format was created.

## Current format

The file is one bounded JSON envelope:

```text
seller_agents_store_backup
  envelopeVersion: 1
  kdf: PBKDF2-HMAC-SHA-256, SHA-256, iterations, base64 salt
  encryption: AES-256-GCM, keyLength 256, base64 12-byte IV, 128-bit tag
  ciphertext: base64 authenticated ciphertext
```

The canonical immutable header is authenticated as AES-GCM AAD. It binds the magic, envelope version, KDF name/hash/iterations/salt, encryption name/key length/IV/tag length. Outer unknown fields, algorithms, versions, invalid encodings, and trailing JSON are rejected.

The decrypted payload is `seller_agents_store_backup_payload_v1` with:

- `accountBinding.accountId`;
- non-authoritative `createdAt`;
- an array of active stores;
- stable `storeId`, label, marketplace, provider identity state/account ID, `credentialRevision`, and `metadataRevision`;
- Ozon `{type: "ozon", version: 1, seller, performance|null}`;
- WB `{type: "wildberries", version: 1, token, tokenType: "personal"}`.

Excluded fields are auth/access/refresh tokens, device sessions, cookies, storageState, transfer requests/keys/packets, C3E pending journal, Work/dialogue/execution state, conversation keys, binding/work generations, queues, technical state, result/report buffers, downloaded files, AI message bodies, Health state, diagnostics, evidence, logs, and tombstoned stores. `personalDataEnabled` is intentionally not exported because it is local execution policy, not credential portability.

## Crypto and limits

- KDF: PBKDF2-HMAC-SHA-256.
- Chosen iterations: `210000`.
- Accepted import range: `100000..600000` iterations.
- Salt: random 16 bytes per export; accepted range 16–64 bytes.
- Encryption: AES-256-GCM with random 12-byte IV and 128-bit tag.
- Password: minimum 8, maximum 256 characters; never stored or sent remotely; references are cleared by the popup after successful operations where practical.
- Outer file limit: 8 MiB.
- Ciphertext limit: 8 MiB; store count limit: 100; parser depth limit: 8; label limit: 80; bounded credential/string fields; duplicate store IDs rejected.
- No deterministic key derives from account/store IDs; no checksum is used as confidentiality.

Reversible owner markers: `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-KDF-20260918` and `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-IMPORT-LIMITS-20260918`. Alternatives considered were a higher-cost memory-hard browser KDF and a different WebCrypto construction; PBKDF2/AES-GCM was selected for reviewed browser compatibility and can be replaced only at a new envelope version boundary.

## Import safety and UX

Export is a popup action for the current account and downloads `seller-agents-store-backup-v1.json`, which exposes no account, email, provider ID, or password. Import reads a bounded local file, decrypts/validates in the privileged worker, shows counts/marketplaces/conflicts, and requires a second explicit local action.

The catalog builds a complete plan before writing. `IMPORT_NEW` is applied; `SAME_CURRENT` is not rewritten; local credential/revision differences are `LOCAL_NEWER` and skipped; tombstones, provider identity mismatches, marketplace mismatches, invalid IDs, and unsafe shapes fail closed. There is no authoritative ordering in the existing opaque `credentialRevision` values, so a backup that appears newer cannot silently overwrite local material. One catalog mutation writes the complete safe set, with a readback-verified existing storage primitive and an injected write-failure test proving the previous snapshot remains unchanged. Imported credentials retain their file revision as a fence; any later Work admission must satisfy the existing credential-revision fence. C3E metadata-only journal records may be queued after local success and never block it.

Import does not call Work Start/Resume, provider transport, AI delivery, or control-plane APIs. Popup-origin validation prevents content/page messages from invoking backup commands or receiving raw plaintext.

## Red-first / green

The complete reachable A24 matrix is represented by `EX-01..EX-74` in `client-d3s2-a24-export-import.mjs`, grouped into ten executable assertion groups plus the atomic-write case. The grouped ranges cover export boundary, crypto/tamper, resource limits, account isolation, provider shapes, conflicts/lifecycle, legacy adapters, and privacy. The initial batch was deliberately red before the implementation because the backup helper, catalog operations, UI controls, and worker routes did not exist. Final focused result: all 74 mapped cases green; the runner reports 10 grouped PASS records and `EX-56` atomic-write PASS.

## Installed Chromium result

Runner: `tests/regression/extension-core/client-i1/browser_d3s2_a24_export_import.py`. It used canonical Playwright Chromium, actual unpacked MV3 source/generated and extracted/package runtimes, real popup controls, two clean persistent profiles for the same synthetic account, and a real downloaded file.

| Installed case | Source/generated | Extracted/package |
|---|---:|---:|
| four-store UI export: two Ozon (Seller-only and Seller+Performance) + two WB | PASS | PASS |
| encrypted downloaded bytes, no plaintext markers | PASS | PASS |
| same-account clean-profile preview/import | PASS | PASS |
| Ozon Seller-only / Seller+Performance / WB shapes | PASS | PASS |
| wrong password | PASS | PASS |
| ciphertext tamper | PASS | PASS |
| account mismatch | PASS | PASS |
| provider identity, marketplace, local-newer, tombstone conflict set | PASS | PASS |
| real Ozon Seller-only v1 adapter through import UI; unknown old-looking JSON rejected | PASS | PASS |
| zero Work sessions/resume/commands/AI sends/provider requests | PASS | PASS |
| zero mandatory control-server requests; server unavailable behavior | PASS | PASS |

The installed receipt was run against configured packages with an ephemeral synthetic trust key. It did not use direct helper calls for the main export/import journey. The server was not required for the local operation; request accounting observed zero `/v1/health-authority`, `/v1/bootstrap`, and `/v1/sync` calls caused by the backup flow.

## Package receipt

Configured deterministic build command: `python3 tooling/build/extension_composed.py --output <dir>` with a synthetic local trust configuration. The build reported repeat archive equality and source/extracted byte equality.

- ZIP: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`.
- ZIP bytes: `2,076,761`.
- ZIP SHA-256: `b5c3a633a4abce7f83403c16656f76d41564cb92f392d8d3479b9d132ba44fac`.
- Runtime file count: 39; extracted file count: 39; JavaScript syntax: 36/36 in each runtime.
- Repeat build: PASS; runtime/extracted parity: PASS; inventory parity: PASS.

## Regression and governance

The focused A24 helper and installed source/package matrix pass. Existing C3F reconciliation kernel remains PASS when run with its own harness. The full `tooling/checks/extension_i1.py` run reached the pre-existing C3H `AUT-47` native-unpacked browser-environment deferral before completing the full suite; this is not an A24 failure. A direct invocation of unrelated C3G/application tests without their required harness setup produced `AUTH_REQUIRED` setup failures and is not counted as A24 evidence. No server regression was required because no server/contracts/migrations changed. A22/A23 were not reopened.

Remote publication/readback: `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no force push and no remote branch was created. Owner-deferred decisions are the KDF and import bounds above. Architect acceptance remains required.

## Candidate answer matrix

1. One file contains all active stores for the current account: **yes**.
2. Login/auth sessions excluded: **yes**.
3. Work/dialogue/execution state excluded: **yes**.
4. Result/report buffers excluded: **yes**.
5. Transfer private/session materials excluded: **yes**.
6. Standard reviewed primitives: **yes, PBKDF2 + AES-GCM WebCrypto**.
7. Wrong password before write: **yes**.
8. Tamper before write: **yes**.
9. Explicit format version: **yes**.
10. Unknown future versions rejected: **yes**.
11. Known legacy only explicit adapters: **yes**.
12. Heuristic conversion forbidden: **yes**.
13. File size bounded: **yes, 8 MiB**.
14. KDF bounded: **yes, 100000..600000**.
15. Store/depth/string resources bounded: **yes**.
16. Account A silently into B: **no**.
17. Ozon Seller-only round trip: **yes**.
18. Ozon Seller+Performance round trip: **yes**.
19. WB round trip: **yes**.
20. Newer local credential silently overwritten: **no**.
21. Tombstone silently resurrected: **no**.
22. Provider identity mismatch overwrite: **no**.
23. Marketplace mismatch import: **no**.
24. Silent partial corruption after failed commit: **no** within the bounded storage-write model; injected write failure passed.
25. Import starts/resumes Work: **no**.
26. Import executes marketplace requests: **no**.
27. Export/import sends AI: **no**.
28. Seller Agents server required: **no**.
29. Password sent to server: **no**.
30. Automatic upload: **no**.
31. Plaintext exposed to page/content script: **no**.
32. Stream-2 implementation files modified: **no**.
33. A24 fully proven for bounded automated scope: **no — candidate only; architect review and broader regression closure remain**.
34. Automated blockers: pre-existing C3H AUT-47 environment deferral; unrelated direct-regression harness setup failures; remote publication/readback unavailable/deferred.

## R1 broader regression and harness differential closure — 2026-09-18

Work ID: `D3S2-3-R1-A24-BROADER-REGRESSION-AND-HARNESS-DIFFERENTIAL-CLOSURE-2026-09-18`.
This is evidence-only R1 closure. No A24 product feature, production/harness
code, Stream-2 implementation, server route, migration, contract, or API was
added or changed.

### Candidate identity and preflight

- Start HEAD/tree: `5bfccdbb384b201e2c1d7d3046151a4340cd6243` /
  `d88e75fa71b2346c9e09ab5de37321b93b3e78b2`.
- Branch: `feature/d3s2-a24-export-import-2026-09-18`.
- Accepted ancestor: `244e6a5596ed19620a775828b407ade264aac457`, ancestry check
  PASS.
- The only Stream-1 descendants of the accepted A24 candidate are the existing
  branch commits `403b5b3`, `38f0077`, and `5bfccdb`; no newer legitimate
  Stream-1 descendant or remote A24 head was found.
- Remote readback: `origin/main` =
  `bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16` =
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`, and
  `origin/docs/roadmap-autonomy-correction-2026-09-18` =
  `6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- Tracked worktree state was clean before R1 evidence editing. Existing
  untracked `packages/server/**` symlink/repro content was not touched.
  `apps/health-runner/**`, `packages/server/health/**`, and
  `tooling/api-watch/**` have zero diff from the accepted base.

### Differential: C3G and application AUTH_REQUIRED

The reported isolated route was replayed with the same Node 24 invocation and
the same packaged synthetic trust configuration against both the accepted base
and the pre-R1 candidate:

```text
node tests/regression/extension-core/client-i1/client-c3g-corrected-predispatch.mjs <configured-runtime>
node tests/regression/extension-core/application.mjs <configured-runtime>
```

The configured runtime was built by the canonical `make-browser-config.mjs`
fixture composition. Both `244e6a` and `5bfccdb` produced the same
`AUTH_REQUIRED` before the A24 backup path or provider dispatch was reached:

- C3G: `C3G-RED-10`, `C3G-RED-11`, and all direct cases fail at worker fixture
  setup with `AUTH_REQUIRED`; no production A24 code is reached.
- Application: `application.mjs:58` account-only popup setup receives
  `{ok:false, code:"AUTH_REQUIRED", error:"AUTH_REQUIRED"}`; no A24 code is
  reached.
- Root cause: the model fixture signs with its worker-local `fixture-key`,
  while the installed packaged configuration trusts the independent
  `browser-fixture-key`. This is a package-fixture identity mismatch, not a
  product auth-state change.
- Classification: `PRE_EXISTING_C3G_HARNESS_SETUP_FAILURE` and
  `PRE_EXISTING_APPLICATION_HARNESS_SETUP_FAILURE` respectively; equivalently
  a pre-existing direct packaged-fixture invocation limitation. It is not an
  `A24_C3G_REGRESSION`, `A24_AUTH_STATE_REGRESSION`, or
  `A24_APPLICATION_REGRESSION`.

The accepted canonical composition, without the incompatible installed trust
fixture, passes identically on base and candidate: C3G `12/12`, application
regression `APP-00..10` plus `C3A-01..04`, and zero live provider calls.

The older direct `client-c3e-sync-journal.mjs` was also run on base and
candidate. Both stop at the same stale assertion expecting `BINDING_UPSERT`
where the accepted D3/S2 line correctly emits `STORE_UPSERT`. This is
`PRE_EXISTING_C3E_HARNESS_VERSION_MISMATCH`; the canonical D3/S2 C3E route is
the accepted `STORE_UPSERT` route below.

### AUT-47 classification

The accepted semantic evidence remains the Playwright-managed Chromium route,
not system Google Chrome registration. The current candidate reran the same
legitimate Chromium route: installed C1 `BR-C1-01..36` passed for both
source/generated and extracted/package, and the A24 installed route also
registered and passed for both forms. C3H therefore reports `AUT-01..46`,
`AUT-48..50` plus the Chromium proof for `AUT-47` as functional PASS.

Classification: `AUT47_CURRENT_CANONICAL_PASS` and
`AUT47_CANONICAL_PASS_NATIVE_ENVIRONMENT_DEFERRED`. The separate system/native
Chrome MV3 registration mismatch remains environment-only; it is not an A24
regression and no production auth workaround was added.

### Current-candidate regression receipt

| Gate | Result |
|---|---|
| A24 focused `EX-01..EX-74` | `74/74 PASS`, source helper and extracted helper |
| Actual-unpacked A24 source/generated | PASS: four-store export, same-account import, wrong password, tamper, account mismatch, conflicts, legacy/unknown rejection |
| Actual-unpacked A24 extracted/package | PASS: same matrix |
| A22/A23 transfer domain | `9/9` transfer tests PASS; zero provider/AI effects |
| A22/A23 installed transfer rerun | Environment-deferred before cases: available DBs reject the fixed fixture identities as collisions; a fresh disposable DB could not be provisioned because the host filesystem was full (`No space left on device`) |
| Canonical C3E | PASS: journal rename, offline retention, tombstone, recovery; canonical D3/S2 metadata route `59/59 PASS` |
| Canonical C3F | `28/28 PASS`, source and extracted direct runtimes |
| Canonical C3G | `12/12 PASS`, source and extracted direct runtimes |
| C3H | `50/50 PASS` with legitimate Chromium proof; no functional failures |
| P1 | `10` provider-outcome scenarios PASS; UNKNOWN no-replay |
| P2 | `9` result-recovery scenarios PASS; additional provider calls `0` |
| P3 | `7` scheduler scenarios PASS; 100-wake soak PASS, duplicate side effects `0` |
| Extension Core | `111/111 PASS` canonical unconfigured source/package checker |
| Extension I1 | `140/140 PASS` source and extracted/package checker with Chromium proof |
| Application regression | PASS in canonical model and installed C1 `36/36` |

The installed transfer limitation is an environment receipt only. The prior
accepted A22/A23 installed transfer evidence remains unchanged; no A22/A23
implementation file was modified by A24.

### Package and installed proof

The configured final A24 package was rebuilt deterministically with the
synthetic trust bundle used by the installed route:

- ZIP: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`;
- ZIP size: `2,076,761` bytes;
- ZIP SHA-256: `0166cd246f5b37229caa1f33f284db5c4530892498882c0659e3e6759fcfedc6`;
- repeat ZIP equality: PASS;
- source/extracted byte equality: PASS;
- runtime files: `39`; extracted files: `39`; JavaScript files: `36/36`
  syntax PASS in each;
- source/extracted inventory and per-file hashes: equal;
- canonical fixture-neutral I1 checker package: `2,075,976` bytes,
  SHA-256 `5f023926ce9fb140766b25fdb4dbe104ce5861f4996d2d3f01b5817aeca64b9c`,
  repeat equality PASS.

The installed configured source/generated and extracted/package A24 runs each
reported PASS for export, four active stores, same-account clean-profile import,
Ozon Seller-only, Ozon Seller+Performance, WB, wrong password, tamper, account
mismatch, provider/marketplace/local-newer/tombstone conflicts, explicit
legacy adapter, unknown old-looking JSON rejection, zero Work sessions, zero
provider requests, and zero mandatory control requests.

### Server and contract no-change proof

The exact Git diff from `244e6a` to `5bfccdb` contains no files under
`apps/api`, `packages/server`, `packages/contracts`, or `packages/shared`; no
server route, migration, OpenAPI file, or contract changed. No backup storage,
backup upload, password transport, or server backup route exists. A full
PostgreSQL/API/E2E rerun was therefore not required for A24’s unchanged server
surface. The installed A24 local operation observed zero `/v1/bootstrap`,
`/v1/sync`, and mandatory control-plane requests after the baseline.

### Zero-side-effect and privacy receipt

- A24 export provider calls: `0`; import provider calls: `0`.
- A24 export AI sends: `0`; import AI sends: `0`.
- A24 export mandatory server calls: `0`; import mandatory server calls: `0`.
- Ordinary Ozon control calls: `0`; ordinary WB control calls: `0`; ordinary
  AI-delivery control calls: `0`.
- Work created by import: `0`; provider replay caused by A24: `0`; AI UNKNOWN
  resend caused by A24: `0`.
- Synthetic password and active credential markers were absent from encrypted
  downloaded bytes, logs, diagnostics, page/content-script projections, and
  I1/Core receipts. The only legacy marker occurrences are the deliberate
  plaintext legacy-adapter test input. No encrypted backup was uploaded,
  placed in C3E, attached to AI, or used to export auth/session, transfer,
  Work/result, or tombstone state.
- This receipt does not claim secure JavaScript memory erasure.

### Governance, publication, and remaining blockers

- `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-KDF-20260918`: preserved as
  provisional; owner-final decision deferred.
- `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-IMPORT-LIMITS-20260918`: preserved as
  provisional; owner-final decision deferred.
- `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-CRYPTO-20260918`: preserved as
  provisional; owner-final decision deferred.
- `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-METADATA-RETENTION-20260918`:
  preserved as provisional; owner-final decision deferred.
- Environment-deferred: system/native Chrome AUT-47 route; current installed
  A22/A23 rerun due fixture-identity collision and no-space fresh-DB failure;
  remote publication/readback.
- Stream-2 overlap: `NONE`; protected implementation paths untouched.
- No force push, reset, rebase, amend, or remote publication was performed.

The final HEAD/tree after the bounded evidence commit is recorded in the R1
terminal report. The candidate under test for all functional conclusions above
is exactly `5bfccdbb384b201e2c1d7d3046151a4340cd6243` /
`d88e75fa71b2346c9e09ab5de37321b93b3e78b2`; this evidence append does not
alter product behavior. Architect acceptance remains required.
