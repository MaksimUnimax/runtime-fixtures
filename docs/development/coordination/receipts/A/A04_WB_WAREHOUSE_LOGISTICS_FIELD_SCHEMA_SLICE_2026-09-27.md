# A04 — WB warehouse/logistics geography field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES + PROVIDER CLUSTER ID OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head: `fcfd6e7611d8f66dbbb786619af79a78777ff778`.
Observed `origin/main`: `fe31e4ac80d0ffb3b7cc7f25772b2e1d30b4e712`.

## Scope

The accepted 45/45 operation mapping remains unchanged.
This slice narrows provider field, identity and geography semantics for:
- `CAP-06` — warehouses, offices and geography.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness mutation or runtime implementation change was performed.

## Current WB OpenAPI authority

Direct automated retrieval of the official WB documentation/raw YAML returned HTTP 498 on this server, including through real Opera. Field claims are therefore grounded in the current machine-readable `eslazarev/wildberries-sdk` mirror, whose `generation.yaml` points directly to the official `dev.wildberries.ru/api/swagger/yaml/ru/*.yaml?region=ru` upstream.

Observed current mirror blobs on 2026-09-27:
- `generation.yaml=43ac4287e0afe98f273fd00f1a89bdf6c6229565`;
- `specs/02-items.yaml=54f6d7828f4188671ef68fde06922e609ef7e7a4`;
- `specs/07-orders-fbw.yaml=7ae91e4101c9a2c0f74d2c34c6dbf743d8ef5f45`.

The mirrored upstream `02-items.yaml` defines Marketplace `GET /api/v3/offices` with WB office identity/geography fields including `id`, `name`, `address`, `city`, `latitude`, `longitude`, nullable `federalDistrict`, `selected`, and cargo/delivery fields.
It also defines `GET /api/v3/warehouses` with seller warehouse `id`, `name`, linked `officeId`, cargo/delivery fields, `isDeleting`, and `isProcessing`.
The supported geography join is therefore exact provider identity:
`sellerWarehouse.officeId -> marketplaceOffice.id`.

The mirrored upstream `07-orders-fbw.yaml` defines FBW `GET /api/v1/warehouses` rows with `ID`, `name`, `address`, `workTime`, `isActive`, and `isTransitActive`.
That warehouse schema exposes no cluster-id field, so this slice does not infer a cluster from names, city, federal district, address, coordinates, or proximity.

These mirror observations are not relabeled as a successful live fetch from the WB portal.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-warehouse-logistics-field-schema-slice-v1.json`
SHA-256: `530b74dd7a4ce7c79a2164079847699494cc2d1a48ff8d3c150dac2ce315e16e`

Validator:
`tests/regression/extension-core/wb-warehouse-logistics-field-schema-slice.mjs`
SHA-256: `5627627d2128f708c6e735c604778a7cb5004bdd39fec1023cac6576e503407f`

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `d4277fe228f0996cb253f2428d9196e45796c8879c3a83f8e70a073738168f9c`

The accepted `business-scenario-coverage-v1.json` mapping remains byte-unchanged.
## Enforced semantics

- seller warehouse ID, marketplace office ID and FBW warehouse ID stay distinct provider namespaces;
- seller geography is joined only through exact `officeId -> id`;
- a missing linked office is `INCOMPLETE`, never zero/unknown geography silently;
- office latitude/longitude are geographic fields, not warehouse identity;
- FBW `isActive` and `isTransitActive` remain distinct flags;
- no provider cluster identity is fabricated from warehouse name/address/city/district.

## Verification

Targeted:
- `node tests/regression/extension-core/wb-warehouse-logistics-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Formatting:
- Prettier applied to the two new slice files;
- `git diff --check` PASS.

Per controller notice `STREAMS-AUDIT-20260927-0701`, no additional 131-gate full extension run was launched for this fixture-only slice because runtime/product bytes did not change.

The erroneous intermediate `78e96213` 100-ID limit was corrected forward by `fcfd6e76`; the restored FBS runtime/test inputs are byte-identical to the previously validated `d8ff3bad` 1000-ID implementation.
Applicable changed-runtime evidence:
- full `extension_core` 131/131 PASS;
- resource job `78383589f22b432faa239dc067174c29`, exit 0, cleanup verified, OOM 0;
- package SHA-256 `78ac291975b2ff9836e2f238b0030ddeaf9d1cf0d3331c6846a89adafe3d7465`;
- current focused source/extracted WB adapter rerun 23/23 PASS;
- live provider calls 0;
- installed acceptance false.

This prior runtime evidence is reused only to establish unchanged runtime/package bytes; it does not turn this new field fixture into live acceptance.

## Evidence boundary and remaining gates

This slice is SOURCE field-schema evidence only. It is not LIVE_WB, LIVE_OWNER, installed-store acceptance or final business acceptance.

Still open:
- live WB warehouse values and owner gold-set reconciliation;
- a provider-defined cluster identity if a current official WB API exposes one;
- cross-scheme warehouse equivalence beyond explicit provider IDs;
- user-facing cargo/delivery enum labels if needed by a concrete business answer;
- geographic distance/service-area calculations, which are outside this field-only slice.

Next independent A04 work should continue with another uncovered field/unit/completeness family without changing the accepted operation map unless a concrete defect is proven.
