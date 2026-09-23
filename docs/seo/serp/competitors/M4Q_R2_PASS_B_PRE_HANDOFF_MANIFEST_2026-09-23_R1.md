# Octoport SEO — M4Q R2 Pass B pre-handoff manifest R1

Date: 2026-09-23
Status: FROZEN FOR CHATGPT WORK HANDOFF
WORK_ID: OCTOPORT_SEO_M4Q_R2_VISIBILITY_RECONCILIATION_2026-09-23_R1
ROADMAP_STAGE: M4Q R2 PASS B

Repository: MaksimUnimax/runtime-fixtures
Branch: seo/wordstat-batch-01-2026-09-16
PRE_HANDOFF_BASE_HEAD: 361b378dc31acd09224cd04e44d8c046e5dc5eb0

## Why Work is required

The accepted provider corpus contains:

~~~text
45 exact queries
100 normalized Search results per query
4500 normalized SERP result rows
60 authorized competitors
cross-source joins to M3 + M4C + M6
~~~

This is a full-volume many-to-many reconciliation. Sampling, FIRST_N or ordinary-chat matrix construction is forbidden by WORK_HANDOFF_RULE.md.

## Attached provider evidence — mandatory

Work must receive both owner-relayed JSON attachments:

1. search-octoport-m4q-r2-b001-20260923-r225-0-24.json
   - bytes: 9207000
   - SHA256: 4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7
   - indices: 0..24
   - normalized rows: 2500

2. search-octoport-m4q-r2-b001-20260923-r225-25-44.json
   - bytes: 7586040
   - SHA256: d185d8a11cfbe70beb10418da7341000481d3faa7856a8ed62a1237cfe73e254
   - indices: 25..44
   - normalized rows: 2000

Combined accepted evidence:

~~~text
SCHEMA = YMB_SEARCH_ASYNC_EXPORT_PAGE_V1
JOB_ID = octoport-m4q-r2-b001-20260923
REVISION = 225
INDICES = 0..44 exactly
ITEMS = 45
NORMALIZED_ROWS = 4500
ALL_ITEMS_SUCCEEDED = true
FINAL_HAS_MORE = false
~~~

If either attachment is missing or its SHA256 differs:
VERDICT = HOLD_INPUT_EVIDENCE_IDENTITY and stop.

## Mandatory current rules

Read in full from the live branch:

- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/WORK_HANDOFF_RULE.md — blob 71a031e74b921dade5998beb842fb3afcc4478e7
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md — blob 9917a52b837bcb8ae50eb63cc53e7becd1671b39
- docs/seo/PRODUCT_TRUTH.md
- docs/seo/METHODOLOGY.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md — blob 3ef9e456dd724500f1b4068236a80211d1fb69be
- docs/seo/LEVEL2/M6_GAP_CLOSURE_AND_PROVIDER_RULES.md — blob 598a248c459b705ac9b7a0e53a86870733d6f379

## Mandatory M4Q R2 authority

- docs/seo/serp/competitors/M4Q_R2_KNOWN_QUERY_VISIBILITY_REOPEN_GATE_2026-09-23_R1.md — blob e4807b9e74eda9fa9467b2a77364eb2af7288e71
- docs/seo/serp/competitors/M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md — blob aae61da9b272d16e9d2098c088638f7cebc0e930
- docs/seo/serp/competitors/M4Q_R2_COMPLETE_EXPORT_ACCEPTANCE_2026-09-23_R1.md — blob d7464ebc2b8634af4829281d8c695ef17e20df48
- docs/seo/serp/competitors/raw/M4Q_R2_13_EXPORT_PAGE1_MANIFEST_2026-09-23.md — blob f552681d41ff05c9adbd08480bb84ca6f02de561
- docs/seo/serp/competitors/raw/M4Q_R2_14_EXPORT_PAGE2_MANIFEST_2026-09-23.md — blob d5cb96357e39515e83a0d161dd26f9799857c465

Read all six accepted Pass A2 return files under:

docs/seo/serp/competitors/work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/

Critical identities:
- M4Q_R2_SEARCH_EXECUTION_MANIFEST_R2.tsv — blob d82fef9ec9bc3d757dc85b771f6c114b92c0cd1a
- M4Q_R2_BATCH_PLAN_R2.tsv — blob 9bafe36cea686e3f791ae56bde505b3282080284

## Historical M3 / demand authority

- docs/seo/serp/M3_QUERY_MATRIX_2026-09-17.md — blob 0d43a40a8d5c865f2078a4f6f2a01815cd9b415f
- docs/seo/work/M2R_PHRASE_LINEAGE_LEDGER_2026-09-17.csv — blob 9343048ed82f129b3f7433c46899e6f255a420a8

M3 is historical top-20/current-control context only. M2R is demand/query-authority context only. Neither may be silently replaced by current Search visibility.

## Mandatory accepted M4C authority

- docs/seo/serp/competitors/M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md — blob 8b8f075052f03511e6d0b831a3688e65da488f7d
- docs/seo/serp/competitors/work_return/M4C_SYNTHESIS_2026-09-22_R1/M4C_HARDENED_COMPETITOR_REGISTRY.tsv — blob 43ce2150686b1b1df33ddb947b8a6920ebb2f112
- M4C_COVERAGE_LEDGER.tsv — blob e308aac9ade959c3a4faebb7c391ea3d25c7c7f4
- M4C_URL_LEDGER.tsv — blob 72b5f18cef0d018d9af970e64b6590ec4eab2e51
- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv — blob 93debb9c20c2f6df6d146e018e9b5afa96350124
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv — blob 345b1aa7c1aac4f283b3d36361aa33cad369e267
- M4C_RETURN_MANIFEST.json — accepted current M4C return manifest.

Binding parser rule for accepted M4C TSVs:

~~~text
FIELD_SEPARATOR = TAB
RECORD_SEPARATOR = PHYSICAL_NEWLINE
DOUBLE_QUOTE = LITERAL_FIELD_CHARACTER
CSV_QUOTE_SEMANTICS = DISABLED
PARSE_MODE = QUOTE_NONE / literal-tab
~~~

## Exact execution goal

Process all 4500 current normalized SERP rows and answer the 45 accepted query-specific information-gain contracts.

Materialize a traceable current bounded known-query visibility layer:

exact query × authorized competitor × ranking URL × rank

Then reconcile what the new evidence changes or does not change in:
- M4Q bounded known-query visibility;
- accepted M4C competitor/candidate context;
- M6 demand-gap routing.

## Claim boundaries

Hard boundaries:

~~~text
SEARCH_VISIBILITY != WORDSTAT_DEMAND
COMPETITOR_RANKING != OCTOPORT_PRODUCT_FACT
COMPETITOR_PAGE_TOPIC != PROVEN_DEMAND
KNOWN_QUERY_TOP100_VISIBILITY != ARBITRARY DOMAIN->UNKNOWN-QUERY REVERSE INDEX
NO AUTHORIZED COMPETITOR IN TOP100 != ZERO DEMAND
NO AUTHORIZED COMPETITOR IN TOP100 != ZERO INDEXED RESULTS
CURRENT R2 SNAPSHOT != UNIVERSAL/TEMPORAL/ALL-DEVICE PROOF
~~~

Do not make final cluster, page ownership, URL, H1, Title or IA decisions.

## Required outputs — exactly 8

1. M4Q_R2_PASS_B_SOURCE_MANIFEST.md
2. M4Q_R2_SERP_RESULT_LEDGER.tsv
3. M4Q_R2_COMPETITOR_VISIBILITY_MATRIX.tsv
4. M4Q_R2_QUERY_VISIBILITY_SUMMARY.tsv
5. M4Q_R2_COMPETITOR_VISIBILITY_SUMMARY.tsv
6. M4Q_R2_M4C_M6_RECONCILIATION.tsv
7. M4Q_R2_PASS_B_QA.md
8. M4Q_R2_PASS_B_RETURN_MANIFEST.json

## Full-volume expectations

M4Q_R2_SERP_RESULT_LEDGER.tsv must contain exactly 4500 data rows, one for every normalized Search result.

Every one of the 45 execution queries must account for exactly 100 current result rows.

All 60 authorized competitors must be represented in competitor summary, including zero-current-visibility rows.

No SERP row may be silently discarded because it is not an authorized competitor.

## Mandatory classification principles

Competitor matching must use frozen authorized registry host/domain/equivalence evidence.

Do not:
- invent sibling-host equivalence;
- merge ambiguous entities silently;
- map by fuzzy brand-name resemblance alone;
- treat native marketplace baseline as ordinary vendor if registry says otherwise.

Preserve match basis and uncertainty.

Current rank buckets:
- TOP3
- TOP10
- 11_20
- 21_100

M3 comparisons must preserve historical date/depth limits.

## QA / acceptance checks

At minimum:

~~~text
ATTACHMENT_SHA256_MATCH = 2/2
EXPORT_REVISION_MATCH = 2/2
QUERY_ORDER_MATCH = 45/45
SERP_RESULT_ROWS = 4500/4500
QUERY_RESULT_COUNTS = 45/45 x 100
SILENT_SERP_ROW_LOSS = 0
DUPLICATE_QUERY_RANK_KEYS = 0
UNKNOWN_EXECUTION_QUERY_IDS = 0
AUTHORIZED_COMPETITORS_ACCOUNTED = 60/60
UNRESOLVED_COMPETITOR_MATCHES = explicit count/list
M3_CONTROL_QUERIES_ACCOUNTED = 15/15
M4C_RECONCILIATION_QUERIES_ACCOUNTED = 45/45
M6_ROUTING_QUERIES_ACCOUNTED = 45/45
SEARCH_VISIBILITY_AS_DEMAND = 0
FINAL_CLUSTER_DECISIONS = 0
FINAL_PAGE_OWNERSHIP_DECISIONS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES = 0
~~~

## Stop conditions

- missing/mismatched attached export -> HOLD_INPUT_EVIDENCE_IDENTITY
- governing/frozen authority drift that changes method or required inputs -> HOLD_AUTHORITY_DRIFT
- inability to account for all 4500 normalized rows -> PARTIAL_REWORK_REQUIRED
- material competitor identity ambiguity that cannot be conservatively preserved -> do not guess; emit explicit HOLD/AMBIGUOUS rows and report count.

## Publication policy

Work must not write to GitHub.

Work returns exactly one ZIP containing exactly the eight required files.

Owner then uploads all eight unpacked files together in one GitHub UI action to:

docs/seo/serp/competitors/work_return/M4Q_R2_PASS_B_VISIBILITY_2026-09-23_R1/

Main Chat performs independent remote readback and acceptance.

## Current cursor

~~~text
M4Q_R2_PASS_A2 = ACCEPTED
M4Q_R2_PROVIDER_ACQUISITION = PASS
M4Q_R2_COMPLETE_SERP_CORPUS = ACCEPTED
M4Q_R2_PASS_B_WORK_TRIGGER = MET
M5 = PAUSED
M6 = NOT_STARTED
M7 = BLOCKED
~~~
