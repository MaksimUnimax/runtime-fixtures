# A02 — MV3 recipient credential-transfer recovery

Status: **A-SIDE VERIFIED CANDIDATE / READY FOR C INTEGRATION REVIEW**  
Task: `A02`  
Role: `A`  
Code candidate: `02dc7639de915f7d1928e8dd91b6288f06a548be`  
Base before A02 code commit: `c7301c15d837784bd5d0b966eb8089b9102b38f4`  
Coordinated server candidate: B03 `615dd763ef115ba41a7a24661db8ea374e2d25a4`; confirmed ancestor of observed `origin/main` `26ffd648c7449cd4c7049b7cb05d694b05298b04`.

This receipt is **not** joint A02+B03 acceptance and is not LIVE_OWNER/DEPLOYMENT evidence. `PLAN.md` requires A02+B03 to be accepted together by integration.

## Product defect and three-level ownership

1. **Component:** the recipient ECDH private key and recipient request discovery existed only in service-worker memory. MV3 worker termination lost both and produced `TRANSFER_KEY_MISSING` even though the server request/packet could still be valid.
2. **Subsystem:** recipient credential-transfer recovery belongs to the privileged extension control-client/runtime. B03 already provides exact-idempotent create by request/key/body, bounded ephemeral packet relay and replay fencing; no new shared/backend protocol was required.
3. **Product invariant:** marketplace credentials remain local; the server never receives the recipient private key or decrypted payload; restart must not cause false success, duplicate application or loss of a confirmed result.

## Implementation

- Added extension-origin IndexedDB recipient vault in `packages/control-client/src/credential-transfer.js`.
- Vault stores a **non-extractable P-256 ECDH `CryptoKey`** plus credential-free request metadata and state only. It never stores decrypted marketplace payload/credentials.
- Durable phases: `PREPARED`, `ACTIVE`, `RECEIVING`, `IMPORTED_PENDING_ACK`, `ACKED_RESULT`.
- IDB writes wait for transaction completion; transaction abort/error is not accepted as durable success.
- Create ordering is `durable PREPARED -> exact-idempotent POST -> durable ACTIVE`; ambiguous network failure retries the same request ID/public key/body instead of creating a replacement key.
- Recipient identity is fenced by stable `accountId + deviceId + sessionId`; AI-profile generation changes do not orphan a valid transfer.
- Receive is single-flight per request. Existing store import semantics make same `storeId + credentialRevision` replay return `SAME_CURRENT`, preventing duplicate credential application.
- `IMPORTED_PENDING_ACK` is durable before ACK. After restart it retries ACK without reimporting.
- Lost ACK response is reconciled through request state `COMPLETED`.
- `ACKED_RESULT` removes the private key but retains only a safe credential-free result until the popup consumes it.
- Local auth reset/terminal auth invalidation clears the vault fail-closed; expired local records are pruned at worker restore.
- The former in-memory recipient request `Set` is removed; runtime discovery reads durable recipient records.

## Deterministic regression — exact final candidate

Run root: `/root/octoport-control/logs/A/A02_FINAL_CANDIDATE_R2/`  
Node: `v24.20.0`  
pnpm: `10.34.5`

`python3 tooling/checks/extension_core.py`:

- stage `D2.4`: **PASS**
- gate processes: **113**
- live provider calls: `0`
- package repeat archive identity: **PASS**
- source/extracted byte identity: **PASS**

A02 recovery matrix on both source runtime and extracted package: **8/8 PASS + 8/8 PASS**:

- `TRR-01` vault failure before POST => zero server create calls;
- `TRR-02` worker restart restores private key and recipient discovery;
- `TRR-03` restart after durable import/before ACK does not reapply credentials;
- `TRR-04` lost ACK response reconciles `COMPLETED` and preserves safe result across popup restart;
- `TRR-05` local reset clears durable recipient private key;
- `TRR-06` concurrent receive is idempotent and cannot reopen `ACKED_RESULT`;
- `TRR-07` lost create response retries the same request and same recipient key;
- `TRR-08` expired vault record is pruned on worker restore.

Final package:

- `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`
- SHA-256: `e5fc212b06672eb89fd6c7cf0340e3db6ab840b45e39a4a7f349ad5f4a161231`

## Installed synthetic browser evidence

Exact extracted runtime from the final package above:

- Playwright Chromium: **PASS** — same extension worker URL after profile restart; private key type `private`; `extractable=false`; export rejected; decrypt after restart PASS; cleanup PASS.
- Real Opera 136 executable: **PASS** — same assertions, independently on Opera.

Evidence files:

- `/root/octoport-control/logs/A/A02_FINAL_CANDIDATE_R2/installed/chromium.json`
- `/root/octoport-control/logs/A/A02_FINAL_CANDIDATE_R2/installed/opera.json`
- `/root/octoport-control/logs/A/A02_FINAL_CANDIDATE_R2/hashes.txt`

This evidence proves the IndexedDB/CryptoKey restart property for those two environments only. It does not transfer browser claims to Chrome/Yandex/Firefox/Safari and is not LIVE_OWNER evidence.

## Independent review

Read-only Luna review:

- task: `a02-mv3-key-vault-review-r1`
- result: `/root/octoport-control/logs/A/a02-mv3-key-vault-review-r1-result.md`
- exit code: `0`

Review independently selected extension-origin IndexedDB structured-clone persistence of a non-extractable ECDH key, required durable request discovery, identified create/import/ACK crash windows, and recommended no server/shared protocol change.

## Security / privacy boundary

- No private key export or storage in `chrome.storage.local`.
- No credential plaintext or decrypted transfer payload in the vault, receipt or evidence.
- Public request metadata and a safe post-import result summary only.
- Missing/corrupt/unavailable vault fails closed; it does not fabricate import/ACK success.
- Physical browser-profile/IndexedDB loss after packet availability remains unrecoverable under the unchanged relay protocol. This is explicitly **not** reported as recovered; A02 closes normal MV3 worker stop/restart, not arbitrary profile-storage destruction.

## Integration requirement

C must review A02 together with B03. The jointly relevant properties are exact-idempotent request creation, packet/replay state transitions, recipient restart recovery and ACK reconciliation. A-side green evidence alone does not mark the combined transfer protocol accepted.
