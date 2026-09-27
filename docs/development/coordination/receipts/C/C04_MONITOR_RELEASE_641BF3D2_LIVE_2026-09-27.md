# C04 monitor release 641bf3d2 live — 2026-09-27

Status: **MONITOR-ONLY DEPLOYMENT PASS / PUBLIC LANE PASS / AUTHENTICATED H3 SEND0**

Deployed source:
- SHA: `641bf3d2f6ec6c535afb335ae1af86ea8a5a84f8`;
- tree: `0ab8a7a34db73ee7dc391e9f4ce781774f080c22`;
- exact branch and post-main workflows: Server CI, Extension CI, Extension I1-C1 client, Documentation CI, Coordination and release safety — all SUCCESS.

Immutable release:
- path: `/opt/octoport/ops-releases/641bf3d2f6ec6c535afb335ae1af86ea8a5a84f8`;
- verifier: PASS;
- 25,111 files / 1,150 symlinks;
- operator entry SHA-256: `706723ae246ea50ce918163cf12805b0bc3d1fe7b596a0330618075782854131`;
- Node runtime SHA-256: `89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7`.

Immediately before service swap, B12 preflight returned `READY` exit 0 and B13 authenticated-deep preflight returned `READY; profiles=2` exit 0 from the immutable release itself.

## Service swap and rollback

The existing one-writer pilot units were changed only from the previous immutable `d462c924...` release path to exact `641bf3d2...`. Existing service user, protected EnvironmentFiles, Xvfb route, sandboxing and restart policy were preserved.

The apply script re-verifies the immutable release and both pilot authorities, refuses to proceed if `HEALTH_DEDICATED_SESSION_CONFIG_PATH` is present, and restores the saved d462 units on any restart/readback failure.

Result: `APPLY_PASS`. Both units are active/running on exact `641bf3d2`, `NRestarts=0`, and the notification worker emitted one static `MONITOR_NOTIFICATION_READY` marker. Durable wake failures and authenticated-deep unavailable errors were both zero during stability readback.

The d462 release and pre-swap unit files remain available as the rollback boundary.

## Public lane evidence

Pre-swap readback:
- 18 historical `FAILED_TERMINAL / NO_SESSION_PERSISTENCE_REJECTED` rows;
- 27 successful scheduled public runs;
- 20 HEALTHY + 7 UNKNOWN Health runs;
- no incidents and no notification intents.

The first natural due cycle on release 641 created exactly nine new successful public runs. Post-cycle readback:
- successful scheduled runs: **27 -> 36**;
- Health: **20 HEALTHY / 7 UNKNOWN -> 27 HEALTHY / 9 UNKNOWN**;
- delta: **+7 HEALTHY, +2 UNKNOWN**;
- historical 18 terminal failures preserved;
- incidents: 0;
- notification intents: 0.

No synthetic failure was created. With zero incident/outbox rows there was no Telegram incident delivery to perform, so this cycle does not falsely claim a new delivery proof.

The nine enabled NO_SESSION schedules remain at 5,400 seconds. After the real cycle their next due is `2026-09-27T20:42:56.350Z`. The independent LLM lane then ran at `19:15:46Z` and advanced to `20:45:46Z` without creating additional scheduled runs: the count stayed 36. This proves the 60-second wake is a due-work wake, not a 60-second provider cadence, and the second scheduler entry point did not duplicate work.

## Authenticated-deep boundary

The live pilot environment has no `HEALTH_DEDICATED_SESSION_CONFIG_PATH`. Post-deploy `DEEP_SCHEDULES=[]`; no H3 browser task and no authenticated Send occurred.

C04 source composition and B15 crash reconciliation are deployed, but real authenticated ChatGPT H3 remains **NOT YET LIVE-PROVED** until a legitimate dedicated technical session is captured and enabled.

Prepared non-Git operational evidence is under:
`/root/octoport-control/logs/C/monitor-pilot-live-641bf3d2/`.

A one-time Standard capture helper is prepared there. It writes only mode-0600 state/config under `/var/lib/octoport-monitor/dedicated-health`, never prints credentials/cookies, and does not enable the runtime env key. It requires a secure graphical owner login/2FA step; no graphical remote channel was opened automatically.

No product API/worker/portal deployment, product DB migration, registration opening, payment change, store Submit, personal-session fallback, synthetic incident, or new Telegram test message was performed.
