# Octoport SEO — M10C Case12 GenSearch snapshot-1 assessment — 2026-09-25 R1

Status: **SUCCESS_USABLE / SECOND SNAPSHOT REQUIRED UNDER QUALITY-PRIORITY RULE**

Case:
`M10BCASE_905d903673405cdf`

Exact prompt:
`отчет маркетплейса вайлдберриз`

Raw snapshot:
`docs/seo/evidence/m10c/M10C_CASE12_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `707a4f63595a005469b3066005e578bc0f38a13e`.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

## Transport / execution

```text
HTTP_STATUS = 200
STATUS = OK
REQUEST_EXECUTED = true
AUTOMATIC_RETRY = false
RESULT_MODE = generative
TRANSPORT_WIRE_FORMAT = json_array
TRANSPORT_FRAME_COUNT = 1
IS_ANSWER_REJECTED = false
PROBLEMATIC_ANSWER = false
ESTIMATED_PROVIDER_COST_RUB = 5.08
```

Request ID:
`search-30069faa-4827-4306-8d39-7b9ad7aacdd5`.

## Source-role composition

Ten sources were returned; five are `used=true`:
- Банк Точка;
- InSales;
- A3 Agency;
- Selsup;
- PlanFact.

No official Wildberries seller/help source is present in the used-source set.

The answer mixes several materially different roles:

1. **Seller report reading / operational analytics**
   - report types, sales, stock, orders, returns and unit economics.

2. **Financial / payout / reconciliation framing**
   - realization report, amount payable, logistics/storage/acceptance costs, penalties and other deductions.

3. **Profitability / accounting-adjacent calculation framing**
   - margin, ROI, taxes, real profit and related calculations.

4. **Freshness/change claims for 2026**
   - report-feature changes, tax/VAT treatment, subscription/report availability and report schedule.

Those 2026 factual claims are preserved as provider output only. M10C does not independently accept them as official Wildberries facts because the used evidence is third-party.

Observed GenSearch queries:
- `отчет маркетплейса вайлдберриз`;
- `отчет маркетплейса wildberries за 2026 год`.

The second query introduces a freshness/year-specific bias that may further favor third-party roundup/explainer content.

## Repeat-trigger assessment

The frozen Case12 uncertainty asks whether AI identifies official seller report/help sources and bounded report explanation instead of vendor reports, statutory/accounting framing, or unsupported completeness claims.

Snapshot-1 leaves material decision-relevant uncertainty because:
- official Wildberries help/seller documentation is absent from used evidence;
- all used sources are third-party;
- report reading and financial/reconciliation/accounting-adjacent claims are mixed;
- the answer makes current-year operational/tax/report claims without an official used source.

Under the owner quality-priority directive, a second independent snapshot is required to test whether official-source evidence appears and whether the report/accounting mix persists.

```text
SNAPSHOT01_CLASS = SUCCESS_USABLE
SNAPSHOT01_SEMANTIC_STATE = THIRD_PARTY_REPORT_AND_FINANCIAL_RECONCILIATION_MIX
OFFICIAL_WB_USED_SOURCE = false
THIRD_PARTY_USED_SOURCE_COUNT = 5
CURRENT_YEAR_CLAIMS_PRESENT = true
SECOND_SNAPSHOT_TRIGGER = true
SECOND_SNAPSHOT_REASON = OFFICIAL_SOURCE_ABSENCE_AND_REPORT_ACCOUNTING_ROLE_MIX
M10D_CAUSAL_OUTCOME = NOT_DECIDED_HERE
```

## Claim boundary

This is GenSearch diagnostic evidence only. It does not establish official Wildberries truth, statutory/accounting correctness, demand, product capability, final page ownership, cluster merge/split or final IA.