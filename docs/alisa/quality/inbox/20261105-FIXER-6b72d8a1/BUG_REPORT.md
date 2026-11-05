# Advertising repair — 20261105-FIXER-6b72d8a1

Owner authorized diagnosing and fixing Performance API after restoring Alisa. Isolated candidate based on the actual active 20261105-v010-base-batch02-r1, not the old offline compatibility runtime. Activated 2026-11-05T02:54:26.527148Z.

## QA-20261105-TESTER-9ad72c41 — installed fix, LIVE_DIALOGS PASS

Observed: same authenticated day previously returned empty expense rows while daily and CPO controls were nonempty. At 02:50 UTC legacy expense began returning rows; at 02:52 its aggregate matched daily exactly. This supports delayed/intermittent report readiness as a hypothesis. It does not prove Ozon's internal cause. HTTP 200/valid credentials never proved numerical completeness.

Application defect was proven: empty expense summed to zero, and one legacy report was used as the total advertising source. JSON-only routing now separates daily ad_spend from legacy bonus/prepayment. Both reject unconfirmed empty results; daily checks identity+day, period, currency, Decimal, duplicates and a full-page truncation risk. CPO controls are not added again.

Live canary via existing HTTPTransport, protected service credentials and shared calls/rates ledger; 11 total HTTP across all current canaries and the Dialogs job, all200. No network uncertainty retried, no quota reset/new bypass bucket. Daily uses existing ozon_expense quota. No new per-question/provider Python handler. Original sources/dataset contracts preserved.

Old qualifications for unchanged source contracts were carried forward with updated enclosing global hashes after exact comparison; this is not new live qualification of every method. New daily and stricter legacy source have a fresh receipt. Old cache plans are rejected by changed registry hash; account/access revisions and credentials unchanged.

## QA-20261105-TESTER-70ac9201 / OZCP-003 — partial improvement

Shared failure_catalog/failure_explanations now supplies reason + next action for failed jobs and bare-code safe_submit failures. Existing human clarifications are preserved. Live unsupported Ozon cancellation query now returned a human reason; that direct rejection still has no explicit next step, so the broader wording issue is not declared completely closed.

## Own integration findings

First canary sent two successful HTTP calls but decode failed: an added redundant guard compared decimal_comma's canonical string with integer0. Removed the invalid guard; finite/nonnegative validation remains in the existing decimal_comma primitive. This was fixed before activation. The failed attempt is retained in private evidence.

Old test transports/route assertions still expected expense for ad_spend. Updated mocks and exact route assertions to daily, retained numerical expectations, changed the combined total+funding call expectation from2 to3 because they are now distinct reports. Added14 independent source regressions. Final874/874, architecture PASS, network forbidden. Initial missing test-only corpus/config fixture files were supplied from the authoritative offline test bundle. Not claiming 957/957 or 32 live calls.

UI counter24 wait timed out; the actual human response was read afterwards, without resending. Timing is a labelled upper bound.

## Other open findings preserved

Absolute-day parsing QA-20261105-TESTER-3c8e502b is not fixed by this advertising patch. The unit economics candidate remains blocked for cancelled-order revenue completeness; no new profit figure is published. Generic exact-period proof and composed-report gate from COMPLETENESS-R01 were not enabled without a current-worker verifier.

## References

- [Earlier provider investigation](../20261105-TESTER-9ad72c40/README.md)
- [Latest owner policy and open bugs](../20261105-TESTER-3c8e502a/README.md)
- [Prepared offline continuation](../../BASE_BATCH02_COMPLETENESS_ACCEPTANCE_2026-11-05.md)
- [Actual applied patch](PATCH.diff)
- [Current run and each HTTP timing](RUN_REPORT.json)

