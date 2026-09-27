# A04 — STD-13 WB supply acceptance + current stock reuse — 2026-09-27

Status: **SOURCE REUSE PASS / LIVE VALUES + PERIOD/GRAIN RECONCILIATION OPEN**

Task: `A04_STD13_WB_SUPPLY_ACCEPTANCE_STOCK_REUSE`.
Parent A head: `7151bbe230ce9cb5fc6bb7d0af84cb32fa3446a5`.
Observed `origin/main`: `61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`.

## Scope

Readiness row `STD-13` needs supply status, accepted units and current stock.
Its accepted WB mapping already uses:
- `fbw_supply`;
- `fbw_supply_goods`;
- the complete acceptance-report create/status/download lifecycle;
- `stock_products`.

This slice reuses validated CAP-08 acceptance evidence and CAP-05 `stock_products` field semantics. It does not change runtime, provider operations or the accepted mapping.
## Enforced boundary

The tested projection keeps four concepts separate:
- FBW provider `statusID`;
- direct per-supply/per-product `acceptedQuantity`;
- acceptance-report `count` after report task reaches `done`;
- `stock_products.metrics.stockCount` as current-day stock.

A difference between accepted units and current stock is not interpreted as loss, write-off, shortage or any other cause.

Fail-closed cases:
- unknown supply status;
- incomplete goods pagination;
- invalid/mismatched direct accepted total;
- report not `done`, canceled or purged;
- invalid report rows;
- missing or duplicate current-stock product rows;
- product-set mismatch.

Missing data remains missing, never zero.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-standard-supply-acceptance-stock-reuse-v1.json`
SHA-256: `648891a683f1382ca5611b1f9eca4560ac6c27e4892f2254decb10205e0f0128`.

Validator:
`tests/regression/extension-core/wb-standard-supply-acceptance-stock-reuse.mjs`
SHA-256: `c55ee4827adf58a06e125a18eb91a553cb4d6a3bb904302c701630226dca2703`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `14a021584dd8b70b2101ec3e2611c1fb9ddc4ad3fb86a1d1bb16f228c72d25bc`.

Reused source schemas:
- `wb_supply_acceptance_field_schema_slice_v1`;
- `wb_turnover_field_schema_slice_v1`.
## Verification

Focused:
- `node tests/regression/extension-core/wb-standard-supply-acceptance-stock-reuse.mjs` — PASS;
- complete synthetic supply/report/current-stock projection PASS;
- report-not-done -> `INCOMPLETE`;
- incomplete goods pagination -> `INCOMPLETE`;
- missing current stock -> `INCOMPLETE`;
- unknown provider supply status -> `INCOMPLETE`;
- accepted units and current stock explicitly differ without a causality claim.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Prettier PASS and `git diff --check` PASS.
No additional 131-gate run: only fixture/validator/import evidence changed; runtime/package bytes are unchanged, consistent with controller batching guidance.
## Evidence boundary and remaining gates

This is SOURCE schema-reuse evidence only, not LIVE_WB, LIVE_OWNER, installed-store acceptance or final business acceptance.

Still open:
- live WB supply/report/stock values and owner gold-set reconciliation;
- real account goods pagination completeness;
- acceptance-report latency and requested-period alignment;
- reconciliation when direct `acceptedQuantity` and report `count` differ by period/grain;
- business interpretation of accepted-versus-current-stock differences.

Continue the next uncovered A04 field/unit/completeness family without inventing provider semantics.
