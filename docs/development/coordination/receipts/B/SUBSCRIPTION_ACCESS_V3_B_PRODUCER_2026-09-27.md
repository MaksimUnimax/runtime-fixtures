# Subscription access v3 — B server producer — 2026-09-27

Status: **SOURCE VALIDATED CANDIDATE / DORMANT / NO LIVE OR COMMERCIAL ACTIVATION**

## Boundary

Accepted shared foundation: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`.
B implementation base: `7eabf6472a823e58856b67f4742d0c185102974f`.

B adds standalone `control_plane_v3` producer/API negotiation against the C-owned dormant v3 schemas. Existing v1/v2 producer bytes, active shared unions, compatibility catalogs and frozen STORE-1 0.2.4 remain unchanged. No DB/schema/migration, cron, lifecycle-worker cadence, billing or live mutation was added.

## Producer semantics

- Paid COMMERCIAL `ACTIVE` / `GRACE` / `CANCELED` derive `paidThrough` from the parity-checked durable `currentPeriodEnd`, never `accessUntil` or `graceUntil`.
- `offlineHardUntil = paidThrough + exactly 72h`.
- GRACE business access remains separate; its `graceUntil` does not move the paid boundary.
- COMMERCIAL `TRIAL`, BETA and NONE emit `subscriptionAccess: null`; no paid timestamp is fabricated.
- Subscription state and `currentPeriodEnd` must agree between the current-subscription snapshot and access resolver or v3 issuance fails closed.
- Renewal replaces the signed paid boundary with the genuine new `currentPeriodEnd`.
- V3 signs through the existing ACTIVE config signing-key lifecycle and standalone C-owned v3 signer.
## Privacy-neutral and negotiation

Privacy-neutral v3 reuses the existing v2 materializer only as the current catalog source, then projects it into the standalone v3 wire: `local_client_authority_v2`, top-level/policy/feature `control_plane_v3`. Existing release `contractVersions` are copied unchanged, so this producer work does not advertise v3 in release catalogs.

The API route uses a local request/response union to dispatch v1, v2 and standalone v3 without changing the C-owned active shared v1/v2 unions. Unknown contract versions fail request validation.

## Parent verification

Environment: Node 24.20.0, pnpm 10.34.5.

- Targeted producer/API/signing tests: **45/45 PASS**, supervisor `octoport-test-b-077bf969fd114e60aa1cba46d7fa732c.service`.
- Full `@product/bootstrap` package: **70/70 PASS**, supervisor `octoport-test-b-948552a7fd6846bab042d9c80723b9c1.service`.
- `@product/bootstrap` typecheck: PASS, supervisor `octoport-test-b-27bc339d12124d0abcc42bb68df410db.service`.
- `@product/api` typecheck: PASS with 1024 MiB build cap, supervisor `octoport-test-b-3c17ab27faa841d09f6ac95acf969ef1.service`. The first 512 MiB attempt OOMed before a compiler result.
- Targeted ESLint: PASS, supervisor `octoport-test-b-ce040ad7a1be46728d438ca21f6cc656.service`.
- Targeted Prettier: PASS, supervisor `octoport-test-b-503ba02fc5b04609a9becd5de4965198.service`.
## C-owned OpenAPI handoff

`@product/api openapi:check` intentionally reports drift on this source candidate, supervisor `octoport-test-b-c09be72b1ebb48059866f11caa2803ce.service`.

B generated the representation out-of-tree for review only. The delta is six hunks, all around `/v1/bootstrap` request/response schemas, adding the standalone v3 request/envelope alternatives; no new API route path appears. The tracked artifact is `packages/contracts/openapi/openapi.json`, which is C-owned, so B did not edit it.

C integration action: after applying this exact B candidate on fresh main, regenerate/review the OpenAPI artifact under C ownership and rerun the normal OpenAPI/CI gate.

## Scope and residual gates

Current `origin/main` advanced after the B source base only through site/design files; there is no overlap with these B v3 paths or the OpenAPI artifact.

This is SOURCE evidence only. It does not activate v3 in compatibility/release catalogs, deploy a service, mutate live data, enable payments, change STORE-1 bytes, or authorize a production operation.

B09 STORE-1 signature-preflight rework `f077c3a1` remains independently pending controller/C review and is not weakened by this v3 producer candidate.
