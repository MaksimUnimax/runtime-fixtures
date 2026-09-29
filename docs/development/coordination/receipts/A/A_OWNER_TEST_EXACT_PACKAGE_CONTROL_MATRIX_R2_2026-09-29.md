# A — exact STORE 0.2.6 owner-test control matrix R2 — 2026-09-29

Status: **TECHNICAL LIFECYCLE RECONCILED / TRANSFER DEFECT REPRODUCED / SOURCE FIX READY**

Task: `A_EXACT_TECHNICAL_LIFECYCLE_REMAINDER_20260929`.
Resume receipt: `/root/octoport-control/incidents/streams-handoff-20260929T0111Z/PROMPT_A.md:OWNER_TRANSFER_20260929T0111Z_A`.
Baseline START_HEAD: `06dadcb160a05c59df83695b88f1b7158c754907`.

This R2 supersedes the disposition columns in
`A_OWNER_TEST_EXACT_PACKAGE_CONTROL_MATRIX_2026-09-28.md`.
The older receipt remains historical evidence and is not rewritten.

## Frozen boundary

- Chromium/Opera STORE carrier: `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`.
- Frozen SHA-256: `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`.
- Frozen source: `028d5dd56341719e2061a47b5e82e216256619f7`.
- Opera: `136.0.6008.22`.
- Runtime inventory: 42 pinned files.
- Frozen STORE bytes were not rebuilt, overwritten, patched, re-signed or relabeled.
- Technical profiles and evidence directories are protected mode 0700; the portal-session authority file remains 0600.
- No owner marketplace credential value, portal cookie/token, account id, device id, transfer request id, store id or raw signed payload is written to this receipt.

## Reconciled matrix

| Boundary | R2 disposition | Evidence / limitation |
| --- | --- | --- |
| Exact frozen package identity | PASS | SHA-256, Opera product and 42-file runtime matched before the new runs. |
| Automated technical Octoport auth | PASS | Two new profiles used the normal device flow; membership and device approval passed; `authStateInjected=false`. This is not human email/login acceptance. |
| Signed ChatGPT profile / Work admission | PASS technical | Both new profiles reached signed profile admission with `workAllowed=true`; this is not a legitimate authenticated ChatGPT conversation or live AI Work proof. |
| Local store controls / backup / diagnostics | PASS prior | Preserved from `A_AUTO_REAL_TEST_SESSION_026_2026-09-28.md`; not rerun without changed input. |
| Ozon Seller / Performance / WB installed read-only checks | PASS prior | All three exact installed buttons previously returned HTTP 200; not rerun. |
| Two-installation transfer on frozen STORE 0.2.6 | **REPRODUCED PRODUCT DEFECT** | Real popup create → discover → receive completed, but the recipient metadata-only marker did not receive credentials. Root cause is below. |
| Transfer refusal / request creation preconditions | PARTIAL PASS within reproducer | Consent-off created no recipient transfer; normal consent created the real request. Full row cannot be accepted while receive is defective. |
| Replay / repeat acceptance on frozen STORE 0.2.6 | BLOCKED BY REPRODUCED DEFECT | Do not claim no-replay acceptance from a flow that failed to import the first credential packet. Existing synthetic lower-level evidence remains separate. |
| Local auth reset of one disposable installation | PASS | Real popup reset confirmation signed out only the recipient technical profile. |
| Re-auth after local reset | PASS | Recipient performed a new normal device flow, regained signed Work admission and received a new device identity. |
| Isolation from the other fresh installation | PASS | Source stayed authenticated and `workAllowed=true` throughout recipient reset/re-auth. |
| Isolation from the preserved r4 owner-test profile | PASS | r4 remained authenticated/workAllowed and retained exactly two pre-existing real stores. |
| Provider / AI side effects during lifecycle-only run | PASS zero-side-effect | Provider requests 0; AI POST requests 0; page errors 0. |
| Account-wide device revocation | NOT RERUN | The task did not authorize production-account DB/device revocation mutation. Existing synthetic adversarial evidence remains synthetic. |
| Human email delivery / human portal login UX | OPEN external | Explicitly not established by technical session authority. |
| Genuine STORE/catalog installation/reviewer acceptance | OPEN external | Development-flag technical installation is not store-channel acceptance. |
| Legitimate live ChatGPT/H3 useful flow | OPEN external | No legitimate authenticated ChatGPT/H3 session is available; no session is fabricated. |

## Two new technical installations

Protected profiles:
- `/root/octoport-control/profiles/A/owner-test-opera-026-lifecycle-20260929/source`;
- `/root/octoport-control/profiles/A/owner-test-opera-026-lifecycle-20260929/recipient`.

Source normal-auth evidence:
`/root/octoport-control/logs/A/owner-test-opera-026-lifecycle-20260929/source-auth.json`.
Resource unit: `octoport-test-a-16f5bdcc776e4e45a422532de41ed88d.service`;
exit 0, peak 753 MiB, cleanup verified.

Recipient normal-auth evidence:
`/root/octoport-control/logs/A/owner-test-opera-026-lifecycle-20260929/recipient-auth.json`.
Resource unit: `octoport-test-a-524529c733a14c5c8edeaee70c683279.service`;
exit 0, peak 489 MiB, cleanup verified.

Both profiles began with store count 0. They are distinct device authorizations on the same specifically permitted technical account.
No extension auth/work flag was injected.

## Exact frozen transfer reproducer

Harness:
`tests/regression/extension-core/client-i1/exact-store-technical-lifecycle.py`.

Evidence:
`/root/octoport-control/logs/A/owner-test-opera-026-lifecycle-20260929/lifecycle.json`.

Resource unit:
`octoport-test-a-59b5bdff95cf4d59a1047837824ae448.service`;
exit 1, peak 900 MiB, cleanup verified.

Observed sequence on the immutable STORE runtime:
1. both fresh installations restored normal technical auth;
2. both obtained the normal signed ChatGPT/web/null profile and Work admission;
3. a synthetic temporary Ozon store was created through the real popup on the source;
4. the recipient was given only supported credential-less remote metadata for the same store;
5. recipient consent-off did not create a transfer;
6. recipient consent-on created the transfer through the real popup;
7. source real popup discovery found and sent it;
8. recipient real popup receive reported completion;
9. postcondition failed: recipient credentials were still absent.

Failure code: `TRANSFER_CREDENTIAL_NOT_IMPORTED`.

The harness cleanup path ran. The later reset/re-auth run independently proved both fresh profile store counts were again zero before any reset, so no temporary store residue was carried into the destructive-auth test.

## Root cause

`packages/bridge-core/src/stores/catalog.js::applyRemoteMetadata()` intentionally creates a metadata-only remote store with empty `credentials`, copies the remote `credentialRevision`, and sets `credentialsStale=true`.

Before this R2 source repair, `importCredential()` returned `SAME_CURRENT` whenever the local and incoming `credentialRevision` matched. It did not distinguish a metadata-only stale marker from a store that already possessed that credential revision.

Therefore a newly converged installation could know the correct credential revision while having no credentials, receive the encrypted transfer packet, and still skip credential import as already current.

This is an actual frozen-0.2.6 product defect, not a test-only failure and not a backend/provider failure.

## Minimal source repair

The A source candidate changes only the transfer import invariant:
- same revision + `credentialsStale != true` remains `SAME_CURRENT`;
- same revision + `credentialsStale == true` imports the transferred credentials, clears stale state and old verification, and returns `IMPORTED`;
- different existing credential revision remains `CONFLICT`;
- tombstone, marketplace and confirmed-provider identity fences remain unchanged.

Focused regression `TRANSFER-33` was added to
`tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs`.

It proves:
- remote metadata creates an empty/stale marker with the incoming revision;
- the first matching-revision transfer imports credentials and clears stale;
- a second identical transfer is `SAME_CURRENT`.

Result: **60/60 PASS**.

## Source integration regression

A separate LOCAL_DEVELOPMENT build was produced only for source validation.
It is not the frozen STORE artifact and is not store/reviewer evidence.

Temporary development archive:
`SELLER_AGENTS_I1_C1_v0.2.6_LOCAL_DEVELOPMENT.zip`.
SHA-256:
`5e3911678556ccae9b07c8405a971561799cbd5241edb02bc2740b50a2226392`.
Build reported repeat archive match and source/extracted byte match.

Existing recipient-recovery suite:
`client-transfer-recipient-recovery.mjs`.

Results:
- development runtime: **8/8 PASS**;
- development extracted package: **8/8 PASS**.

Covered existing vault failure-before-POST, worker restart/private-key recovery,
durable import before ACK, lost ACK response recovery, local reset key clear,
concurrent receive idempotency, lost create response retry, and expired vault pruning.

The LOCAL_DEVELOPMENT archive is disposable validation evidence. It must not replace,
overwrite or be presented as the accepted STORE 0.2.6 ZIP.

## Exact reset / re-auth acceptance

Harness:
`tests/regression/extension-core/client-i1/exact-store-technical-reset.py`.

Evidence:
`/root/octoport-control/logs/A/owner-test-opera-026-lifecycle-20260929/reset-reauth.json`.

Resource unit:
`octoport-test-a-6ea2e1bc15bc43a5917985fed503e5b4.service`;
exit 0, peak 1001 MiB, cleanup verified.

Result: **PASS**.

Observed:
- exact frozen SHA and Opera matched;
- both fresh profiles were authenticated normally and had zero stores before reset;
- both obtained signed Work admission;
- the recipient popup used the real `Сменить аккаунт` confirmation path;
- recipient became locally signed out;
- source remained authenticated/workAllowed and kept its device identity;
- recipient re-authorized through the normal device flow and regained signed Work admission;
- recipient device identity rotated and did not collide with source;
- preserved r4 reopened authenticated/workAllowed with exactly two existing real stores;
- provider requests 0;
- AI POST requests 0;
- page errors 0.

This proves installation-local reset/re-auth isolation.
It does not prove account-wide revoke, human login UX or live AI Work.

## Current acceptance / next action

Exact STORE 0.2.6 can retain all previously accepted auth, signed-profile,
local-control, read-only provider-check and now local reset/re-auth rows.

Exact STORE 0.2.6 transfer must remain **NOT ACCEPTED** because a real
two-installation transfer reproduces the metadata-only same-revision defect.

The frozen ZIP remains immutable. The source repair therefore requires normal C
intake and a later candidate artifact before the exact installed transfer row can
be rerun and closed. No existing accepted STORE package is silently replaced.

Live AI/H3, human login, and store-channel/reviewer gates remain external and are
not reclassified by this receipt.
