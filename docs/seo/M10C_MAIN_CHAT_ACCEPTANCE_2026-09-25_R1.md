# Octoport SEO — M10C Main Chat acceptance — 2026-09-25 R1

Status: **ACCEPTED / AI-SEARCH EVIDENCE ACQUISITION CLOSED / M10D PREFLIGHT OPEN**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

## Frozen evidence authority

Accepted evidence manifest:
`docs/seo/M10C_ACCEPTED_EVIDENCE_MANIFEST_2026-09-25_R1.json`
blob `5a07366b653b7c0db6b49a791dfe739e900724f8`.

The manifest freezes the M10C corpus at pre-manifest evidence HEAD:
`030ce4bb356208e9dd0cda21b860d769d56ec807`.

## Acquisition accounting

```text
FINAL_M10B_CASES = 15
TERMINAL_M10C_CASES = 15/15
RAW_SEARCH_RESULT_V1 = 27
UNIQUE_PROVIDER_REQUEST_IDS = 27
DUPLICATE_REQUEST_IDS = 0
PROVIDER_FAILURES = 0
HTTP_200 = 27/27
STATUS_OK = 27/27
REQUEST_EXECUTED_TRUE = 27/27
AUTOMATIC_RETRY_FALSE = 27/27
RESULT_MODE_GENERATIVE = 27/27
ROLE_ASSISTANT = 27/27
NONEMPTY_ANSWER = 27/27
SOURCES_PRESENT = 27/27
SEARCH_QUERIES_PRESENT = 27/27
TRANSPORT_JSON_ARRAY_FRAME_1 = 27/27
ESTIMATED_TOTAL_PROVIDER_COST_RUB = 137.16
```

Case snapshot counts:
```text
01=2 02=1 03=1 04=2 05=2
06=2 07=1 08=2 09=2 10=2
11=2 12=2 13=2 14=2 15=2
```

No blind retry occurred. No case exceeded its accepted two-snapshot bound. Owner quality-priority guidance was applied: second snapshots were used when decision-relevant ambiguity remained; cases with coherent complete first snapshots could close at one.

## Terminal evidence states

```text
CASE01 = STABLE_MIXED_CAPABILITY_FRAMING
CASE02 = COHERENT_CONNECTOR_MCP_FRAMING
CASE03 = COHERENT_AUTONOMOUS_WRITE_FRAMING
CASE04 = STABLE_MIXED_CONNECTOR_CONTENT_ANALYTICS_FRAMING
CASE05 = STABLE_MIXED_LIVE_CONNECTOR_AND_FILE_REPORT_ANALYTICS
CASE06 = STABLE_CONNECTOR_REPORT_MIX_WITH_PERSISTENT_SCOPE_CONTAMINATION
CASE07 = COHERENT_AUTONOMOUS_MARKETPLACE_AGENT_FRAMING
CASE08 = STABLE_MIXED_OWNED_AND_EXTERNAL_ANALYTICS_SINGLE_SOURCE_SYNTHESIS
CASE09 = STABLE_OWN_STORE_AI_ANALYTICS_LEAN_WITH_MIXED_ACCESS_MODES
CASE10 = BYTE_STABLE_THIRD_PARTY_AI_ASSISTANT_PRODUCTS
CASE11 = STABLE_THIRD_PARTY_AUTONOMOUS_AGENT_WITH_REPEATED_BYO_LLM_SIGNAL
CASE12 = STABLE_THIRD_PARTY_REPORT_FINANCIAL_RECONCILIATION_MIX
CASE13 = STABLE_THIRD_PARTY_EDUCATIONAL_DRR_MEASUREMENT
CASE14 = STABLE_OFFICIAL_OZON_PLUS_THIRD_PARTY_ACCOUNTING_REPORT_MIX
CASE15 = STABLE_THIRD_PARTY_ACCOUNTING_REALIZATION_WITH_CORPORATE_REPORT_CONTAMINATION
```

These are M10C evidence descriptions, not M10D outcome classifications.

## Frozen claim boundary

```text
GENSEARCH_OBSERVATION != SEARCH_DEMAND
GENSEARCH_OBSERVATION != PRODUCT_TRUTH
GENSEARCH_OBSERVATION != FINAL_PAGE_OWNER
GENSEARCH_OBSERVATION != FINAL_IA
GENSEARCH_OBSERVATION != CONSUMER_ALICE_EQUIVALENCE
THIRD_PARTY_CLAIM_IN_ANSWER != OFFICIAL_MARKETPLACE_TRUTH
ONE_OR_TWO_AI_SNAPSHOTS != PERMANENT_TRUTH
```

M10C never retroactively rewrote M10A Search-only baseline.

## Fresh current method check before M10D

Checked 2026-09-25 against current official Yandex documentation:

- Search with Alice compiles answers from query-matching content and links to sources; indexed Yandex pages are the source pool:
  https://yandex.ru/support/webmaster/en/alice
- Yandex Webmaster states that Alice AI answers and source lists for the same query can differ over time:
  https://yandex.ru/support/webmaster/ru/service/alice-answers
- Yandex Search warns Alice AI answers may contain inaccuracies and directs users to source pages:
  https://yandex.ru/support/search/ru/alice
- Search API generative responses may vary by available source material and can return different/partial fields:
  https://aistudio.yandex.ru/en/docs/search-api/concepts/generative-response

Project consequence:
M10D must evaluate the causal effect of accepted AI-search evidence on the frozen Search-only baseline; it must not treat answer text as demand or automatically create AI-specific pages.

## M10C hard gates

```text
LEVEL1_READ = PASS
APPLICABLE_LEVEL2_READ = PASS
SEARCH_ONLY_BASELINE_FROZEN_BEFORE_AI = true
FINAL_AI_CASES_HAVE_INFORMATION_GAIN = true
AI_PROVIDER_EVIDENCE_PERSISTED = PASS
AI_SOURCE_PROVENANCE = COMPLETE
SEARCH_BASELINE_NOT_REWRITTEN_RETROACTIVELY = true
NO_BLIND_RETRY = true
CASE_ACCOUNTING_COMPLETE = true
OPEN_CRITICAL_DEFECTS = 0
GITHUB_PERSISTENCE_REMOTE_READBACK = PASS
```

## Quality score

```text
1 goal/output completeness = 10/10
2 method/source support = 10/10
3 input evidence/provenance integrity = 10/10
4 coverage/completeness = 10/10
5 analytical correctness/claim boundaries = 10/10
6 adversarial/variability QA = 10/10
7 persistence/readback/reproducibility = 10/10
8 owner usability/plain language = 9/10
9 information gain/cost/execution efficiency = 10/10
10 downstream readiness = 10/10

QUALITY_TOTAL = 99/100
QUALITY_SCORE = 9.9/10
```

## Acceptance

```text
M10C = ACCEPTED
M10C_PROVIDER_ACQUISITION = CLOSED
NEW_GENSEARCH_CALLS = NOT_AUTHORIZED
M10D_PREFLIGHT = OPEN
M10D_EXECUTION = NOT_YET_RELEASED
M11 = BLOCKED_UNTIL_ACCEPTED_M10D
```

M10D must classify every one of the 15 accepted cases exactly once as:
`CHANGE | ENRICH | DE_RISK | NO_CHANGE | HOLD`,
with an explicit causal chain:
`frozen M10A baseline -> accepted M10C evidence -> causal delta -> affected final-decision implication`.

No fake CREATE and no AI-specific page may be manufactured merely to justify the AI stage.
