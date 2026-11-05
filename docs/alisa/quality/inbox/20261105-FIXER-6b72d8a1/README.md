# Advertising source repair — installed and checked in Dialogs

Release: 20261105-v010-ads-daily-r1. Base: actual 20261105-v010-base-batch02-r1.
Registry hash: 21c455ab0bbae9595bedb8b0e74fc41a0e804ece5b790f5067c41e5956953d9d. Scalar hash: 3012bb29b23c61037204af625fcffd740b4020023f1178e76421fed17d904212.

[RUN_REPORT.json](RUN_REPORT.json) contains scenarios, all11 HTTP timings, all4 UI commands and timing limitations. [BUG_REPORT.md](BUG_REPORT.md) explains evidence, root cause limits, own integration failures and open bugs. Merchant amounts remain in the owner's private report.

[PATCH.diff](PATCH.diff) contains the four current runtime changes and two shared failure files plus14 new source regressions. Apply only against [BASE_MANIFEST.json](BASE_MANIFEST.json), preserving all existing dataset additions. [REGRESSION.json](REGRESSION.json) is the merged874-test final result. [MERGED_MANIFEST.json](MERGED_MANIFEST.json) records the exact activated tree. [activate_ads_daily.py](activate_ads_daily.py) documents guarded switch and rollback, not a blind installer for another host.

The prepared offline ZIP was reused selectively: daily recipe + failure explanations. Its opt-in hourly exact-period proof was not enabled as a universal live permission; no dynamic proof adapter exists. Do not deploy the old full runtime over current batch02. Unused generic validation modules are present but not connected to the worker. The activated source uses existing method-level qualification and strict result decoding; this does not promise all billing/cohort coverage.

Rollback: stop alice-market, remove only zzzzzzz-ads-daily-r1.conf, restore the saved config only if it still matches this run's written hash, daemon-reload/start. Never restore the saved SQLite over newer activity. Existing UNKNOWN jobs are preserved.

