# M4 progress — Search competitor + landing corpus

Date: 2026-09-23
Branch: seo/wordstat-batch-01-2026-09-16
Status: **M4 ACCEPTED / M4Q R2 PASS A R1 MECHANICAL PASS BUT SEMANTIC ADMISSION REWORK REQUIRED / PASS A2 RELEASED TO WORK / M5 PAUSED**
## Current cursor

~~~text
M3_PRIMARY_ORGANIC = CLOSED
M3_CONTROL_DEBT = OPEN UNTIL M6

M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION
M4A = ACCEPTED
M4B1 = ACCEPTED
M4B2 = ACCEPTED
M4C = R1_ACCEPTED

M4Q_R1 = ACCEPTED_WITH_SOURCE_LIMITATION
M4Q_UNKNOWN_QUERY_REVERSE_INDEX_RECALL = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
M4Q_R2_KNOWN_QUERY_VISIBILITY = PASS_A_R1_SEMANTIC_ADMISSION_REWORK_REQUIRED
M4Q_R2_PASS_A_R1_MECHANICAL_QA = PASS
M4Q_R2_PASS_A_R1_PROVIDER_MANIFEST_ACCEPTED = false
M4Q_R2_PASS_A2 = RELEASED_TO_WORK
M4Q_R2_PASS_A2_RELEASE_READBACK = PASS
M4Q_R2_PASS_A2_WORK_START_ALLOWED = true

M5 = PAUSED_BY_OWNER_AUTHORIZED_M4Q_R2_ENRICHMENT
M6 = NOT STARTED
M7 = BLOCKED
~~~

## Current authorities

- docs/seo/LEVEL1/README.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- M4A_PRE_STEP_RESEARCH_AND_EXECUTION_GATE_2026-09-18.md = SUPERSEDED HISTORY
- M4A_WORK_PROMPT_2026-09-18.md = DO NOT EXECUTE

## Historical note — why M4A was next

Search competitors must be derived from accepted M3 recurrence, not from remembered brands or a business-rival shortlist.

Expected authority universe:
15 accepted query authorities × 20 organic rows = 300 occurrences.
Original R04 excluded. R04R1 is authority.

Full-volume cross-file recurrence/lineage analysis is assigned to ChatGPT Work under quality-first and Work-handoff rules.

## Historical next physical action at the original M4A stage

Main Chat re-prepares M4A from live HEAD after explicit LEVEL 1 + M4 LEVEL 2 read, persists/readbacks the new preparation, and only then may a new Work prompt be relayed.

No competitor/vendor landing collection is released before the M4A return is uploaded, remote-read back and independently accepted by Main Chat.


## 2026-09-18 — post-transfer audit state

The complete KW-002 Step06-22 rule-transfer audit materially changed the M4 method authority after the earlier M4A preparation was superseded.

New required authorities before M4A re-preparation:
- docs/seo/LEVEL1/README.md
- docs/seo/LEVEL2/README.md
- docs/seo/LEVEL2/OCTOPORT_STEP_RULES_INDEX.md
- docs/seo/LEVEL2/OCTOPORT_KW002_RULE_TRANSFER_AUDIT_2026-09-18.md
- docs/seo/LEVEL2/M4_SEARCH_COMPETITOR_LANDING_RULES.md
- current M3 authority/evidence/failure history
- current external M4 method sources

New M4A must additionally implement transferred Step06 controls:
- Top3 / Top10 / 11-20 strength separation;
- explicit collision/uncertainty preservation;
- recurrence metric granularity;
- exact-URL and domain pairwise Top10 similarity across the frozen query set;
- curated registry from the complete recurrence universe.

M4B must implement transferred Step07 controls:
- only M4A-authorized competitors;
- deterministic host-scope policy;
- complete bounded URL frontier, not representative sampling;
- terminal URL-state accounting;
- canonicalization/redirect provenance;
- candidate provenance and reconciliation;
- competitor topic != proven demand.

CURRENT_CURSOR:
M4 CURRENT -> M4A REPREPARATION REQUIRED UNDER UPDATED LEVEL2 -> NO WORK PROMPT RELAY YET.


## 2026-09-18 — M4A R2 re-prepared after R0 and full KW-002 hardening transfer

R0 prerequisite:
M0_SCOPE_SOURCE_RETRO_CONSOLIDATION = PASS
M0_CURRENT_SCORE = 9.7/10

New current M4A execution authorities:
- M4A_PRE_STEP_RESEARCH_AND_EXECUTION_GATE_2026-09-18_R2.md
- M4A_EXECUTION_RELEASE_2026-09-18_R2.md
- M4A_WORK_PROMPT_2026-09-18_R2.md

The old M4A gate/prompt remains SUPERSEDED / DO NOT EXECUTE.

R2 execution unit:
- 15 accepted authority queries;
- 20 rows each;
- 300 occurrences;
- 105 unique unordered Top10 query pairs;
- no new provider calls;
- no external vendor browsing.

R2 adds the missing hardened Step06 layer:
- Top3 / Top10 / 11-20;
- complete occurrence classification;
- query profiles;
- collision/uncertainty ledger;
- exact-URL and domain pairwise Top10 similarity;
- explicit recurrence granularity;
- complete domain recurrence universe;
- curated competitor registry;
- exact M4B ranking-URL anchors.

Role correction:
Main Chat has already performed Level1/Level2/research/release governance.
Work performs only the released full-volume execution plus narrow live-HEAD/input-drift preflight.

CURRENT_CURSOR:
M4 CURRENT -> M4A R2 PREPARED -> REMOTE READBACK -> OWNER RELAYS R2 WORK PROMPT -> WORK RETURN -> OWNER ONE-STAGING UPLOAD -> MAIN CHAT RETURN QA -> only then M4B.


## 2026-09-18 — M4A R2 Work preflight HOLD / R06 transport incident

Work correctly stopped before classification because R06 historical export transport failed exact-byte verification.

Current incident authority:
`../raw/R06_09_TRANSPORT_INTEGRITY_INCIDENT_2026-09-18.md`

Important:
- R06 provider collect/lifecycle remains valid;
- seven chunk blobs are unchanged and match their historical manifest identities;
- their reconstructed gzip SHA/CRC/ISIZE do not match the historical manifest;
- raw DEFLATE body is recoverable as valid 73,385-byte R06 JSON with the correct job/revision/operation and complete 20 ranks;
- no new provider call is authorized while deterministic provider-free recovery is available.

CURRENT_CURSOR:
M4 CURRENT -> R06 TRANSPORT RECOVERY -> MAIN CHAT RECOVERY QA -> NEW M4A RELEASE -> WORK.


## 2026-09-18 — R06 provider-free transport recovery ACCEPTED

Current R06 transport authority:
`../raw/recovery/R06_2026-09-18/R06_10_RECOVERED_EXPORT_MANIFEST_2026-09-18.md`

Recovery QA:
`../raw/recovery/R06_2026-09-18/R06_11_RECOVERY_QA_2026-09-18.md`

The historical R06 manifest is superseded for exact-byte identity.

No Search replay occurred.

```text
R06_DERIVED_RECOVERY_AUTHORITY = ACCEPTED
R06_INPUT_INTEGRITY_BLOCKER = CLOSED
M4A_R2 = remains SUSPENDED/HISTORICAL
NEXT = issue fresh M4A R3 release
```


## 2026-09-18 — M4A R3 release remote-readback PASS

R3 release commit:
`0369e0556bbee9728dd148a3e8452958e8479087`

Branch compare:
`identical / ahead_by=0 / behind_by=0`.

Read back:
- R3 pre-step gate: PASS;
- R3 execution release: PASS;
- R3 Work prompt: PASS;
- R3 staging target: PASS.

R06 derived recovery authority is frozen explicitly in R3.

```text
M4A_R3_RELEASE_READBACK = PASS
M4A_R3_WORK_START_ALLOWED = true
M4A_R2_WORK_START_ALLOWED = false
```

CURRENT_CURSOR:
M4 CURRENT -> OWNER RELAYS M4A R3 WORK PROMPT -> WORK EXECUTES COMPLETE 300/105 UNIT -> OWNER ONE-STAGING UPLOAD -> MAIN CHAT RETURN QA -> only then M4B.


## 2026-09-18 — M4A R3 Main Chat ACCEPT

Authority:
`M4A_R3_MAIN_CHAT_RETURN_QA_2026-09-18.md`

Independent Main Chat QA:
- all remote output hashes match manifest;
- 300/300 occurrences;
- 15/15 profiles;
- 105/105 pairwise rows and metrics independently recomputed;
- 127/127 domain recurrence metrics independently recomputed;
- 92 collision rows fully reconciled;
- 60 registry rows traceable;
- 143 M4B anchors traceable;
- R06 recovery verified;
- S03 one-character normalized transport defect repaired provider-free/content-equivalently.

Score:
`9.8/10`.

```text
M4A_R3 = ACCEPTED
M3_STEP06_ANALYTICAL_HARDENING_VIA_M4A = PASS
M4B = CURRENT
```


## 2026-09-18 — M4B deterministic split and M4B1 preparation

Accepted M4A registry:
60 entities / 143 anchors.

M4B is split into complete deterministic units:

M4B1 PRODUCT/VENDOR:
- 30 recurring product vendors;
- 12 relevant one-off product vendors;
- 2 services/agencies;
- 1 other relevant context;
- total = 45 entities / 100 anchors.

M4B2 CONTEXT/BASELINE:
- 12 editorial/publishers;
- 2 native marketplace baselines;
- 1 aggregator/directory;
- total = 15 entities / 43 anchors.

This is chunking, not sampling. M4B cannot close until both units and M4C are accepted.

M4B1 Work trigger = MET.

M4B1 hard method:
- every anchor accounted;
- deterministic per-entity host scope;
- complete bounded URL frontier;
- every eligible URL terminal;
- environment failure != site failure;
- no CAPTCHA/auth/private bypass;
- no whole-domain crawl for broad sites;
- no full-page copy storage;
- competitor topic != proven demand.

Current next action:
owner relays M4B1 Work prompt after release remote readback.


## 2026-09-18 — M4B1 release remote-readback PASS

Release commit:
`5fd04afe5eebd3467a657bc8bc33f3aebb10488e`

Branch compare:
`identical / ahead_by=0 / behind_by=0`.

Readback:
- M4B1 gate: PASS;
- execution release: PASS;
- Work prompt: PASS;
- staging target: PASS;
- roadmap/progress: PASS.

```text
M4B1_WORK_START_ALLOWED = true
M4B2_WORK_START_ALLOWED = false
M4C_ALLOWED = false
```

Current next action:
owner relays `M4B1_WORK_PROMPT_2026-09-18_R1.md`.


## 2026-09-18 — M4B1 Work partial return accepted for recovery only

Owner upload HEAD:
`ddb7ce16f325f92014de383039400523a7de7742`

Independent Main Chat QA:
- output hash mismatches: 0;
- 45 scope rows;
- 100/100 anchors;
- 372 URL rows;
- 249 inspected/page-evidence rows;
- 390 candidate terms;
- 45 residual URL rows;
- 23 navigation-enumeration entities;
- joins: PASS.

Decision:

```text
M4B1_PARTIAL_EVIDENCE = ACCEPTED_FOR_RECOVERY
M4B1_FINAL_ACCEPTANCE = false
M4B1_RECOVERY = CURRENT
M4B2_ALLOWED = false
```

Exact recovery is frozen in:
- M4B1_RECOVERY_URL_QUEUE_2026-09-18.tsv
- M4B1_NAVIGATION_RECOVERY_QUEUE_2026-09-18.tsv
- M4B1_BROWSER_RECOVERY_GATE_2026-09-18.md


## 2026-09-18 — M4B1 Recovery R2 prepared

Opera browser recovery closed:
- 45/45 original residual decisions;
- 23/23 navigation enumerations.

Navigation evidence created 835 new same-entity URL delta rows after conservative deduplication against R1.

Triage only:
- 649 NEEDS_SCOPE_CLASSIFICATION;
- 111 NON_HTML_CANDIDATE;
- 44 LEGAL_OR_CORPORATE_CANDIDATE;
- 31 AUTH_OR_PRIVATE_CANDIDATE.

Because 835 + recursive frontier is a new large-data execution unit, full-volume handling returns to Work.

R2 must:
- structure 43 recovered pages;
- disposition all 835 initial delta rows;
- recursively close all admitted in-scope URLs;
- produce current 45-entity synthesis and frontier reconciliation.

M4B1 remains NOT ACCEPTED.
M4B2 remains blocked.


## 2026-09-18 — M4B1 Recovery R2 remote-readback PASS

Release commit:
`0d29e898fed8389570db9e662cdbb0792d58fac0`

Readback:
- navigation delta: 835 data rows / blob `9ec4cf1c72531e7e0e937fe576cfa116c7effed9`;
- R2 gate: PASS;
- R2 release: PASS;
- R2 Work prompt: PASS;
- R2 staging README: PASS.

```text
M4B1_RECOVERY_R2_WORK_START_ALLOWED = true
M4B1_ACCEPTED = false
M4B2_ALLOWED = false
```


## 2026-09-18 — R2 preflight HOLD resolved: Mayak authority correction

Work correctly stopped on authority mismatch.

Reverification in Opera:
- Mayak `/webinars_mayak` renders branded not-found surface;
- canonical row is `M4B1U0293`;
- authoritative terminal = `NOT_FOUND`;
- no structured page evidence required.

Root cause: wrong special-case URL ID was used when generating the first residual overlay.

Correct residual equation:
`43 INSPECTED + 1 AUTH_REQUIRED + 1 NOT_FOUND = 45`.

835-row navigation delta unchanged.


## 2026-09-18 — M4B1 R2 merged QA / frontier-method correction

Owner upload HEAD:
`96d1483822c48d63e4474f4e4a65d6eed48f4204`

Independent QA:
- 13/13 input SHA match;
- 8/8 output SHA match;
- 835/835 initial delta IDs accounted exactly once;
- 405 recursive new URL identities;
- current non-residual URL universe = 1612 unique normalized URLs;
- 579/579 R2 INSPECTED URLs have page evidence;
- 43/43 Opera-recovered pages have structured evidence;
- 45/45 entity/reconciliation rows;
- count equation failures = 0;
- open unresolved URL count = 0.

R2 execution/data quality = 9.7/10.

Method correction:
the R2 local per-page child-link recursion gate exceeded the canonical M4 Level2. The 416 child-link flags remain diagnostics, not a 416-page mandatory revisit set.

Real remaining M4B1 page-surface closure:
45-entity discovery-channel audit for navigation/taxonomy + scoped sitemap + pagination.

Current KW-002 Step07 re-read also exposed a missing transferred amendment:
M4Q Yandex-organic ranking-query discovery/source-unavailable lane is required before M4C.

```text
M4B1_R2_PARTIAL_EVIDENCE = ACCEPTED
M4B1_FINAL_ACCEPTANCE = false
M4B1_R3_COVERAGE_CLOSURE = NEXT
M4B2_ALLOWED = false
M4Q_REQUIRED_BEFORE_M4C = true
```


## 2026-09-18 — M4B1 Coverage Closure R3 prepared

R3 execution unit:
45 authorized M4B1 entities.

R3 does NOT replay the 416 R2 child-link diagnostics.

It closes the canonical page-surface discovery channels:
- anchors;
- primary navigation/taxonomy;
- breadcrumb/local subtree;
- scoped sitemap;
- pagination/load-more;
- terminal new delta.

Current normalized URL universe before R3:
1612.

Work trigger = MET because sitemap/pagination discovery may generate a large full-volume delta.

M4B2 remains blocked until M4B1 page-surface acceptance.
M4Q organic ranking-query lane is required before M4C.


## 2026-09-18 — M4B1 Coverage Closure R3 release readback PASS

Release commit:
`be483ce2ba1036829e80148c157e6bd7591bdcc0`

Branch compare:
`identical / ahead_by=0 / behind_by=0`.

Readback:
- R3 gate = PASS;
- R3 release = PASS;
- R3 Work prompt = PASS;
- R3 staging README = PASS;
- corrected M4 Level2 = PASS;
- roadmap/progress = PASS.

```text
M4B1_COVERAGE_R3_WORK_START_ALLOWED = true
M4B1_FINAL_ACCEPTANCE = false
M4B2_ALLOWED = false
M4Q_REQUIRED_BEFORE_M4C = true
```


## 2026-09-21 — M4B1 R5 Main Chat final acceptance

Authority:
`M4B1_R5_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-21.md`

Owner R5 upload commit:
`b09874c8fbb22a83f8fbaf8c3136d1365db8f127`

Independent Main Chat QA:
- 9/9 required R5 files present;
- 8/8 non-self SHA-256 values independently match remote bytes;
- 5,455/5,455 URL rows unique and terminal `INSPECTED`;
- 5,455/5,455 structured page-evidence joins;
- normalized-URL duplicates = 0;
- missing/unknown page evidence = 0/0;
- 45/45 discovery-channel rows;
- 45/45 entity-synthesis rows;
- 45/45 frontier-reconciliation rows;
- R4→R5 non-Uniseller diffs across the three current-state tables = 0;
- final terminal normalized universe = 9,965;
- open URL unresolved = 0;
- blocking channel HOLD = 0;
- count equation failures = 0.

```text
M4B1_PRODUCT_VENDOR_PAGE_SURFACE = ACCEPTED
M4B1_FINAL_ACCEPTANCE = true
M4B1_OPEN_CRITICAL_DEFECTS = 0
M4B2 = NEXT_PREPARATION
M4B2_WORK_START_ALLOWED = false
M4Q_REQUIRED_BEFORE_M4C = true
M4C_ALLOWED = false
```

CURRENT_CURSOR:
M4 CURRENT -> M4B1 ACCEPTED -> M4B2 PRE-STEP PREPARATION -> M4B2 WORK/RETURN QA -> M4Q -> M4C.


## 2026-09-22 — M4B1 R5 A1 final acceptance

Current acceptance authority:
`M4B1_R5_A1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md`

The earlier 2026-09-21 acceptance is superseded as final acceptance authority because later full-volume Work QA exposed two acceptance defects:
- REG024 phase accounting omitted explicit R4 +10 in its equation;
- Uniseller occurrence-level losslessness had not been independently retained/proven.

A1 correction PASS:
- exactly 5 required correction files remote-read back;
- occurrence rows = 5,475;
- contiguous occurrence indices = PASS;
- unique normalized identities = 5,474;
- duplicate occurrence rows = 1;
- 19 already accepted + 5,455 R5 new terminal = 5,474;
- silent URL loss = 0;
- frontier rows = 45;
- equation pass = 45/45;
- REG024 = `4 + 109 + 12 + 10 + 0 = 135`;
- REG051 = `2 + 66 + 0 + 0 + 5455 = 5523`;
- global terminal universe = 9,965;
- open URL unresolved = 0;
- blocking channel HOLD = 0;
- other 44 entities materially unchanged.

```text
M4B1_PRODUCT_VENDOR_PAGE_SURFACE = ACCEPTED
M4B1_FINAL_ACCEPTANCE = true
M4B1_OPEN_CRITICAL_DEFECTS = 0
M4B1_FINAL_TERMINAL_UNIVERSE = 9965

M4B2 = NEXT_PREPARATION
M4B2_WORK_START_ALLOWED = false
M4Q_REQUIRED_BEFORE_M4C = true
M4C_ALLOWED = false
```

CURRENT_CURSOR:
M4 CURRENT -> M4B1 ACCEPTED -> M4B2 PRE-STEP PREPARATION -> M4B2 WORK/RETURN QA -> M4Q -> M4C.

## 2026-09-22 — M4B2 pre-step preparation R1

M4B1 is accepted under:
`M4B1_R5_A1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md`.

M4B2 deterministic unit is now prepared from accepted M4A authority:

- 12 EDITORIAL_OR_PUBLISHER = 32 accepted page-candidate anchors;
- 2 NATIVE_MARKETPLACE_BASELINE = 8 anchors;
- 1 AGGREGATOR_DIRECTORY = 3 anchors;
- total = 15 entities / 43 accepted page-candidate anchors.

Preparation detected two accepted registry entities with zero page-candidate rows:
- REG032 Reg;
- REG033 Rutube.

To prevent silent entity loss, four exact accepted M4A occurrence URLs are frozen as zero-anchor bootstrap seeds. This does not alter the accepted 43-anchor count.

```text
M4B2_REGISTRY_ENTITIES = 15
M4B2_ACCEPTED_PAGE_CANDIDATE_ANCHORS = 43
M4B2_ZERO_ANCHOR_REGISTRY_ENTITIES = 2
M4B2_BOOTSTRAP_URLS = 4
M4B2_TOTAL_EXECUTION_SEED_ROWS = 47
M4B2_PREPARATION = COMPLETE
M4B2_WORK_START_ALLOWED = true
M4Q_REQUIRED_BEFORE_M4C = true
M4C_ALLOWED = false
```

Prepared authorities:
- M4B2_AUTHORITY_MANIFEST_2026-09-22_R1.tsv
- M4B2_PRE_STEP_RESEARCH_AND_EXECUTION_GATE_2026-09-22_R1.md
- M4B2_EXECUTION_RELEASE_2026-09-22_R1.md
- M4B2_WORK_PROMPT_2026-09-22_R1.md

CURRENT_CURSOR:
M4 CURRENT -> M4B1 ACCEPTED -> M4B2 R1 AUTHORIZED / WORK MAY START -> M4B2 WORK -> MAIN CHAT RETURN QA -> M4Q -> M4C.


## 2026-09-22 — M4B2 R1 release remote-readback PASS

Preparation commit:
`68809be4823688ac855486c0985cea23c04cfd05`

Independent remote readback confirmed:

- authority manifest = 47 rows;
- unique authorized entities = 15;
- accepted page-candidate anchors = 43;
- zero-anchor bootstrap URLs = 4;
- zero-anchor entities = REG032 Reg + REG033 Rutube;
- editorial anchors = 32;
- native-baseline anchors = 8;
- aggregator anchors = 3;
- gate/release/prompt/staging/progress readback = PASS.

```text
M4B2_R1_RELEASE_READBACK = PASS
M4B2_WORK_START_ALLOWED = true
M4Q_REQUIRED_BEFORE_M4C = true
M4C_ALLOWED = false
```

CURRENT_CURSOR:
M4 CURRENT -> M4B1 ACCEPTED -> OWNER RELAYS M4B2 R1 WORK PROMPT -> WORK EXECUTES 15-ENTITY/47-SEED BOUNDED UNIT -> OWNER UPLOAD -> MAIN CHAT RETURN QA -> M4Q -> M4C.


## 2026-09-22 — M4B2 R1 Main Chat final acceptance

Authority:
`M4B2_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-22.md`

Owner upload HEAD:
`88c3e98c6ad99cadcd3c6af5563e25520ea173b6`

Acceptance commit:
`1f38242d687056feb0fc449863dbd13d567b4cfe`

```text
M4B2 = ACCEPTED
M4B2_FINAL_ACCEPTANCE = true
M4B2_OPEN_CRITICAL_DEFECTS = 0
URL_LEDGER_ROWS = 1476
PAGE_EVIDENCE_ROWS = 1412
CANDIDATE_ROWS = 1412
FRONTIER_EQUATIONS = 15/15 PASS
OPEN_URL_UNRESOLVED = 0
BLOCKING_CHANNEL_HOLD = 0
SILENT_URL_LOSS = 0
```

M4Q remained required before M4C.

## 2026-09-22 — M4Q source recovery and limitation acceptance

Preparation/source-recovery authority:
`M4Q_PRE_STEP_RESEARCH_AND_SOURCE_RECOVERY_GATE_2026-09-22_R1.md`

Preparation commit:
`95df35ecc3b8e2e096f27aaaf4da4c8734258b7f`

Acceptance authority:
`M4Q_R1_SOURCE_LIMITATION_ACCEPTANCE_2026-09-22.md`

Acceptance commit:
`ba1baad819e2e1c5c50c6bb428c8c2be313759d2`

Fresh source recovery rechecked current Keys.so, SpyWords, Topvisor, MegaIndex and Yandex Webmaster access models.

Suitable Yandex organic reverse-index capability exists in commercial sources, but no approved real-data credential/report/export is available in the frozen Octoport execution scope.

No access controls were bypassed and no demo/masked data was promoted to fact.

```text
M4Q = ACCEPTED_WITH_SOURCE_LIMITATION
RANKING_QUERY_LANE = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
RANKING_QUERY_OBSERVATIONS_ACQUIRED = 0
ZERO_OBSERVATIONS_MEANS_ZERO_RANKING_QUERIES = false
KNOWN_COMPETITOR_RANKING_QUERY_RECALL_LIMITATION = ACTIVE
WORK_TRIGGER = NOT_MET

M4C = NEXT_PREPARATION
M4C_PREPARATION_ALLOWED = true
M4C_EXECUTION_ALLOWED = false
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 CURRENT -> M4A ACCEPTED -> M4B1 ACCEPTED -> M4B2 ACCEPTED -> M4Q ACCEPTED WITH SOURCE LIMITATION -> M4C PRE-STEP PREPARATION.


## 2026-09-22 — M4C pre-step input-integrity HOLD

Authority:
`M4C_PRE_STEP_INPUT_INTEGRITY_HOLD_2026-09-22.md`

M4C preparation found that the accepted M4B1 R3 page-level Work return is not durably present in the current repository staging directory.

R4 authority proves the accepted R3 contribution:

```text
R3_NEW_IN_SCOPE_NORMALIZED_IDENTITIES = 2888
R3_NEW_INSPECTED_IDENTITIES = 2845
POST_R3_MERGED_NORMALIZED_URL_UNIVERSE = 4500
OPEN_URL_UNRESOLVED = 0
SILENT_URL_LOSS = 0
```

Current R3 work_return directory contains only the pre-existing README; the nine accepted R3 Work outputs must be restored unchanged before full-volume M4C synthesis.

```text
M4C = HOLD_R3_ARTIFACT_PERSISTENCE_RECOVERY
M4C_PREPARATION_ALLOWED = false
M4C_WORK_START_ALLOWED = false
NEW_R3_ACQUISITION_ALLOWED = false
NEXT = RESTORE ORIGINAL 9 R3 WORK OUTPUTS -> REMOTE READBACK -> RESUME M4C PREPARATION
```


## 2026-09-22 — M4B1 R3 reacquisition R1 authorized

Owner explicitly authorized rebuilding the lost R3 evidence from scratch.

Authority:
- `M4B1_R3_REACQUISITION_GATE_2026-09-22_R1.md`
- `M4B1_R3_REACQUISITION_RELEASE_2026-09-22_R1.md`
- `M4B1_R3_REACQUISITION_WORK_PROMPT_2026-09-22_R1.md`

The earlier constraint `NEW_R3_ACQUISITION_ALLOWED = false` is superseded only for this owner-authorized recovery execution.

```text
M4B1_R3_REACQUISITION_R1 = AUTHORIZED
M4B1_R3_REACQUISITION_WORK_START_ALLOWED = true
WORK_TRIGGER = MET
EXECUTION_UNIT = EXACT_LOST_R3_BOUNDED_UNIT
AUTHORIZED_ENTITIES = 45
PRE_R3_NORMALIZED_UNIVERSE = 1612

M4C = HOLD_R3_REACQUISITION_RETURN_REQUIRED
M4C_PREPARATION_ALLOWED = false
M4C_EXECUTION_ALLOWED = false
```

CURRENT_CURSOR:
M4 -> M4B1 R3 REACQUISITION R1 WORK -> OWNER UPLOAD 9 FILES -> MAIN CHAT READBACK/DEPENDENCY RECONCILIATION -> M4C PREPARATION.


## 2026-09-22 — M4B1 R3 reacquisition R1 Main Chat acceptance

Authority:
`M4B1_R3_REACQUISITION_R1_MAIN_CHAT_ACCEPTANCE_2026-09-22.md`

Owner upload HEAD:
`64450ee61708d09a214f8ef324eb4e9ec1859348`

Acceptance commit:
`3ac67c3f8ba4eb053eaf44d6fb440e85b1668514`

Independent Main Chat QA:

```text
REQUIRED_FILES = 9/9
NON_SELF_SHA256 = 8/8 MATCH
DECLARED_BYTES = 8/8 MATCH

URL_ROWS = 11222
URL_ID_DUPLICATES = 0
PAGE_EVIDENCE_ROWS = 5118
INSPECTED_MISSING_PAGE_EVIDENCE = 0
CANDIDATE_ROWS = 5116
CANDIDATE_BROKEN_PROVENANCE = 0

DISCOVERY_CHANNEL_COVERAGE_ROWS = 45
ENTITY_SYNTHESIS_ROWS = 45
FRONTIER_RECONCILIATION_ROWS = 45
FRONTIER_EQUATIONS = 45/45 PASS
OPEN_URL_UNRESOLVED = 0
BLOCKING_CHANNEL_HOLD = 0
SILENT_URL_LOSS = 0

CURRENT_PUBLIC_DRIFT_DETECTED = true
CURRENT_POST_R3_MERGED_UNIVERSE = 12834
```

The reacquisition is accepted as current R3 evidence, not as byte-for-byte restoration of the lost 2026-09-18 R3 snapshot.

Historical R4/R5 acceptance remains preserved. M4C must reconcile overlaps by normalized identity and preserve multi-phase provenance; historical additive counts may not be used as current dedupe authority.

```text
M4B1_R3_REACQUISITION_R1 = ACCEPTED_AS_CURRENT_EVIDENCE
M4B1_R3_PERSISTENCE_HOLD = CLOSED_BY_OWNER_AUTHORIZED_REACQUISITION
M4C = NEXT_PREPARATION
M4C_PREPARATION_ALLOWED = true
M4C_EXECUTION_ALLOWED = false
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 CURRENT -> M4C PRE-STEP PREPARATION -> FULL-VOLUME WORK SYNTHESIS/RECONCILIATION -> MAIN CHAT RETURN QA.


## 2026-09-22 — M4C synthesis R1 preparation

Preparation base HEAD:
f33bbbd4a5be4769ce199e68c8024875821d5041

Prepared:
- M4C_AUTHORITY_MANIFEST_2026-09-22_R1.tsv
- M4C_PRE_STEP_RESEARCH_AND_EXECUTION_GATE_2026-09-22_R1.md
- M4C_EXECUTION_RELEASE_2026-09-22_R1.md
- M4C_WORK_PROMPT_2026-09-22_R1.md
- work_return/M4C_SYNTHESIS_2026-09-22_R1/README.md

Fresh Yandex method check completed.

Work trigger is MET because current M4C requires full-volume cross-file dedupe/reconciliation across accepted M4B1 phases, fresh R3 drift evidence, M4B2 and M4Q limitation state.

Critical reconciliation rule:
fresh R3 access state and durable historical R4/R5 content evidence are preserved separately; historical phase totals are not additive dedupe authority.

~~~text
M4C_R1_PREPARATION = COMPLETE
M4C_WORK_START_ALLOWED = false
NEXT = REMOTE READBACK OF PREPARATION/RELEASE/PROMPT/MANIFEST/STAGING/PROGRESS
~~~


## 2026-09-22 — M4C R1 release remote-readback PASS

Authority:
`M4C_R1_RELEASE_READBACK_2026-09-22.md`

Remote readback confirmed:
- authority manifest = 64/64 frozen rows with WORK_ID and preparation base HEAD;
- gate = PASS;
- execution release = PASS;
- canonical Work prompt = PASS;
- staging = PASS;
- progress preparation state = PASS;
- unexpected changed paths since preparation base = 0;
- authority drift = NONE.

```text
M4C_R1_RELEASE_READBACK = PASS
M4C_WORK_START_ALLOWED = true
M4C = RELEASED_TO_WORK
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 CURRENT -> OWNER RELAYS M4C R1 WORK PROMPT -> WORK EXECUTES COMPLETE FROZEN M4C UNIT -> OWNER UPLOADS 11 UNPACKED FILES -> MAIN CHAT REMOTE READBACK / RETURN QA -> ACCEPT | REWORK | HOLD.


## 2026-09-22 — M4C GitHub Web transport correction

Work reported PASS from START_HEAD / END_OBSERVED_HEAD:
`b72a510138bf5a324be45b74311058d364ae099f`.

Owner partial upload commit:
`cc4a30a742b2544eb1e52e40b14d97a2c29fb79d`.

Six logical files were uploaded unchanged.

GitHub Web rejected oversized logical outputs:
- M4C_PAGE_EVIDENCE.tsv = 34206423 bytes;
- M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv = 185122964 bytes.

Transport correction authority:
`M4C_GITHUB_WEB_TRANSPORT_CORRECTION_2026-09-22_R1.md`.

The two oversized logical TSVs are now represented by ordered line-aligned byte-exact parts below 25 MiB. Original Work bytes and SHA-256 remain the acceptance identity.

```text
M4C_WORK_RESULT = REPORTED_PASS
M4C_OWNER_UPLOAD = PARTIAL
M4C_TRANSPORT_CORRECTION = ACTIVE
M4C_ACCEPTED = false
NEXT = OWNER UPLOADS REMAINING 14 PAYLOAD FILES -> REMOTE READBACK -> BYTE-EXACT RECONSTRUCTION QA -> MAIN CHAT ACCEPTANCE
```


## 2026-09-23 — M4C R1 Main Chat final acceptance

Authority:
`M4C_R1_MAIN_CHAT_FINAL_ACCEPTANCE_2026-09-23.md`

Owner single-ZIP publication HEAD:
`a19d3556492ac3359940a105af231b6f6b51f2dc`

Independent Main Chat QA:

```text
REMOTE_ZIP_GIT_BLOB_IDENTITY = MATCH
REMOTE_ZIP_BYTES = 10082076
ZIP_SHA256 = 57ada78d090695163e33c14faed1fce5cd9f42c29fe5f4527d9b3e30aa05a04e

ZIP_PART_FILES = 11/11
PART_SHA256 = 11/11 MATCH
PART_BYTES = 11/11 MATCH

NON_SELF_LOGICAL_OUTPUT_SHA256 = 10/10 MATCH
NON_SELF_LOGICAL_OUTPUT_BYTES = 10/10 MATCH

M4C_REGISTRY_ROWS = 60
M4C_COVERAGE_ROWS = 60
M4C_DEDUPED_URL_ROWS = 15469
M4C_PAGE_EVIDENCE_ROWS = 12502
M4C_MATRIX_ROWS = 212200
M4C_CANDIDATE_OCCURRENCE_ROWS = 8431
M4C_M5_HYPOTHESIS_ROWS = 867
M4C_M6_CANDIDATE_ROWS = 5973

SOURCE_URL_OCCURRENCES_ACCOUNTED = 25295/25295
SOURCE_PAGE_ROWS_ACCOUNTED = 12820/12820
SOURCE_CANDIDATE_ROWS_ACCOUNTED = 8431/8431

R3_R4_R5_OVERLAP_ROWS = 4306
FRESH_ACCESS_FAILURE_WITH_DURABLE_CONTENT = 3986
DURABLE_CONTENT_ERASED = 0

URL_ENTITY_KEY_DUPLICATES = 0
OPEN_CRITICAL_DEFECTS = 0
QUALITY_SCORE = 9.6/10
```

Parser contract:
M4C TSV files are literal-tab / physical-newline records.
Double quotes are literal field characters, not CSV quote syntax.
Downstream parsing must use `QUOTE_NONE` / literal-tab mode.

```text
M4C_R1 = ACCEPTED
M4 = ACCEPTED_WITH_DECLARED_M4Q_SOURCE_LIMITATION
M5 = NEXT_PREPARATION
M6 = NOT_STARTED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M5 PRE-STEP PREPARATION.


## 2026-09-23 — M4Q R2 known-query visibility corrective enrichment

Owner explicitly authorized using the existing Yandex Marketing Bridge to enrich M4Q over the complete known query/candidate universe.

This does not claim arbitrary competitor-domain reverse-index discovery.

Two separate lanes are now explicit:

```text
KNOWN_QUERY_YANDEX_VISIBILITY = R2 corrective acquisition target
UNKNOWN_QUERY_REVERSE_INDEX_RECALL = SOURCE_UNAVAILABLE_DECLARED_LIMITATION
```

Pass A is Work-only manifest construction:
- full M2R lineage;
- all 15 M3 queries;
- all 8431 M4C candidate occurrences;
- all 5973 M4C M6 groups;
- 60 authorized competitors.

No provider calls are authorized in Pass A.

Prepared:
- M4Q_R2_QUERY_MANIFEST_AUTHORITY_2026-09-23_R1.tsv
- M4Q_R2_KNOWN_QUERY_VISIBILITY_REOPEN_GATE_2026-09-23_R1.md
- M4Q_R2_QUERY_MANIFEST_WORK_PROMPT_2026-09-23_R1.md
- M4Q_R2_QUERY_MANIFEST_EXECUTION_RELEASE_2026-09-23_R1.md
- work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R1/README.md

```text
M4Q_R2_QUERY_MANIFEST_PREPARATION = COMPLETE
M4Q_R2_QUERY_MANIFEST_WORK_START_ALLOWED = false
NEXT = REMOTE READBACK -> WORK MANIFEST BUILD
```


## 2026-09-23 — M4Q R2 query-manifest release readback PASS

Authority:
`M4Q_R2_QUERY_MANIFEST_RELEASE_READBACK_2026-09-23_R1.md`

Remote readback:
- 18/18 frozen inputs prechecked against live branch;
- authority manifest = PASS;
- reopen gate = PASS;
- Work prompt = PASS;
- execution release = PASS;
- staging = PASS;
- unexpected changed paths since accepted M4 HEAD = 0.

```text
M4Q_R2_QUERY_MANIFEST_RELEASE_READBACK = PASS
M4Q_R2_QUERY_MANIFEST_WORK_START_ALLOWED = true
M4Q_R2_PROVIDER_EXECUTION_ALLOWED = false
M5 = PAUSED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M4Q R2 PASS A WORK QUERY-MANIFEST BUILD -> MAIN CHAT RETURN QA -> BRIDGE CAPABILITY/PRICE PREFLIGHT -> PROVIDER ACQUISITION -> PASS B WORK VISIBILITY MATRIX -> DEPENDENCY RECONCILIATION -> M5.


## 2026-09-23 — M4Q R2 Pass A R1 semantic admission rework

Main Chat independent QA:

```text
R1_SOURCE_UNIVERSE_ROWS = 15542
R1_MECHANICAL_ACCOUNTING = PASS
R1_EXECUTION_QUERIES = 387
R1_M3_OR_M2R_AUTHORITY_EXECUTION_QUERIES = 77
R1_PURE_M4C_ONLY_EXECUTION_QUERIES = 310

R1_PROVIDER_MANIFEST_ACCEPTED = false
PROVIDER_EXECUTION_ALLOWED = false
```

Root correction:
competitor page/content wording is not query authority.

Pass A2 requires full-volume 15,542-row reclassification with:
- M3 exact-query authority;
- M2R observed Wordstat query authority + contamination/info-gain review;
- pure M4C-derived wording deferred to M6 demand validation or another non-execution terminal disposition.

Prepared:
- M4Q_R2_QUERY_MANIFEST_CORRECTION_AUTHORITY_2026-09-23_R2.tsv
- M4Q_R2_PASS_A_R1_MAIN_CHAT_QA_2026-09-23.md
- M4Q_R2_QUERY_MANIFEST_CORRECTION_GATE_2026-09-23_R2.md
- M4Q_R2_QUERY_MANIFEST_CORRECTION_WORK_PROMPT_2026-09-23_R2.md
- M4Q_R2_QUERY_MANIFEST_CORRECTION_RELEASE_2026-09-23_R2.md
- work_return/M4Q_R2_QUERY_MANIFEST_2026-09-23_R2/README.md

```text
M4Q_R2_PASS_A2_PREPARATION = COMPLETE
M4Q_R2_PASS_A2_WORK_START_ALLOWED = false
NEXT = REMOTE READBACK -> PASS A2 WORK
```


## 2026-09-23 — M4Q R2 Pass A2 correction release readback PASS

Authority:
`M4Q_R2_QUERY_MANIFEST_CORRECTION_RELEASE_READBACK_2026-09-23_R2.md`

```text
CORRECTION_AUTHORITY_ROWS = 24
PASS_A2_RELEASE_READBACK = PASS
M4Q_R2_PASS_A2_WORK_START_ALLOWED = true

R1_PROVIDER_MANIFEST_ACCEPTED = false
PROVIDER_EXECUTION_ALLOWED = false
M5 = PAUSED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M4Q R2 PASS A2 WORK QUERY-AUTHORITY CORRECTION -> MAIN CHAT RETURN QA -> ONLY THEN BRIDGE PRICE/CAPABILITY PREFLIGHT.


## 2026-09-23 — M4Q R2 Pass A2 Main Chat acceptance

Authority:
`M4Q_R2_PASS_A2_MAIN_CHAT_ACCEPTANCE_2026-09-23.md`

Acceptance commit:
`ccfcf23d808c80e01e65e85a48c187cf5a6581d9`

Independent Main Chat QA:

```text
RETURN_FILES = 6/6
QUERY_UNIVERSE_ROWS = 15542
EXECUTION_MANIFEST_ROWS = 45
BATCH_COUNT = 1
BATCH_SIZE = 45

R2_M3_AUTHORITY_QUERIES = 8
R2_M2R_AUTHORITY_QUERIES = 30
R2_M3_AND_M2R_AUTHORITY_QUERIES = 7
R2_PURE_M4C_ONLY_EXECUTION_QUERIES = 0

EXACT_TEXT_EXISTS_IN_M2R_OR_M3 = 45/45
DECLARED_AUTHORITY_CLASS_MATCHES_ACTUAL_SOURCE = 45/45
DECLARED_SOURCE_LOCATORS_MATCH_EXACT_QUERY = PASS
EXECUTION_QUERY_EXACT_SAFE_DUPLICATES = 0
DISTINCT_INFORMATION_GAIN_QUESTIONS = 45
PROVIDER_LIMIT_VIOLATIONS = 0

M2R_REFERENCED_SOURCE_ROWS = 60
M2R_NONEMPTY_CONTAMINATION_FLAGS = 0
SILENT_SOURCE_LOSS = 0
```

The R1 semantic admission defect is closed. Pure M4C competitor-page/content wording is not provider-ready and remains routed to M6 or another terminal non-execution disposition.

```text
M4Q_R2_PASS_A2 = ACCEPTED
R2_EXECUTION_QUERIES_ACCEPTED_FOR_PREFLIGHT = 45

PROVIDER_EXECUTION_ALLOWED = false
PROVIDER_CALLS_AUTHORIZED = 0

M5 = PAUSED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M4Q R2 PASS A2 ACCEPTED -> LIVE BRIDGE CAPABILITY / PRICE / LIFECYCLE / RAW-PERSISTENCE PREFLIGHT -> SEPARATE PROVIDER RELEASE -> YANDEX ACQUISITION -> PASS B WORK VISIBILITY MATRIX -> MAIN CHAT RECONCILIATION -> M5.


## 2026-09-23 — M4Q R2 live Bridge preflight R1

Authority:
`M4Q_R2_BRIDGE_PREFLIGHT_2026-09-23_R1.md`

Preflight record commit:
`00e514117f283e0bf668d96827589fa812399eaf`

Fresh official Yandex Search API verification:

```text
FIX_TYPO_MODE_OFF_SUPPORTED_BY_PROVIDER = true
XML_GROUPS_ON_PAGE_MAX = 100
MAX_RESULTS_PER_QUERY = 250
MAX_QUERY_CHARS = 400
MAX_QUERY_WORDS = 40

DAY_SYNC_RUB_PER_REQUEST = 0.488
DAY_DEFERRED_RUB_PER_REQUEST = 0.0305
NIGHT_SYNC_RUB_PER_REQUEST = 0.366
NIGHT_DEFERRED_RUB_PER_REQUEST = 0.02541
```

Historical local Search overlay inspection:

```text
HISTORICAL_EXTENSION_VERSION = 1.1.6
SEARCH_PROTOCOL_VERSION = 0.1.0
SYNC_WEBSEARCH = IMPLEMENTED
DEFERRED_WEBSEARCH = NOT_IMPLEMENTED
XML_FIX_TYPO_MODE = HARD_CODED_ON
BASE_MAX_RESPONSE_BYTES = 1500000
HISTORICAL_LIVE_TOP100_ACCEPTANCE = false
LIVE_INSTALLED_RUNTIME_IDENTITY = NOT_VERIFIED
```

The provider supports the Pass A2 exact-query target, but the historical overlay does not expose the accepted `FIX_TYPO_MODE_OFF` contract. Top-100 raw-evidence persistence is also not proven. The historical source checkout is dirty with unrelated server/auth/db changes and was inspected read-only.

```text
M4Q_R2_PASS_A2 = ACCEPTED
M4Q_R2_BRIDGE_PREFLIGHT_R1 = HOLD_BRIDGE_CAPABILITY_CORRECTION_REQUIRED

PROVIDER_EXECUTION_ALLOWED = false
PROVIDER_CALLS_AUTHORIZED = 0
M5 = PAUSED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M4Q R2 PASS A2 ACCEPTED -> BRIDGE CAPABILITY CORRECTION / TOP100 RAW-PERSISTENCE ACCEPTANCE -> LIVE SINGLE-PROBE GATE -> SEPARATE 45-QUERY PROVIDER RELEASE -> YANDEX ACQUISITION -> PASS B WORK VISIBILITY MATRIX -> MAIN CHAT RECONCILIATION -> M5.


## 2026-09-23 — M4Q R2 current Yandex Marketing Bridge 0.1.9 correction

Authority:
`M4Q_R2_BRIDGE_PREFLIGHT_2026-09-23_R2.md`

Superseding preflight commit:
`94bba53315afbe2427724dc813c2b5398021b0f8`

Owner supplied the current production package:
`Yandex-Marketing-Bridge-0.1.9.zip`

Package identity / static inspection:

```text
PACKAGE_VERSION = 0.1.9
ZIP_BYTES = 232456
ZIP_SHA256 = de4425a47645d537ef7b69994ef2df0f66c3e9bd6741b0b47884426bdd954c4c
JS_SYNTAX_PASS = 62/62

SEARCH_ASYNC_BATCH_API_V1 = PRESENT
WEB_SEARCH_ASYNC_ENDPOINT = /v2/web/searchAsync
OPERATION_API_COLLECTION = PRESENT
ASYNC_PROVIDER_HOST_PERMISSION = PRESENT
ASYNC_PROVIDER_ENABLED_BY_MANIFEST = true

ASYNC_MAX_JOB_ITEMS = 1500
ASYNC_MAX_SLICE = 25
ASYNC_MAX_RESPONSE_BYTES = 8 MiB
ASYNC_NORMALIZER_MAX_RESULTS = 250
MIN_FIRST_POLL_MS = 300000
```

The 0.1.9 protocol was executed locally with a synthetic 45-query job shape and proved:

```text
FIX_TYPO_MODE_OFF = PASS
GROUPS_ON_PAGE_100 = PASS
GROUP_MODE_FLAT = PASS
DOCS_IN_GROUP_1 = PASS
REGION_225 = PASS
PAGE_0 = PASS
SORT_RELEVANCE_DESC = PASS
SUBMIT_URL = https://searchapi.api.cloud.yandex.net/v2/web/searchAsync
```

Therefore the preceding R1 hold was caused by inspecting the obsolete historical 1.1.6 overlay and is superseded.

Fresh official tariff:

```text
DAY_DEFERRED_RUB_PER_REQUEST = 0.0305
NIGHT_DEFERRED_RUB_PER_REQUEST = 0.02541
DAY_SYNC_RUB_PER_REQUEST = 0.488
NIGHT_SYNC_RUB_PER_REQUEST = 0.366

M4Q_45_QUERY_DAY_DEFERRED_ESTIMATE_RUB = 1.3725
M4Q_45_QUERY_NIGHT_DEFERRED_ESTIMATE_RUB = 1.14345
```

```text
M4Q_R2_PASS_A2 = ACCEPTED
M4Q_R2_BRIDGE_PREFLIGHT_R1 = SUPERSEDED
M4Q_R2_BRIDGE_PREFLIGHT_R2 = PASS_CURRENT_ASYNC_PACKAGE_CAPABILITY

PREFERRED_PROVIDER_MODE = DEFERRED_ASYNC
PAID_PROVIDER_CALLS_EXECUTED = 0

M5 = PAUSED
M7 = BLOCKED
```

CURRENT_CURSOR:
M4 ACCEPTED -> M4Q R2 PASS A2 ACCEPTED -> CURRENT BRIDGE 0.1.9 ASYNC PREFLIGHT PASS -> CREATE/READBACK 45-QUERY DURABLE ASYNC JOB (NO PROVIDER CALL) -> FRESH TARIFF CHECK -> BOUNDED submitN -> EXPLICIT COLLECT -> COMPLETE EXPORT -> PASS B WORK VISIBILITY MATRIX -> MAIN CHAT RECONCILIATION -> M5.


## 2026-09-23 — M4Q R2 45-item deferred Search local-start release

Authority:
`M4Q_R2_ASYNC_ACQUISITION_START_RELEASE_2026-09-23_R1.md`

Release commits:
- create: `c99ee3359d7236dbfbcdec0756b11f57afbb0f46`
- exact command freeze: `fef050374a0c14b9bac39edc4389303596a4dfd5`

Frozen execution:

```text
JOB_ID = octoport-m4q-r2-b001-20260923
PROTOCOL = SEARCH_ASYNC_BATCH_API_V1
QUERY_COUNT = 45
GROUPS_ON_PAGE = 100
FIX_TYPO_MODE = OFF
MAX_REQUESTS = 45
MAX_COST_RUB = 1.3725

LOCAL_STARTS_ALLOWED_NOW = 1
PROVIDER_SUBMITS_ALLOWED_NOW = 0
PROVIDER_COLLECTIONS_ALLOWED_NOW = 0
LOCAL_EXPORTS_ALLOWED_NOW = 0
```

The 45 query-level information-gain/provenance contracts remain those independently accepted in Pass A2. Grouping them into one durable async job follows the already accepted KW-002 YMB 0.1.9 grouped-queue execution pattern and does not collapse item identity.

Expected local-start result is 45 PENDING items with zero provider calls, but only the actual returned `SEARCH_ASYNC_BATCH_RESULT_V1` is execution authority.

CURRENT_CURSOR:
M4Q R2 PASS A2 ACCEPTED -> ONE 45-ITEM ASYNC LOCAL START RELEASED -> ACTUAL START RESULT REQUIRED -> PERSIST/READBACK -> FRESH TARIFF CHECK -> SEPARATE submitN RELEASE -> COLLECT -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 45-item async start PASS / first submit slice released

Raw start authority:
`raw/M4Q_R2_01_START_2026-09-23.md`

Release authority:
`M4Q_R2_ASYNC_START_ACCEPTANCE_AND_SUBMIT_RELEASE_2026-09-23_R1.md`

Observed local start:

```text
JOB_ID = octoport-m4q-r2-b001-20260923
TOTAL = 45
PENDING = 45
WAITING = 0
FAILED = 0
UNKNOWN = 0
REQUEST_EXECUTED = false
PROVIDER_CALLS = 0
REVISION = 0
REMOTE_READBACK = PASS
```

Fresh official deferred price check immediately before provider release:

```text
DAY_DEFERRED_RUB_PER_REQUEST = 0.0305
FULL_45_SUBMIT_CEILING_RUB = 1.3725
CURRENT_PRICING_WINDOW_AT_CHECK = DAY
```

Released exactly one provider action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

```text
FIRST_SUBMITN_COMMANDS_ALLOWED_NOW = 1
FIRST_SUBMITN_COUNT_LIMIT = 25
SECOND_SUBMITN_ALLOWED_NOW = 0
COLLECT_ALLOWED_NOW = 0
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
M4Q R2 PASS A2 ACCEPTED -> 45-ITEM LOCAL START PASS -> FIRST submitN(25) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> REMAINING SUBMIT SLICE -> COLLECT -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 first async submit slice PASS / remainder released

Raw slice-1 authority:
`raw/M4Q_R2_02_SUBMIT_SLICE1_2026-09-23.md`

Release authority:
`M4Q_R2_ASYNC_SUBMIT_SLICE1_ACCEPTANCE_AND_SLICE2_RELEASE_2026-09-23_R1.md`

Observed first submit slice:

```text
PROVIDER_CALLS_THIS_ACTION = 22
PROCESSED = 22
BOUNDED_STOP = true
WAITING = 22
PENDING = 23
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REQUESTS_STARTED = 22
OPERATIONS_ACCEPTED = 22
REVISION = 44
REMOTE_READBACK = PASS
```

Fresh official deferred tariff rechecked immediately before the remainder release:

```text
DAY_DEFERRED_RUB_PER_REQUEST = 0.0305
ALREADY_ACCEPTED_SUBMIT_CEILING_RUB = 0.671
REMAINING_23_SUBMIT_CEILING_RUB = 0.7015
FULL_45_SUBMIT_CEILING_RUB = 1.3725
```

Released exactly one remaining-submit action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":23}
```

```text
REMAINING_SUBMITN_COMMANDS_ALLOWED_NOW = 1
REMAINING_SUBMITN_COUNT_LIMIT = 23
COLLECT_ALLOWED_NOW = 0
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
M4Q R2 PASS A2 ACCEPTED -> 45-ITEM LOCAL START PASS -> FIRST SUBMIT SLICE 22 ACCEPTED / 23 PENDING -> REMAINING submitN(23) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> COLLECT PHASE -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 early collect deviation reconciled / remaining submits re-released

Observed deviation:
`raw/M4Q_R2_03_EARLY_COLLECT_2026-09-23.md`

Continuation authority:
`M4Q_R2_EARLY_COLLECT_ACCEPTANCE_AND_REMAINING_SUBMIT_RELEASE_2026-09-23_R1.md`

Observed state:

```text
PENDING = 23
WAITING = 21
SUCCEEDED = 1
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REQUESTS_STARTED = 22
OPERATIONS_ACCEPTED = 22
POLLS_STARTED = 1
REVISION = 47
```

Interpretation:
one already-submitted operation was collected successfully before submit-phase closure. No data loss, no replay and no ambiguous state occurred. The 23 not-yet-submitted items remain cleanly PENDING.

Released exactly one continuation action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":23}
```

```text
REMAINING_SUBMITN_COMMANDS_ALLOWED_NOW = 1
REMAINING_SUBMITN_COUNT_LIMIT = 23
COLLECT_ALLOWED_NOW = 0
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
M4Q R2 PASS A2 ACCEPTED -> 22 SUBMITTED -> 1 EARLY COLLECT SUCCEEDED -> 23 PENDING -> submitN(23) RE-RELEASED -> ACTUAL RESULT REQUIRED -> SUBMIT-PHASE CLOSURE -> COLLECTION -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 collection batch 1 released

Latest durable async state:

```text
TOTAL = 45
REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 3
PENDING = 1
WAITING = 41
SUCCEEDED = 3
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REVISION = 97
```

Operator order now frozen:

```text
DO NOT SUBMIT LAST PENDING ITEM YET
FIRST COLLECT ALREADY-SUBMITTED OPERATIONS
```

Released exactly one action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

CURRENT_CURSOR:
44 SUBMITTED / 3 SUCCEEDED / 41 WAITING / 1 PENDING -> ONE collectN(25) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> NEXT COLLECTION SWEEP.


## 2026-09-23 — M4Q R2 collection batch 1 result accepted / batch 2 released

Observed batch-1 collection:

```text
PROVIDER_CALLS_THIS_ACTION = 10
PROCESSED = 10
NORMALIZED = 10
BOUNDED_STOP = true

PENDING = 1
WAITING = 31
SUCCEEDED = 13
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 13
REVISION = 127
```

Remote readback = PASS.

Released exactly one next collection action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":25}
```

```text
LAST_PENDING_SUBMIT_ALLOWED_NOW = 0
COLLECT_BATCH2_COMMANDS_ALLOWED_NOW = 1
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
44 SUBMITTED / 13 SUCCEEDED / 31 WAITING / 1 PENDING -> ONE collectN(25) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> NEXT COLLECTION SWEEP.


## 2026-09-23 — M4Q R2 collection batch 2 result accepted / batch 3 released

Observed batch-2 collection:

```text
PROVIDER_CALLS_THIS_ACTION = 13
PROCESSED = 13
NORMALIZED = 13
BOUNDED_STOP = true

PENDING = 1
WAITING = 18
SUCCEEDED = 26
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 26
REVISION = 166
```

Remote readback = PASS.

Released exactly one next collection action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":18}
```

```text
LAST_PENDING_SUBMIT_ALLOWED_NOW = 0
COLLECT_BATCH3_COMMANDS_ALLOWED_NOW = 1
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
44 SUBMITTED / 26 SUCCEEDED / 18 WAITING / 1 PENDING -> ONE collectN(18) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> NEXT COLLECTION SWEEP.


## 2026-09-23 — M4Q R2 collection batch 3 result accepted / batch 4 released

Observed batch-3 collection:

```text
PROVIDER_CALLS_THIS_ACTION = 12
PROCESSED = 12
NORMALIZED = 12
BOUNDED_STOP = true

PENDING = 1
WAITING = 6
SUCCEEDED = 38
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0

REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 38
REVISION = 202
```

Remote readback = PASS.

Released exactly one next collection action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"collectN","jobId":"octoport-m4q-r2-b001-20260923","count":6}
```

```text
LAST_PENDING_SUBMIT_ALLOWED_NOW = 0
COLLECT_BATCH4_COMMANDS_ALLOWED_NOW = 1
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
44 SUBMITTED / 38 SUCCEEDED / 6 WAITING / 1 PENDING -> ONE collectN(6) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> FINAL PENDING DECISION.


## 2026-09-23 — M4Q R2 first 44 items terminal-successful / final pending submit released

Current durable state before final submit:

```text
TOTAL = 45
REQUESTS_STARTED = 44
OPERATIONS_ACCEPTED = 44
POLLS_STARTED = 44
PENDING = 1
WAITING = 0
SUCCEEDED = 44
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REVISION = 220
```

All 44 already-submitted async operations are terminal-successful and normalized.

Fresh official Yandex Search API pricing rechecked immediately before the final paid submit:

```text
DAY_DEFERRED_RUB_PER_REQUEST = 0.0305
ONE_FINAL_SUBMIT_CEILING_RUB = 0.0305
FULL_45_SUBMIT_CEILING_RUB = 1.3725
```

Released exactly one final submit action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"submitN","jobId":"octoport-m4q-r2-b001-20260923","count":1}
```

```text
FINAL_SUBMIT_COMMANDS_ALLOWED_NOW = 1
FINAL_SUBMIT_COUNT = 1
COLLECT_ALLOWED_NOW = 0
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
44/45 SUCCEEDED / 1 PENDING -> FINAL submitN(1) RELEASED -> ACTUAL RESULT REQUIRED -> PERSIST/READBACK -> WAIT UNTIL DUE -> FINAL collectN(1) -> 45/45 TERMINAL -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 submit phase closed / final deferred wait gate

Final submit result:

```text
PENDING = 0
WAITING = 1
SUCCEEDED = 44
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 44
REVISION = 222
FINAL_WAITING_INDEX = 44
FINAL_OPERATION_ID = sprg7lkstbo8aa72re2l
```

Remote readback = PASS.

```text
SUBMIT_PHASE = CLOSED
FURTHER_SUBMIT = FORBIDDEN
FINAL_COLLECT = WAIT_FOR_BRIDGE_DUE_TIME
EXPORT_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
45/45 SUBMITTED -> 44 SUCCEEDED / 1 WAITING -> MINIMUM 5-MINUTE DEFERRED POLL GATE -> FINAL collectN(1) -> 45/45 TERMINAL -> EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 provider acquisition terminal 45/45 / export page 1 released

Terminal provider state:

```text
TOTAL = 45
PENDING = 0
WAITING = 0
SUCCEEDED = 45
FAILED = 0
PARSE_FAILED = 0
UNKNOWN = 0
UNRESOLVED = 0
ALL_SUCCESSFUL = true
REQUESTS_STARTED = 45
OPERATIONS_ACCEPTED = 45
POLLS_STARTED = 45
REVISION = 225
```

Provider phase:
```text
SUBMIT_ALLOWED = 0
COLLECT_ALLOWED = 0
PROVIDER_CALLS_REMAINING = 0
```

Released exactly one local export action:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"exportPage","jobId":"octoport-m4q-r2-b001-20260923","after":-1,"revision":225,"limit":25}
```

```text
EXPORT_PAGE1_COMMANDS_ALLOWED_NOW = 1
EXPORT_CONTINUATION_ALLOWED_NOW = 0
PASS_B_ALLOWED_NOW = 0
```

CURRENT_CURSOR:
45/45 TERMINAL SUCCESS -> EXPORT PAGE 1 RELEASED -> ACTUAL EXPORT RESULT + FILE REQUIRED -> PERSIST/READBACK -> CONTINUATION EXPORT BY ACTUAL next_after -> COMPLETE EXPORT -> PASS B.


## 2026-09-23 — M4Q R2 export page 1 verified / page 2 released

Verified page 1:

```text
FILE = search-octoport-m4q-r2-b001-20260923-r225-0-24.json
SIZE_BYTES = 9207000
SHA256 = 4e9890bfba1006e116523701d61d0edfc82f6305b68d412101eb5f4aaec4aeb7
REVISION = 225
ITEMS = 25
INDICES = 0..24
NORMALIZED_ROWS = 2500
NEXT_AFTER = 24
HAS_MORE = true
REMOTE_READBACK = PASS
```

Released exactly one continuation export:

```text
SEARCH_ASYNC_BATCH_API_V1 {"action":"exportPage","jobId":"octoport-m4q-r2-b001-20260923","after":24,"revision":225,"limit":25}
```

CURRENT_CURSOR:
45/45 TERMINAL SUCCESS -> EXPORT PAGE 1 VERIFIED (0..24) -> EXPORT PAGE 2 RELEASED (after=24) -> SECOND FILE REQUIRED -> VERIFY COMPLETE 0..44 -> PERSIST/READBACK -> PASS B.
