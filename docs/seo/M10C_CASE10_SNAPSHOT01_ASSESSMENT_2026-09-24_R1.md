# Octoport SEO — M10C Case10 GenSearch snapshot-1 assessment — 2026-09-24 R1

Status: **SUCCESS_USABLE / SECOND SNAPSHOT REQUIRED UNDER QUALITY-PRIORITY RULE**

Case:
`M10BCASE_975659397140bfbd`

Exact prompt:
`ии ассистент для маркетплейсов`

Raw snapshot:
`docs/seo/evidence/m10c/M10C_CASE10_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a53ad4ada73a15492daeb65af938928b20c7e26b`.

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
`search-c4086f64-7049-44f8-9bcb-e80cadea117f`.

## Decision-relevant source-role composition

Five sources were returned; four were `used=true`.

The answer is dominated by **third-party AI products**, not native Ozon/Wildberries AI and not an explicit bring-your-own-LLM bridge:
- Blaber.AI — reviews/questions/chats plus product-improvement analytics;
- SELLER MOON — sales/stock/advertising analytics;
- InfoSell — broad seller AI product suite;
- JAFO — autonomous management of catalog, prices, ads, reviews and card updates.

Komanda.ai marketplace assistant was returned but `used=false`.

Observed GenSearch query:
`ии ассистент для маркетплейсов`.

## Frozen-boundary assessment

The frozen Case10 uncertainty asks whether AI-search distinguishes:
- native marketplace AI functionality;
- a separate bridge connecting a user-selected LLM to permitted seller data.

Snapshot-1 does not resolve that contrast directly. Instead it establishes a third category: **third-party AI-assistant products with their own service/tooling model**.

The used sources also span materially different capability strengths, from bounded assistance/analytics to autonomous marketplace management.

Under the owner quality-priority directive, a second independent snapshot is warranted to test whether this third-party-service framing is stable or whether native/BYO-LLM evidence appears on another draw.

```text
SNAPSHOT01_CLASS = SUCCESS_USABLE
SNAPSHOT01_SEMANTIC_STATE = THIRD_PARTY_AI_ASSISTANT_PRODUCTS_WITH_MIXED_CAPABILITY_STRENGTH
NATIVE_MARKETPLACE_AI_USED_SOURCE = false
EXPLICIT_BYO_LLM_BRIDGE_USED_SOURCE = false
SECOND_SNAPSHOT_TRIGGER = true
SECOND_SNAPSHOT_REASON = NATIVE_VS_BYO_BOUNDARY_UNRESOLVED_AND_THIRD_PARTY_ROLE_MIX
M10D_CAUSAL_OUTCOME = NOT_DECIDED_HERE
```

## Claim boundary

This is GenSearch diagnostic evidence only. It does not prove demand, product capability, final page ownership, cluster merge/split, consumer-Alice equivalence or final IA.