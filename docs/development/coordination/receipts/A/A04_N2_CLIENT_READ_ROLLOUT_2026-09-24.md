# A04 / N2 client read rollout — 2026-09-24

Role: A
Status: **SOURCE + PACKAGE VERIFIED / READY FOR C INTEGRATION REVIEW / NOT LIVE**
Server-first prerequisite in main: `f11b3d5918fd69bc313c9e6609516bc11c7f25ae`
Product commit: `e94457a7467e14ee4cdb838cdcfded7cc6111017`
Test-only follow-up: `76bf057f6bfb91c014718bb21456d6899e92c459`

## Implemented boundary

The accepted N2 server-first wire is now consumed by the extension without adding another transport.

- `SellerAgentsControlClient.synchronizeMetadata()` accepts the accepted V1 mutation-only, read-only, and mixed shapes.
- `readEntityIds` are client-validated as unique canonical conversation/store keys.
- mutation + read cardinality is capped at 32 and an empty operation is rejected.
- binding mutation wire remains historical/replay-compatible; mutation `entityId` fingerprints are not rewritten.
- conversation reads use a separate read-only `POST /v1/sync` request with `entries: []`.
- returned bounded `snapshots` feed the already verified local adoption/conflict/FINISH reconciliation path.
## Rare-read / autonomy behavior

A confirmed conversation gets a best-effort snapshot read when the owner opens the popup.

The popup does not await that network request. Existing local Work state is returned immediately and remains usable when a read fails.

Reads are bounded per Octoport account + canonical conversation entity:
- one in-flight request is coalesced;
- after a read failure, the next attempt is suppressed for 60 seconds;
- after a successful read, further attempts are suppressed for 5 minutes;
- repeated popup refresh therefore does not become polling.

There is no per-command read, heartbeat, lease, WebSocket, background server poll, or mandatory control request in ordinary provider execution.

Pending local explicit binding/FINISH state remains local truth until reconciliation. A snapshot at or behind that pending base revision is ignored. Late delivery cannot overwrite accepted FINISH/newer explicit state.
## Exact verification

Evidence root:
`/root/octoport-control/logs/A/a04-n2-client-read-final-76bf057`

Deterministic package:
- SHA-256 `48070cf1ecfc42db6eff13e1b0e99243cdb50a94db46cc3ae7f703f6112ba7e5`;
- repeat archive match: PASS;
- source/extracted byte identity: PASS.

Both source and extracted runtime:
- N2 client regression: **19/19 PASS**;
- application regression: **16/16 PASS**;
- network correctness: **PASS**;
- request deadline/cleanup: **PASS**;
- C3E sync journal: **6/6 PASS**;
- C3F reconciliation: **28/28 PASS**;
- C3G corrected predispatch: **12/12 PASS**;
- C3H autonomy: **50/50 PASS**;
- native Chromium-family browser proof: **PASS**, sourceHead exactly `76bf057f6bfb91c014718bb21456d6899e92c459`;
- browser runtime SHA-256 `1a25f722587cacf54f6e01f56217c4609a9fb172a372670bac228af4604ece38`.

Resource receipts:
- build `fc48d030a8c64edca7526df927c4734f`: exit 0, cleanup verified;
- focused `890faead5aa7457ea4e31b97bae27ff4`: exit 0, cleanup verified;
- browser/C3 `91df563b79e5441c99877d1749738375`: exit 0, cleanup verified.
## Acceptance / release boundary

This verifies the A client rollout against the accepted server-first contract in source/package form. It does not claim LIVE production deployment or cross-browser store acceptance.

C must preserve deployment order: a user-facing client package that sends `readEntityIds` must not be published against a server artifact that predates the accepted N2 wire/server implementation.

Firefox AMO optional-technical-data handling remains a separate browser-publication gate. Existing Opera reviewer images remain valid and were not regenerated.
