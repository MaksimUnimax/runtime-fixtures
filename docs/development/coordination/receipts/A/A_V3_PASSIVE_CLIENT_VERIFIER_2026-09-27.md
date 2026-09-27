# A — passive subscription-access v3 verifier foundation — 2026-09-27

Status: **SOURCE + EXTRACTED PACKAGE PASS / PASSIVE ONLY / CACHE-REPLAY WORK CONTINUES**

Task: `A_V3_PASSIVE_CLIENT_CONSUMER`.
Parent A head: `51e473ac92808abc2de9652f79fe8a8c3540d393`.
Observed `origin/main`: `0b9648bd0bb14d1af6a2916f6fbba16e37b887a0`.

Authority:
- `docs/development/coordination/SUBSCRIPTION_ACCESS_CONTRACT_V3_2026-09-27.md`;
- accepted shared v3 foundation referenced by controller: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`;
- reviewed B standalone producer candidate: `2167c42caeeaee8f72823fb4189336dc4bd67a37`;
- controller assignment: `STREAMS-AUDIT-20260927-0857`.

## Scope

This checkpoint adds a **passive browser consumer foundation** for the standalone signed v3 wire:
- strict browser `verifyV3` beside unchanged `verifyV2`;
- exact v3 snapshot/envelope and `subscriptionAccess` validation;
- v3 privacy-neutral `local_client_authority_v2` projection support;
- focused shared-signer → browser-verifier readback on source and extracted package;
- I1 checker integration for the v3 verifier/readback tests.

It deliberately does **not**:
- change `client.js` outgoing bootstrap negotiation;
- advertise or request `control_plane_v3`;
- change packaged `config.js` from `control_plane_v2`;
- change frozen STORE-1 Opera 0.2.4 semantics;
- enable billing, deployment, live service mutation or marketplace access.

`bootstrapRequest()` remains hard-coded to `control_plane_v2`.
## Browser verifier semantics

`verifyV3` uses the existing Ed25519 trust bundle, signing domain and key binding.

The strict v3 payload mirror verifies:
- `bootstrap_snapshot_v3` / `control_plane_v3`;
- identified and privacy-neutral variants;
- strict account/subscription/device/entitlement fields;
- strict `local_client_authority_v2` / `control_plane_v3` policy and feature-rule shapes;
- required `subscriptionAccess` field;
- `subscription_access_v1` object only for COMMERCIAL ACTIVE/GRACE/CANCELED;
- `offlineHardUntil - paidThrough = exactly 72h`;
- BETA, NONE and COMMERCIAL TRIAL require `subscriptionAccess=null`;
- canonical JSON bytes, envelope version, signature and trusted key.

The signed legacy `offlineGraceUntil` remains valid v3 wire data. This verifier does not reinterpret it as commercial offline entitlement.

## Dormant privacy-neutral boundary

The local privacy-neutral projector now recognizes:
- v2: `local_client_authority_v1/control_plane_v2`;
- v3: `local_client_authority_v2/control_plane_v3`.

Current B producer intentionally copies v2-only release rows and does not advertise v3. The regression therefore proves both branches:
- a future explicit release row containing `control_plane_v3` can materialize as supported;
- the current dormant producer shape with release support only for `control_plane_v2` remains `UPDATE_REQUIRED/UNSUPPORTED_BROWSER`.

Passive verifier support therefore cannot silently activate v3.
## Changed bytes

`packages/control-client/src/crypto.js`
SHA-256: `2ba17a635c927b852770811ec3141533ad595a27d3368055e59d51d3fc4817ce`.

`packages/control-client/src/local-client-authority.js`
SHA-256: `e559be415cf9f2b86fb2c14b20646fa94908016f3687468c7514291593a6bb34`.

`tests/regression/extension-core/client-i1/firefox-local-authority.mjs`
SHA-256: `be2b6d91fcfaa2054c11e7b78944fb2eb549037204e652ca21059b6f7d5c85e8`.

`tests/regression/extension-core/client-i1/verifier-v3.mjs`
SHA-256: `b1754c869965519094e29ca55d37493fd0cb9274995416b66311cee67452778d`.

`tests/regression/extension-core/client-i1/client-v3-passive-signed-readback.ts`
SHA-256: `9d11284b0aa636c430f9f61d8e081969aa055bb7a7882c0b87be8f60aa554ad5`.

`tooling/checks/extension_i1.py`
SHA-256: `36d6c0c953fb91945935e948089ba27663beee905d2155174a20732f24dca946`.
## Verification

Source focused checks:
- existing v2 verifier: PASS;
- new v3 verifier: PASS;
- identified v3: PASS;
- privacy-neutral v3: PASS;
- exact +72h: PASS;
- ±1ms hard-deadline drift: rejected;
- paid ACTIVE without `subscriptionAccess`: rejected;
- BETA with paid fields: rejected;
- COMMERCIAL TRIAL with null paid fields: PASS;
- wrong account schema, bad signature, unknown key, cross-version envelope and non-canonical payload: rejected;
- existing Firefox local-authority cases: PASS;
- new advertised-v3 release projection: PASS;
- dormant v2-only release is not treated as supported v3: PASS.

Supervised heavy I1:
- command: `python3 tooling/coordination/control.py A heavy -- python3 tooling/checks/extension_i1.py --output /tmp/octoport-a-v3-passive-i1-r1`;
- resource unit: `octoport-test-a-3f34c47d4c38461a985b4d73fe78a99d.service`;
- result: PASS;
- gate processes: 156;
- source native browser proof and source regression set: PASS;
- extracted package regression set: PASS;
- source v3 shared-signer → browser-verifier readback: PASS;
- package v3 shared-signer → browser-verifier readback: PASS;
- source/package v3 verifier: PASS;
- package repeat archive match: true;
- source/extracted bytes match: true;
- generated local-development ZIP SHA-256: `7e2a57dda4b3ec7db13960867a4c9075ee18f6142e2fd9884d47458993acb8d9`;
- `installed_acceptance=false`.

Additional:
- `python3 -m py_compile tooling/checks/extension_i1.py`: PASS;
- new standalone test files Prettier check: PASS;
- `git diff --check`: PASS.
- Existing compact-style `crypto.js`, `local-client-authority.js` and `firefox-local-authority.mjs` already fail repository Prettier check on the parent HEAD; this checkpoint does not perform unrelated whole-file reformatting.
## Remaining task boundary

This checkpoint is not the complete v3 client consumer.

Still required under the same controller assignment:
- passive cache/authority dispatch for an already-supplied verified v3 authority without changing outgoing negotiation;
- account/device/session/context binding and replay/older-generation rejection;
- commercial cached-offline enforcement using only `subscriptionAccess.offlineHardUntil`, never legacy `offlineGraceUntil`;
- paidThrough refresh-due behavior and exact hard deadline;
- verified renewal replacing the paid boundary;
- verified current NONE/terminal revoke defeating an older cached allow;
- wall-clock rollback/restart cannot extend deadlines;
- later shared approximately-24h refresh scheduling/single-flight across tabs/sleep, after the passive authority layer is green.

No LIVE_OWNER, DEPLOYMENT, billing-provider, installed-store or production acceptance is claimed.
