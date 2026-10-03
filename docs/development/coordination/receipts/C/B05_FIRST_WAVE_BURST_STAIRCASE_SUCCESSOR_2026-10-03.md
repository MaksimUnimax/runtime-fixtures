# B05 first-wave burst staircase — accepted-source successor

Date: 2026-10-03.

This receipt belongs to `B05-FIRST-WAVE-BURST-STAIRCASE-SUCCESSOR-R2-20261003`.
It does **not** change the verdict of historical task `B05-FIRST-WAVE-BURST-STAIRCASE`,
which remains `REWORK_REQUIRED` because an unnecessary second supervised run violated
that task's literal "exactly one heavy run" process criterion.

## Source

The three implementation files are byte-identical to reviewed source commit
`84c5ad0d4afb0d2f8aee634ec7d01d32a01dd735`. Current-main preimage blobs were
verified identical to historical base `7ed7294150fb8797bd2141b93f295ac144441509`
before reconstruction. The successor therefore does not invent a new burst model.

The opt-in stages remain exactly `[1, 2, 4, 8, 16, 32, 64, 100]`.

Burst and sequential first-wave profiles are mutually exclusive. Burst runs only on
the final-current phase and uses the same eight local readiness/live/portal/account/
sync/bootstrap probes per cycle. No SMTP, Telegram, marketplace provider, external AI
or live service call belongs to this diagnostic.

## Technical evidence

No new heavy workload is run for this successor.

The only accepted runtime evidence is the first successful supervised job
`93a25db350ac4c12873995550af70d58`: exit 0, OOM kills 0, cleanup verified,
peak cgroup memory 1836056576 bytes. Its evidence SHA-256 is
`054d5dfeef7c15750dc39e6244fa4d14bf3c37ccf38d513d182539f8edd7843d`.

That run recorded candidate -> rollback floor -> candidate on disposable PostgreSQL.
The final-current burst profile recorded 227 cycles, 8 safe requests per cycle,
1816 total safe requests, stages through 100 synchronized cycles, and unchanged
protected journal/account/device/session/config/sync authority state.

## Preserved process incident

The later job `5dbcdb5d2d6d4163a7cc21c251b24971` is **not** acceptance evidence.
It was an unnecessary duplicate caused by stale saved-next handling, exited 1 on
the exclusive evidence write with `EEXIST`, had OOM kills 0, and cleanup verified.

The original REWORK receipt, duplicate-run incident, both resource receipts and the
first-run evidence remain immutable. No third heavy run is permitted or required by
this successor.

## Evidence boundary

Evidence level:
`REQUEST_LEVEL_SYNCHRONIZED_BURST_DIAGNOSTIC + DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE`.

This does not prove 100 distinct users, a representative concurrency model,
production capacity, production resource ceilings, live provider/AI/SMTP/Telegram
behavior, final systemd resource limits, deployment, `LIVE_OWNER` or `PRODUCTION`.

Independent source/evidence review and normal exact-head publication gates are still
required before this successor can be marked `DONE`.
