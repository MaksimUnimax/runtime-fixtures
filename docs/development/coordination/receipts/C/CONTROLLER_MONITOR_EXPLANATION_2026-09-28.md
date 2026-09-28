# Controller: plain monitoring explanations

Owner manual-mode task, isolated from C's active Telegram/source-acquisition files.
Base: c08a08494cb1bf5c7c63db4790dedc6c47c4969f.

The pure explainMonitoringResult helper maps exact lane/status/code triples to
bounded Russian explanations. Scheduler failure stays a check failure rather than
an invented login/site failure. API completion does not assert unchanged or
recovered operations. Unknown or contradictory combinations remain unexplained.
No upstream summary, raw code, run identifier, URL or private text is forwarded.
A successful empty scheduler cycle does not claim actual provider coverage.
Public checks never imply installed button or authenticated acceptance.

Verification: Telegram package93/93 tests (21 new explanation cases), typecheck,
changed-file ESLint/Prettier and git diff check PASS. Supervisor
5f0e763727684d9c8c610548b533440f exited0, peak861 MiB, OOM0, cleanup verified.
Logs: /root/octoport-control/logs/controller/manual-monitor-explanation-20260928/.
This is SOURCE evidence; no messages were sent and no live service changed.

C integration: import explainMonitoringResult in the owned Telegram formatter
and replace its blanket failure explanation. Preserve notification deduplication.
The existing three-field result has no per-provider coverage or persistence
breakdown; do not parse free-text summary to invent either. Structured producer
coverage and concise status/buttons remain C's next separate owned change.
