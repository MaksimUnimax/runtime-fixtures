# Preprod release preflight R4 — 2026-09-26

Status: **PREPARATION REQUIRED / NOT READY FOR CATALOG WRITES / NO LIVE AUTHORIZATION / NOT EXECUTED**

This corrects the ordering and readiness claims in the C-only R3 preprod runbook at `/root/octoport-control/logs/C/PREPROD_DEPLOYMENT_RUNBOOK_0D5E4F46_R3_2026-09-25.md`. Existing exact backend build, forward-migration, candidate-launch, and disposable API rollback evidence remains as recorded there and in C05 receipts. This document records source-derived prerequisites and the next bounded checks; it reports no new live or disposable inspection.

## Readiness by boundary

| Boundary | State | Evidence / missing proof |
|---|---|---|
| Candidate source, build, migration and candidate launch | Previously proved on disposable/restored state for the exact R3 identities; revalidate if the accepted target changes | R3 receipt; this is not installed/live acceptance |
| Reviewer identity and admission | **BLOCKED / UNKNOWN** | No evidence here that a dedicated reviewer already exists as an ACTIVE, email-verified user, owns exactly one ACTIVE account after complete pagination, and that account is already admitted |
| Compatible v2 base configuration | **BLOCKED / UNKNOWN** | A nonzero config count is insufficient. No signed/read-back proof of the current compatible v2 base and its signing authority is supplied here |
| Complete STORE-1 catalog activation | **NOT PREPARED** | The ordered, read-only checks below must pass before the first catalog POST; none of their unknown live results is presumed |
| API rollback floor | **PROVED ONLY FOR EXERCISED API PATHS** | C05 final0051 disposable rehearsal identifies `d24838669c54f21dc161dc48a7e71e0e288384c2`; do not generalize to worker/portal |
| Worker and portal rollback | **UNPROVED** | No exact previous-runtime worker/portal rollback rehearsal on the same compatible forward schema is evidenced |
| Live/preprod operation | **NOT AUTHORIZED / NOT EXECUTED** | This preparation receipt grants no mutation authority |

## Mandatory read-only preflight before any catalog write

Use ordinary authenticated admin readback on the exact intended target. Preserve private reviewer identifiers outside the receipt and logs. If a read endpoint is unavailable on the current runtime, preparation may use the previously proven isolated upgraded copy, but that result is not live readback and must be repeated on the authorized target before any catalog POST.

1. Verify global beta is `CLOSED` with `GET /v1/admin/beta/admission`. Stop if it is not closed.
2. Resolve the already-existing dedicated reviewer through `GET /v1/admin/users?email=<REVIEWER_EMAIL_PRIVATE>&limit=1`. Require exactly the intended ACTIVE user and verified queried email. Do not create a user, open global registration, reuse an owner privileged identity, use SQL/admin bypass, or invent an invite route. The source planner explicitly blocks missing identities because CLOSED beta has no targeted invite primitive.
3. Read every ACTIVE account for that reviewer using `GET /v1/admin/accounts?ownerEmail=<REVIEWER_EMAIL_PRIVATE>&status=ACTIVE&limit=100`, following every `nextCursor` until null. Require complete pagination and exactly one ACTIVE owned account. Unknown cursor state, zero accounts, or multiple accounts is a blocker.
4. Verify that exact account is already admitted using `GET /v1/admin/beta/admission/accounts/{account_id}`. Require matching account ID and `admitted: true` while global beta remains CLOSED. Do not try to create admission by opening beta or by an unsupported targeted invite.
5. Verify the exact accepted package authority using `tooling/server/store1-opera-admin-activation.ts` and its `readStore1PackageAuthority` guard. R3 identifies package source `e7d66152bdb77918b65115486c9829ef7a634e69`, tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`, version `0.2.4`, contract `control_plane_v2`, and Opera ZIP SHA-256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`. A changed package-input delta requires renewed package authority/build evidence.
6. Before any release, policy, config, adapter, surface, variant, profile, revision, or assignment POST, read `GET /v1/admin/compatibility/config-releases/latest?contractVersion=control_plane_v2`. Prove an existing compatible signed v2 base: expected contract, `bootstrap_snapshot_v2`, `bootstrap_envelope_v2`, valid signature under the already established trusted public signing authority, and successful ordinary authenticated readback. This is a no-mutation check: do not publish a seed/config, create or rotate signing keys, extract/print signing secrets, or infer readiness from migrations or a nonzero count. If no valid v2 base exists, stop and identify the supported initialization/signing source gap for separate preparation.

Steps 1-4 follow the order of `reviewerPreflight` in `tooling/server/store1-opera-admin-activation.ts` (roughly lines 274–357), which `planStore1Activation` runs before release/policy/config reads that can lead to writes (roughly lines 359–375 onward). Its compatible-v2-config gate is at roughly lines 445–475. That gate occurs AFTER release/policy decisions in the current planner and therefore does not enforce step 6 before all writes: the parent must obtain and validate the base-config/signature readback before executing any planner mutation. This receipt does not claim that this additional preflight is already implemented in the planner; shape checks there alone are not cryptographic verification. Use the exact source lines in the current reviewed tree when executing; line numbers can shift.

Only after every read-only precondition passes may a separately authorized, bounded activation plan proceed through ordinary authenticated admin APIs, preserving CAS and readback at each step. The planner's later adapter, surface, variant, profile, revision and account-assignment reads also require complete pagination before each create/reuse decision. Never use direct SQL for catalog activation. Keep beta CLOSED.

## Rollback evidence and boundary

`docs/development/coordination/receipts/C/C05_FINAL0051_IMMUTABLE_RECOVERY_ROLLBACK_2026-09-25.md` proves the d248 floor against the same restored forward-schema disposable database for API readiness, the exercised N2 reads, and identified/privacy-neutral signed bootstrap. It rejects `7945d628...` for privacy-neutral bootstrap. This is API evidence only. It does not establish API+worker+portal rollback, and it does not prove live deployment rollback.

Before describing a three-service rollback as proved, a separately supervised disposable rehearsal needs to identify exact source/dependency/artifact inputs and launch commands for API, worker, and portal; start all three against the same compatible restored forward schema; check API, worker, and portal readiness plus required authenticated bootstrap/N2/metadata-forget compatibility; verify prohibited outbound integrations are disabled; then exercise return to the candidate or record a precise recovery disposition. No down migration is part of application rollback. If writes have reopened, restoring an older DB snapshot requires an explicit recovery/data-loss decision.

R3's candidate rehearsal command identities must remain truthful: API runs Node 24.20.0 with `apps/api/node_modules/tsx/dist/cli.mjs` and `apps/api/src/main.ts`; worker runs Node with `apps/worker/node_modules/tsx/dist/cli.mjs` and `apps/worker/src/main.ts`; portal runs Node with `apps/portal/node_modules/next/dist/bin/next start -p 3191`. These are source/tsx and Next-start commands, not `dist` server entrypoints. Preserve the actual target, frozen dependency identity, portal build identity, and exact command when repeating evidence. The rehearsal script is `/root/octoport-control/logs/C/run_preprod_systemd_rehearsal_0d5e4f46.sh`; its command is historical evidence, not permission to run it.

## Bounded next checks and authority

1. Parent C reviews this document and integrates it at a normal documentation boundary.
2. Parent C may prepare an explicitly supervised disposable readback/rehearsal using `control.py C heavy` and the resource policy. First resolve the reviewer and base-config unknowns with read-only checks; do not repeat already recorded build/migration/candidate launch proofs unless the exact target changed.
3. If reviewer identity/admission or valid v2 base is absent, record the precise source/product prerequisite and keep catalog activation blocked. Any genuinely missing supported provisioning capability needs a separately scoped shared contract/source task; it is not permission to create a user or invite now.
4. Complete and review the worker/portal rollback rehearsal before claiming a three-service rollback plan.
5. Only after all technical prerequisites and the concrete operation are prepared does the parent request the required operation-specific owner authorization. Store submission remains a separate gate: existing early-submit authorization applies only once the real reviewer minimum is met.

No live service, database, SMTP, marketplace, signing secret, user identity, catalog, or store dashboard was inspected or changed for this source-review document. Existing R3 and C05 receipts remain evidence only within their stated disposable/source boundaries; no claim is made that only owner permission remains.
