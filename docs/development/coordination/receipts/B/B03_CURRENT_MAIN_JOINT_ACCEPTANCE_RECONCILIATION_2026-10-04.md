# B03 current-main joint acceptance reconciliation — 2026-10-04

Status: PRECLAIM REVIEW DRAFT. This file is permanent control evidence outside Git. It does not claim queue ownership, publication, deployment or production.

## Purpose

Reconcile PLAN B03 against exact current main without rerunning unchanged heavy transfer scenarios. The technical B03 bounded relay and the mandatory joint A02+B03 restart/replay acceptance already exist in canonical accepted receipts; the current work-board archive has no plan=B03 strict-DONE row, so the missing result is an evidence/accounting reconciliation, not a new protocol implementation.

## Exact current inputs

- Current origin/main: `c2831613c9a0f64d973f550aaf602e3dfb5c0788`.
- Previous joint acceptance base: `5499d57cdbff250723ce2497911d36527306b07b`.
- B03 implementation commit: `ae15d486cef926b48a7f4749dde4c2b6c978a403`.
- A02 recovery commit: `02dc7639de915f7d1928e8dd91b6288f06a548be`.
- All three historical inputs are ancestors of current main.
- Main advanced from `35053304` to `c2831613` only by the B06 retention-classification receipt; that commit does not touch transfer product paths.

## Byte-continuity proof

These five relevant blobs are identical on the accepted joint base and current main:

| Path | Blob |
| --- | --- |
| `packages/server/credential-transfer/src/index.ts` | `db519266951c79c962aa143ad4f09ba103910184` |
| `packages/server/credential-transfer/src/credential-transfer.test.ts` | `2e28d6526d2cf61a5ec905b7702aa83798af9c39` |
| `apps/api/src/credential-transfer-routes.ts` | `6d26c7503a2050717cf32e7bdcaa30eaba99c706` |
| `apps/api/src/credential-transfer-routes.test.ts` | `85b871311d4433fb18818e8fee4a68c4e46da2fd` |
| `packages/control-client/src/credential-transfer.js` | `2ab75f1cf157827e0a9559a373e1b382f47006be` |

Fresh `git diff 5499d57c..origin/main` over those paths is empty.

## Accepted B03 server behavior

Canonical receipt: `docs/development/coordination/receipts/B/B03_EPHEMERAL_TRANSFER_RELAY_2026-09-23.md`.
Current-main receipt SHA-256: `524d7a8bc7cce1863054c7f4943e37093e830fda28f18b76f4288ade46cb9b1d`.

Accepted behavior:
- process-memory-only packet bytes; no packet serialization/logging;
- fail-closed UTF-8 envelope ceiling 131072 bytes;
- default resident limits: 64 packets global, 8/account, 8 MiB global envelope bytes, 1 MiB/account;
- account/source identity retained in relay accounting and checked on receive;
- capacity reservation precedes durable `markPacketAvailable`;
- a failed durable transition releases reservation and preserves any prior active packet;
- activation after TTL expiry returns `TRANSFER_EXPIRED` instead of fabricated submit success;
- one unref timer tracks earliest active/reserved expiry;
- get/has/expireDue/ACK/cancel/clear release accounting as applicable;
- a new process relay is empty after restart and preserves truthful `SOURCE_OFFLINE`, not false SUCCESS.

The historical pre-fix review at `/root/octoport-control/logs/B/b03-relay-review-result.md` is retained as rejected/problem evidence; its unbounded-relay findings were the input to the later accepted implementation and must not be replayed as current defects.

## Mandatory joint A02+B03 acceptance

Canonical receipt: `docs/development/coordination/receipts/C/C02_A02_B03_JOINT_RESTART_ACCEPTANCE_2026-09-27.md`.
Current-main receipt SHA-256: `0d6b9184344735503d66e102b1ac889f1e51ded7eafed2d78a1b6d89ff4dae76`.
Status in that receipt: **JOINT INSTALLED_SYNTHETIC PASS / NOT LIVE_OWNER / NOT DEPLOYED**.

The accepted joint scenario used:
- two actual extension workers;
- production HTTP transfer routes;
- disposable API/PostgreSQL;
- recipient persistent profile closed and reopened with one packet in flight.

It proved:
- non-extractable P-256 private key recovery;
- exactly one packet read;
- exactly one ACK POST;
- safe recovered result retained until explicit RESULT_CONSUME;
- later receive does not perform another packet read/ACK;
- selected-store credential revision is unchanged by replay;
- unrelated store remains untouched;
- provider requests zero;
- AI requests zero;
- no completion/success fabricated after process loss.

Because all five relevant client/server blobs remain identical on current main, the accepted heavy installed-synthetic result remains applicable to this exact protocol boundary.

## Later two-installed-profile lifecycle evidence

Canonical receipt: `docs/development/coordination/receipts/A/A04_TWO_INSTALL_KEY_TRANSFER_2026-10-01.md`.
Current-main receipt SHA-256: `29b5de046967be221f187a9bc80e3142ca1a7f4beb5936a713c326bed3ff6546`.

A04 explicitly treats the prior A02+B03 joint result as accepted and adds only later installed two-profile lifecycle evidence:
- refusal without consent creates no request;
- explicit consent creates one request;
- recipient restart restores ACTIVE request and non-extractable key;
- source restart preserves local selected-store credentials;
- cross-account profile cannot read/cancel;
- rightful recipient cancel terminates safely;
- expiry does not alter imported credentials;
- cancelled/expired requests disappear from source pending list;
- no provider or packaged-AI POSTs were observed.

This is additional INSTALLED_SYNTHETIC / LOCAL DEVELOPMENT evidence and does not upgrade B03 to store/live/deployment acceptance.

## Why no new heavy run is justified

The accepted joint test script and product inputs were explicitly checked for applicability in the C02 receipt. Fresh 2026-10-04 readback again proves all relevant product/test blobs are unchanged. Repeating the same browser/DB scenario would only create a newer timestamp and consume resources without adding an acceptance dimension.

A new heavy run becomes justified only if:
- one of the five protocol/client/server blobs changes;
- the claimed environment dimension changes materially;
- a new defect/feedback invalidates the accepted scenario;
- a new browser/live/store/deployment claim is being added.

None of those conditions is established by the current-main delta.

## Current disposition

Technical B03 requirement for the tested protocol boundary is already supported by accepted evidence. The current bookkeeping gap is that the v2 work-board completion archive contains no strict-DONE row whose plan is B03.

After the operational notice reader is repaired and a fresh duplicate check still finds no equivalent successor, the correct next action is:
1. atomically queue-add/claim one B03 evidence-only reconciliation task;
2. place this independently reviewed content at `docs/development/coordination/receipts/B/B03_CURRENT_MAIN_JOINT_ACCEPTANCE_RECONCILIATION_2026-10-04.md`;
3. use normal fresh-main review/exact-five/publication/readback;
4. strict-DONE the task without rerunning the unchanged heavy transfer scenario.

## Evidence boundaries

Not claimed by this reconciliation:
- LIVE_OWNER transfer;
- real marketplace/provider requests;
- STORE artifact transfer compatibility;
- Firefox or Yandex transfer acceptance;
- recovery after physical profile/IndexedDB destruction;
- deployment or production;
- store submission/manual operator acceptance.

No source, package, database, service, provider, browser, GitHub setting or live state is mutated by this preclaim evidence draft.
