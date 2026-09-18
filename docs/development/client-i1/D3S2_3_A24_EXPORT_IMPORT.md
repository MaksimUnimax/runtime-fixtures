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
