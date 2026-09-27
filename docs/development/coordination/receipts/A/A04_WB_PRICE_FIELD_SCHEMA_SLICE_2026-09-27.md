# A04 — WB price field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `acddf29f8ad0a298fd5ce5f3e64984b802fe15ee`.
Observed `origin/main`: `3805f8b23655668556e1f1ef43d4ab3cef837413`.

## Scope

The accepted 45/45 business operation mapping is intentionally unchanged.
This slice narrows price field, unit and completeness semantics for:
- `CAP-10` — seller/provider price, discount and buyer-price provider fields.

No live WB request, marketplace credential, owner session, AI request, deployment, price write, or shared readiness TSV mutation was performed.

## Current official WB sources

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/work-with-products
- https://dev.wildberries.ru/en/release-notes

The current Prices and Discounts API exposes:
- `GET /api/v2/list/goods/filter` as `prices_all`;
- `POST /api/v2/list/goods/filter` as `prices_by_nm`;
- `GET /api/v2/list/goods/size/nm` as `size_prices`.

For all-product reads, WB documents `limit <= 1000`, `offset`, optional `filterNmID`, and explicit full-catalog continuation by adding the prior limit to offset until `listGoods` is empty.
The POST-by-articles route requires `nmList` with 1..1000 WB article IDs.
The size-price route requires `limit` and `nmID`, supports `offset`, and is only applicable where the product reports `editableSizePrice=true`.

Current responses keep these concepts separate:
- `price` — base provider price;
- `discountedPrice` — provider price after the ordinary product discount;
- `clubDiscountedPrice` — provider price including the WB Club discount;
- `currencyIsoCode4217` — response currency;
- `discount` — ordinary product discount;
- `clubDiscount` — WB Club discount;
- `sizeID` / `techSizeName` — size identity;
- `editableSizePrice` — whether size-specific pricing applies.

WB added `clubDiscount` and `clubDiscountedPrice` specifically for WB Club pricing. Therefore this slice does not collapse `discountedPrice` and `clubDiscountedPrice` into one universal buyer checkout price.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-price-field-schema-slice-v1.json`

SHA-256:
`03e62a355fbff3c9ef2915ed5e4250353799fd4619c17327baabdfa92004ee78`

Validator:
`tests/regression/extension-core/wb-price-field-schema-slice.mjs`

SHA-256:
`bd19eee0eaa40a4d02aca116a77510e0f3c01479044f9a84cd412d8625163918`

Coverage validator after import SHA-256:
`a63bdb3b83b92dc4101e3ee49b6d71c5215d3cf1ec20ac66651ae8d0a7464808`

The accepted `business-scenario-coverage-v1.json` mapping remains byte-unchanged.
## Enforced semantics

- Base `price`, `discountedPrice` and `clubDiscountedPrice` remain separate fields.
- WB Club pricing is context-specific and cannot silently replace the ordinary discounted price.
- Provider currency is required; missing currency is `INCOMPLETE`, never assumed RUB.
- Missing or non-numeric price fields are `INCOMPLETE`, never zero.
- Ordinary `discount` and `clubDiscount` remain separate provider percentages.
- Size-level pricing is used only when `editableSizePrice=true`.
- Full catalog completeness requires the documented offset + limit continuation until the provider returns empty `listGoods`.
- No price field in this slice is labeled a guaranteed final checkout amount outside its provider context.

## Verification

Targeted exact validator:
- `node tests/regression/extension-core/wb-price-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

A first targeted run exposed only a test-harness cross-realm assertion issue: frozen registry arrays are loaded through Node `vm`. The assertion was corrected to compare a local spread copy; provider/runtime semantics were unchanged.

Full extension regression under the A supervisor:
`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-price-extension-core-20260927-r1`

Result:
- supervisor unit `octoport-test-a-26b2f6fd08d9488aa6808cac686ca7f4.service`;
- 131/131 gates PASS;
- command exit 0, systemd result success;
- peak memory 181403648 bytes;
- OOM kills 0;
- cleanup verified true.

## Evidence boundary and remaining gates

This is SOURCE field/schema evidence. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.

Still open:
- live WB price values and owner gold-set reconciliation;
- exact customer checkout price under other promotions/context outside these provider fields;
- real full size-price pagination on an editable-size catalog;
- missing/duplicate article behavior on a real catalog;
- cross-marketplace price comparison rules and currencies.

Next independent A04 work should continue the highest-value uncovered field/unit families without changing the accepted operation map unless a concrete mapping defect is proven.
