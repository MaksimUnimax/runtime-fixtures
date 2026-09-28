# A04 — STD-11 WB inventory movement boundary — 2026-09-28

Status: **SOURCE BOUNDARY PASS / REPLACEMENT REGISTRY + LIVE CAUSALITY OPEN**

Task: `A04_STD11_WB_INVENTORY_MOVEMENT_BOUNDARY`.
Parent A head before the slice: `0b07ad843760c04b5f7a3ff771b20b96a620f40e`.
Observed `origin/main`: `5f7940dee5a2caa1f8dea6fc5df07c720f437d4c`.

## Defect closed

The accepted STD-11 operation map already included `goods_return`, and the
existing A04 order-lifecycle evidence already proved that
`GET /api/v1/analytics/goods-return` is a provider return/item-movement report.
However, the aggregate business manifest still described the movement source as
unverified and referenced `movement_evidence` without an executable numeric
case/calculator.

That mismatch could leave two opposite interpretations in the same evidence set:
the operation was mapped as movement evidence, while the scenario text still said
there was no verified movement source.

This slice makes the boundary explicit without inventing a broader inventory
ledger.

## Current provider boundary checked 2026-09-28

Current WB API Reports documentation identifies
`GET /api/v1/analytics/goods-return` as the deprecated **Returns and Item
Movement Report** and says it will be disabled on **2026-10-26**.

The current documented replacement is:
`GET /api/analytics/v1/item-returns`.

The replacement uses explicit `dateFrom`, `dateTo`, `status`,
`limit`, and `offset` query parameters, with `status=active|archive`
and pagination. The current accepted Octoport WB registry does **not** contain
that replacement path.

Provider source:
`https://dev.wildberries.cn/docs/openapi/reports`.

This is a shared-WB-authority gap. A does not edit
`migration/reference/**`; C owns the shared registry/generator decision.

## Enforced STD-11 semantics

- A `goods_return` row is provider evidence of a **return/item-movement
  event** only.
- A falling stock snapshot without a matching provider movement event remains
  `UNKNOWN_CAUSE`; it is not silently relabelled as a transfer or write-off.
- Even when a provider return/movement event exists, that event does **not**
  prove a generic inventory write-off or transfer cause.
- Sales, buyer-return claims, finance rows, and stock snapshots remain distinct
  evidence families.
- Missing evidence remains missing, never zero.
- The deprecated `goods_return` alias is not treated as long-term authority
  after its documented shutdown boundary; the replacement must enter the
  accepted shared registry before it can be relied on as the durable path.

The accepted STD-11 WB operation list itself is unchanged.

## Machine-readable evidence

New fixture:
`tests/regression/extension-core/fixtures/wb-inventory-movement-boundary-v1.json`

SHA-256:
`59e0fc24de6710629b75ac5d0dd799e033cd43251816d563d0f452e7a677f9c1`

New validator:
`tests/regression/extension-core/wb-inventory-movement-boundary.mjs`

SHA-256:
`01ef818bd35529ebf01ac2fc9efea43a53da32d68e26b4da5e826a43a1254ca2`

Updated coverage manifest:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`

SHA-256:
`99263233edf3ecb3e23db4ff5cc664ac6fd497cc8ced98c138ae90d42797d822`

Updated deterministic numeric fixtures:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`

SHA-256:
`bd50d832dee86c20012648a3afcefd50948e9bb2798cd1975786efb30ee62dae`

Updated aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`

SHA-256:
`aeea4100afb14055938cdf8fbbbd56cc5d23b9aa2872ee7f4fdb6d797942716d`

## Verification

Exact Node: `v24.20.0`.

- `node tests/regression/extension-core/wb-inventory-movement-boundary.mjs`
  — PASS.
- `node tests/regression/extension-core/business-scenario-coverage.mjs`
  — PASS.
- Aggregate remains 45/45 business rows, 101 Ozon operation refs,
  133 WB operation refs; deterministic numeric cases are now 58.
- `movement_evidence_provider_event` proves the provider-event boundary while
  keeping write-off/transfer causality unproven.
- `movement_evidence_missing_event` proves a stock decline with no provider
  event stays `UNKNOWN_CAUSE`.
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes
source evidence/tests only and no runtime/package bytes.

## Remaining gates

Open and deliberately not relabelled:

1. C/shared-authority intake for
   `GET /api/analytics/v1/item-returns` before the deprecated path is removed.
2. Live WB values and owner gold-set reconciliation.
3. Generic write-off/transfer causality unless a provider event family explicitly
   proves it.
4. Historical cross-period completeness beyond the provider report boundaries.

Evidence level: **SOURCE only**. No LIVE_WB, LIVE_OWNER, installed-store,
publication, deployment, or production acceptance is claimed.
