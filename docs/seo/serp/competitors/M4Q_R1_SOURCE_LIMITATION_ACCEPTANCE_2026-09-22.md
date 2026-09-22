# Octoport SEO — M4Q R1 ranking-query source limitation acceptance

Date: 2026-09-22
Status: **ACCEPTED WITH EXTERNAL SOURCE LIMITATION**
Stage: M4Q — Yandex organic domain/page -> query discovery

Preparation/source-recovery commit:
`95df35ecc3b8e2e096f27aaaf4da4c8734258b7f`

Preparation authority:
`M4Q_PRE_STEP_RESEARCH_AND_SOURCE_RECOVERY_GATE_2026-09-22_R1.md`

## 1. Decision

M4Q is accepted as:

`RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION`

This is not a zero-query result and is not a claim of complete competitor ranking-query recall.

## 2. Frozen upstream authority

Current accepted upstream state:

```text
M4A_R3 = ACCEPTED
M4A_REGISTRY_ROWS = 60
M4A_REGISTRY_BLOB = 822155d7cebcbcf5cf8cdaef0f92782d5f84cd59

M4B1 = ACCEPTED
M4B1_FINAL_TERMINAL_UNIVERSE = 9965

M4B2 = ACCEPTED
M4B2_URL_LEDGER_ROWS = 1476
M4B2_PAGE_EVIDENCE_ROWS = 1412
M4B2_CANDIDATE_ROWS = 1412
M4B2_FRONTIER_EQUATIONS = 15/15 PASS
```

M4Q does not add competitors or rewrite immutable M4A/M4B evidence.

## 3. Fresh 2026-09-22 source-recovery evidence

Current official/provider documentation was rechecked for serious reverse-index candidates.

### Keys.so

Current official API/help documentation confirms Yandex organic domain and page keyword capability, including domain organic keywords and page-level organic keyword reports.

Access boundary:
API requires an auth token; user-facing reports require registered access. No approved Octoport Keys.so credential or owner export is available in the frozen execution scope.

### SpyWords

Current official API documentation confirms:
- `DomainOrganic` for domain -> Yandex organic query/position/URL evidence;
- `DomainUrl` for ranked pages;
- `DomainUrlOrganic` for page -> Yandex organic queries/positions.

Access boundary:
production API requires login/token. Public test/demo access is not admissible as real competitor evidence. No approved production credential/export is available in the frozen Octoport scope.

### Topvisor

Current official documentation confirms Yandex organic competitor/domain keyword reports and API retrieval.

Access boundary:
competitor keyword data is tied to authenticated/purchased reports/API access. No approved Topvisor credential/report/export is available in the frozen Octoport scope.

### MegaIndex

Current official API documentation confirms competitor/visibility API capability requiring an API key/Units.

Access boundary:
no approved MegaIndex credential/export is available in the frozen Octoport scope.

### Yandex Webmaster

Yandex Webmaster is an owned-site visibility source and does not replace an unrestricted competitor reverse index for arbitrary M4A domains.

## 4. Historical regression check

The earlier KW-002 Step07 source-recovery incident was re-read as failure history, not copied as current evidence.

Its accepted lesson remains applicable:

```text
SOURCE_UNAVAILABLE != ZERO RANKING QUERIES
SOURCE_UNAVAILABLE != COMPLETE COMPETITOR RECALL
SOURCE_UNAVAILABLE != PERMISSION TO FABRICATE
```

The current Octoport decision is based on fresh 2026-09-22 source research plus current project access state.

## 5. Current execution/access state

```text
RANKING_QUERY_SOURCE_CAPABILITY_EXISTS = true
APPROVED_REAL_DATA_ACCESS_AVAILABLE_NOW = false
OWNER_PROVIDED_ADMISSIBLE_EXPORT = false
RANKING_QUERY_OBSERVATIONS_ACQUIRED = 0
RANKING_QUERY_ROWS_FABRICATED = 0

CREDENTIAL_EXTRACTION = 0
COOKIE_OR_SESSION_THEFT = 0
CAPTCHA_BYPASS = 0
PAYWALL_BYPASS = 0
DEMO_OR_MASKED_DATA_PROMOTED_TO_FACT = 0
```

## 6. Work decision

```text
WORK_TRIGGER = NOT_MET
```

There is no ranking-query corpus to process.

A Work run would not improve evidence quality and would only repeat the already completed access-state/source-recovery analysis.

If a legitimate source later supplies a large bounded ranking-query corpus, Work becomes mandatory under the normal full-volume rule.

## 7. Persistent limitation

The accepted M4 competitor evidence does **not** contain an exhaustive reverse-index portfolio of Yandex organic queries for the authorized M4A universe.

Therefore downstream artifacts must not claim:
- full competitor ranking-query recall;
- zero ranking queries;
- complete competitor semantic coverage solely from M4B page surfaces.

The limitation remains active until explicitly superseded by a later legitimate M4Q enrichment.

## 8. Reopen condition

M4Q may be reopened if any of the following becomes available:
- owner-provided admissible Keys.so / SpyWords / Topvisor / MegaIndex export;
- owner-authorized credentialed execution in an approved environment;
- another current source that demonstrably returns real Yandex competitor domain/page -> raw query -> ranking URL evidence without access-control bypass.

On reopen:
- preserve existing accepted evidence;
- use the then-current M4A authorized universe;
- acquire complete bounded source output;
- route large data through Work;
- reconcile candidate deltas;
- re-evaluate M4C/M6 dependency impact before changing accepted downstream authority.

## 9. Quality gate

| dimension | score /10 |
|---|---:|
| goal/output completeness | 10.0 |
| method/source support | 10.0 |
| input evidence/provenance integrity | 10.0 |
| source-recovery coverage/completeness | 9.5 |
| analytical correctness/claim boundaries | 10.0 |
| adversarial/failure-history QA | 9.0 |
| persistence/readback/reproducibility | 10.0 |
| owner usability/plain language | 9.0 |
| information gain/execution efficiency | 9.5 |
| downstream readiness | 9.0 |

```text
QUALITY_TOTAL = 95 / 100
QUALITY_SCORE = 9.5 / 10
ALL_HARD_GATES = PASS
OPEN_CRITICAL_DEFECTS = 0
```

## 10. Acceptance / forward gate

```text
M4Q = ACCEPTED_WITH_SOURCE_LIMITATION
RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
KNOWN_COMPETITOR_RANKING_QUERY_RECALL_LIMITATION = ACTIVE

M4C_PREPARATION_ALLOWED = true
M4C_EXECUTION_ALLOWED = false until its own Level1/Level2 preparation/release/readback
M7 = BLOCKED
```

Next physical stage:

`M4C synthesis pre-step preparation`.
