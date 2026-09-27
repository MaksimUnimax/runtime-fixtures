# A04 — WB content-quality field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / RECOMMENDATION FIELD SCHEMA + LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE` after the controller-assigned FBS required-body runtime repair.
Parent A head: `7f9efcc8b2d2e7cf16a7bb4988daed827e772fd8`.
Observed `origin/main`: `84c3ba00a2c7f60f17bda414e0292f285cfd734e`.

## Scope

The accepted 45/45 operation mapping is unchanged.
This slice narrows `CAP-03` field/schema semantics for:
- official WB product-card errors;
- active card identity used only for an explicit seller-article to card join;
- the boundary between provider error facts and any expert/AI quality assessment.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness TSV mutation or runtime/product implementation change was performed.

## Current official boundary

Checked on 2026-09-27:
- https://dev.wildberries.ru/en/openapi/work-with-products
- https://dev.wildberries.ru/en/release-notes

Current official WB documentation exposes `POST /content/v2/cards/error/list` for product-card error batches. The response is batch-oriented and carries seller `vendorCodes`, provider error-message arrays and `updatedAt`; cursor continuation ends only when response `cursor.next` is false.
Release notes confirm the current POST method and the `updatedAt` addition.

The accepted registry also contains `content_recommendations -> POST /api/content/v1/recommendations/list`, but this cycle did not find a current retrievable official field schema sufficient to assign field-level meanings. The slice therefore records that part as unresolved and does not infer a score, quality metric or expert conclusion from the operation name.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-content-quality-field-schema-slice-v1.json`
SHA-256: `dde12faabc99e25a9afa5124f0861614aa96282163e9b35639fc43f1662eba39`

Validator:
`tests/regression/extension-core/wb-content-quality-field-schema-slice.mjs`
SHA-256: `1bf29a46bf740f1201bb2cf1b1d119698a948b8dbd7612f8fff4ceff6f6d5a12`

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `9b8e7a4a1a88a22ffbf809758330a3c08acebffe2f779d6466d28d8a4fe5e24c`

## Enforced semantics

- Official error count means provider error-message occurrences only after complete error-batch pagination.
- Duplicate `batchUUID` fails closed instead of double-counting.
- Error rows are attached to seller `vendorCode`; a `vendorCode -> nmID` join must be unique before an error is attributed to a specific active card.
- Missing or ambiguous card identity is `INCOMPLETE`, not guessed.
- Provider errors are factual source signals; they are not an expert content-quality score.
- `content_recommendations` cannot contribute field-derived metrics until a current official field schema is available.
- Missing data remains missing, not zero.

Synthetic checks cover complete two-page error pagination, duplicate-batch rejection, non-terminal pagination rejection and ambiguous seller-article join rejection.
## Verification

Targeted:
- `node tests/regression/extension-core/wb-content-quality-field-schema-slice.mjs` — PASS.
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS.
- 45/45 scenario rows.
- 101 Ozon operation references.
- 137 WB operation references.
- 25 deterministic numeric cases.
- accepted readiness semantic projection unchanged.
- Prettier check PASS.
- `git diff --check` PASS.

Per controller notice `STREAMS-AUDIT-20260927-0701`, fixture-only field-schema slices with unchanged runtime must use focused validation and batch/reuse identical package evidence rather than repeat the 131-gate full matrix.

The immediately preceding exact runtime head `7f9efcc8` changed the WB FBS contract and was fully checked:
- focused source/extracted WB adapter 23/23 PASS;
- full `extension_core` 131/131 PASS;
- supervisor job `78383589f22b432faa239dc067174c29`, exit 0, OOM 0, cleanup verified;
- package SHA-256 `78ac291975b2ff9836e2f238b0030ddeaf9d1cf0d3331c6846a89adafe3d7465`;
- source/extracted package bytes matched;
- live provider calls 0;
- installed acceptance false.

CAP-03 changes only fixture/validator/import/receipt bytes, so that runtime/package evidence is reused and not relabeled as CAP-03 live acceptance.

## Remaining gates

- current official field schema and semantic proof for `content_recommendations`;
- live WB values and owner gold-set reconciliation;
- owner/business definition of expert content quality beyond provider errors;
- unambiguous seller-article to `nmID` join where a business answer requires card identity;
- provider recommendation data must not be relabeled as an AI expert score without an accepted semantic contract.

This receipt is SOURCE field-schema evidence only, not LIVE_WB, LIVE_OWNER, installed-store or final business acceptance.
