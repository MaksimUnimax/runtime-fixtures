# A03 — RESOLVED v2 real-browser / disposable-API parity — 2026-09-25

Status: **REAL_BROWSER + DISPOSABLE_API PASS / NOT LIVE / NOT DEPLOYMENT**

## Scope and authority

Controller notice: `STREAMS-AUDIT-20260925-0726`.

Source main at validation start:
`891b89f198f89e52eef78d6da89a28641e7dcdce`.

Controller repair:
- patch SHA-256 `4a94b86bef2cfc429fa48ac1869ced7c7969084cd4686b8c926d1a1e502e5780`;
- candidate worktree `/root/octoport-control/worktrees/controller-client-boundary-audit-20260925`;
- A did not edit controller-reserved `client.js`, `client-profile-contract-and-forget.mjs`, or `extension_core.py`.

C intake commit `e7d66152bdb77918b65115486c9829ef7a634e69` is not main at this receipt boundary. Its three repair blobs were byte-identical to the validated controller candidate.

## Real Opera + disposable API

Accepted evidence:
`/root/octoport-control/logs/A/A03_RESOLVED_V2_REAL_BROWSER_PARITY_20260925_R8_OPERA/result.json`.
SHA-256: `4a86921003717786fecb87db62d53577de7d94bcf690ccf1f58701179c28e25e`.

- real Opera binary; detected identity `opera 136.0.0.0`;
- real extension runtime built from the staged controller candidate;
- real loopback API/portal modules over role-A disposable PostgreSQL;
- fixture-only account/OTP/signing material; live provider calls = 0;
- identified device authorization/exchange completed;
- explicit ChatGPT bootstrap returned HTTP 200 signed `RESOLVED`;
- profile contract `control_plane_v2`;
- profile browser families include Opera and Firefox;
- `canWork = true`.

Acceptance class is real browser + disposable API. It is not LIVE_OWNER, DEPLOYMENT, provider, or production evidence.

## Real Firefox grant / deny / revoke + disposable API

Accepted evidence:
`/root/octoport-control/logs/A/A03_RESOLVED_V2_REAL_BROWSER_PARITY_20260925_R10_FIREFOX/result.json`.
SHA-256: `edb20285512afbe0cb8e4d4298ecfe89f426ae77b630170f74c522bcdc1e1c52`.

Browser: Firefox 155.0.1, temporary real add-on.

Observed with Firefox's real built-in data-collection permission:
1. initial technical permission absent;
2. real Deny kept it absent;
3. deny/privacy-neutral bootstrap returned signed HTTP 200 `RESOLVED control_plane_v2`;
4. real Allow granted `technicalAndInteraction`;
5. grant/identified bootstrap returned signed HTTP 200 `RESOLVED control_plane_v2`;
6. real Revoke removed technical permission;
7. revoke/privacy-neutral bootstrap again returned signed HTTP 200 `RESOLVED control_plane_v2`;
8. revoke-triggered metadata clear reached a persisted acknowledgement before the repeated-check baseline;
9. five subsequent denied Health acquisitions returned local null and caused **zero additional metadata-forget requests**.

Safe network evidence recorded only method/path/status and request body field names. Authorization IDs are normalized out of paths; parity fixture evidence omits fixture email values. No token, session, OTP, email value, marketplace payload, or raw signed payload is persisted in the accepted evidence.

## Independent review hardening

Read-only Luna review of A commit `01d38a0a56ae124ee8b1f6a9bfeac77015222097` found three Medium harness gaps and one Low evidence-redaction gap: permission-query errors could masquerade as revocation, Health `allNull` was informational rather than a PASS gate, opt-out bootstrap request shape was recorded but not asserted, and synthetic fixture email values were persisted in fixture evidence.

The follow-up hardening makes each item fail closed, normalizes fixture authorization IDs, redacts fixture email values in parity runs, and waits for the expected revoke-triggered metadata-clear receipt before measuring repeat Health deduplication. R8/R10 are the post-review accepted runs.

## Preservation regression

Evidence:
`/root/octoport-control/logs/A/A03_RESOLVED_V2_REPAIR_PRESERVATION_20260925_R2/`.
Exit-code manifest SHA-256: `b05c98037013d8dd12b1b0c4bd38281aaff0c7e51643ab13180ff9b8ad34f1b1`.

Against the same controller-repair runtime:
- controller P1/P2 focused unit: PASS, including v1/v2 acceptance, v3 fail-closed, metadata-clear dedup/restart/regrant/cooldown/race/device scope;
- C3C autonomous authority + restart: PASS;
- C3D autonomous Start/Resume/rebind/Finish/isolation: **18/18 PASS**;
- C3E compact sync journal + restart/retry/cache persistence: **6/6 PASS**.

This preserves Work/Finish/cache-restart/isolation at the repaired client boundary.

## Test fixture changes

A added only test/evidence infrastructure:
- configurable loopback API/portal ports in `make-browser-config.mjs`;
- opt-in v2 profile/browser-family fixture, opt-in beta bootstrap eligibility, production `LocalClientAuthorityMaterializer`, and safe network telemetry in `api-harness.ts`;
- `browser-resolved-v2-parity.py` for real Opera/Firefox parity.

All new server behavior is opt-in to the parity harness. Existing fixture defaults remain unchanged. The parity-only local authority uses the production materializer with a minimal test catalog; it is **not** proof that the owner-test/preprod release/catalog rows are activated.

## Non-accepted attempts

- R1: cgroup 1536 MiB ceiling, exit 137, classified `ENVIRONMENT_RESOURCE_LIMIT`; cleanup verified.
- R2/R3/R4/R6: harness/fixture diagnostic iterations only; not accepted as product verdicts.
- R5 Opera and R7 Firefox were superseded after independent read-only review strengthened fail-closed assertions.
- R9 Firefox exposed a harness timing error: the baseline was sampled before the expected grant→revoke metadata clear completed; no product verdict was taken from it.
- R8 Opera and R10 Firefox are the accepted strengthened real-browser parity evidence.

## Remaining gates

This receipt does **not** prove:
- controller repair publication to `main`;
- owner-test/preprod catalog/release activation;
- live migration/deployment or reachable public backend parity;
- LIVE_OWNER marketplace credentials/provider calls;
- ordinary Opera reviewer E2E/dashboard Submit;
- store or production acceptance.

Next safe boundary: C serially completes repair intake and required CI/main publication. A then merges accepted main normally and uses this parity harness on the integrated exact line only if integration changes the validated repair/runtime.
