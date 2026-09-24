# A02 — offline-policy IndexedDB fixture follow-up

Status: **A-SIDE VERIFIED TEST-ENVIRONMENT FIX / READY FOR C INTEGRATION REVIEW**  
Task: `A02` follow-up  
Role: `A`

C integration exposed one A-owned regression-fixture failure after A02 transfer-vault hardening:

`Q5-A-held-A-then-real-B-activation -> TRANSFER_VAULT_CLEAR_FAILED`.

The production behavior is intentional: `SellerAgentsControlClient.localReset()` fails closed unless the recipient transfer vault is durably cleared.

## Root cause

`client-offline-policy.mjs` created its candidate worker without IndexedDB unless a case explicitly injected one. After A02, `localReset()` legitimately calls the transfer-vault `objectStore.clear()`, so Q5-A was testing an impossible extension environment.

The existing fake IndexedDB also lacked `clear()` and keyed only `artifact_key`, while the transfer vault uses `requestId`.

## Change

Test fixture only:

- add `clear()` to the existing fake object store;
- accept `artifact_key ?? requestId` for fake records;
- give the candidate worker `options.indexedDB || fakeIDB()`;
- preserve explicit-IDB cases unchanged, including Q3 durability counters.

No product/runtime, protocol, server, DB, migration, lockfile, browser or release code changed.
## Evidence

Run root:
`/root/octoport-control/logs/A/A02_OFFLINE_POLICY_IDB_FIX_R1/`

Exact product package under test:
`bf10373a308673ca216ba0217a5b2589f38d3d154b9ffa959b9daa2f136fa32b`

Node:
`v24.20.0`

Results:

- source runtime: **PASS**, exit 0;
- extracted runtime: **PASS**, exit 0;
- Q1: PASS;
- Q2: PASS;
- Q3: PASS;
- Q4: PASS;
- Q5: PASS;
- Q6: PASS;
- Q7: PASS;
- Q5-A specifically: **PASS**;
- Q3 first-floor/IDB retention: **PASS**;
- Q3 destructive-readonly negative control remains **EXPECTED_FAIL** with normal control PASS.

The fix therefore restores the intended browser-like test environment without weakening fail-closed vault cleanup.

No LIVE_OWNER, installed-browser, deployment or production claim is made by this receipt.
