# C04 isolated monitor pilot — public LIVE acceptance — 2026-09-27

Status: **LIVE PUBLIC-CYCLE PASS / AUTHENTICATED H3 + INCIDENT DELIVERY NOT YET PROVED**

Source/runtime boundary:
- accepted and main source: `d462c924abc8dd26b6b20224eb2649dfd3e83b17`;
- immutable ops release: `/opt/octoport/ops-releases/d462c924abc8dd26b6b20224eb2649dfd3e83b17`;
- both monitor services are active from that release as dedicated `octoport-monitor`;
- product API/worker/portal and product database were not part of this rollout.

Pilot database readback identifies both database and role as `octoport_monitor_pilot`. The B12 authority catalog is exact: 8 adapters, 9 surfaces, 0 variants, 9 profiles and 9 published revisions. Its technical bootstrap granted and revoked authority in one transaction at `2026-09-27T14:41:55.426Z`; the grant is inactive and the temporary principal/user are suspended.

Historical evidence is preserved: 18 prior scheduled runs remain `FAILED_TERMINAL / NO_SESSION_PERSISTENCE_REJECTED`. They were not rewritten.

The next natural public LLM due-cycle created nine new scheduled runs around `2026-09-27T14:45:23Z`; all nine completed successfully and persisted nine observations. Result classification is 7 `HEALTHY` and 2 `UNKNOWN`:
- ChatGPT Work: `UNKNOWN / NOT_OBSERVABLE_WITHOUT_SESSION`;
- DeepSeek: `UNKNOWN / IDENTITY_NOT_PROVEN`, blocker `UNEXPECTED_SURFACE`;
- the other seven public targets are `HEALTHY` with their observed public/auth-entry outcomes.

The LLM lane remains 5,400 seconds (90 minutes) and Swagger/API 21,600 seconds (6 hours); the operator reconciliation wake is 60 seconds. A standalone B12 read-only preflight against the live pilot returned `MONITOR_PILOT_PREFLIGHT=READY; issues=none` with exit 0. The immutable release needs `NODE_PATH` pointed at its telegram-operator node_modules for this standalone tooling invocation; no DB mutation occurred during that check.

There are zero open incidents and zero notification intents/dedup keys after the successful cycle. Therefore no real incident existed to deliver, and this receipt deliberately does **not** manufacture one. The old pilot-start Telegram message is not incident-delivery evidence.

Evidence boundary:
- LIVE public scheduler/browser/persistence cycle: PASS;
- B12 catalog/bootstrap cleanup: PASS;
- persisted classifications: PASS, including the two honest UNKNOWN outcomes;
- actual incident/outbox/Telegram delivery: NOT PROVED because the cycle generated no incident;
- authenticated ChatGPT H3/session behavior: NOT PROVED and remains blocked on the separate C04 no-replay/completedAt gates plus B13 scope/session inputs.

This receipt records the controller-independent readbacks under `/root/octoport-control/logs/C/monitor-pilot-live-d462/` and the later controller verification `FULL-AUDIT-20260927-1419`. No secret environment values, personal sessions or raw private inputs are recorded here.

Post-rollout runtime acceptance also found a packaging-side effect in the `d462c924` release: importing B12 tooling inside the bundled operator could enter its CLI guard and emit `MONITOR_PILOT_COMMAND_REQUIRED`. This does not invalidate the already persisted 9/9 public-cycle observations, but `d462c924` is not treated as the clean final monitor deployment. The minimal source fix is `f63522285a90a3e407636a2ee2f48d329ca77019`; a later immutable monitor release containing that fix must replace `d462c924` before clean deployment closure.
