# C — signed profile contract + owner helper guard intake — 2026-09-28

Status: **INTEGRATED SOURCE CANDIDATE / LOCAL PASS / BRANCH CI REQUIRED / NO LIVE APPLY**

Base: canonical `main` exact `c08a08494cb1bf5c7c63db4790dedc6c47c4969f`.

## Exact intake

C cherry-picked controller owner-helper guard `65e3b11ded81879bb6162013dbb797d64da5b448` after already accepted A `8fa44892`. The helper now inspects `/proc` argv exactly instead of invoking `pgrep` with an option-like pattern, fails closed on inspection errors, and records only safe page-error counts instead of raw page-error strings. C reran 12/12 guard tests plus compile/describe/exact STORE prepare: PASS, no browser login/provider/live mutation.

C then integrated the exact shared contract chain in order:
- `62da3d71c6c378ed17314851036efb5d9f84fc0d` — canonical existing `adapter_profile_v1` schemas plus strict internal signed-profile request/response/receipt;
- `555452f8fa59a0006c25d164afc779569ef93c46` — semantic follow-up binding each selector slot strategy/reference and each contour key/strategy;
- `e70d1f281b9c80e780a3c33d9cac30cb5dd52751` — first bounded profile-repair binding/decision/approval contract and server-side binding/freshness helper.

The contract does not permit raw CSS/JS/URLs/executable text, does not turn parsing into signature verification or work authority, does not let callers supply operator identity/time, and caps approval lifetime at 24 hours. `checkProfileRepairApprovalBinding()` explicitly verifies only identity/time freshness; it is not an execution authorization service. No DB/HTTP/live mutation is in this boundary.

A preflight candidate `b844f3cd6c554d3a9df95e6a1f7b6c841c7e9b8d` had identified the two semantic strictness gaps (slot reference mismatch and contour strategy mismatch). Those findings are now closed by exact `555452f8`; no A product implementation is claimed by this intake.

## Integrated validation

Supervisor `octoport-test-c-7624ad8b34c042f2baeb80aeca62adf3.service` ran under the 3 GiB build profile and exited 0, OOM 0, cleanup verified, peak 670,040,064 bytes. It performed:
- `pnpm install --offline --frozen-lockfile`;
- contracts tests (78/78) + typecheck;
- adapter-registry tests + typecheck;
- health tests + typecheck;
- owner-helper guard tests 12/12;
- repository lint, format check, documentation check and `git diff --check`.

B exact `400c713c08a6ecfc7be8f531447c5e0cdfe804bf` is intentionally **not** batched into this candidate. Controller finding `B18-LEGACY-ACTIVATION-GAP-20260928-0625` shows the migration/repositories still need a bounded idempotent reconciliation path for already-SUCCEEDED legacy NO_SESSION results plus actual prune coverage. Source review may continue independently, but live retention acceptance remains open.

Evidence boundary: SOURCE/LOCAL_TEST only. No immutable STORE bytes changed, no owner-test deployment/catalog/auth action, no monitoring pilot mutation and no production action occurred.
