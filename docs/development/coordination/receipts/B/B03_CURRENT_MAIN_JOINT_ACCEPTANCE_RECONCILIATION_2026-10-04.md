# B03 current-main joint acceptance reconciliation — 2026-10-04

Status: **FINAL — PUBLICATION-BACKED STRICT DONE** for exact candidate `de64e69350b63d658e82bda8f34d408af21fbcba`. Fresh current-main applicability was revalidated on `789a75e3c0a016bdf15f9bf14e0dba1e41d1959a`.

## Purpose

Reconcile PLAN B03 against current main without rerunning unchanged heavy transfer scenarios. The technical B03 bounded relay and the mandatory joint A02+B03 restart/replay acceptance already existed in canonical accepted receipts. This evidence-only reconciliation supplied the missing strict work-board completion row; it did not implement a new transfer protocol.

The original preclaim review and source-freeze records are preserved as historical inputs. They describe the state **before** queue claim/publication and must not be read as the final disposition of this document.

## Exact inputs and current-main continuity

- Historical preclaim/source base: `c2831613c9a0f64d973f550aaf602e3dfb5c0788`.
- Published reconciliation candidate: `de64e69350b63d658e82bda8f34d408af21fbcba`.
- Published candidate parent: `c2831613c9a0f64d973f550aaf602e3dfb5c0788`.
- Fresh current origin/main at this status correction: `789a75e3c0a016bdf15f9bf14e0dba1e41d1959a`.
- Previous joint acceptance base: `5499d57cdbff250723ce2497911d36527306b07b`.
- B03 implementation commit: `ae15d486cef926b48a7f4749dde4c2b6c978a403`.
- A02 recovery commit: `02dc7639de915f7d1928e8dd91b6288f06a548be`.
- All historical protocol inputs remain ancestors of current main.
- The receipt blob published at `de64e693` remained byte-identical through `789a75e3` before this correction: Git blob `86dd3d690279fe1a8d31857ca2d299295a168161`.
- Fresh `git diff de64e693..789a75e3` over the five protocol/client/server paths below is empty. Main advances after `de64e693` therefore do not invalidate the accepted protocol evidence.

## Byte-continuity proof

These five relevant blobs were identical on the accepted joint base and the published reconciliation line, and fresh status-correction readback found no changes through current main:

| Path | Accepted blob |
| --- | --- |
| `packages/server/credential-transfer/src/index.ts` | `db519266951c79c962aa143ad4f09ba103910184` |
| `packages/server/credential-transfer/src/credential-transfer.test.ts` | `2e28d6526d2cf61a5ec905b7702aa83798af9c39` |
| `apps/api/src/credential-transfer-routes.ts` | `6d26c7503a2050717cf32e7bdcaa30eaba99c706` |
| `apps/api/src/credential-transfer-routes.test.ts` | `85b871311d4433fb18818e8fee4a68c4e46da2fd` |
| `packages/control-client/src/credential-transfer.js` | `2ab75f1cf157827e0a9559a373e1b382f47006be` |

## Accepted B03 server behavior

Canonical receipt: `docs/development/coordination/receipts/B/B03_EPHEMERAL_TRANSFER_RELAY_2026-09-23.md`.

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

The historical pre-fix review at `/root/octoport-control/logs/B/b03-relay-review-result.md` remains rejected/problem evidence. Its unbounded-relay findings were input to the later accepted implementation, not current defects.

## Mandatory joint A02+B03 acceptance

Canonical receipt: `docs/development/coordination/receipts/C/C02_A02_B03_JOINT_RESTART_ACCEPTANCE_2026-09-27.md`.

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

Because all five relevant client/server blobs remain unchanged through fresh current main, the accepted heavy installed-synthetic result remains applicable to this exact protocol boundary.

## Later two-installed-profile lifecycle evidence

Canonical receipt: `docs/development/coordination/receipts/A/A04_TWO_INSTALL_KEY_TRANSFER_2026-10-01.md`.

A04 explicitly treats the prior A02+B03 joint result as accepted and adds later installed two-profile lifecycle evidence:
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

## Publication-backed final disposition

The historical preclaim review was followed by the normal governed publication lifecycle. The final evidence is:

- source freeze: `/root/octoport-control/logs/B/b03-current-main-joint-acceptance-reconcile-20261004/SOURCE_FREEZE.json`;
- exact-candidate independent publication review: **PASS**, `PUBLICATION_REVIEW.json`;
- published candidate: `de64e69350b63d658e82bda8f34d408af21fbcba`;
- publication registration: `b93b6002604d526cfae844b0e8eda0227008526c9cec7d810c30d0e5e781695f`;
- exact-five CI ready receipt: `/root/octoport-control/controllers/task-publication/ready/b93b6002604d526cfae844b0e8eda0227008526c9cec7d810c30d0e5e781695f/5.json`;
- governed main publication/readback: `PUBLISH_MAIN_RESULT.json`;
- governed task-ref cleanup: `CLEANUP_REF_RESULT.json`, final cleanup state **DELETED**;
- registration close: `CLOSE_RESULT.json`, final state **CLOSED**;
- strict completion receipt: `STRICT_COMPLETION_DE64E693_R2.json`, verdict **PASS**;
- strict queue finalization: `COMPLETE_QUEUE_DE64E693_R2.json`;
- completed work-board archive row: `/root/octoport-control/controllers/work-board-done/rows/4928b11018bdc378c26d0c5829e46d67c8315ffbd6367c26de6f2174ac1658a5.json`.

Therefore the bookkeeping gap described in the preclaim draft is closed for the accepted tested B03 protocol boundary. Publication and strict DONE are completed facts, not future actions.

## Why no new heavy run is justified

The accepted joint test and relevant product inputs are unchanged. Repeating the same browser/DB transfer scenario would add only a newer timestamp, not a new acceptance dimension.

A new heavy run becomes justified only if:
- one of the five protocol/client/server blobs changes;
- the claimed environment dimension changes materially;
- a new defect/feedback invalidates the accepted scenario;
- a new browser/live/store/deployment claim is being added.

None of those conditions is established by the current-main delta or by this documentation correction.

## Evidence boundaries

Not claimed by this reconciliation:
- LIVE_OWNER transfer;
- real marketplace/provider requests;
- STORE artifact transfer compatibility;
- Firefox or Yandex transfer acceptance;
- recovery after physical profile/IndexedDB destruction;
- deployment or production;
- store submission/manual operator acceptance.

This status correction changes only this documentation receipt. It performs no transfer/runtime/server/client/DB/schema/config/service/provider/browser or GitHub-admin mutation.
