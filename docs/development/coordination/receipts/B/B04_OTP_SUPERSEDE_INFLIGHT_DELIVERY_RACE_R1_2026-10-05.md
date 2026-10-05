# B04 OTP supersede / in-flight delivery race — 2026-10-05

Status: SOURCE CANDIDATE / LOCAL REAL-POSTGRESQL PASS / INDEPENDENT REVIEW PENDING / NOT LIVE.

Task: `B04-OTP-SUPERSEDE-INFLIGHT-DELIVERY-RACE-R1-20261005`.

Base: `7e3406d4f51fc4469d1fc6c09e7b4a131fe4fc6d`.

## Confirmed defect

The accepted B01 OTP cutover review identified and independent role C confirmed a real B04 race in the ordinary OTP replacement path.

Before this correction:

1. `requestOtp()` superseded an older active challenge and set its `otp_email_jobs` row to `DEAD`, clearing ciphertext/nonce/auth tag.
2. If a worker had already claimed that row, the supersede update left `lease_id` and `leased_until` intact.
3. The already-running SMTP/provider call could return after supersede.
4. Worker success/error updates matched only `id + lease_id`, so the old terminal `DEAD` row could be rewritten to `SENT` or, for a retryable failure, resurrected to `PENDING`.

The invalidated OTP challenge never regained authentication authority, but terminal delivery state was not properly fenced and retry state could be resurrected.

This task does **not** claim that an SMTP call already dispatched to a provider can be cancelled.

## Correction

The fix is deliberately narrow.

- The ordinary supersede transaction now clears `lease_id` and `leased_until` when it marks the old job `DEAD`.
- Every worker update performed after a claimed delivery now uses compare-and-set semantics requiring both:
  - the exact lease ID; and
  - current `status='PROCESSING'`.
- This applies to challenge-terminal/envelope-invalid `DEAD`, successful `SENT`, terminal provider failure `DEAD`, and retryable provider failure `PENDING`.

Therefore either ordering is safe:

- provider result commits first, then supersede deterministically ends the job as `DEAD`; or
- supersede commits first, revokes the lease, and the stale worker's later completion update affects zero rows.

Existing expired-processing behavior is unchanged: an expired `PROCESSING` lease becomes `DEAD / LEASE_EXPIRED_UNKNOWN_OUTCOME` and is not retried because provider acceptance is ambiguous.

## RED → GREEN evidence

A focused real-PostgreSQL regression was added to `tests/integration/server/p2-auth.integration.test.ts`.

### RED

Two new scenarios failed on the uncorrected source:

- `T2-16A`: an in-flight successful provider call was superseded; immediately after supersede the old job still retained a non-null lease.
- `T2-16B`: the same defect existed for an in-flight retryable provider failure.

The failing resource job was:
`/root/octoport-control/resource-jobs/07d71eba1b2840a9ab4311ab565ff9b0/receipt.json`.

It finished normally as a test failure, peak about 488 MiB, OOM 0, cleanup verified.

### GREEN

After the correction:

- focused `T2-16A|T2-16B`: **2/2 PASS**;
  resource receipt:
  `/root/octoport-control/resource-jobs/92801e9dc3134dfd927ef75984566897/receipt.json`.
- complete `p2-auth.integration.test.ts`: **21/21 PASS**;
  resource receipt:
  `/root/octoport-control/resource-jobs/3031812307f24a8d8acb1bb5ccc3a15c/receipt.json`.
- `git diff --check`: PASS.
- Prettier for all changed TypeScript files: PASS.
- ESLint for all changed TypeScript files: PASS.

All successful heavy runs report OOM 0 and cleanup verified.

## Local typecheck boundary

A first isolated-worktree package typecheck hit the default V8 heap limit; resource receipt:
`/root/octoport-control/resource-jobs/c47fd7247a1948acadbd1feacb8ef52e/receipt.json`.

A retry with a larger cgroup/Node heap proceeded further but failed because the intentionally symlink-only isolated worktree does not contain the complete pnpm workspace dependency-link graph for unrelated API packages. The errors are missing unrelated workspace/Fastify modules rather than diagnostics in the three changed files. Resource receipt:
`/root/octoport-control/resource-jobs/131bc94516a043289dea5824d837b412/receipt.json`.

This is **not** recorded as a typecheck PASS. Normal exact-candidate CI typecheck remains mandatory before main publication.

## Scope and non-claims

Changed product/test paths:

- `packages/server/db/src/auth-repository.ts`
- `apps/worker/src/otp-runner.ts`
- `tests/integration/server/p2-auth.integration.test.ts`

Plus this receipt.

No schema/migration/OpenAPI change is required.

No owner-test/live database was mutated. Only the role-B disposable PostgreSQL database was reset and used through the existing resource supervisor. No real email/provider request, credential, browser, owner session, maintenance-access path, controller-owned file, or production service was touched.

The correction fences database state after supersede. It cannot recall an email already accepted by an external provider; the superseded challenge remains invalid, so that old code has no authentication authority.

Independent `gpt-6-luna` review and normal governed publication are still required before this source can be accepted into `main`.
