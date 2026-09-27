# Controller next work — 2026-09-26

Direct owner instruction: audit/fix A/B/C work only, no resource or disk audit.
Effective now through STREAMS-AUDIT-20260926-0136 notices.
This is a bounded assignment within existing PLAN/OWNERSHIP and accepted product requirements; it does not reset progress, authorize live mutations or start a stopped chat.

## A — A02_B03_JOINT_TRANSFER_ACCEPTANCE

Controller reviewed exact6f75 source/package Personal-token regression; no material issue found in the two-file candidate. C retains normal integration. Do not wait for that receipt-only integration: joint A02+B03 acceptance is an assigned existing-contract task.

1. Reuse browser_d3s2_r1_transfer.py and browser_transfer_vault_restart.py against accepted current source. Drive two actual extension workers/profiles through the real disposable API and actual B03 relay, including A02 recipient restart while an envelope is in flight.
2. Cover one-time successful receive/import/ack, restart before/after delivery, expired request, source/recipient revoke, corrupted packet and no-replay UNKNOWN. Keep account/store/device fencing. Use only fixture credentials, no live marketplace calls. Do not label synthetic proof as owner UX.
3. If existing evidence already proves a scenario on identical implementation, cite it and add only the missing joint boundary. A owns the browser harness; B owns server/DB helpers. No protocol/schema change is required just to run the accepted protocol.
4. Then finish a bounded WB field-schema/unit mapping slice for the minimum useful read-only scenarios using current official documentation; 45/45 operation-name mapping is not complete field-level proof. Report unavailable sources precisely; do not infer metrics from names.

Paths: tests/regression/extension-core/client-i1/browser_d3s2_r1_transfer.py; tests/regression/extension-core/client-i1/browser_transfer_vault_restart.py; tests/regression/extension-core/client-i1/api-harness.ts; A-owned client/tests/receipts.

## B — B07_SUBSCRIPTION_POST_LOCK_TIME

Confirmed residual timing defect: billing webhook classifies subscriptions at receivedAt captured before DB locks; reconciliation similarly uses caller processedAt. Deterministic actual-repository/materializer repro returns CURRENT_SUBSCRIPTION_CONFLICT after modeled expiry under lock. No live DB was involved.

1. Read /root/octoport-control/incidents/streams-only-audit-20260926T0136Z/expiry-lock-boundary.mts and .log. Reproduce with actual disposable PostgreSQL lock wait across paid end; inspect both webhook and reconciliation paths.
2. Use fresh processing time after relevant transaction locks for access/lifecycle classification while preserving receivedAt/verifiedAt/provider occurredAt/statusAt as event chronology. Keep injection deterministic and avoid blanket changes to fixtures, deadlines or worker cadence.
3. Add targeted lock-crosses-expiry and delayed-new-period cases, atomicity/replay/worker-first equivalence as needed. B alone changes DB repositories; no schema change or live deployment is requested. Existing 30-second worker is retained.
4. Next support A joint transfer proof through existing normal routes; any new server-only fixture helper stays in B ownership, not concurrent editing of A api-harness.ts.
5. Then complete source-only reviewer/v2-config preflight specification: existing verified admitted reviewer must be checked before catalog mutation. No hidden creation of user, global signup opening, SQL or owner credentials as reviewer. If no existing ordinary provisioning path exists, hand C precise smallest contract gap.

Paths: packages/server/db/src/p5-billing-event-repository.ts; packages/server/db/src/p5-reconciliation-repository.ts; packages/server/db/src/p5-current-subscription-materializer.ts; tests/integration/server/p5-4-simulated-billing-events.integration.test.ts; tests/integration/server/p5-5-reconciliation-lifecycle.integration.test.ts; B-owned transfer/server tooling and receipts.

## C — C02_C06_INTAKE_AND_R4_PREPARATION

Exact7600 failed browser CI retried once by controller: run36160138783 attempt2 SUCCESS; five workflows now green. Complete normal existing-candidate integration, then review/intake A6f75 and ready documentation. Do not leave completed CI in waiting state.

1. Fresh main check, normal ci_gate/ready-main for exact7600, non-force push/readback and required post-main verification. A6f75 controller scoped review passed; consume exact candidate normally. Controller does not impersonate C or bypass hooks.
2. R3 is not yet sufficient to say only owner authorization remains: StepD wrongly creates reviewer after catalog writes but planner requires existing verified admitted reviewer first. Fix preflight/order, and prove a compatible v2 base config before proposing complete catalog activation.
3. Only API rollback to d248 is evidenced by current C05 receipt. Prove exact worker/portal rollback commands too, or scope rollback honestly and prepare the missing pieces. Candidate launch used tsx source entrypoints: preserve exact tested commands rather than substituting untested dist outputs.
4. Publish the already corrected MBrowser one-cell evidence only at a normal compatible documentation boundary, not another reason for A/B to wait. Keep source/package/live distinctions.
5. Assign the precise shared extension/server contract for already-approved 24h refresh and paidThrough+72h access policy. This is already approved source development, not permission to enable paid commerce or an added beta/store gate. A and B continue assigned independent work while C defines it.
6. Continue early store preparation; no Submit until reviewer minimum is proved. Preserve the existing owner-only live authorization boundary and ask only about a corrected concrete ready operation.

Paths: C-owned coordination/contracts/release/operations files, no overlap with active A/B changes.

## Ownership and sequencing

A and B begin their independent existing-scope portions now; controller review completion and C's docs integration are not a new permission gate. A does not edit DB/server sources; B does not edit A's browser harness. Any genuinely new wire/schema is first assigned precisely by C as already required. C keeps intake/publication moving while preparing release and the approved access-policy contract.

Controller reserved only the new review/assignment/R4 documentation and README pointer in its isolated audit worktree. This reservation does not block product paths. C integrates exact ready documentation through normal checks; no hook bypass.

At each boundary record actual work done and a concrete next task. WAITING_INPUT needs every remaining authorized task's blocker. A RUNNING label or a newly written notice alone is not evidence that execution resumed.
