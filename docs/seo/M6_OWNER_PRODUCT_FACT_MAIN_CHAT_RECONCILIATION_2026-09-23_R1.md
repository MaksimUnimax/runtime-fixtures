# Octoport SEO — M6 owner/product-fact reconciliation R1

Date: 2026-09-23
Status: **30/30 RECONCILED / OWNER INPUT NOT REQUIRED NOW / CAPABILITY HOLDS PRESERVED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `33e4c62a7a6b006e120836660f745ca8562c4a7c`

Parent authority:
- `docs/seo/PRODUCT_TRUTH.md`
- `docs/seo/evidence/M0_SCOPE_SOURCE_RETRO_CONSOLIDATION_2026-09-18.md`
- `docs/seo/LEVEL1/README.md`
- `docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md`
- `docs/seo/work_return/M6_PRE_ACQUISITION_RECONCILIATION_2026-09-23_R1/M6_GAP_REGISTER.tsv`

Source gap:
`M6G902 / OWNER_PRODUCT_FACT`.

## 1. Exact source accounting

The accepted M6 Work-return identifies exactly 30 source rows as
`OWNER_OR_PRODUCT_FACT_REQUIRED`.

Main Chat recovered and reviewed the exact 30 source rows from the live remote TSV; no row was inferred from the aggregate gap description.

Durable row-level overlay:
`docs/seo/work/M6_OWNER_PRODUCT_FACT_RECONCILIATION_2026-09-23_R1.tsv`

```text
SOURCE_ROWS_EXPECTED = 30
SOURCE_ROWS_REVIEWED = 30/30
SILENT_SKIP = 0
DUPLICATE_SOURCE_ID = 0
OWNER_INPUT_REQUIRED_NOW = 0
```

## 2. Why owner input is not the correct next evidence source

The aggregate Work-return called these rows `OWNER_OR_PRODUCT_FACT_REQUIRED`, but the exact rows show that their unresolved questions mostly concern:
- whether a specific marketplace endpoint/data surface exists and is accessible;
- whether Octoport has an implemented read-only workflow for that exact task;
- whether inputs are complete enough for a strong metric such as net profit;
- whether a forecasting method is productized/accepted;
- whether a manual import workflow exists.

An owner statement cannot substitute for endpoint/API/implementation/data-completeness proof.

Therefore Main Chat does **not** ask the owner to manufacture capability truth.

The current Product Truth is already sufficient to fail closed:
```text
UNPROVEN_API_OR_DATA_SURFACE -> HOLD
UNPROVEN_WORKFLOW -> HOLD
UNPROVEN_DATA_COMPLETENESS -> HOLD
UNPROVEN_FORECAST_METHOD -> HOLD
UNPROVEN_IMPORT_WORKFLOW -> HOLD
CLEAR_NON_SELLER_TASK -> OUT_OF_PRODUCT_SCOPE
```

## 3. Reconciliation totals

```text
HOLD_CAPABILITY_EVIDENCE_REQUIRED = 4
HOLD_ENDPOINT_AND_WORKFLOW_EVIDENCE_REQUIRED = 9
HOLD_DATA_COMPLETENESS_OR_INPUT_EVIDENCE_REQUIRED = 11
HOLD_WB_ENDPOINT_EVIDENCE_REQUIRED = 2
HOLD_HISTORY_AND_FORECAST_METHOD_REQUIRED = 1
HOLD_IMPORT_WORKFLOW_UNCONFIRMED = 2
OUT_OF_PRODUCT_SCOPE = 1
TOTAL = 30/30
```

### External/niche intelligence — 4

These include WB niche selection / external analytics.

Current M0 authority explicitly lists full WB niche-analysis API coverage and full external market/competitor intelligence as material unknowns.

Resolution:
`HOLD_CAPABILITY_EVIDENCE_REQUIRED`.

No Wordstat/Search demand call is authorized until product capability is separately proven.

### Fines / deductions / returns / disputes — 9

The rows ask for penalty reasons, logistics/acceptance charges, evidence and/or appeals.

Product Truth does not prove the complete exact data surface plus dispute/appeal workflow.

Resolution:
`HOLD_ENDPOINT_AND_WORKFLOW_EVIDENCE_REQUIRED`.

This is not owner-input debt and not demand debt.

### Net profit / costs / margin — 11

These rows require complete cost/revenue attribution, and in some cases explicitly include non-marketplace expenses or per-SKU/article net profit.

Current Product Truth allows analysis of available seller-owned data but does not establish a complete accounting input model.

Resolution:
`HOLD_DATA_COMPLETENESS_OR_INPUT_EVIDENCE_REQUIRED`.

No claim of complete net profit is admitted.

### WB buyer portrait — 2

Exact accessibility of the WB `Портрет покупателя` report/API surface is not accepted product authority.

Resolution:
`HOLD_WB_ENDPOINT_EVIDENCE_REQUIRED`.

### Forecast / seasonality — 1

A demand forecast requires both sufficient history and an accepted forecast method.

Resolution:
`HOLD_HISTORY_AND_FORECAST_METHOD_REQUIRED`.

### Manual financial import — 2

Current Product Truth describes marketplace API read/data retrieval, not a manual financial-import workflow.

Resolution:
`HOLD_IMPORT_WORKFLOW_UNCONFIRMED`.

### Ozon corporate financial news — 1

`Ozon отчитался за 2025 год: чистая прибыль, рост оборота до 4,16 трлн и 65 млн покупателей`

This is corporate Ozon news/metrics, not a seller-owned operational task supplied through the user's marketplace account.

Resolution:
`OUT_OF_PRODUCT_SCOPE`.

## 4. Claim boundary

This reconciliation does **not** claim that the held tasks can never be supported.

It claims only:

```text
CURRENT_ACCEPTED_PRODUCT_AUTHORITY
DOES_NOT YET PROVE
THE EXACT REQUIRED CAPABILITY / DATA / WORKFLOW / METHOD.
```

Reopen only when a current accepted endpoint/API/implementation/product authority changes that boundary.

Competitor pages, Search visibility or owner intuition cannot substitute for that evidence.

## 5. Effect on M6

```text
M6G902_OWNER_PRODUCT_FACT = TERMINALLY_RECONCILED_FOR_CURRENT_PASS
OWNER_INPUT_REQUIRED_NOW = 0
NEW_PROVIDER_CALLS = 0
NEW_SEMANTIC_ROWS = 0
UNSUPPORTED_PRODUCT_CLAIMS_ADMITTED = 0
```

The 29 HOLD rows remain recoverable as explicit product-capability holds and may be carried into later open-HOLD accounting. They do not become demand observations.

## 6. Next work

Remaining M6 closure work is now:
1. reconcile accepted `HOLD_AMBIGUOUS` rows as terminal source-identity holds;
2. reconcile 9 Bridge capability holds (HTML/userAgent) into blocking/non-blocking M6/M7 state;
3. preserve M6PC004 provider-invalid-query HOLD;
4. close separate M1 pre-M7 dependency;
5. run final M6 hard-gate/quality closure before M7.

No provider call is released by this artifact.
