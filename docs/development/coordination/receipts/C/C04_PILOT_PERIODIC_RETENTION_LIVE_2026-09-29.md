# C04 isolated monitor pilot — periodic retention LIVE — 2026-09-29

Status: **LIVE PERIODIC RETENTION PASS / MONITOR PILOT ONLY**.

This receipt is for the already-authorized isolated monitoring pilot. It is not
product deployment, H3 acceptance, store publication, or permission to apply
schema 0053/0054.

## Exact runtime

- maintenance source/release: `fe3b4aeb9bcd41a038f79d7c233a6866b314a0fc`;
- immutable release tree: `0ef76a7b1dae0b7c779ea07006ba0334aab7ed4e`;
- release verifier: PASS, 25,283 files / 917 symlinks;
- exact branch CI: 5/5 SUCCESS;
- exact post-main CI: 5/5 SUCCESS;
- pilot DB remained migration journal 41 / schema 0052;
- product owner-test API/worker/portal remained exact backend
  `62024d192a8572c11aafab91653330d1f996699f`;
- Telegram operator and notification worker remained exact monitor release
  `c2e715501161d421b1641bb697c7ee7786d84960`.

The maintenance runtime is a separate systemd oneshot plus timer. It does not
replace or duplicate the Telegram operator.

## Source/runtime safety closure

The periodic caller uses the accepted B retention repository and CLI. C's
wrapper adds:

- strict result schema and mode/kind agreement before cursor/result mutation;
- persisted keyset continuation for bounded PARTIAL inventory;
- nonblocking file lock for overlapping invocations;
- process-group hard timeout around the cooperative B CLI deadline;
- safe result/error logging without DB URL or secret environment values.

Controller P2 reproductions for non-object output and `apply -> INSPECTED`
were closed before LIVE use. Supervised regression
`9c021b1b564f4746bb09d01b45425e1a` passed with real subprocess-group timeout,
OOM=0 and cleanup verified.

## Read-only preflight

Exact `fe3b4aeb` inspect as `octoport-monitor` succeeded before mutation:

- pending projection: 72;
- pending incident processing: 0;
- already-pruned receipts: 138;
- terminal metadata candidates: 18;
- inventory: 153 rows = 138 `ALREADY_PRUNED` + 15
  `RECENT_STATE_PINNED`;
- authority/schema preflight: PASS.

An earlier stale inspect unit generated from `83035523` failed closed with
`RETENTION_RESULT_MISSING` because the pilot role pin was absent from that
older unit. It performed no DB mutation. The unit was replaced by exact
`fe3b4aeb` before any apply.

## Backup / recovery boundary

Immediately before the first apply, C created a protected custom-format backup:

- path:
  `/root/octoport-control/backups/C/monitor-retention/pilot-pre-periodic-20260929T040050Z.dump`;
- mode: 0600;
- bytes: 535,915;
- SHA-256:
  `d41d0acb5886cd361b73d40315eae79efbb7e86fa68159be63470280312b9087`;
- `pg_restore --list`: PASS.

The same archive restored successfully into a new temporary C disposable
PostgreSQL database. Readback after restore was journal=41, runs=87,
observations=87, receipts=153, scopes=9, recent=15. The temporary restore DB
was dropped after verification; the protected backup was retained.

## First bounded apply

The first manually initiated oneshot was used only to establish the bounded
runtime and clear the accumulated backlog before enabling the timer:

- kind: `APPLIED`;
- projected: 72;
- reconciled: 72;
- raw payloads pruned: 72;
- receipt retirements: 0;
- terminal retirements: 0;
- blocked: 0;
- deadline reached: false;
- projection backlog: 72 -> 0;
- pruned receipts: 138 -> 210.

Post-apply inspect returned projection=0, incident=0, prunedReceipts=210,
terminal=18.

## Automatic periodic proof

C deliberately left the timer disabled until the unchanged old
`c2e71550` writer completed the next natural NO_SESSION due cycle.

Before enabling the timer, new real writer output had accumulated without
maintenance receipts. The recorded pre-auto snapshot reached eight missing
receipts while the natural cycle was still completing.

C then enabled `octoport-monitor-retention.timer`. No manual start of the
maintenance service was issued for the proof cycle. The timer triggered at
2026-09-29T04:14:05Z and the oneshot reported:

- kind: `APPLIED`;
- projected: 9;
- reconciled: 9;
- raw payloads pruned: 9;
- receipt retirements: 0;
- terminal retirements: 0;
- blocked: 0;
- deadline reached: false;
- pending projection: 9 -> 0;
- pruned receipts: 210 -> 219.

Post-auto readback:

- missing receipts: 0;
- receipts: 234;
- recent compact states: 15;
- compact scopes: 9;
- maximum recent states per scope: 3;
- latest compact observation:
  `2026-09-29T04:13:48.078Z`;
- latest remaining NO_SESSION run:
  `2026-09-29T04:13:50.608Z`;
- open incidents: 0;
- `monitor_profile_repair_bindings`: absent;
- `api_watch_product_baselines`: absent.

The timer is enabled and active. Its next scheduled activation after the
automatic proof is 30 minutes later. The runner lock and systemd oneshot
provide non-overlap; a stopped developer chat does not control this timer.

## Isolation readback

After automatic maintenance:

- owner-test API/worker/portal: active/running, backend `62024d19...`,
  `NRestarts=0`;
- Telegram operator: active/running from `c2e71550...`, `NRestarts=0`;
- notification worker: active/running from `c2e71550...`, `NRestarts=0`;
- no second Telegram operator unit was created;
- no provider probe replay, Telegram send, product service restart, product DB
  migration, schema 0053/0054 activation, store submission or audience change
  was part of maintenance.

Operational evidence is retained under:

`/root/octoport-control/logs/C/monitor-retention-periodic-fe3b4aeb/`

No secrets or raw provider/customer payloads are recorded in this receipt.
