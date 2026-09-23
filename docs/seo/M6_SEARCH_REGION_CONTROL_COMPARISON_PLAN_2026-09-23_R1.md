# Octoport SEO — M6 regional Search comparison plan R1

Date: 2026-09-23
Status: **FROZEN BEFORE PROVIDER RESULT ANALYSIS**

Scope:
- M6PC006 / R04 / `аналитика маркетплейсов для селлеров`
- M6PC008 / R06 / `помощник селлера маркетплейсов`

Purpose:
compare the newly collected Moscow-213 organic Top20 against the already accepted Russia-225 M3 Top20 without changing interpretation criteria after seeing the new SERP.

## Shared comparison unit

For each query compare:
```text
BASELINE = accepted M3 region 225 Top20
CONTROL = current region 213 Top20
DEPTH = 20
SEARCH_TYPE = SEARCH_TYPE_RU
DEVICE = unspecified/current bridge default
FORMAT = XML organic
```

Do not claim device causality or full-SERP feature parity.

## Row-level evidence to retain

For each Top20 row:
- rank;
- URL;
- normalized host/domain;
- page title/snippet where provider export supplies it;
- accepted/authorized competitor identity where already governed;
- page/result role classification;
- ambiguity/HOLD marker;
- exact source provenance.

No classification from domain name alone when the page role is ambiguous.

## R04 decision dimensions

Open question:
seller analytics product/tool versus external analytics/service versus human/local-service/profession/training composition.

Classify each result into one of:
```text
SELLER_ANALYTICS_PRODUCT_OR_SOFTWARE
SELLER_ANALYTICS_SERVICE_OR_AGENCY
EDITORIAL_OR_EDUCATION
HUMAN_ROLE_OR_HIRING
MARKETPLACE_NATIVE_OR_HELP
OTHER_RELEVANT
AMBIGUOUS_HOLD
```

Primary comparison:
- count/share in Top20 by class;
- Top3 and Top10 class composition;
- recurring authorized competitors versus region 225;
- new/removed domains and exact URLs;
- whether human/local-service representation changes enough to affect the accepted intent boundary.

## R06 decision dimensions

Open question:
software/AI seller-helper versus human employee/service/help composition.

Classify each result into:
```text
SOFTWARE_OR_AI_HELPER
HUMAN_ASSISTANT_OR_VACANCY
SERVICE_OR_AGENCY_HELP
EDITORIAL_OR_EDUCATION
MARKETPLACE_NATIVE_OR_HELP
OTHER_RELEVANT
AMBIGUOUS_HOLD
```

Primary comparison:
- count/share in Top20 by class;
- Top3 and Top10 class composition;
- new/removed domains and exact URLs;
- whether Moscow materially increases human/local-service intent relative to software/AI helper intent.

## Outcome vocabulary

For each query use only:
```text
NO_MATERIAL_CHANGE
ENRICH
REOPEN_TARGETED_GAP
HOLD
```

Interpretation:
- NO_MATERIAL_CHANGE: regional control does not materially alter the accepted intent boundary.
- ENRICH: composition differs, but current search-side interpretation remains valid with added regional nuance.
- REOPEN_TARGETED_GAP: region 213 materially changes the decision-sensitive intent boundary and a named downstream assumption must reopen.
- HOLD: evidence is incomplete/ambiguous/transport-limited and cannot support a clean comparison.

No winner/ranking judgment is inferred from rank movement alone.

## Hard boundaries

```text
REGIONAL_RANK_CHANGE != CAUSAL_REGION_EFFECT
TOP20_CONTROL != ALL_RUSSIA_DEMAND
ORGANIC_XML != FULL_SERP
ONE_SNAPSHOT != TEMPORAL_STABILITY
AUTHORIZED_COMPETITOR_PRESENCE != PRODUCT_RELEVANCE BY ITSELF
```

## Stop rule

For each query one complete accepted region-213 Top20 snapshot is sufficient for this M6 regional sensitivity question.

Do not expand to more regions or replay region 225 unless:
- the accepted control is incomplete, or
- the comparison itself reveals a new named high-value ambiguity that satisfies the M6 information-gain gate.

## Persistence

The complete provider export and raw lifecycle evidence must be durable before analysis.

Final comparison artifact is produced only after:
`collect terminal -> export -> GitHub persistence -> remote readback`.
