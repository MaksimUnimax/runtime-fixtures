# C2.3-C3C — Fundamental Autonomous Authority Rewrite

Work ID: `SA-I1-C2-3-C3C-FUNDAMENTAL-AUTONOMOUS-AUTHORITY-REWRITE-20260918-01`

Status: implementation candidate; final acceptance remains architectural-owner review.

## Boundary and removed premise

C3B established that the old Work authority was structurally active-session-only. Its offline path required `CONTINUE`, an active visible/hidden Work state, matching historical online admission provenance, a previous online admission, and `expiresAt` rather than the accepted signed grace deadline. That policy is superseded.

C3C replaces both the old online evaluator and the old offline evaluator with one installation-local authority evaluator. `SellerAgentsOnlineWorkAuthority` and `SellerAgentsOfflineWorkAuthority` are compatibility adapters to the same `SellerAgentsAutonomousWorkAuthority`; neither is an independent source of authority.

The core evaluator is operation-neutral. It does not require `CONTINUE`, an active Work state, or an admission receipt. C3D may consume the contract for Start, Resume, and rebind orchestration, but those workflows are deliberately outside this change.

## Authority layers

The trusted input is a locally durable, previously verified and signed Bootstrap envelope plus the accepted cache clock. Callers cannot supply a final allow bit, freshness override, permission map, packaged-capability declaration, or AI authority.

The evaluator composes these layers in order:

1. Signed Bootstrap identity and scope: account, device/session, generation, configuration/contract, signed AI/profile, signed entitlements/features, `expiresAt`, `offlineGraceUntil`, and signed server time.
2. Safe effective time and cache ownership. Effective time is monotonic/high-water-mark protected and cannot be moved backward by caller input or restart.
3. Freshness state: `FRESH` while effective time is before `expiresAt`; `STALE_BUT_OFFLINE_GRACE_ELIGIBLE` from `expiresAt` inclusive until `offlineGraceUntil` exclusive; `CACHE_EXPIRED` at exact `offlineGraceUntil` and after. No local extension is made.
4. Local invalidation and context: logout, auth reset, known revoke, obsolete/reset state, account/device/session/generation, dialogue, Work intent, store/deletion, binding/revision, credential revision, and current AI/profile identity.
5. Capability intersection: packaged local capability presence AND the matching signed server permission. Unknown permissions do not grant authority.
6. AI/profile identity: the signed detected family/surface/profile must match the current page request and accepted profile digest. An account-only cache cannot become an AI-specific grant.
7. Work/dialogue/store context: the result can be evaluated for a current conversation, binding, marketplace, store, credential, and Work generation without using historical admission as a bearer.

All failures are fail-closed and retain explicit denial reasons such as `DENY_CACHE_EXPIRED`, `DENY_AUTH_INVALIDATED`, `DENY_ACCOUNT_MISMATCH`, `DENY_DEVICE_SESSION_MISMATCH`, `DENY_AI_PROFILE_MISMATCH`, `DENY_CAPABILITY`, `DENY_STORE_CONTEXT`, `DENY_CREDENTIAL_REVISION`, and `DENY_BINDING_CONTEXT`.

## Health and provenance

Health is an optional, current online observation adapter. `SellerAgentsVerifiedOnlineWorkAuthority` verifies a supplied Health envelope and passes only its observation status to the same core evaluator with `requireHealth: true`. The core evaluator performs no Health fetch, Bootstrap fetch, provider call, server sync, or network call. A Health observation age does not truncate a valid signed offline-grace authority during an outage.

`admission_provenance` remains historical/lifecycle and race-correlation evidence. It is explicitly marked non-bearer and is ignored by the authority evaluator. Its presence is not required for offline continuation, and it cannot authorize by itself. No raw Health envelope, B2 decision, or final allow result is stored as an offline credential.

Active continuation now calls the unified autonomous evaluator. The runtime still keeps lifecycle/context safety checks around the existing active Work path; those checks are not the authority source and do not reintroduce the old provenance rule.

## Storage, restart, and migration

Existing privileged local storage remains the durable store. The signed authority envelope, cache binding, cache clock, credentials, and local invalidation state are recomputed and checked after worker restart. The old `workAllowed` field remains only as compatibility/output data; the client checkpoint no longer trusts it as authority. A valid signed cache is therefore not blocked by an old false bit, and an old true bit cannot bypass signature, time, context, capability, or invalidation checks.

The existing cache-clock effective-time floor is retained. Restart cannot reset effective time backward, extend `offlineGraceUntil`, resurrect logout/reset, or require old online-admission provenance. Existing records are read through the current storage transaction path; malformed, mismatched, tampered, or obsolete records fail closed rather than being upgraded.

## RED batch and coordinated correction

The initial red batch reproduced the complete reachable wrong premise before the rewrite:

- `C3C-RED-01`: signed grace-valid authority was rejected after `expiresAt`.
- `C3C-RED-02`: historical online admission provenance was required.
- `C3C-RED-03`: active Work state was required by the authority evaluator.
- `C3C-RED-04`: new Start could not consume authority without an active-session receipt.
- `C3C-RED-05`: the exact grace boundary was not the authoritative expiry boundary.
- Additional reds: the client checkpoint and signed-metadata/CanWork suites trusted persisted `workAllowed`; verified-Health tests supplied the superseded authority context shape.

Root cause classes were split source-of-truth (online versus offline), expired-at-`expiresAt` policy, lifecycle/provenance bearer semantics, and persisted final-decision trust. These were corrected together rather than adding operation exceptions.

## C3C / C3D boundary

C3C includes the operation-neutral production contract and active continuation wiring. It does not implement server-down new Start, historical Start, Resume, store change, marketplace change, or rebind orchestration. It does not implement the C3E rare journal, C3F reconciliation, C3G final predispatch rewrite, or C3H acceptance.

C3A provider behavior and its gate remain compatible. The provider gate now receives the unified authority result through the existing adapter boundary; this is API adaptation only and is not a C3G claim.

## Evidence

Supported toolchain used for all relevant runs:

- Node: `/root/.nvm/versions/node/v24.20.0/bin/node`, `v24.20.0`.
- Package tooling: pnpm `10.34.5` via the same Node 24 PATH.
- The earlier Node 12.22.9 optional-chaining parse failure is closed; no production syntax downgrade was made.

Focused authority matrix: `tests/regression/extension-core/client-i1/client-c3c-autonomous-authority.mjs`, run against source-composed and extracted/package runtimes. It covers the C3C RED cases, fresh/grace/exact-boundary/expired states, invalidation, context, capability intersection, provenance non-authority, operation neutrality, no-network/no-Health/no-Bootstrap behavior, tampered Bootstrap, and restart reconstruction.

Affected regression matrix: `python3 tooling/checks/extension_i1.py --output <isolated-output>/package`, with Node 24 on source and package runtimes. The final run passed 124 gate processes, including source/package syntax, cache time, cached-bootstrap/offline policy, signed metadata, packaged capability/intersection, C3A online admission/races, rewritten active continuation, verified Health adapter, D3C signed readback, and verifier tests. The checker’s intentional `middle-failure` negative control remains expected.

The changed policy tests are classified as `REWRITE_TO_CORRECT_AUTHORITY`: the C2.3-C3A authority assertion, C2.3-C3C2 continuation assertions, stale-grace signed metadata assertions, CanWork persisted-bit assertion, and the C1-10 persisted-final-bit assertion. Security, lifecycle, race, tamper, context, and provider assertions remain covered. Historical C2/C3B evidence is unchanged.

Native Chromium execution is environment-deferred in this candidate because this checkout does not provide the browser fixture private-key input; no owner credential or persistent private key was created. The browser harness was updated to test non-authoritative provenance and tampered durable signed-state denial when a fixture key is supplied.

Source/package parity and deterministic packaging are run as part of the final candidate validation. `git diff --check` is required and passed before commit.

Implementation candidate commit: `3ae08e347cede83c659cf575eabbdf93176ec0cf`

Implementation candidate tree: `3164ebc6b34bc0571b08209391119b2ac9e1ce76`

## Deferred ledger

Preserved from C3B: owner-deferred test-environment items, provisional remote publication, superseded active-only continuation policy pending this rewrite, and remote verification/publication limits. Added: `ENVIRONMENT_DEFERRED_NATIVE_CHROMIUM_FIXTURE_KEY` for the bounded browser harness input described above. Remote publication remains `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no force push or merge is performed.

## Security/privacy attestation

No real Ozon/Wildberries calls, owner credentials, marketplace tokens, passwords, private keys, storageState, private conversation content, raw Health envelope, or raw seller report were added to evidence. Runtime technical results remain bounded. The accepted Bootstrap signature verification boundary is unchanged and tampered signed material continues to fail closed.
