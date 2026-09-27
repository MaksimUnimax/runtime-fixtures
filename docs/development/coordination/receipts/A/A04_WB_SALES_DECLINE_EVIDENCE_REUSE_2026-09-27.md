# A04 — WB sales-decline evidence / attention-rank reuse — 2026-09-27

Status: **SOURCE TRIAGE PASS / CAUSAL ATTRIBUTION FORBIDDEN**

Task: `A04_STD06_WB_SALES_DECLINE_EVIDENCE`.
Parent A head: `be1a68432c1d96590e819730455d8f713449383c`.
Observed `origin/main`: `24571c392b0c01359887019e6d23f3363d830f69`.

## Scope

STD-06 accepted WB operations remain:
- `cards_errors`;
- `statistics_orders`;
- `stock_products`;
- `promo_fullstats`.

This slice reuses already accepted A04 source semantics to support a bounded “what deserves attention when sales/orders fell?” triage. It does **not** prove why sales fell and does not assign causal weights.

No runtime/provider call, registry change, live WB, owner data, deployment, STORE package, shared readiness-map, or production behavior change was performed.
## Evidence semantics

Signals are source-bounded:
- content: official provider card errors after complete error pagination; product-level use requires a unique vendorCode -> product identity;
- orders: comparable complete operational order periods; a negative count delta is evidence, not final sales/revenue causality;
- stock: current `stockCount`; only exact zero is treated as a source-defined adverse state in this slice; no arbitrary “low stock” threshold is invented;
- ads: product-grain promotion stats; a comparable click-count decline is evidence, not proof that advertising caused the sales change.

`attention_rank` is deliberately simple:
- every complete observed adverse signal has equal weight;
- score = count of present complete signals;
- higher score means “inspect first”, not “more likely cause”, “larger impact” or “probability”;
- missing/incomplete evidence makes the product evidence incomplete, not false;
- ties are deterministic by product identifier.

The separate `causal_language_boundary` remains mandatory and returns `HYPOTHESIS_NOT_PROVEN_CAUSE`.
## Numeric manifest correction

The accepted STD-06 readiness row already referenced numeric fixture ID `attention_rank`, but the numeric-fixture registry did not contain that ID.

This block adds the missing deterministic fixture and calculator without changing the readiness row or semantic-projection SHA.

Numeric registry now has 26 cases. Required numeric kind coverage now explicitly includes `attention_rank`.

The existing `causal_language_boundary` fixture is retained unchanged as an independent guard against causal wording.
## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-sales-decline-evidence-reuse-v1.json`
SHA-256: `923c51f6909430cd4bca4cb6aee1d5b309d4a994544cdc1a2921865b5d504a64`.

Validator:
`tests/regression/extension-core/wb-sales-decline-evidence-reuse.mjs`
SHA-256: `1b9b19e9446a5ab815c0b314c25c17d4db27640ec6caf2ca21f8be9abacdc1ec`.

Numeric fixtures:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`
SHA-256: `1b1dd98e0d1ed91c7b1b2ccb8475f1fec01cab5a894e7da56fb52e5cdfd5b898`.

Coverage validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `682b803a9548e9cc87a962b7835d608d3fbec05f9a5ae4681ebab4e9e476907b`.
## Verification

Focused:
- `node tests/regression/extension-core/wb-sales-decline-evidence-reuse.mjs` — PASS;
- accepted operation mapping unchanged;
- attention rank unweighted: true;
- causal claim proven: false;
- missing signal treated as false: false;
- ambiguous content-product identity fails closed.

Global business coverage:
- PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 138 WB operation refs;
- 26 deterministic numeric cases;
- semantic projection SHA remains `4013ffaf678697ed1ed940c89fa3cd7cb0dbaf08e947597e02f071d8eff04c4a`.

Formatting:
- Prettier PASS;
- `git diff --check` PASS.

No full extension/runtime suite was rerun because this block changes source fixtures/validators only.
## Remaining gates

This is SOURCE triage evidence only. It is not LIVE_WB, LIVE_OWNER, final business diagnosis or causal analysis.

Open:
- live WB values and owner gold-set reconciliation;
- explicit comparable periods/timezone for order/ad deltas;
- unique content product identity where vendorCode is ambiguous;
- any business-approved weighting beyond equal-weight attention count;
- causal claims require separate evidence/experiment design and are not allowed from these correlations alone.
