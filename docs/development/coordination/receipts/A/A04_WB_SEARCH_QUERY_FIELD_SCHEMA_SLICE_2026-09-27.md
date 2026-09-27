# A04 — WB search-query field/grain boundary — 2026-09-27

Status: **SOURCE SEARCH FACTS PASS / ENTITLEMENT + LIVE VALUES + FULL QUERY UNIVERSE OPEN**

Task: `A04_CAP21_WB_SEARCH_QUERY_FIELDS`.
Parent A head before the slice: `b0586319071d7fbc209b409fcbd269415280dd49`.
Observed `origin/main`: `d462c924abc8dd26b6b20224eb2649dfd3e83b17`.

## Scope

This slice closes source-level field/grain/completeness evidence for:
- `CAP-21` — own-card semantic/search suggestions grounded in provider facts;
- the shared search-source boundary reused by `CAP-25` monthly local-file history.

The accepted operation mapping is unchanged:
- `search_report_product`;
- `search_report_details`;
- `cards_list`.

No extension/runtime/provider implementation, live WB call, credential, owner session,
AI request, deployment, STORE package or shared readiness TSV was changed.

## Pinned source boundary

Authority is pinned to `eslazarev/wildberries-sdk`
commit `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`,
analytics spec blob `de25972f376a6804e34c6842830c45cfed644d61`.

Pinned generated models establish:
- `search_report_product` accepts a required current period and at most 50 `nmIds`;
- provider sort target is one of `openCard/addToCart/openToCart/orders/cartToOrder`;
- the returned query limit is tariff-bounded: up to 30 for the standard tier or
  up to 100 for the advanced tier;
- returned rows carry exact provider `text`, `nmId`, seller article,
  current frequency, weekly frequency, median position, average position and
  related provider metrics;
- response currency is explicit;
- this endpoint has no cursor/offset that proves an exhaustive search-query universe;
- `search_report_details` supports product-level filtering, position clusters,
  limit up to 1000 and offset pagination;
- `cards_list` remains the catalog identity source and joins by exact `nmID`.

The server-side direct official-doc refetch is not upgraded to fresh evidence here;
this receipt remains pinned-source evidence.

## Enforced semantics

- Search query text/frequency/position are provider facts only when present in the
  provider response.
- AI-created wording ideas remain a separate class and may never be relabeled as
  provider query/frequency/position facts.
- Search fact business key is `period + nmId + query text`; duplicates fail closed.
- Missing provider metric is `INCOMPLETE`, never zero.
- Product joins use exact `nmId`; `vendorCode` is context, not a primary key.
- A top-30/top-100 response is a bounded ranked set, not proof of every search phrase.
- CAP-25 history may deduplicate `period + product + query` in owner-managed local
  files, but request/page counts do not prove semantic completeness.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-search-query-field-schema-slice-v1.json`
SHA-256: `e27f5501466b7f98ef7c15e4ebb2e703289299e32fd7d4945d77a7f0f4708c98`.

Validator:
`tests/regression/extension-core/wb-search-query-field-schema-slice.mjs`
SHA-256: `bd474460a946759fc38fe159788fa7e5f59bc4bf001d45c65611342c1d0a1c27`.

Numeric fixtures after adding executable `search_fact_boundary` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `a3024850b7f22a99b2e6e316a097cd52f22aa1a32d474604765cfe72e622a5cf`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `78f432997abcc8bd8317690676340a1d8a0a50792ef91e2ffd192ec35d37a726`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-search-query-field-schema-slice.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon operation refs, 138 WB operation refs,
  32 deterministic numeric cases;
- `search_fact_boundary` proves provider-fact/model-idea separation,
  missing-metric fail-closed behavior and duplicate business-key rejection;
- existing `search_dedup` remains the CAP-25 owner-file dedup boundary;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests and no product/runtime bytes.

## Remaining gates

Open and not relabelled:
- live search-analytics entitlement and actual tariff response boundary;
- live WB search metrics and owner gold-set reconciliation;
- complete active-card export for the selected business scope;
- no source in this slice proves an exhaustive semantic query universe beyond the
  bounded provider top set;
- prior-month CAP-25 history remains owner-managed local files.

Evidence level: SOURCE only. This is not LIVE_WB, LIVE_OWNER, installed-store,
store publication or production acceptance.

