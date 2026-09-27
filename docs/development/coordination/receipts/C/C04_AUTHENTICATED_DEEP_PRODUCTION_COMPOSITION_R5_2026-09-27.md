# C04 authenticated-deep production composition R5 — 2026-09-27

Status: **SOURCE COMPOSITION PASS / LIVE AUTHENTICATED H3 NOT ENABLED**

Accepted base: `0208145336d75d10e2286fbcd8bd0c134215c815`, already published to `main` with five post-main workflows SUCCESS and the accepted STORE1 0.2.5 B14 rebind.

C composition commits on the isolated branch:
- `a8e46c1d6c35e53b69c96c4804665980091a8268` — reconcile authenticated-deep schedules;
- `62aed61d18e56ab5e0ec14ad9076641c1bede7e9` — expose only safe configured dedicated-session target keys;
- `5d05a116547de42bd5fca3da69ac4831e615c28a` — gate deep work inside the existing shared durable scheduler;
- `16f07065950fc2cb820bc6965be0dcb8f1833ffb` — bind runtime version authority to the packaged extension and health-runner package versions;
- `c96c31e70e63cfca57abd58f2cefdd98ed11e745` — compose the real authenticated-deep executor;
- `0a2d148a52cb0159254c7c9764c2ff16ad33536a` — wire the optional production runtime into telegram-operator.

## Runtime boundary

There remains exactly one durable Health scheduler/poller.

- NO_SESSION bootstrap remains unconditional and keeps its existing cadence.
- Authenticated schedules are reconciled against the currently trusted dedicated-session registry on each wake.
- No configured/valid dedicated-session registry means zero enabled authenticated schedules. Existing stale deep schedules are disabled before due materialization.
- An already materialized deep run encountered while deep authority is unavailable is terminalized as `AUTHENTICATED_DEEP_DEPENDENCY_UNAVAILABLE`; no browser/H3 Send is attempted for that run.
- Only exact packaged `chatgpt_standard_health` and `chatgpt_work_health` keys can enable deep schedules. Alice or arbitrary keys are ignored for this C04 ChatGPT lane.
- `HEALTH_DEDICATED_SESSION_CONFIG_PATH` is optional. If absent, public monitoring continues and authenticated H3 remains disabled. If present but invalid/unavailable, the failure is reduced to the safe `HEALTH_AUTHENTICATED_DEEP_UNAVAILABLE` operational marker and deep schedules remain disabled; config/session contents are not logged.

The existing dedicated-session loader still enforces its bounded absolute config path and mode-0600/symlink/size/state protections.

## H3 execution order

For one scheduled deep run:

1. Resolve the exact packaged target.
2. Start the dedicated controlled browser only to obtain actual browser runtime metadata.
3. Resolve B13 DB Health scope for the actual browser version plus packaged extension/engine versions.
4. On deterministic B13 authority rejection, close the browser and return terminal scope-unavailable; H3/Send remains zero.
5. Only after scope authority succeeds, open the exact packaged Standard/Work target and execute one `runH3BehavioralSmoke` with the fixed packaged Health prompt.
6. Materialize safe H3 evidence with the scheduler's actual `startedAt` and a `completedAt` captured only after H3 returns.
7. Persist the completed H3 run under its exact `scheduledRunId`, then process that run through the existing Health incident authority.
8. Always close the browser.

Runtime versions are code-owned and tested against their canonical package sources:
- extension version = `apps/extension/composition.json` (currently 0.2.5);
- adapter-engine version = `apps/health-runner/package.json` (currently 0.1.0).

## Focused verification

Supervisor: `octoport-test-c-081632b3f9fa482b8a754cc41a2ec4c7.service`.

- health-runner focused tests: **65/65 PASS**;
- telegram-operator focused tests: **27/27 PASS**;
- `@product/health-runner` typecheck: PASS;
- `@product/telegram-operator` typecheck: PASS;
- both package builds: PASS;
- ESLint: PASS;
- Prettier: PASS;
- `git diff --check`: PASS;
- supervisor exit 0;
- peak memory 765 MiB;
- cleanup verified.

The focused cases prove missing config send0, safe target enumeration, stale schedule disable, exact Standard/Work enablement, B13 fail-closed before H3, one H3 call, scheduled identity persistence, controlled-browser-unavailable handling, and browser cleanup.

## Open blocker before live H3

Live authenticated H3 remains blocked by one DB-owned crash-recovery gap already sent to B:

`/root/octoport-control/logs/C/C04_B_H3_RECONCILIATION_INCIDENT_REQUEST_2026-09-27.md`

Current `reconcilePersistedResults()` can recover a persisted H3 Health run and mark the scheduler row successful without first running the existing H3 incident/outbox processor if the process crashed after persistence. B must make recovered H3 runs process the existing idempotent incident authority before scheduler success and prove crash/replay behavior on disposable PostgreSQL. No new schema/queue/scheduler is requested.

The current pilot metadata inspection also found no configured dedicated/auth session path. No personal session was used or inspected.

No protected pilot DB mutation, no dedicated-session login, no provider H3 Send, no Telegram incident delivery, no product deployment and no store action are claimed by this receipt.
