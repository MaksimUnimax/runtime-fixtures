# C02 controller client-boundary repair intake — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Baseline: `891b89f198f89e52eef78d6da89a28641e7dcdce`.

Controller notice: `STREAMS-AUDIT-20260925-0726`.
Exact controller patch SHA-256:
`4a94b86bef2cfc429fa48ac1869ced7c7969084cd4686b8c926d1a1e502e5780`.

## Defects reproduced by controller

1. Correctly signed identified `control_plane_v2` profiles were rejected by the Opera and Firefox grant path with `BOOTSTRAP_PROFILE_INCOMPATIBLE`.
2. Repeated denied Firefox Health acquisition checks emitted duplicate successful bodyless metadata-forget POSTs.
3. The historical deployment preparation omitted release/catalog activation while the last read-only live observation had zero extension releases.

The controller assigned a bounded repair. C verified the patch hash, `git apply --check`, and an exact reverse-check after application. No DB, migration, shared wire, live service, credentials, or marketplace payload changed.

## C validation

Pinned environment: Node `24.20.0`, pnpm `10.34.5`.

Full common-core source + extracted-package gate:
- command: `python3 tooling/coordination/control.py C heavy --profile focused -- python3 tooling/checks/extension_core.py --output /root/octoport-control/logs/C/controller-client-repair-extension-core-20260925-r2`;
- result: `PASS`;
- gate processes: `131`;
- source `firefox-privacy-neutral-client`: PASS, 16 cases;
- source `client-profile-contract-and-forget`: PASS;
- extracted package `firefox-privacy-neutral-client`: PASS, 16 cases;
- extracted package `client-profile-contract-and-forget`: PASS;
- `live_provider_calls=0`, `installed_acceptance=false`;
- resource unit: `octoport-test-c-3235a531f79d4fef8b07eb303ee51c15.service`;
- exit code `0`, peak `141 MiB`, cleanup verified.

An earlier interrupted r1 run is NOT acceptance evidence. Only the complete r2 `summary.json=PASS` is used.

## Release consequence

The historical STORE bytes built from `891b89f...` are `NOT_READY` and must not be submitted or deployed. Their old package/authority hashes remain historical evidence only.

After this repair reaches a new exact C HEAD:
1. build fresh final STORE package bytes;
2. rerun B1 package/trust preflight on those exact bytes;
3. obtain five required green workflows on that exact branch HEAD;
4. publish the accepted C HEAD to `main`;
5. coordinate A's real disposable-API signed RESOLVED-profile browser proof and B's authenticated catalog activation evidence;
6. prepare a replacement deployment runbook that incorporates the controller R2 lineage, final quiesced backup, exact runtime/rollback launch evidence, and HTTP release/catalog activation requirements.

No live DB/service/catalog/store mutation is claimed by this receipt.
