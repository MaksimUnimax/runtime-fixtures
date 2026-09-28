# Controller: Russian Health incident messages

Owner manual mode and S0 message clarity. Formatter-only worker change, based on
b5122beb after736300e8; C may cherry-pick this patch independently.

The existing live-path formatter printed Health/Provider/Level codes and UUIDs.
It now explains known incidents in Russian, names the AI/site mode and known
problem contour, states the actual H0-H5 evidence boundary, and shows observed
time in +05 including date rollover. H2 is page structure, not a completed AI
answer or installed extension acceptance. H4/H5 are not automatic release proof.
Recovery means the problem did not reproduce in that check; it does not announce
that a patch was approved or delivered. Unknown/contradictory event-state pairs
remain inconclusive. Unknown labels and upstream data are never copied verbatim.
IDs remain in the existing durable delivery data, not the owner-facing message.

Route, transport, delivery receipt, timeout/retry and dedup are unchanged.
No Telegram message was sent, no service restarted and no database changed.

Verification: worker57/57 tests, including25 formatter/transport cases and18
new explanatory/privacy/uncertainty/timezone cases. Typecheck, changed-file
ESLint/Prettier and diff PASS. Supervisor1518e30ac66b4681bf98dbb60639a3b5
exited0, peak811 MiB, OOM0, cleanup verified. Logs are under
/root/octoport-control/logs/controller/manual-monitor-explanation-20260928/.
C integrates through normal source intake and deploys only the authorized pilot.
