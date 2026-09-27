# B07 post-lock time validation — 2026-09-27

Status: SOURCE_VALIDATED_CANDIDATE

## Scope

Validated the existing child worktree `/root/octoport-control/worktrees/B/resume-b07-postlock-time-20260926` rather than reimplementing it.
Child base was `1dc04b150b28a55b8319261046bed61727d1fd17`.
Fresh `origin/main` was `7600f3ceb555c32ff798aac48f6c9613e8124ab2`; its only delta against the B base was C-owned readiness documentation, merged cleanly into B as `dab92e0b4f5bc7589f3746d18e0cca513b38c241`.
The five tested source/test files were copied byte-for-byte from the validated child after that docs-only merge; `cmp` passed for every file.

## Clock and fixture corrections

P5.5 now uses a deterministic injected `processingClock` for reconciliation repositories. Historical fixed-`processedAt` tests therefore no longer accidentally classify against wall clock.
The pre-existing delayed-period-ended case explicitly advances `processingClock` to its intended `processedAt`, preserving the historical EXPIRED outcome.
Both new lock-crossing fixtures now include their required revision-1 ACTIVE transition; the database transition-origin constraint remains enforced.
Webhook/reconciliation lifecycle classification samples fresh time after the relevant lock while event/provider chronology remains on `receivedAt`, `verifiedAt`, provider `occurredAt`/`statusAt`, and provider period boundaries.
No schema, worker cadence, live DB, commercial enablement, registration opening, or SQL bypass was introduced.

## Verification

Environment: Node 24.20.0, pnpm 10.34.5.
Exact-child dependencies were installed offline with `pnpm install --frozen-lockfile --offline`; lock SHA256 stayed `e947b55bf62341da18963663545d5fe91e243d83560d40e709a3361350ac34e5`.
B disposable PostgreSQL was provided by `control.py B ensure-db` on the supervised B database profile.

Rework run R2: supervisor job `714b05e295264dc981c98c2ca9e7b70e` produced 242 PASS / 2 FAIL. Both failures were invalid new fixtures lacking the required initial subscription transition; no production assertion or database constraint was weakened. Log SHA256: `5fbf6c519a04130557c68d32c641a82b44a8a3693ace5f29b502ac0a43890e53`.

Final run R3: supervisor job `89f6f651c7684aa0bed3cda2791f0e36`, `command_exit_code=0`, `cleanup_verified=true`, `oom_kill=0`.
Vitest result: 2 files passed, 244 tests passed.
Final log: `/root/octoport-control/logs/B/b07-postlock-full-p54-p55-r3.log`.
Final log SHA256: `475f60f1058baf6615249395da627c408b5a13e416f058b0aa1e5b98c296ee4d`.
Supervisor receipt SHA256: `a696dccc039aa41c26bbcfdbf701cc8fe897806ff2ae763481c51225417d98e6`.

The passing files include the real PostgreSQL advisory-lock wait checked through `pg_blocking_pids`, post-lock expiry, delayed provider-period expiry, replay, atomicity, worker-first/inline-first lifecycle equivalence, and provider/event chronology assertions.
Prettier was applied to the repository and both edited integration files; `git diff --check` passes.
