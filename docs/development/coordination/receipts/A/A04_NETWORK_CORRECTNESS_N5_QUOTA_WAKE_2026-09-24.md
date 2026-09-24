# A04 network correctness — N5 quota wake — 2026-09-24

Role: A
Task: A04 / controller subscription-network follow-up
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller notice `SUBSCRIPTION-NETWORK-REVIEW-20260924` confirmed that the composed active runtime returned immediately from `resumeProviderQuotaWaits()`, while the durable technical scheduler QUOTA task dispatched to that same function.

A bounded Luna child reproduced the defect against base `d34175afec872474a34dcce099775612928e4df4`: a manually authorized two-command package reached an observed quota wait, but the due technical alarm did not dispatch the second provider request. The child worktree result is `/root/octoport-control/logs/A/a04-n5-quota-wake-20260924-result.md`.

## Change

- Active Seller Agents runtime no longer returns from the existing quota-resume function before manual waits are inspected.
- The existing manual batch processor is reused; no second execution path or scheduler is introduced.
- Legacy/client autorun quota waits are skipped when Seller Agents runtime is active, so stale autorun state cannot keep rearming a QUOTA wake.
- Technical scheduler reconstruction ignores active-runtime autorun quota records through the same composed patch boundary.
- Imported donor bytes remain unchanged.
## Regression

`tests/regression/extension-core/full-worker-composed.mjs` now exercises the real composed alarm listener with the existing manual Work path:
- an early alarm leaves the authorized package waiting and performs no extra provider request;
- once the observed quota deadline is due, the existing package resumes exactly once without popup click or tab switch;
- a fresh worker created from the same durable browser storage reconstructs the waiting package/scheduler state and resumes exactly one due provider dispatch;
- `Finish` before the due alarm prevents any second provider dispatch;
- stale autorun quota state does not reconstruct/rearm an active-runtime QUOTA task.

`tests/regression/extension-core/worker-harness.mjs` now preserves synthetic alarm registration and exposes a bounded `fireAlarm` test seam. It does not alter production runtime.

Parent focused verification on the integrated diff:
- deterministic composition build PASS;
- full-worker-composed PASS with `quota_alarm_resume=true`, `fresh_worker_quota_alarm_resume=true`, `early_quota_alarm_stays_scheduled=true`, `finish_blocks_quota_dispatch=true`, `autorun_quota_wake_disabled=true`;
- worker-lifecycle PASS 6/6 including provider-429 no hidden retry and worker-restart no replay;
- batch-context PASS 12/12;
- P3 technical scheduler PASS 7 scenarios;
- exact committed-head `extension_core.py` PASS 119 gates; evidence `/root/octoport-control/logs/A/a04-n5-exact-145efb2-core/summary.json`; resource job `725f5eb02ba345d7ab831046f6134142`, exit 0, OOM 0, cleanup verified, peak 178,257,920 bytes;
- exact committed-head `extension_i1.py` PASS 146 gates; evidence `/root/octoport-control/logs/A/a04-n5-exact-145efb2-i1/summary.json`; resource job `d95d18434b5b4328ab1ac118795e8bf7`, exit 0, OOM 0, cleanup verified, peak 358,612,992 bytes.

## Limits

This does not claim installed-browser or live-provider acceptance. It does not implement N2 cross-browser wire identity/pull or N4 Wildberries quota/header semantics. It does not permit replay after an unknown provider outcome; existing batch/context/result-recovery fences remain authoritative.
## Independent review

Read-only Luna review of exact implementation commit `de5d54d13368a7663587587e3921a4bac95a10fc` found no blocking implementation defect. It identified one test-coverage gap: the alarm scenario originally kept the same worker alive.

That gap was closed before submission by persisting the authorized quota-wait package in shared synthetic browser storage, closing the first worker, creating a fresh worker, firing the durable technical alarm after the deadline, and proving exactly one provider dispatch with the package returning to `idle`. Evidence: `/root/octoport-control/logs/A/a04-n5-review-de5d54d-result.md` plus the final `full-worker-composed.mjs` regression.
