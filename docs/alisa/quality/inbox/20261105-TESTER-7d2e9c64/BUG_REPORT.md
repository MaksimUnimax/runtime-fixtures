# C-UE01 owner report — fresh source-backed period calculation

Run 20261105-TESTER-7d2e9c64. Owner requested one table, all expenses per originally ordered unit, revenue and detailed source explanation.

## OZCP-003 / cancellation monetary capability remains uninstalled

The live API returns cancelled postings and product price objects. The corresponding ready scalar/command in the service is still not connected. This is a runtime capability gap, not absence of provider data or a reason to treat cancelled money as zero. Current owner report obtained the exact amount from complete FBO/FBS read-only pages; counts and gross value reconcile to fresh analytics. C-UE01 is manually calculated and is not declared an installed voice command.

## QA-20261105-TESTER-7d2e9c65 — period finance/advertising overlap

A fresh finance balance for the same day now contains promotion_with_cost_per_order and pay_per_click. Both were absent from the earlier balance receipt; other fee amounts match, and accrued changes by exactly the now-present advertising. Their aggregate equals the separately qualified Performance report.

The unit-economics calculation MUST count these two rows once. Adding the entire external advertising total to an all-service finance total would duplicate expenses. Conversely a prior finance snapshot lacking ads cannot prove zero advertising. Source as-of time, coverage and matching controls are required. This is an observed source evolution and formula risk; no invented internal provider cause or claim of existing installed C-UE01 failure.

## QA-20261105-TESTER-7d2e9c66 — research collector price object parser

First processing attempt assumed product.price was directly Decimal-convertible. Actual price is {amount,currency}. Fixed the research decoder, validated currency, replayed already RECEIVED responses with hashes, then sent only the two remaining calls. Four total HTTP, all200; no unknown resends, quota resets or runtime changes.

## Calculation and limits

Every value is divided by the original ordered unit count. Cancelled order value and cancelled COGS excluded; all recorded non-COGS fees kept. COGS250 supplied by owner, tax explicitly excluded. All currently returned commission/services included. Financial return amount/commission adjustments are0 in this snapshot; reverse logistics or cancellation costs are not falsely declared0 merely because no separate row exists.

This is a requested period model: current noncancelled order value minus actual period fees and model COGS. The orders are still open; no realized cohort profit claimed. No monetary owner values, order/SKU/store IDs or raw API bodies are published.

See [TEMPLATE_CANDIDATE.json](TEMPLATE_CANDIDATE.json) and [RUN_REPORT.json](RUN_REPORT.json).
