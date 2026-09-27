# A04 — WB STD-05 causal-factor source reuse — 2026-09-27

Status: **SOURCE CAUSAL-FACTOR REUSE PASS / CAUSAL LIKELIHOOD NOT CLAIMED**

Task: `A04_STD05_WB_CAUSAL_FACTOR_REUSE`.
Parent A head before the slice: `b7ab04a72c2254716bb54bb1894b906efba8d34b`.
Observed `origin/main`: `2a734899810c540e9597e56c531be247f7065fb4`.

## Scope

STD-05 asks for reasons to investigate when sales decline. Its accepted WB mapping
already uses the same four source families validated for STD-06:
- `statistics_orders`;
- `stock_products`;
- `cards_errors`;
- `promo_fullstats`.

This slice reuses that evidence. It does not add a new API, runtime behavior,
causal model, hidden weighting, live provider call, owner session, deployment,
STORE package or shared readiness mutation.

## Enforced semantics

Source signals remain:
- provider content errors;
- comparable-period operational order decline;
- exact current stock zero;
- comparable-period promotion click decline.

The output boundary is stricter than the natural-language phrase “most likely”:
- only complete observed adverse signals become factors to investigate;
- each factor is labelled `HYPOTHESIS_NOT_PROVEN_CAUSE`;
- no probability, impact weight or causal likelihood is derived from correlation;
- deterministic ordering is by signal name only, not by likelihood;
- missing/incomplete evidence makes the factor set `INCOMPLETE`, never false/zero;
- optional owner business context may qualify interpretation but is not invented.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-sales-decline-causal-factor-reuse-v1.json`
SHA-256: `85813594e60be59b8a5986fcb8a7bb7709fe6fb7002c4d8666a52205bc3df984`.

Validator:
`tests/regression/extension-core/wb-sales-decline-causal-factor-reuse.mjs`
SHA-256: `0e45e510d49ffb35119e9613f5fe0757b5ff38650e67c7276370cccbdcf250e1`.

Numeric fixtures after executable `causal_factors` cases:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `3140cef6e19be5e5cf6306f3291f5f5cc71796b4efb4b9b231e1f1fdadf793c1`.

Aggregate validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `58a4c4a2c3deb8b917bf2491bcbba6213374152d9f568f8d656ca6468510d50c`.

## Verification

Node `v24.20.0`:
- `node tests/regression/extension-core/wb-sales-decline-causal-factor-reuse.mjs` — PASS;
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- aggregate: 45/45 scenarios, 101 Ozon refs, 134 WB refs, 47 numeric cases;
- complete adverse signals produce evidence factors only;
- missing signal fails closed;
- no adverse observed signal produces an empty factor list, not an invented cause;
- `git diff --check` — PASS.

No full extension/package/browser suite was rerun because this slice changes only
source evidence/tests and no product/runtime bytes.

## Remaining gates

Open:
- live WB values and owner gold-set reconciliation;
- explicit comparable periods/timezone for orders and ad deltas;
- unique content-error product identity where vendorCode is ambiguous;
- business-approved weighting if any prioritization beyond evidence listing is desired;
- causal claims require separate causal evidence/experiment design.

Evidence level: SOURCE only. No LIVE_WB, LIVE_OWNER, installed-store,
publication or production acceptance is claimed.
