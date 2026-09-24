# Octoport SEO — M10C Case01 GenSearch snapshot-1 receipt and assessment — 2026-09-24 R1

Status: **VALID SUCCESS SNAPSHOT / CONDITIONAL SECOND SNAPSHOT TRIGGERED**
Case: `M10BCASE_e5e5533784063649`
Exact prompt: `ии помощник селлера`

## Provider receipt

```text
BRIDGE = yandex-marketing-bridge
VERSION = 0.1.9
SERVICE = search
OPERATION = genSearch
REQUEST_ID = search-bd634526-efca-44a3-bdf4-3bd12801a529
STATUS = OK
HTTP_STATUS = 200
ELAPSED_MS = 4423
REQUEST_EXECUTED = true
AUTOMATIC_RETRY = false
COST_ESTIMATE_RUB = 5.08
RESULT_MODE = generative
TRANSPORT_WIRE_FORMAT = json_array
TRANSPORT_FRAME_COUNT = 1
IS_ANSWER_REJECTED = false
IS_BULLET_ANSWER = false
PROBLEMATIC_ANSWER = false
```

Observed command:
```json
{"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":true}
```

## Preserved answer evidence

Answer names four seller-AI products in the generated body:
- SELLER MOON;
- Салли;
- InfoSell;
- ILAI.

Provider source list has 5 rows:
```text
USED=true  SELLER MOON  https://sellermoon.ru/tools/ai-assistant
USED=true  Салли        https://sally-seller.ru/
USED=true  InfoSell     https://infosell.tech/
USED=false SellerGPT    https://sellergpt.ru/
USED=true  ILAI         https://ilai.io/
```

Observed GenSearch query expansion:
```text
ии помощник селлера
```

One searchQueries row was returned, with provider reqId preserved in the owner receipt.

Hints were present and preserved in the owner receipt.

## Case-contract assessment

Frozen case uncertainty:
seller-owned read-only chat assistance versus a human manager, autonomous business actions and native marketplace bots.

Snapshot-1 is technically complete and semantically usable. It satisfies the case `success_condition` as a valid terminal provider answer with answer body and cited source roles.

However, the snapshot contains decision-sensitive mixed product/capability framing:

- SELLER MOON is framed primarily as API-connected analytics over reports, sales, stock, advertising, payouts, returns and products;
- Салли is framed as monitoring sales, advertising, stock and finances with dashboards/chat analytics/reports/notifications;
- InfoSell is framed beyond analysis: automates routine, creates/analyzes product cards, exports them to the seller cabinet and manages promotions;
- ILAI is framed as an integrated seller tool spanning analytics, SEO, advertising, finances and seller tools.

This means the current AI answer does **not** cleanly preserve a single read-only-helper boundary. It mixes analytical assistance with materially stronger automation/write-action capability framing.

That condition matches the accepted Case01 variability trigger:
`material source-role or framing inconsistency / decision-sensitive product-capability boundary`.

Therefore:
```text
SNAPSHOT01_CLASS = SUCCESS_USABLE
SNAPSHOT01_SEMANTIC_STATE = MIXED_CAPABILITY_FRAMING
SECOND_SNAPSHOT_TRIGGER = true
SECOND_SNAPSHOT_REASON = PRODUCT_CAPABILITY_BOUNDARY_AND_FRAMING_INCONSISTENCY
M10D_CAUSAL_OUTCOME = NOT_DECIDED_HERE
```

## Claim boundary

This evidence does not prove demand, page ownership, cluster merge/split, Octoport capability, consumer Alice equivalence, or final IA.

GenSearch remains distinct AI-search provenance. No semantic conclusion may be finalized until the bounded Case01 repeat is collected and M10D later performs causal reconciliation.