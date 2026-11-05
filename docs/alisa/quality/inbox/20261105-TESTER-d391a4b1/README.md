# API-only C-UE01 fallback — 20261105-TESTER-d391a4b1

Owner explicitly requires every business input from API, and authorizes official tariff estimates when actual accrual is absent; intervals use arithmetic midpoint. Screenshot values are not inputs.

## New evidence

Seven Seller API HTTP, all200, collection6.555s, LLM0, Dialogs0. Complete FBO/FBS pages with financial_data=true; matched product price pages; complete accrual day; fresh balance and analytics. Bound calls/rates ledger used, no quota reset or UNKNOWN retry. Raw financial data and product/posting IDs remain private.

## Findings

- Pending postings contain zero commission and payout placeholders; they do not qualify free fulfillment or zero fees. Separate source state from monetary zero.
- The prices API supplies commission percentages, acquiring amounts, direct/last-mile/first-mile and return-flow estimates. Every projected variable expense has a named field. Intervals are midpoint assumptions, not claimed observed route averages.
- Current tariff values are forecast inputs for historical unfinished orders, not historical actual accruals.
- Acquiring ratio derives from acquiring/current price and was checked on every matched price row before applying it to historical order price.
- Daily storage and advertising are actual store-period figures with explicit allocation. Historical variable courier, logistics, processing and acquiring amounts are controls only and are replaced by selected-order tariff estimates; they are not added again.
- Source financial return-flow estimate is counted once; a separate undisclosed reverse/handling charge is not invented.
- Owner cost and tax remain user inputs; API net_price cannot replace the owner's cost.
- The cancellation-commission amount kept under owner's conservative all-non-COGS policy is an explicit conditional reserve, not an API assertion of an actual payable fee. Official Ozon explains that sales remuneration is returned for returns; net-commission control is separately reported. No reserve may be silently labelled actual expense.

## Business statuses and open integration

API-backed forecast data are complete for the declared model; actual cohort profitability remains not proven. Preserve the requested order model; do not substitute realized count. Two denominators and scenario assumptions are disclosed. The unit-cost input is immutable per physical noncancelled item.

Runtime and platform unchanged. C-UE01 generic worker fallback/monetary cancellation projection are still not installed. Shared catalogs must implement the declared fallback policies and evidence labels; no per-question financial handler. Next implementation proof: source field coverage, inclusion/exclusion, currency/period, no duplicate ads/return-flow, immutable product cost and conditional commission reversal.
