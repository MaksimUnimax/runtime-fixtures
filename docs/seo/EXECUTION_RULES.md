# Octoport SEO — execution rules

Status: **ACTIVE / OWNER-LOCKED / CURRENT PROCESS AUTHORITY**.
Date: 2026-09-16.

Adapted from the current KW-002 universal method on `MaksimUnimax/Yandex_direct`, branch `roadmap/kwork-productization-2026-08-28`, verified at commit `1f56a5ad3d7086c0930882c49b105e6cafe5b8d4`.

These rules are local Octoport authority. Future execution must not depend on remembering KW-002 or reopening that repository to know the basic process.

Companion authorities:

- `SEO_MASTER_ROADMAP_2026-09-16.md`;
- `WORK_HANDOFF_RULE.md`;
- `STAGE_GATES_M0_M7.md`;
- `PRODUCT_TRUTH.md`;
- `EXTERNAL_METHOD_RESEARCH_2026-09-16.md`.

## 0. Two-level authority model — OWNER-LOCKED

~~~text
LEVEL 1 = universal mandatory rules for the whole SEO program
LEVEL 2 = methodology/gates/contract for the exact roadmap step
work/evidence/state/results = factual execution data, not LEVEL 2
~~~

Canonical indexes:
- LEVEL1/README.md
- LEVEL2/README.md

Before any material step or material step preparation:
~~~text
RESTORE CONTEXT
-> VERIFY LIVE GITHUB HEAD
-> READ LEVEL 1
-> READ APPLICABLE LEVEL 2
-> READ CURRENT WORK/EVIDENCE/STATE
-> READ FAILURE HISTORY
-> FRESH EXTERNAL METHOD CHECK WHERE REQUIRED
-> FREEZE EXACT INPUTS/OUTPUTS/SCHEMA/QA/STOP RULES
-> RECORD IN GITHUB
-> REMOTE READBACK
-> ONLY THEN PREPARE/EXECUTE
~~~

If applicable LEVEL 2 is missing/stale/contradictory/unread, preparation, Work prompt, Bridge/provider, execution, QA acceptance and cursor advance are forbidden.

Memory, summary, earlier-step rules or job results do not substitute for live LEVEL 1 + exact LEVEL 2.

## 1. Roles

```text
MAIN CHAT = architect / method controller / evidence collector / provider command author / return QA / owner communication
YANDEX MARKETING BRIDGE = provider evidence acquisition / lifecycle / persistence transport
CHATGPT WORK = large-data execution / full-volume transformation / systematization / artifact generation under frozen rules
OWNER = product/business truth / authorization / Work prompt relay / final commercial decisions
```

Bridge does not decide SEO strategy. Work does not create new methodology. Main Chat controls method and accepts/rejects Work output.

## 1A. GitHub-first persistence — OWNER-LOCKED

The repository is the durable project memory. Chat is control/communication only.

```text
CHAT != STORAGE
LOCAL/SANDBOX FILE != ACCEPTED PROJECT STATE
WRITTEN IN CHAT != PERSISTED
```

For every material change to roadmap, rules, evidence, analysis, progress, acceptance state or current cursor:

```text
CREATE/UPDATE REPOSITORY ARTIFACT
-> COMMIT TO CURRENT AUTHORIZED BRANCH
-> UPDATE REF FAST-FORWARD ONLY
-> REMOTE READBACK / VERIFY
-> ONLY THEN REPORT AS SAVED/ACCEPTED
```

Hard requirements:

- do not leave the only copy of a project change in chat, a writing block, local sandbox or temporary generated file;
- when Main Chat creates or changes a project document, publish that exact change to GitHub in the same work cycle whenever repository write access is available;
- if publication is technically impossible, label the result `NOT PERSISTED / NOT ACCEPTED` and do not claim the repository was updated;
- never substitute “I wrote it in chat” for repository persistence;
- append/update the relevant durable authority rather than relying on conversational memory;
- use fast-forward Git publication; no force-push;
- after every write, read back the remote branch/file/commit before continuing dependent work.

This repeats an existing project principle deliberately because failure to persist a roadmap correction outside chat creates authority drift and causes the next session to restore stale state.

## 2. Goal-first before every major stage

Before a major stage, restore explicitly:

```text
WHOLE PRODUCT/SEO GOAL
FULL ROADMAP
WHAT IS ACTUALLY COMPLETE
WHAT REMAINS
CURRENT STAGE GOAL
PROBLEM THE STAGE SOLVES
EXACT OUTPUT REQUIRED
```

Technical activity does not equal stage completion.

```text
API CALL != STAGE PASS
FILE EXISTS != STAGE PASS
COMMIT EXISTS != STAGE PASS
PROVIDER SUCCESS != STAGE PASS
```

## 3. Product/source scope is frozen authority

Product truth, allowed evidence sources, geography and current public product state must be explicit before dependent analysis.

A material upstream change requires dependency reconciliation:

```text
MATERIAL AUTHORITY CHANGE
-> identify dependent artifacts/decisions
-> invalidate only affected downstream PASS states
-> rerun/reconcile affected work
-> re-accept
```

Do not silently rewrite old evidence or pretend an earlier state never existed.

## 4. Evidence classes remain separate

Material claims must distinguish at least:

```text
PRODUCT / OWNER FACT
WORDSTAT / PROVIDER OBSERVATION
CURRENT ORDINARY SERP OBSERVATION
PUBLIC COMPETITOR-PAGE OBSERVATION
ALICE / AI-SEARCH OBSERVATION
PROJECT DERIVATION / ANALYST JUDGMENT
UNKNOWN / HOLD
IMPLEMENTED
MEASURED
```

Forbidden equivalences:

```text
WORDSTAT PHRASE != PRODUCT RELEVANCE
COMPETITOR PAGE TOPIC != PROVEN DEMAND
ONE SERP APPEARANCE != SEARCH-COMPETITOR AUTHORITY
SERP OVERLAP != AUTOMATIC SAME PAGE
ALICE TOPIC != AUTOMATIC NEW PAGE
OWNER IDEA != SEARCH DEMAND
```

## 5. Fresh external research before every major stage

Before material execution of a major stage:

```text
DEFINE CURRENT METHOD/PROVIDER QUESTIONS
-> FRESH WEB RESEARCH
-> OFFICIAL/PRIMARY SOURCES FIRST
-> INDUSTRY CORROBORATION WHERE OFFICIAL DOCS DO NOT DEFINE ANALYTICAL METHOD
-> COMPARE WITH PROJECT METHOD
-> RECORD SOURCE->METHOD TRACE
-> DISCLOSE CLICKABLE SOURCES + SUPPORTED CLAIMS TO OWNER
-> ONLY THEN EXECUTE
```

Changing claims such as provider schema, limits, pricing, Search/Alice features and current SEO/search-engine guidance must be refreshed.

If no adequate external source exists, record the gap and classify the method as project-test evidence, owner rule or analyst heuristic. Never fabricate external authority.

## 6. Source -> method -> execution trace

Every material rule/decision should be expressible as:

```text
METHOD ELEMENT
-> SOURCE / PROJECT EVIDENCE / OWNER RULE
-> EXACT CLAIM SUPPORTED
-> PROJECT-SPECIFIC APPLICATION
-> EXECUTABLE ACTION / ARTIFACT FIELD
-> FAILURE POLICY
-> CLAIM BOUNDARY
-> PASS/FAIL/HOLD CHECK
```

Research is not operationalized until it changes a real action, field, QA check or claim boundary.

## 7. Provider/Bridge pre-command gate

Before a paid/limited/provider action, state and verify:

```text
ACTIVE SERVICE
EXECUTION MODE
EXACT QUESTION BEING RESOLVED
WHY EXISTING DURABLE EVIDENCE IS INSUFFICIENT
EXPECTED INFORMATION GAIN
REQUEST/DEPTH/REGION/DEVICE/OPERATOR PARAMETERS
MAX REQUEST/COST BOUND WHEN MATERIAL
RETRY / UNKNOWN-OUTCOME BOUNDARY
WHERE THE RESULT WILL BE SAVED
WHICH LATER DECISION USES IT
```

Provider availability is not a reason to call it.

Cost matters, but evidence quality has priority over trivial request savings. More requests are not automatically better.

## 8. Official provider docs and Bridge capability are separate proofs

For provider stages verify both:

```text
CURRENT OFFICIAL PROVIDER CONTRACT
AND
CURRENT BRIDGE IMPLEMENTATION / ACCEPTED PROJECT CAPABILITY
```

Neither substitutes for the other.

## 9. Full evidence persistence before the next provider action

Hard order for substantive provider output:

```text
RECEIVE COMPLETE RESPONSE / EXPORT
-> DURABLY PERSIST REQUIRED FACTUAL BODY + PROVENANCE
-> REMOTE READBACK
-> VERIFY ID/PARAMETERS/FIELDS/ROW COUNTS/STATUS
-> ONLY THEN ANALYZE / RELEASE NEXT PROVIDER ACTION
```

Chat is transport, not project storage.

For Wordstat, preserve the complete bridge envelope and every returned `results[]`, `associations[]`, `totalCount`, error body and service/request fields actually returned.

For Search/Deferred Search, preserve lifecycle envelopes and the complete required normalized export/provenance. Exact provider operation identity must remain traceable.

## 10. No blind retry and exact outcome semantics

Never convert execution safety into semantic evidence.

```text
NO_RETRY != NEGATIVE EVIDENCE
TECHNICAL FAILURE != ZERO DEMAND
PENDING/WAITING != ZERO RESULTS
OUTCOME UNKNOWN != FAILED MARKET DEMAND
```

For asynchronous operations:

```text
accepted operation -> preserve operation_id -> poll/collect same operation -> do not resubmit blindly
```

Unknown/incomplete states remain unresolved until separately reconciled/released.

## 11. Data layers are non-interchangeable

Octoport uses these conceptual layers:

```text
RAW_PROVIDER_EVIDENCE
NORMALIZED_UNIQUE_EVIDENCE
SANITIZED_CANDIDATES
REVIEW/HOLD
EXCLUDED_HISTORY
WORKING / ACTIVE CANDIDATES
SERP/COMPETITOR/ALICE EVIDENCE
SEMANTIC_MASTER
CLUSTERS
PAGE_OWNERSHIP / IA
IMPLEMENTATION
MEASUREMENT
```

Raw evidence is immutable history. Later layers may collapse analytically but must retain lineage.

## 12. Conservative normalization and sanitation

Hard semantic rules:

```text
SUBSTRING/PREFIX MATCH != LEXEME PROOF
TOKEN MATCH != REFERENT PROOF
REFERENT PROOF != INTENT PROOF
POSITIVE PRODUCT TOKEN DOES NOT OVERRIDE EXPLICIT FOREIGN CONTEXT
LOW FREQUENCY ALONE != EXCLUDE
HIGH FREQUENCY ALONE != KEEP
MATERIAL AMBIGUITY -> HOLD
```

Exact/safe duplicate collapse is analytical only; original raw evidence remains recoverable.

## 13. Seed/probe is not final SEO truth

```text
SEED != FINAL KEYWORD
SEED != FINAL INTENT
SEED != CLUSTER
SEED != PAGE
```

Every discovery probe must have a named information purpose. High-noise broad probes need a refinement/control role. Business vocabulary coverage and search-language discovery coverage are separate QA dimensions.

## 14. Acquisition depth is a semantic coverage decision

Never choose result depth because it is:

- convenient for chat;
- used in an old job;
- the provider maximum;
- the smallest value that technically succeeds.

Depth must be justified by the current information question and truncation risk.

```text
LARGE RESULT != LOWER DEPTH
```

If justified acquisition produces large data, preserve it and use Work for full-volume transformation.

## 15. Targeted expansion requires information gain

A new acquisition candidate is allowed only after:

```text
NAME EXACT OPEN QUESTION
-> RECONCILE AGAINST ALL DURABLE EVIDENCE
-> SEPARATE OWNER FACT FROM SEARCH-DEMAND QUESTION
-> PROVE INCREMENTAL INFORMATION GAIN
-> DEFINE POSITIVE / VALID-ZERO / FAILURE / UNKNOWN MEANING
-> DEFINE REQUEST/DEPTH/STOP/REOPEN CONTRACT
-> EXECUTE
-> PERSIST/READBACK
-> NORMALIZE/SANITIZE BEFORE ACCEPTED UNION
```

No recursive related-query collection merely because additional queries exist.

## 16. Mechanical QA != semantic QA

Counts, schema validity and deterministic processing are necessary but not sufficient.

```text
ACCOUNTING QA != SEMANTIC QA
SELF-SCORE != INDEPENDENT ACCEPTANCE
```

When semantic rules or data scale can create systematic bias, use an independent/adversarial diagnostic. It must not simply replay the producer's own rules.

## 17. Fix the mechanism, not the example

A bad example is a regression fixture, not the patch target.

```text
OBSERVED DEFECT
-> ROOT CAUSE
-> BLAST RADIUS
-> PRODUCER/RULE FIX
-> RERUN COMPLETE AFFECTED UNIVERSE
-> KNOWN-EXAMPLE REGRESSION
-> SIBLING-CHANGE REPORT
```

Manual one-row patches do not close a systematic defect.

## 18. Preliminary families are not final pages

Any early topic/task grouping is explicitly provisional.

```text
PRELIMINARY FAMILY != FINAL INTENT
PRELIMINARY FAMILY != SERP CLUSTER
PRELIMINARY FAMILY != PAGE OWNERSHIP
PRELIMINARY FAMILY != IA
```

Final page decisions require user task + product answer + current SERP behavior and later Search-vs-Alice reconciliation where material.

## 19. Search-only baseline before Alice reconciliation

The project must be able to show the ordinary Search-derived architecture/evidence independently before Alice evidence changes or enriches it.

```text
SEARCH BASELINE
-> ALICE EVIDENCE
-> RECONCILE AS CHANGE | ENRICH | DE-RISK | NO-CHANGE | HOLD
```

A supported `NO_CHANGE` is a valid result. We do not manufacture AI-specific pages to justify the AI stage.

## 20. Search competitor != business rival

Search competitors are discovered from recurring current ranking evidence across representative queries.

Owner-known brands can be context, but do not become search competitors without current SERP evidence.

## 21. Current authority vs history

For every stage keep one clear current authority. Superseded evidence remains preserved as history but must not silently feed current decisions.

If upstream authority changes materially, dependent downstream decisions are explicitly reopened.

## 22. Work is mandatory when large-data quality risk appears

The detailed contract is in `WORK_HANDOFF_RULE.md`.

Hard principle:

```text
LARGE DATA
!= SAMPLE
!= FIRST-N
!= SUMMARY BEFORE FULL ANALYSIS

LARGE DATA
-> CHATGPT WORK WITH COMPLETE EXECUTION UNIT
```

The Work trigger is quality-based, not a fixed row count.

## 23. Large artifacts are not transported through model text by default

When Work creates large TSV/CSV/JSON/XLSX/PDF/ZIP or similar artifacts, do not print/base64/split the entire file through chat/tool arguments merely for transport.

Preferred publication:

1. native authenticated Git when reliable;
2. otherwise owner file relay/upload;
3. remote readback/identity QA after publication.

A Git-auth failure does not invalidate a valid local analytical result and does not authorize recomputation.

## 24. Work/base freshness

Before Work starts:

```text
FETCH CURRENT REMOTE BRANCH
RECORD LIVE HEAD
VERIFY CURRENT RULES/PROMPT/UPSTREAM AUTHORITIES
```

Before Work output is published:

```text
RECHECK REMOTE HEAD
IF REMOTE ADVANCED -> classify changed paths -> reconcile mutable state/method authorities -> rerun affected QA if governing rules changed
```

Never overwrite newer mutable authority from a stale Work workspace.

## 25. Work output is not automatically accepted

After Work returns:

```text
VERIFY SOURCE MANIFEST
VERIFY COUNTS / JOINS / LINEAGE
VERIFY REQUIRED FIELDS
INSPECT HOLD / ERROR / UNRESOLVED
COMPARE AGAINST STEP CONTRACT
PERSIST ACCEPTED ARTIFACTS
REMOTE READBACK
INDEPENDENT RETURN QA
ONLY THEN MARK STEP COMPLETE
```

## 26. Mandatory owner-facing plain language

Major stage reports must explain in normal Russian:

- зачем шаг нужен;
- что реально выполнено;
- что получено;
- можно ли идти дальше;
- если нельзя — что мешает;
- какое следующее физическое действие.

Hashes/IDs/status dumps may be shown separately but never replace the explanation.

## 27. Quality score after every major stage

Use ten independent 0–10 dimensions:

1. goal/output completeness;
2. method/source support;
3. input evidence/provenance integrity;
4. coverage/completeness;
5. analytical correctness/claim boundaries;
6. adversarial QA quality;
7. persistence/readback/reproducibility;
8. owner/client usability/plain language;
9. information gain/cost/execution efficiency;
10. downstream readiness.

```text
QUALITY_TOTAL = sum / 100
QUALITY_SCORE = QUALITY_TOTAL / 10
```

PASS candidate requires:

```text
QUALITY_TOTAL >= 90/100
QUALITY_SCORE >= 9.0/10
ALL HARD GATES PASS
NO OPEN CRITICAL DEFECT
```

Score never overrides a hard failure. Later evidence may invalidate an earlier PASS; preserve history and rescore.

## 28. Fail closed

When a material claim lacks evidence:

```text
DO NOT GUESS
-> HOLD / REVIEW / EVIDENCE_REQUIRED / SEARCH_REQUIRED / OWNER_FACT_REQUIRED
```

Completeness must not erase uncertainty.

## 29. Isolation from parallel product development

Until an explicit implementation handoff:

```text
SEO STREAM WRITES ONLY docs/seo/**
SERVER / EXTENSION / SITE IMPLEMENTATION = DO NOT TOUCH
```

Before eventual implementation/merge, refresh current main and check overlap with parallel work.

## 29A. Full-chain decision verification — OWNER-LOCKED

Before Main Chat states a material fact, identifies an artifact, advances a cursor, prepares a next step, writes to GitHub, or tells the owner to upload/use a file, the conclusion must pass the complete verification chain:

```text
USER/MD/HISTORY CLAIM
-> LIVE GITHUB HEAD / CURRENT AUTHORITY
-> EXACT ARTIFACT IDENTITY (name + manifest/work_id + hash/blob/row identity where available)
-> APPLICABLE LEVEL 1 / LEVEL 2 RULE
-> AUTHORITY CONTINUITY / DEPENDENCY CHECK
-> ONLY THEN ACTION OR OWNER-FACING CONCLUSION
```

Hard requirements:

- never identify an artifact from filename resemblance alone;
- for ZIP/file handoff, inspect the actual manifest or contained file set before saying "this is the one";
- never invent or infer a chat URL, artifact URL, repository path, branch, timestamp or source location from adjacent evidence;
- a remembered or copied conversation link does not become the target link unless the exact target artifact/conversation is verified;
- if one link in the chain is unavailable, return `HOLD / EVIDENCE_REQUIRED` rather than guessing;
- when two sources conflict, stop and reconcile before any dependent action;
- large-data rules remain in force: this verification gate does not authorize Main Chat to process a large corpus that belongs in Work;
- after every material conclusion, preserve the evidence path sufficient for the next session to reproduce why the conclusion was allowed.

Regression fixture:
the 2026-09-22 M4B1 R3 recovery incident demonstrated that a transient Work/chat attachment was treated as durable authority and later a different archive was misidentified from context without opening its manifest. Both behaviors are forbidden.

## 30. Major-stage closure gate

A stage closes only when:

```text
DECLARED OUTPUT EXISTS
REQUIRED EVIDENCE IS DURABLE
REMOTE READBACK PASSES
HARD STEP GATES PASS
KNOWN FAILURE REGRESSIONS PASS
QUALITY_SCORE >= 9.0/10 AND TOTAL >= 90/100
NO CRITICAL DEFECT OPEN
NEXT_STEP_ALLOWED IS EXPLICIT
OWNER-FACING SUMMARY IS CLEAR
```
