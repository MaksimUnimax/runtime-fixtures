# Controller workstream review — 2026-09-26

Audit ID: STREAMS-AUDIT-20260926-0136.
Owner scope: audit A/B/C work and fix identified issues; explicitly exclude RAM/resources and disk.
Observed remote main: a7097321410921f2fffa54fc3ecf1bc17963c0c2.
Observed C candidate: 7600f3ceb555c32ff798aac48f6c9613e8124ab2.
Observed A candidate: 6f75b75a6c0b329f827b0ccfb81f84a2476d89cc.
Observed B: 1dc04b150b28a55b8319261046bed61727d1fd17, clean synchronization tree.

## Accepted evidence at this boundary

- Current main a709: all five required branch and all five post-main workflows SUCCESS.
- Controller client-profile/forget fixes and permanent continuation rules are in accepted main. PROMPT_A/B/C bytes equal the previously supplied full versions. Do not reapply the old documentation patch.
- A Opera/Firefox actual-browser + disposable-API proof has verified result hashes 4a86921003717786fecb87db62d53577de7d94bcf690ccf1f58701179c28e25e and edb20285512afbe0cb8e4d4298ecfe89f426ae77b630170f74c522bcdc1e1c52. This proves the scoped signed RESOLVED-v2/consent behavior, not live reviewer/provider operation.
- A current Personal-token regression candidate adds a bounded actual-composed-runtime test and an evidence receipt only. Exact diff reviewed; corresponding source/extracted application evidence and core summary PASS. No material issue found in this two-file candidate. Normal C intake/CI still applies.
- B normal-admin catalog planner, prefix22 upgrade, old-v1/new-v2 coexistence and targeted auth/beta/retention evidence are integrated. Their SOURCE/DISPOSABLE limits remain.
- B's expiry materializer fixes historical stale-state cases, but the post-lock timing defect below prevents declaring that entire class closed.
- C ops release/backup/Telegram source work is integrated. No live service, external backup destination or actual store submission is accepted by this audit.

## P1 workflow: terminal failed CI was left waiting

C state still described awaiting terminal branch CI. GitHub showed 4/5 workflows successful and Extension CI failed since 2026-09-25 16:32 UTC. Its only failed job 108154384388 timed out waiting for the extracted-runtime service worker; source runtime passed. The same exact local fixture had already passed both source and extracted runs.

Controller reran only failed jobs for run 36160138783 once. Attempt2 SUCCESS at 2026-09-26T01:39:30Z. All five required workflows on exact7600 are now green. This is actual GitHub evidence, not a local-pass substitution. There is no basis to leave that candidate waiting for CI. C alone completes normal ready-main/non-force publication/readback/post-main checks.

No automatic green bypass, disabled check, force push or repeated unchanged full suite was used.

## P2 source correctness: classification time captured before locks

Current sources:
- packages/server/db/src/p5-billing-event-repository.ts materializes at input.receivedAt after acquiring account/payment locks.
- packages/server/db/src/p5-reconciliation-repository.ts materializes at caller processedAt after multiple awaited locks.
- grant/checkout already use refreshed post-lock time, so the coverage is inconsistent.

Deterministic reproduction:
- event received at 00:00:00;
- current paid period ends at 00:00:01;
- modeled lock release/decision time 00:00:02;
- actual current-source repository returns FAILED/CURRENT_SUBSCRIPTION_CONFLICT;
- actual lifecycle helper at the decision time says no current subscription remains.

Evidence: /root/octoport-control/incidents/streams-only-audit-20260926T0136Z/expiry-lock-boundary.mts and .log.
Scope: actual repository and actual materializer with a deterministic database port. It is not a physical concurrent PostgreSQL lock rehearsal. No real payment/DB/network operation was executed.

Impact: avoidable delayed/rejected activation until reconciliation when expiry is crossed during processing/lock wait. This is not evidence of a permanently lost payment or a currently exploited live incident.
Assignment: B reproduces actual lock crossing on disposable PostgreSQL, then uses fresh processing time after relevant locks for current/new lifecycle classification. Keep provider occurredAt/statusAt and receivedAt/verifiedAt for their original chronology. Preserve account serialization, atomicity, replay/history and the existing 30-second worker. No new schema/cron or paid launch.

## P1 release-plan evidence: R3 preconditions overclaimed

The R3 runbook says all technical preconditions are proved, but:
1. StepD publishes catalog records before creating/retrieving the reviewer in step6. Accepted planner deliberately requires an existing verified ACTIVE reviewer, exactly one ACTIVE account and beta admission BEFORE any catalog mutation. It explicitly has no targeted create/invite path under CLOSED beta.
2. The accepted rehearsal starts with a valid v2 base config. A count of one config row in a restored live snapshot does not prove its contract is v2 or that its signing authority satisfies the planner. STORE1_V2_BASE_CONFIG_MISSING remains a real preflight branch.
3. The cited d248 rollback-floor receipt proves exercised API paths. Full exact worker/portal rollback launch parity is not evidenced by that receipt. R3's forward API/worker/portal rehearsal does not prove rollback of all three.
4. The actual R3 launch script executes API/worker through tsx source entrypoints and portal through next start. dist-file build hashes do not by themselves identify the executed closure; retain and verify the exact tested source/dependency/portal commands.

R4 correction document is authoritative for the next preparation step. Existing good forward migration/snapshot/launch evidence remains valid in its stated scope. Do not demand its repetition without drift. Do not perform live mutation from this audit. Do not present missing preparation as a request for owner authorization alone.

## P2 coordination: ready work mislabeled external

- Joint A02+B03 acceptance is not the same as owner live transfer UX. Existing browser_d3s2_r1_transfer.py, vault-restart harness, production transfer routes and relay can be exercised on synthetic credentials and a disposable API now. A owns the browser harness; B owns server/DB helpers. No new shared-wire design is needed merely to test the accepted protocol.
- APPROVED_REQUIREMENTS_NOT_IMPLEMENTED subscription policy already authorizes the target requirements. C must define the exact versioned contract before A/B implementation; this is a C design assignment, not a reason to ask the owner to restate the decision. Source implementation does not enable paid commerce and does not become a beta/store blocker.
- Current N2 integration is already accepted. Old generic 'wait for N2 decision' wording must be replaced with a precise new unresolved contract if any; otherwise it is stale.
- The corrected MBROWSER one-cell draft is a C bookkeeping handoff, not a dependency for A/B product development.
- Controller notices themselves retained obsolete READY_PATCH_NOT_IN_MAIN and old task lists. Controller closes/updates these after this review; unchanged permanent prompts need no replacement.

## Scope of review closure

Controller closes prior requests as REVIEWED_WITH_FINDINGS_AND_ASSIGNED_WORK, not full beta/release acceptance. Current role status/task/head/result/next and timestamps are preserved; a notice is not proof a chat resumed. New targeted notices and report remain open until actual resulting evidence arrives. Only known stale owner R3 authorization requests are deferred for corrected preparation; unrelated requests are retained.

## External policy reference checked

Official WB seller token guide was retrievable through search on 2026-09-26:
https://seller.wildberries.ru/instructions/ru/ru/material/how-to-create-update-or-delete-a-wb-api-token

The current test correctly covers the declared Personal-only input boundary. This review does not turn local token-type normalization into validation of every real token, nor decide optional encrypted-relay policy. Generic synthetic transfer acceptance can proceed without live WB credentials.

## Publication

Opera: PREPARING, not SUBMITTED. Repaired e7d STORE package inputs remain unchanged through observed7600. First submission still needs compatible reachable backend/catalog, ordinary dedicated reviewer path and actual reviewer E2E. C handles the corrected concrete deployment preparation; A/B source work continues. Other channels are not newly accepted by this audit; Safari remains outside beta.
