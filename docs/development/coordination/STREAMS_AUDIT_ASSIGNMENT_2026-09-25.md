# Workstream audit and next assignments — 2026-09-25

Controller authorization: owner requests audit/fixes of A/B/C only, excluding resources/disk, followed by three new-dialogue start prompts. Baseline main: c520015cfa2a4630d06b3013b9cd78aafde352da. This assignment is operative through controller notices now; C records this exact document in Git before integrating dependent implementation. It does not itself resume stopped chats.

## Verified disposition

- Main c520015: all five required workflows on main succeeded by 2026-09-24 18:20:51 UTC; all five branch workflows also succeeded.
- N2 server-first reader/wire/client integration is present. The two earlier review findings (legacy reconciliation migration; pending local explicit intent versus late snapshot) are corrected in current source. Do not redo this completed task or merge whole old A/B tails.
- C04 persistence, privacy repair, post-persist incident/outbox reconciliation and durable runtime are integrated. C04 SOURCE/disposable-DB evidence accepted at this boundary. Live 0049/deploy/TG delivery remain unperformed, not accepted.
- A73f37da and Bf224614 are clean synchronization checkpoints, not new product candidates.
- C state waiting for C04 B bridge / post-main CI is stale. The accepted bridge and all CI results already exist.
- A/B explicit owner STOP stays until the owner pastes their new-dialogue start prompt. C RUNNING text is not evidence of active execution; preserve execution status during this audit.

## A — immediate independent A03 work

Paths: apps/extension/**, packages/browser-platform/**, packages/control-client/**, tooling/build/extension_firefox.py, A-owned tests and receipts. No shared HTTP/schema, DB or package manifest ownership expansion.

1. Reconcile the existing Firefox disclosure candidate 50c252 against current main, which still lists only authenticationInfo and personallyIdentifyingInfo. Build a field-to-destination/category matrix from actual auth, bootstrap, health/diagnostic and explicit AI/report delivery. Reuse correct existing code; do not mechanically merge its unrelated tail or declare every category without evidence.
2. Implement the reusable Firefox consent state / request-projection boundary locally and test grant, decline, permission-query failure, restart and revocation before a subsequent send. Do not add polling, background grant timers or a second authorization system. Missing/failed permission lookup does not mean consent granted. Keep Chromium behavior unchanged.
3. This local seam and focused tests can be completed before C's wire decision. Do not silently enable malformed/metadata-free requests against old strict endpoints, or stop core functionality on opt-out and call it compliant. Active request wiring + final manifest rollout require the compatible server-first shared contract.
4. A delivers its exact local candidate and concrete consumed interface requirements; C owns shared wire/signature selection, B server persistence. A continues the already assigned local portion while C works; no whole-stream wait merely because review_pending is set.
5. Final Firefox acceptance requires actual grant/decline/revoke operation in Firefox, core function on decline, and no forbidden metadata in outbound requests. Source/package checks alone do not close AMO readiness. Opera remains independent.

Mozilla references checked 2026-09-25:
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
technicalAndInteraction is optional; unconditional transmission with an optional declaration is insufficient.

## B — immediate B05 assignment serving C05

Paths: tooling/server/**, packages/server/** and B-owned disposable integration tests/receipts, within current OWNERSHIP. C does not edit these simultaneously.

The prior B05 real PostgreSQL recovery proof is useful but covers the older 38-row journal through 0048. Current main has source0049 (39 migration records). Extend/reuse that recipe for the current accepted schema; do not repeat it merely to change a date.

Deliver a reproducible disposable-only source -> pg_dump custom archive -> fresh restore -> real application-service auth/account/readiness proof. Include synthetic Health scheduled/no-session state introduced by0049 and check that restoration/reconciliation does not duplicate results/incidents/outbox entries. Use normal service/repository paths. No real mailbox, customer data, live DB, live migrations, Telegram send or down migration.

Bounded handoff to C: exact source SHA/tree, migration journal identity, archive SHA256, synthetic invariants checked, exact commands/exit results, private local restored-target reference and limitations. Do not publish DB URL/tokens. Reuse existing tooling; add only the minimal repeatable helper where the old receipt cannot be rerun.

This work does NOT claim immutable application-artifact rollback. C owns that part and consumes B's restored DB proof. B may build the reusable recipe now; when C supplies exact artifact identities, perform only the missing application-boundary checks, not all completed suites again. No new schema migration is needed for this recovery assignment.

When C publishes a precise Firefox server/DB contract, B takes its small bounded implementation at the next safe boundary. Reserve any actual migration number from then-current main; do not preempt existing S2/0050. Until then B05 is real independent work, not waiting for an architecture decision.

## C — first working cycle, before another monitoring task

1. Intake the controller documentation patch by its recorded SHA256 on a clean fresh base; inspect exact paths, apply normally, run docs check, commit using normal hooks. Do not bypass hooks to manufacture a controller commit. No runtime changes in this patch.
2. Record that C04 source is accepted and old post-main CI wait is closed. Preserve live gates. Serially consume ready independent A/B candidates; do not reintroduce old tails.
3. Produce and record the concrete Firefox privacy-neutral contract FIRST: exact optional/request fields, auth/device persistence semantics, signed compatibility/config/profile selection when metadata is absent, version negotiation, old-client compatibility and server-first rollout. Read A's existing impact map; broad permission to design this was already granted on24Sept. No fabricated browser/version, no unsigned compatibility acceptance, no weaker revocation/account isolation. C owns shared schemas/OpenAPI/spec; B owns server/DB; A owns client/consent.
4. Within the first active cycle deliver this bounded contract (or a concrete unresolved design issue with options/evidence), not another generic notice telling A/B to wait for C. This is not a deadline to waive tests or guess architecture. A's local consent seam and B05 continue independently.
5. Advance Opera actual reviewer readiness. R3 proves PACKAGE only, and the published reviewer pack still leaves ordinary authenticated end-to-end open. Verify exact current package against the intended reachable backend, including N2 server-first compatibility, signed config/profile, ordinary login, dedicated safe reviewer data and one claimed read-only request/result/Finish. First submission does not require a prior catalog install.
6. Existing owner authorization permits Submit/Publish under STORE_POLICY once that minimum is met. Remove the duplicate permission request. Request owner input only for a concrete missing publisher login/2FA/mandatory field after all available preparation. Preserve receipt/status from the real dashboard; NOT_SUBMITTED until it exists. Do not substitute owner marketplace keys or fake functionality.
7. C05 independent work: actual immutable app artifact(s) + B restored disposable DB, app startup/ready/auth/bootstrap/isolation and a tested rollback to the previous compatible artifact while retaining forward schema. Reuse B proof; old JSON/symlink harness is only a simulation. Do not let this broader rehearsal delay a store slice unless its concrete deployment depends on it.

## Stale state and evidence discipline

Controller closes the old review requests with this scoped review receipt and keeps unresolved Firefox, reviewer, deployment and C05 product gates visible. Completed STREAMS-ONLY-AUDIT-20260924-1355 notices are superseded; unrelated marketplace/subscription requirements stay open.

New prompts explicitly resume only the owner stop used for this dialogue transfer. Any later STOP wins. Do not ask the owner to approve routine assigned work again; do not claim a notice file starts another chat.

Controller audit does not inspect resources, invoke resource snapshots, stop processes or delete files. Normal supervised tests remain under the existing lifecycle rules. This limited audit is not a new performance/resource conclusion.
