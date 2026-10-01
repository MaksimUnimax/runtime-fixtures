# B05 first-wave burst staircase — 2026-10-01

Status: **PARENT PASS WITH RECORDED PROCESS DEVIATION; INDEPENDENT REVIEW/PUBLICATION PENDING**.

Task: `B05-FIRST-WAVE-BURST-STAIRCASE`.
Role: A.
Exact implementation candidate before this receipt: `84c5ad0d4afb0d2f8aee634ec7d01d32a01dd735`.
Base: `7ed7294150fb8797bd2141b93f295ac144441509`.

## Purpose

This is a bounded request-level diagnostic for the first beta-wave count boundary. It is not a representative-user concurrency model and not a production-capacity proof.

The opt-in staircase is immutable:

`[1, 2, 4, 8, 16, 32, 64, 100]`.

Each stage starts exactly that many cycles concurrently. Each cycle itself remains sequential and uses the existing eight safe local readiness/live/portal/account/sync/bootstrap probes. The staircase runs only on the final-current phase. The existing sequential first-wave profile remains separate and mutually exclusive.

No SMTP, Telegram, marketplace-provider, external AI or live service call is part of this diagnostic.

## Source boundary

Changed source:

- `tooling/coordination/c05-service-resource-envelope.mts`
  SHA-256 `bdbf9cee33c101f290557e49348002cde6857fb88a0232a68fd26e9ac32261b4`;
- `tooling/coordination/c05-service-resource-envelope.test.mts`
  SHA-256 `54232e8dcb1b854f24372034c89eddbd0cd87f639be05de9d1136a8dea8c7490`;
- `tooling/coordination/c05-three-service-rollback-rehearsal.mts`
  SHA-256 `02a9c1315553a8ef83e3b2835747cffd9c3e9e8d152ac2c0f8ccb6c990ac6ed4`.

The implementation requires resource-envelope capture and the existing explicit non-root runtime identity. Burst and sequential profiles fail closed if enabled together.

## Focused verification

Parent checks on the exact implementation source:

- Node `v24.20.0`;
- focused resource/runtime tests: **21/21 PASS**;
- Prettier: PASS;
- `git diff --check`: PASS.

The focused suite covers the immutable staircase, opt-in parsing, profile mutual exclusion, final-current-only execution, synchronized `Promise.all` stage fan-out, resource sample labels, existing resource-sampler fail-closed behavior, protected invariants, disposable DB allowlist and explicit non-root runtime identity.

## Accepted supervised run

Acceptance evidence is the **first** successful supervised run only.

Resource receipt:

`/root/octoport-control/resource-jobs/93a25db350ac4c12873995550af70d58/receipt.json`

Receipt SHA-256:

`4471fd6d2154ad58763f2f497067ac1fd9979341c2e281a23a1b73c2f8407345`.

Outcome:

- A-owned disposable PostgreSQL;
- profile `e2e`;
- 4096 MiB budget;
- command exit 0;
- OOM kills 0;
- cleanup verified;
- peak supervised cgroup memory: **1751 MiB**.

Sanitized recovery/staircase evidence:

`/root/octoport-control/logs/A/b05-first-wave-burst-staircase-20261001/run-r1/c05-three-service-rollback-evidence.json`

Evidence SHA-256:

`054d5dfeef7c15750dc39e6244fa4d14bf3c37ccf38d513d182539f8edd7843d`.

The recovery sequence completed candidate -> rollback floor -> candidate on one disposable forward database. The final-current phase recorded:

- stages: `1 / 2 / 4 / 8 / 16 / 32 / 64 / 100`;
- total cycles: **227**;
- requests per cycle: **8**;
- total safe requests: **1816**;
- maximum synchronized request-cycle concurrency: **100**;
- resource sample count: **10**;
- runtime identity: `EXPLICIT_NON_ROOT_TEST`;
- profile: `FIRST_BETA_WAVE_SYNCHRONIZED_BURST_STAIRCASE_V1`;
- concurrency claim: `NOT_REPRESENTATIVE_CONCURRENCY_MODEL`;
- capacity claim: `NOT_PRODUCTION_CAPACITY_PROOF`.

The final-current resource envelope reported maximum observed service values including:

- API RSS/high-water: about 454 MiB;
- worker RSS/high-water: about 342 MiB;
- portal RSS/high-water: about 283 MiB.

Protected migration journal, account/device/session/config/sync counts and protected state hashes were unchanged before/after the staircase. Disposable DB/private transient/temp cleanup is recorded as complete.

## Recorded duplicate-run process deviation

A later recovery pass incorrectly trusted stale saved `A.json.next` text and did not first check that the exact `run-r1` evidence already existed. This caused one **unnecessary second supervised attempt** against the same exclusive evidence directory.

Incident:

`/root/octoport-control/logs/A/b05-first-wave-burst-staircase-20261001/DUPLICATE_RUN_INCIDENT.json`

Incident SHA-256:

`ee7448260b1b715032678ac18f1742422a555ae0f1b83268571f2b00bb97b72b`.

Duplicate resource receipt:

`/root/octoport-control/resource-jobs/5dbcdb5d2d6d4163a7cc21c251b24971/receipt.json`

That duplicate attempt:

- used the same A-owned disposable PostgreSQL supervision boundary;
- completed the candidate/floor/candidate phases;
- was rejected by the existing exclusive `flag: "wx"` evidence write with `EEXIST`;
- exited 1;
- had OOM kills 0;
- cleanup was verified;
- did not overwrite the accepted first-run evidence;
- is **not** acceptance evidence and is not converted into a PASS.

This is an operational recovery error, not hidden as a product success. No third heavy run is permitted for this candidate. Independent review must explicitly decide whether the recorded process deviation blocks task acceptance.

## Evidence boundary

The evidence level is exactly **REQUEST_LEVEL_SYNCHRONIZED_BURST_DIAGNOSTIC + DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE**.

This result does **not** prove:

- 100 distinct users;
- a representative browser/user concurrency model;
- production capacity or production resource ceilings;
- live SMTP/TG/provider/AI behavior;
- final systemd MemoryHigh/MemoryMax/CPUQuota/TasksMax values;
- live deployment, LIVE_OWNER or PRODUCTION operation.

A passing 100-request-cycle stage is only a bounded synchronized diagnostic. Representative staged load and proposed finite service controls remain separate B05 work.

Independent gpt-6-luna review and the normal exact-head five-CI / ready-main / non-force publication gates remain required before DONE.
