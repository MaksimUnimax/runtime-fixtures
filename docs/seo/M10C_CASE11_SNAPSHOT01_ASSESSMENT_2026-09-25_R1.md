# Octoport SEO — M10C Case11 GenSearch snapshot-1 assessment — 2026-09-25 R1

Status: **SUCCESS_USABLE / SECOND SNAPSHOT REQUIRED UNDER QUALITY-PRIORITY RULE**

Case:
`M10BCASE_a6a64d20ed4e5695`

Exact prompt:
`ии агент для wildberries`

Raw snapshot:
`docs/seo/evidence/m10c/M10C_CASE11_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `288ca0f5235ec3646587da858fdc601f0b40e59c`.

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
`search-ab1e6475-3800-4150-81a0-866f298b8c2d`.

## Decision-relevant source-role composition

All five returned sources are `used=true`.

The answer is dominated by third-party autonomous or operational seller-agent products:
- AI007 — prices, reviews and advertising with seller confirmation;
- Зинаида Продаёт — autonomous advertising management;
- JAFO — catalog, pricing, advertising, analytics, reviews and card updates;
- TULPARI — multiple specialized scheduled agents.

One source is materially different and directly relevant to the frozen native-vs-BYO boundary:
- MarketAut — explicitly says the store can be connected to `любая нейросеть`, which is a user-selected-LLM / bridge-like model, while still promising autonomous marketplace actions.

No native Wildberries AI feature is surfaced as a used source.

Observed GenSearch query:
`ии агент для wildberries`.

## Repeat-trigger assessment

The frozen Case11 uncertainty asks whether AI-search distinguishes native marketplace functionality from a separate bridge connecting the user-selected LLM to seller data.

Snapshot-1 is complete but leaves a decision-relevant role split:
- four used sources are third-party seller-agent products with strong autonomous/write capability;
- one used source expresses BYO-LLM connectivity;
- native Wildberries AI is absent.

Under the owner quality-priority directive, a second independent snapshot is warranted to test whether MarketAut/BYO-LLM framing persists and whether any native-WB interpretation appears.

```text
SNAPSHOT01_CLASS = SUCCESS_USABLE
SNAPSHOT01_SEMANTIC_STATE = THIRD_PARTY_AUTONOMOUS_AGENT_DOMINANT_WITH_BYO_LLM_BRIDGE_SIGNAL
NATIVE_WILDBERRIES_AI_USED_SOURCE = false
EXPLICIT_BYO_LLM_BRIDGE_SIGNAL = true
SECOND_SNAPSHOT_TRIGGER = true
SECOND_SNAPSHOT_REASON = NATIVE_VS_BYO_BOUNDARY_AND_CAPABILITY_ROLE_MIX
M10D_CAUSAL_OUTCOME = NOT_DECIDED_HERE
```

## Claim boundary

This is GenSearch diagnostic evidence only. It does not prove demand, product capability, final page ownership, cluster merge/split, consumer-Alice equivalence or final IA.