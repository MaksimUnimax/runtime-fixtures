# A04 — WB external-context boundaries — 2026-09-27

Status: **SOURCE EXTERNAL-CONTEXT BOUNDARY PASS / LIVE PUBLIC CONTEXT REMAINS EXTERNAL**

Task: `A04_WB_EXTERNAL_CONTEXT_BOUNDARIES`.
Parent A head before the slice: `562ffeb160d9f931847d2b92ad46cdbad7dd2e8d`.
Observed `origin/main`: `2a734899810c540e9597e56c531be247f7065fb4`.

## Scope

This source-only slice binds the three remaining explicit external-context scenarios:
- `STD-10` — a public incident plus private current stock/warehouse facts;
- `CAP-20` — own private marketplace facts plus public cited research;
- `CAP-22` — own card plus public comparable competitor pages or owner links.

Accepted WB operation mappings are unchanged.

No live web incident research, competitor discovery, marketplace call, credential,
owner session, AI request, runtime change, deployment, STORE package or shared
readiness mutation was performed.

## Enforced boundaries

STD-10:
- public incident fact requires an external source URL and event date;
- private WB stock/warehouse data is current account data;
- current stock does not prove the product was present at the historical incident time;
- historical presence therefore remains unknown unless separate historical evidence exists.

CAP-20:
- private marketplace fact, public cited fact and model hypothesis are three distinct classes;
- a public fact requires a source URL;
- a model inference is never relabelled as a public or private fact.

CAP-22:
- competitor evidence must come from a public page or owner-provided link;
- comparable context remains explicit;
- competitor sales, conversion, stock or other private analytics are not invented;
- own-card private data remains separate from competitor public evidence.

Missing external context is unknown/incomplete, never numeric zero.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-external-context-boundary-v1.json`
SHA-256: `6d6f201a02690353d70715c80da3a97e665d2afb8a2edeecee87ed718bd247e3`.

Validator:
`tests/regression/extension-core/wb-external-context-boundary.mjs`
SHA-256: `fde4c3f80240db56c94ce2c31894be37e195c4b7b823c9c02df98d11473ecd0f`.

Numeric fixtures after executable `incident_boundary`,
`external_fact_boundary` and `competitor_boundary` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `11339bbb00656d684edc3cf45e8924a685e29c8efe0fa329bfa3710eb91a348c`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `0c70b2a3a159492a1dfd27aaac49b184b21b128df83be7d1bd6e04a003ba05fd`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-external-context-boundary.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon refs, 134 WB refs, 53 numeric cases;
- historical incident stock is not inferred from current stock;
- public facts require citation;
- competitor private metrics are rejected;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests and no product/runtime bytes.

## Remaining gates

Open by design:
- actual public incident/date/source for STD-10 from AI web research or owner context;
- live WB stock/warehouse values and owner gold-set reconciliation;
- actual public-world research for CAP-20;
- actual comparable competitor public pages or owner links for CAP-22;
- buyer/competitor private metrics remain unavailable and may not be inferred.

Evidence level: SOURCE only. No LIVE_WB, LIVE_OWNER, installed-store,
publication or production acceptance is claimed.
