# Octoport SEO — M4Q organic ranking-query discovery — pre-step research and source-recovery gate

Date: 2026-09-22
Status: **PREPARED / SOURCE-RECOVERY COMPLETE / LIMITATION ACCEPTANCE CANDIDATE**
Stage: M4Q — Yandex organic domain/page -> query discovery
Preparation live HEAD: `1f38242d687056feb0fc449863dbd13d567b4cfe`

## 1. Why M4Q exists

M4Q is a distinct discovery lane from M4B page-surface mining.

Required evidence shape when a legitimate source is available:

```text
authorized M4A competitor domain/page
-> raw query
-> Yandex organic ranking URL
-> position / visibility metric when supplied
-> source identity / timestamp
```

Ranking-query evidence is discovery evidence only. It is not Wordstat demand and does not become a production keyword in M4.

M4C remains blocked until M4Q has a terminal accepted state.

## 2. Mandatory authority restored

LEVEL 1 read:
- docs/seo/LEVEL1/README.md
- docs/seo/EXECUTION_RULES.md
- docs/seo/QUALITY_FIRST_RESOURCE_RULE.md
- docs/seo/WORK_HANDOFF_RULE.md
- docs/seo/METHODOLOGY.md
- docs/seo/PRODUCT_TRUTH.md

LEVEL 2 read:
- docs/seo/LEVEL2/README.md
- docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- docs/seo/LEVEL2/OCTOPORT_KW002_RULE_TRANSFER_AUDIT_2026-09-18.md

Current accepted M4 evidence read:
- M4A_R3_MAIN_CHAT_RETURN_QA_2026-09-18.md
- M4B1_R5_A1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md
- M4B2_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md
- M4_PROGRESS.md

Failure/method history read:
- KW-002 STEP07_POST_EXTERNAL_METHOD_AUDIT_2026-09-18.md
- KW-002 STEP07_RANKING_QUERY_SOURCE_LIMITATION_ACCEPTANCE_2026-09-18.md
- KW-002 Step07 source-recovery blocked/acceptance cursor records

## 3. Frozen M4Q authority universe

Accepted M4A registry:

```text
M4A_REGISTRY_ROWS = 60
RECURRING_PRODUCT_VENDOR = 30
RELEVANT_ONE_OFF_PRODUCT_VENDOR = 12
SERVICE_OR_AGENCY = 2
OTHER_RELEVANT_CONTEXT = 1
EDITORIAL_OR_PUBLISHER = 12
NATIVE_MARKETPLACE_BASELINE = 2
AGGREGATOR_DIRECTORY = 1
M4A_REGISTRY_BLOB = 822155d7cebcbcf5cf8cdaef0f92782d5f84cd59
```

M4Q does not add new competitors. If the lane is reopened with a source later, the then-current rule must determine which of these 60 authorized entities are materially applicable to ranking-query acquisition; no raw non-registry domain may enter silently.

## 4. Fresh source-recovery research — 2026-09-22

### Keys.so

Official current API documentation exposes Yandex organic reverse-index reports, including domain organic keywords and page-level organic keywords. Regional bases identify `msk` and multiple other values as Yandex databases.

Relevant current documentation:
- https://apidoc.keys.so/
- https://help.keys.so/spravka-zaprosy-organic
- https://help.keys.so/spravka-konkurentu-organic
- https://www.keys.so/ru/api-changelog

Current access boundary:
- API methods require `X-Keyso-TOKEN`;
- the user-facing organic keyword report is for registered users;
- no approved Keys.so credential/export is frozen in the Octoport execution scope.

Verdict:
`CAPABILITY_CONFIRMED / LEGITIMATE_EXECUTION_ACCESS_NOT_AVAILABLE`.

### SpyWords

Official API documentation exposes:
- `DomainOrganic` — domain -> organic query/position/snippet URL for Yandex or Google;
- `DomainUrl` — domain -> ranked URLs;
- `DomainUrlOrganic` — page(s) -> organic queries/positions;
- `DomainOrganicCompetitors` and comparison methods.

Documentation:
- https://spywords.ru/api_docs.php

Current access boundary:
- production API is login/token authenticated;
- public documentation contains a test/demo credential path, but demo/masked data is not admissible as real competitor evidence;
- no approved production SpyWords credential/export is frozen in the Octoport execution scope.

Verdict:
`CAPABILITY_CONFIRMED / LEGITIMATE_EXECUTION_ACCESS_NOT_AVAILABLE`.

### Topvisor

Current official documentation confirms competitor research can return Yandex organic domain/URL keywords and competitor keyword sets.

Relevant documentation:
- https://topvisor.com/ru/support/competitors/
- https://topvisor.com/ru/support/competitors/competitors/
- https://topvisor.com/ru/api/competitors-2/get-table/
- https://topvisor.com/ru/api/competitors-2/get-orders-info/

Current access boundary:
- competitor keyword data is obtained through purchased reports / authenticated API execution;
- no approved Topvisor account/report/API credential or owner export is frozen in the Octoport execution scope.

Verdict:
`CAPABILITY_CONFIRMED / LEGITIMATE_EXECUTION_ACCESS_NOT_AVAILABLE`.

### MegaIndex

Official API documentation confirms competitor/visibility API surfaces and requires an API key plus Units.

Relevant documentation:
- https://ru.megaindex.com/api/catalog/view/26

Current access boundary:
- no approved MegaIndex key/Units-backed execution or owner export is frozen in the Octoport execution scope.

Verdict:
`CAPABILITY_PARTIAL_FOR_TARGET_LANE / LEGITIMATE_EXECUTION_ACCESS_NOT_AVAILABLE`.

### Yandex Webmaster

Yandex Webmaster is an owned-site visibility source, not an unrestricted reverse index for arbitrary competitor domains. It therefore cannot replace the M4Q competitor domain/page -> raw query lane for the frozen external competitor universe.

Verdict:
`WRONG_ACCESS_MODEL_FOR_COMPETITOR_REVERSE_INDEX`.

## 5. Current source-recovery result

Fresh 2026-09-22 source research confirms that suitable commercial capability exists, but no legitimately usable real-data source is currently available inside the authorized Octoport execution environment.

No:
- credential extraction;
- session/cookie theft;
- CAPTCHA bypass;
- paywall bypass;
- use of masked/demo results as factual competitor evidence;
- purchase initiated without owner authorization;
- fabricated ranking-query rows.

Therefore:

```text
RANKING_QUERY_SOURCE_CAPABILITY_EXISTS = true
APPROVED_REAL_DATA_ACCESS_AVAILABLE_NOW = false
OWNER_PROVIDED_ADMISSIBLE_EXPORT = false
RANKING_QUERY_OBSERVATIONS_ACQUIRED = 0
ZERO_OBSERVATIONS_MEANS_ZERO_RANKING_QUERIES = false
```

## 6. Work trigger

```text
WORK_TRIGGER = NOT_MET
```

Reason:
there is no acquired ranking-query corpus to process. Starting Work would add no information gain and would only repeat source-unavailability analysis already completed in Main Chat.

If a legitimate source/export becomes available later and produces a large bounded corpus, full-volume processing must move to Work under the normal large-data rule.

## 7. Terminal-state candidate

Under current M4 Level2, the valid terminal state is:

`RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION`

This is not a claim of complete competitor semantic recall.

Persistent limitation:
the accepted Octoport competitor evidence does not include a reverse-index portfolio of all Yandex organic queries for the authorized M4A universe.

## 8. Reopen condition

Reopen M4Q if any of the following becomes legitimately available:
- owner-provided Keys.so / SpyWords / Topvisor / MegaIndex export;
- owner-authorized credentialed execution through an approved environment;
- another current source that demonstrably supplies real Yandex competitor domain/page -> raw query -> ranking URL evidence without access-control bypass.

On reopen:
- preserve current immutable M4A/M4B evidence;
- freeze exact authorized registry scope;
- acquire the complete bounded source corpus;
- use Work if large-data quality risk is present;
- reconcile new candidates;
- reassess downstream M4C/M6 dependency impact before changing accepted results.

## 9. Hard boundary

M4Q source limitation does not:
- turn page topics into proven demand;
- turn 0 acquired rows into a negative search observation;
- permit Google-only data to be relabelled as Yandex evidence;
- authorize M4C before separate Main Chat limitation acceptance is persisted and remote-read back.

## 10. Next action

Persist and remote-read back this gate.

If readback is clean and no approved ranking-query credential/export appears in the live authority, publish the M4Q source-limitation acceptance and move the cursor to:

`M4C PREPARATION`.
