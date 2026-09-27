# Preprod preparation corrections R4 — 2026-09-26

This is an amendment to /root/octoport-control/logs/C/PREPROD_DEPLOYMENT_RUNBOOK_0D5E4F46_R3_2026-09-25.md.
Status: PREPARATION_REQUIRED / NO_LIVE_AUTHORIZATION / NO_SERVICE_OR_DATABASE_MUTATION.
Existing exact forward-build/migration/launch evidence is retained. Fix only the missing boundaries below.

## 1. Separate backend cutover from catalog/reviewer completion

R3 currently bundles live migration, three-service switch and complete reviewer-ready catalog activation. Do not claim the complete bundle is technically ready while reviewer/base-config preconditions are unknown.

Before any catalog mutation:
- verify global beta CLOSED;
- resolve an existing verified ACTIVE dedicated reviewer identity through ordinary admin readback;
- exhaust account pagination and require exactly one ACTIVE owned account;
- prove that account/user is admitted;
- validate exact accepted STORE package authority;
- establish an actual compatible v2 base config and its existing signing authority.

Keep the planner's read-only preflight order. Do not move reviewer checks behind release/policy/profile POSTs. If the current deployed backend cannot supply new readback endpoints, use the proven isolated upgraded copy for preparation, distinguish it from live readback and recheck ordinary API on the authorized target before any catalog POST.

Missing reviewer identity is not permission to create one via SQL, reuse an owner's privileged account, open global registration or invent an invite endpoint. First finish a supported ordinary provisioning plan or explicitly separate the safely reviewable backend-only operation from later catalog activation. C owns the shared contract if a genuinely missing bounded invitation capability must be implemented; B owns server/DB. Any required owner email/OTP is requested only for a prepared concrete flow.

Missing v2 config is not solved by migrations or by a nonzero config count. Reuse the existing supported initialization/signing path if present; otherwise name the precise source gap and prepare it before claiming full activation readiness. Never extract or print signing secrets.

## 2. Prove the rollback actually proposed

The d248 receipt proves API-only paths against the forward schema. Before proposing rollback of API+worker+portal, supply:
- exact source/dependency/artifact identities and startup commands for all three;
- isolated startup/readiness on the same compatible restored forward schema;
- auth/bootstrap/N2/metadata-forget compatibility needed by already-installed clients;
- no outbound mail, Telegram, billing, marketplace or real user action;
- a tested return to the candidate or a precise recovery disposition.

Do not confuse candidate forward startup with previous-runtime rollback proof. Do not roll back schema destructively.

## 3. Pin the bytes that commands execute

The R3 rehearsal commands launch:
- API: Node + apps/api/node_modules/tsx/dist/cli.mjs + apps/api/src/main.ts;
- worker: Node + apps/worker/node_modules/tsx/dist/cli.mjs + apps/worker/src/main.ts;
- portal: Node + apps/portal/node_modules/next/dist/bin/next start.

Use the same verified commands or prove the replacement. A dist build SHA is not the identity of a tsx source execution closure. Record the source tree, frozen dependency identity, portal build and exact command. Keep the target unchanged during review/operation. Immutable packaging/hardening can proceed under the existing B05/C05 scope without inventing a new deployment topology.

## 4. Keep the good R3 protections

Retain fresh final quiesced backup after stopping only owner-test writers, exact canonical prefix verification, source/data count safeguards, forward migration and compatible rollback. Rehearsal backups are not the final live rollback point. Preserve the rule that restoring an older snapshot after writes reopened requires an explicit recovery/data-loss decision.

Business Bridge and other services are outside the operation. CLOSED beta stays CLOSED. Store Submit remains separate and already authorized only after its real minimum is reached.

## Completion evidence

C produces one corrected runbook with explicit PREPARED / BLOCKED states per boundary and references exact missing proofs, then asks for authorization only for a concrete fully prepared live operation. This correction adds no owner work merely to run source/disposable preparation.
