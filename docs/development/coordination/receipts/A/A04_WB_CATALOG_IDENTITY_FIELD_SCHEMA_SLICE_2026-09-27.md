# A04 — WB catalog identity field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `0a8dc30c5103c59350850f8145c1a79c78ca980f`.
Observed `origin/main`: `3805f8b23655668556e1f1ef43d4ab3cef837413`.

## Scope

The accepted 45/45 operation mapping remains unchanged.
This slice adds field/grain/completeness evidence for:
- `CAP-01` — seller catalog identity and catalog row count.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness mutation or product-card write was performed.

## Current official WB source

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/work-with-products
- https://dev.wildberries.ru/en/release-notes

Current `POST /content/v2/get/cards/list` returns created product cards and explicitly excludes cards in trash.
For exports beyond one batch, WB documents ascending cursor pagination:
- initial cursor limit 100;
- response cursor fields `updatedAt` and `nmID`;
- copy both fields into the next request cursor;
- continue until response `cursor.total < request cursor.limit`;
- for incremental export, persist the final `updatedAt + nmID` cursor and keep ascending sort.
The current response schema keeps identity levels distinct:
- `nmID` — WB product-card/article identifier;
- `vendorCode` — seller article text;
- `sizes[].chrtID` — size/characteristic identifier;
- `sizes[].skus[]` — SKU/barcode identifiers attached to a size.

Recent WB release notes also keep card-level compliance fields explicit: `needKiz` says marking is required and `kizMarked` records seller confirmation. They are not identity fields.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-catalog-identity-field-schema-slice-v1.json`

SHA-256:
`51397e237faa95c05c51d7d6bbcdd482a9e72b192261b7464c78eaece87c6290`

Validator:
`tests/regression/extension-core/wb-catalog-identity-field-schema-slice.mjs`

SHA-256:
`9caa3e9469f89c0372c9865f7e8de87aedd10f427278789bc762112e9eb95424`

Coverage validator after import SHA-256:
`f87c396a358bee6fef96fa7a2d6380bc626dce855eec2938dcff135a9b860f64`

The accepted `business-scenario-coverage-v1.json` mapping remains byte-unchanged.

## Enforced semantics

- catalog row count counts product cards / unique `nmID`, not sizes or SKU strings;
- `chrtID` is a size-level identity and cannot replace `nmID`;
- SKU/barcodes belong to a size and cannot replace product or size IDs;
- seller `vendorCode` is kept as a separate join label, not treated as the provider primary key;
- duplicate `nmID`, duplicate `chrtID` inside one card, and size rows without SKU identifiers fail closed as `INCOMPLETE`;
- full active-card export requires exact cursor continuation to the documented terminal page;
- cards-list excludes trash, so it is not labeled “all ever-created cards” without that boundary;
- missing rows/identifiers are never converted to zero.
## Verification

Targeted:
- `node tests/regression/extension-core/wb-catalog-identity-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Full extension regression under the A supervisor:
`python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-catalog-extension-core-20260927-r1`

Result:
- supervisor unit `octoport-test-a-4b63b55b5ea245eca1374b8f3af0473b.service`;
- 131/131 gates PASS;
- command exit 0, systemd result success;
- peak memory 186646528 bytes;
- OOM kills 0;
- cleanup verified true.

## Evidence boundary and remaining gates

This is SOURCE field/schema evidence. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.

Still open:
- live WB catalog values and owner gold-set reconciliation;
- trash cards via the separate trash-list method when a business scenario needs them;
- seller article uniqueness is not assumed by this schema;
- cross-marketplace catalog identity requires an explicit Ozon↔WB join policy.

Next independent A04 work remains field/unit/completeness closure for uncovered scenario families.
