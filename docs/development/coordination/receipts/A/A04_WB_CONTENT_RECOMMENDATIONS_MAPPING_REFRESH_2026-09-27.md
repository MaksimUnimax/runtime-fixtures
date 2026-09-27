# A04 — WB CAP-03 content-quality mapping refresh — 2026-09-27

Status: **SOURCE MAPPING REFRESH PASS / EXPERT QUALITY REMAINS SEPARATE**

Task: `A04_CAP03_WB_CONTENT_QUALITY_REFRESH`.
Parent A head before the slice: `a0ab85e07c0d3e3da370f59d7944917a0670d337`.
Observed `origin/main`: `2a734899810c540e9597e56c531be247f7065fb4`.

## Defect corrected

The earlier CAP-03 source slice left `content_recommendations` field semantics
unresolved. The current pinned mirror now exposes the generated request/response
models for `POST /api/content/v1/recommendations/list`.

Those models show that the method returns product-to-product recommendation data:
`nmId`, `recomCount`, `recomNms`, recommendation images and card context.
It is not a content-quality advice endpoint and does not expose an expert quality
score.

CAP-03 therefore changes its current WB mapping from:
- `cards_errors + content_recommendations + cards_list`

to:
- `cards_errors + cards_list`.

The recommendation endpoint remains a valid current read operation in the registry;
it is excluded only from the CAP-03 quality mapping.

## Pinned authority

Current mirror:
`eslazarev/wildberries-sdk@5057bdb9bf16dea24000e3ca79e1934f7761d7fe`.

Pinned source blobs:
- items spec: `54f6d7828f4188671ef68fde06922e609ef7e7a4`;
- `GetRecomReq.ts`: `aa1819d746def85df3ad482aff7ef4e99f583a43`;
- `GetRecomRes.ts`: `fc213bc30a1116637492cd0a314af22728a61542`;
- `GetRecomResDataInner.ts`: `d078ff780224a9cf443f82f927699fc31bc31c57`.

The current request supports brand/subject/search filters, an optional limit and
`next` cursor. The response preserves a product-grain `nmId`, product/card
context, `recomCount`, `recomNms` and `recomPics`.

## Enforced semantics

- Official content issues come from complete `cards_errors` pagination.
- `cards_errors` seller-article identity still requires a unique
  `vendorCode -> nmID` join through `cards_list`.
- `recomCount` means number of recommended products, not number of content issues.
- `recomNms` identifies recommended products, not quality problems.
- Product recommendation lists are not relabelled as content-quality advice or score.
- Expert quality remains a separate AI/owner interpretation layer.
- Zero official errors does not prove expert quality is good; expert quality remains unknown.

## Machine-readable evidence

Updated content-quality fixture:
`tests/regression/extension-core/fixtures/wb-content-quality-field-schema-slice-v1.json`
SHA-256: `0b98741e35c522f658c1cd87ee312bd00cb4858e22d6cc72b4794b90ea8712f4`.

Updated validator:
`tests/regression/extension-core/wb-content-quality-field-schema-slice.mjs`
SHA-256: `b479d53afcb2e00465049f6ee4712a7f23325e2e1c56185c0a37901fd1747c27`.

Coverage manifest:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`
SHA-256: `5f4000052bc51fc1e5c05276a3573e7218bda133e30f02430824d2eb83015bd6`.

Numeric fixtures after executable `content_quality_boundary` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `fb4ba3bb2361a70df864f8dff96bb4b531257b8152021a12d1dfc36ae5b947ee`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `68b96ddc56272ec532af56121c9c01920f8326b99ace0568725afd6cc244d368`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-content-quality-field-schema-slice.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon refs, 133 WB refs, 56 numeric cases;
- current recommendation field schema resolved;
- recommendation list is explicitly not a quality signal;
- CAP-03 current mapping excludes the unrelated recommendation read;
- official error count and expert-quality boundary are deterministic;
- `git diff --check` — PASS.

The older CAP-03 receipt remains historical evidence for its exact earlier commit;
this receipt supersedes its unresolved recommendation-schema conclusion.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests/business mapping and no product/runtime bytes.

## Remaining gates

Open:
- live WB card-error/catalog values and owner gold-set reconciliation;
- owner/business definition of expert content quality beyond provider errors;
- unambiguous seller-article to product-card identity when required;
- product recommendation data remains separate from content-quality diagnosis.

Evidence level: SOURCE only. No LIVE_WB, LIVE_OWNER, installed-store,
publication or production acceptance is claimed.
