# Octoport SEO — execution failure ledger

Status: **ACTIVE / APPEND-ONLY**.

Purpose: preserve concrete execution incidents separately from universal rules. Generalized controls live in `EXECUTION_RULES.md`, `PROVIDER_QUERY_RELEASE_RULE.md`, `WORK_HANDOFF_RULE.md` and stage gates.

## OSEO-F01 — S03 local start issued before per-query pre-step/release

Date: 2026-09-16.
Stage: M3 ordinary Yandex SERP collection.
Query: `ии агент для wildberries`.

### Incident

After S02 was closed, Main Chat released and the owner executed the local S03 `start` before Main Chat had shown and durably materialized a query-specific fresh-research / source-disclosure / information-gain release contract.

Observed start outcome:

```text
request_executed = false
provider_calls = 0
PENDING = 1
revision = 0
```

Raw evidence: `serp/raw/S03_01_START_2026-09-16.md`.

### Root cause

Main Chat incorrectly treated the already-passed generic M3 stage pre-step as automatic authorization for every later query inside M3.

### Why this is wrong

A new provider-backed query can change semantic, competitor, marketplace-split and page-intent decisions. Under the transferred KW-002 discipline, each such query needs a bounded release with fresh method/provider research, source disclosure, information-gain/outcome contract, Bridge capability check, Work trigger, hard gates and durable readback before the first lifecycle command.

### Impact

No Yandex Search provider request occurred and no Search cost was incurred because `start` was local-only. No provider result or operation identity exists for S03 yet. The analytical evidence base is not contaminated.

### Recovery

```text
STOP BEFORE submitN
-> preserve/readback local-start evidence
-> perform fresh S03 external research
-> owner-facing source disclosure + method analysis
-> persist/readback S03 release
-> only then allow continuation of the existing local job
```

Do not recreate the local job just to erase the process history.

### Permanent prevention

`PROVIDER_QUERY_RELEASE_RULE.md` now makes a per-query release mandatory before any Bridge lifecycle command, including local-only `start`.

### Status

`RECOVERY IN PROGRESS / PROVIDER SUBMIT BLOCKED UNTIL S03 RELEASE GATE PASS`.


## OSEO-F02 — M1 public read-only check started before durable M1 pre-step gate

Date: 2026-09-23.
Stage: M1 current-site + measurement baseline.

### Incident

After M6 internal reconciliation was reduced to the separate M1 blocker, Main Chat read current source authority and then issued initial public read-only HTTP/curl checks for `octoport.ru` before first creating and remote-reading a dedicated durable M1 pre-step/gate artifact.

Observed actions were read-only:
- HTTP/HTTPS/www response/redirect checks;
- homepage/robots/sitemap fetches;
- local source-vs-live byte/hash comparison.

No provider Search/Wordstat action occurred.
No account/private console action occurred.
No site mutation occurred.

### Root cause

Main Chat transitioned directly from M6 closure work into M1 evidence collection and treated the already-read LEVEL 1 + generic M1 roadmap rule as sufficient, instead of materializing the exact M1 execution contract first.

### Impact

The initial public observations are technically reproducible but are **not accepted M1 evidence** because the required durable pre-step ordering was violated.

### Recovery

```text
PRESERVE INCIDENT
-> DO NOT ACCEPT FIRST PUBLIC CHECKS
-> COMPLETE FRESH M1 METHOD RESEARCH
-> CREATE DEDICATED M1 PRE-STEP / EXECUTION GATE
-> REMOTE READBACK
-> RE-RUN PUBLIC LIVE CHECKS
-> PERSIST RESULTS
-> ONLY THEN M1 QA / ACCEPTANCE
```

The initial source/live size mismatch statement was also corrected: `7467` was source character count, while `9487` was byte count. A subsequent byte-level comparison showed source/live homepage identity, but that observation is also re-run after the proper gate.

### Permanent prevention

Any roadmap cursor transition to a different major stage requires a new durable step-specific preparation artifact before the first evidence-acquisition command, even when the action is free/read-only/public and even if LEVEL 1 was already read earlier in the same chat.

### Status

`RECOVERY IN PROGRESS / FIRST M1 OBSERVATIONS NOT ACCEPTED`.


## OSEO-F03 — Prelaunch placeholder misclassified as production SEO site

Date: 2026-09-23.
Stage: M1 current-site + measurement baseline.

### Incident

Main Chat observed that `octoport.ru` publicly returned a valid page and incorrectly escalated M1 into production-site ownership/readiness checks for:
- Yandex Webmaster;
- Yandex Metrika;
- Google Search Console.

The owner corrected the product state: Octoport does **not yet have a production SEO site**. The reachable page is a prelaunch placeholder/foundation, so those ownership/measurement systems are not expected to exist yet.

### Impact

Two read-only Yandex account calls were performed:
- Webmaster `listHosts`;
- Metrika `listCounters`.

Both were non-mutating. No site/property/counter was added, changed or verified. No retry occurred.

The earlier interpretation `HOLD_OWNER_SETUP_REQUIRED` is superseded.

### Correct state

```text
PRODUCTION_SEO_SITE = NOT_YET_EXISTS
YANDEX_WEBMASTER = NOT_APPLICABLE_PRELAUNCH
YANDEX_METRIKA = NOT_APPLICABLE_PRELAUNCH
GOOGLE_SEARCH_CONSOLE = NOT_APPLICABLE_PRELAUNCH
```

### Prevention

Do not infer launch-state from public reachability alone.

Before checking ownership/indexing/measurement tools, first establish:
```text
DOES A PRODUCTION SEO SITE EXIST?
```

If the owner/product authority says no, close M1 as a prelaunch baseline and defer ownership/measurement setup to launch/indexing/measurement stages.


## OSEO-F04 — M8 Work release issued before complete two-level step preparation

Date: 2026-09-23.
Stage: M8 Search-only semantic master.

### Incident

After M7 PASS, Main Chat created an M8 pre-handoff and canonical Work prompt before materializing a complete M8 step-preparation artifact containing the mandatory two-level gate fields required by LEVEL 1 and LEVEL 2.

The issued R1 handoff included useful execution constraints, but it did not itself prove the required preparation sequence:

```text
LIVE HEAD
-> LEVEL 1
-> LEVEL 2
-> ROADMAP/CURRENT STATE
-> FAILURE HISTORY
-> FRESH METHOD RESEARCH
-> EXACT STEP CONTRACT
-> GITHUB
-> REMOTE READBACK
-> ONLY THEN WORK RELEASE
```

### Impact

No Work execution had been accepted from the R1 prompt.
No provider action occurred.
No M8 analytical output was produced or accepted.

Therefore the defect is a release-order/process defect, not evidence contamination.

### Recovery

```text
R1 WORK RELEASE = SUPERSEDED / NOT EXECUTABLE
-> re-read current LEVEL 1
-> re-read LEVEL 2 index + dedicated M7/M8 rule
-> restore current roadmap/cursor
-> read failures/current evidence
-> perform fresh external M8 method research
-> create complete M8 STEP PREPARATION R2
-> GitHub persist
-> remote readback
-> create new M8 PRE-HANDOFF R2
-> remote readback
-> create canonical WORK PROMPT R2
-> remote readback
-> owner receives full prompt directly in chat
```

### Prevention

For every Work-backed major stage, a pre-handoff file is not a substitute for the step-preparation record.

Both must exist in order:

```text
STEP_PREPARATION
-> PRE_HANDOFF_MANIFEST
-> WORK_PROMPT
```

### Status

`RECOVERY ACTIVE / R1 M8 WORK RELEASE SUPERSEDED`.


## OSEO-F05 — M4Q targeted page evidence violated its declared physical-line TSV contract

Date: 2026-09-24.
Stage discovered: M8 Search-only semantic master.
Origin stage: M4Q R2 targeted M4C recheck.

### Incident

ChatGPT Work M8 R2 correctly stopped with `HOLD_SEMANTIC_CONTRACT_DEFECT`.

Frozen input:

`docs/seo/serp/competitors/work_return/M4Q_R2_TARGETED_M4C_RECHECK_2026-09-23_R1/M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv`

The accepted M4Q source manifest declared:

```text
FIELD_SEPARATOR = TAB
RECORD_SEPARATOR = PHYSICAL NEWLINE
CSV_QUOTE_SEMANTICS = DISABLED
CONTROL CHARACTERS = escaped
```

But the exact frozen bytes contain physical LF characters inside records `M4QR2TR0058` and `M4QR2TR0059`.

Observed:

```text
EXPECTED_COLUMNS = 21
EXPECTED_LOGICAL_ROWS = 47
SOURCE_PHYSICAL_LINES = 54
BAD_PHYSICAL_DATA_LINES = 8
AFFECTED_RECORDS = M4QR2TR0058,M4QR2TR0059
```

### Origin proof

The historical Work return manifest itself records:

```text
M4Q_R2_TARGETED_PAGE_EVIDENCE.tsv
bytes = 2602167
sha256 = 96d930d02060141a6eb9242c8079121a85359a256ff2fd39e0c4995577b05486
row_count = 47
```

Those bytes/hash exactly match the malformed frozen Git file.

Therefore:

```text
GITHUB_PUBLICATION_MUTATION = false
DEFECT_EXISTED_IN_ORIGINAL_WORK_RETURN = true
```

The earlier M4Q QA statement that the final ZIP passed tab-width checks was insufficient/incorrect under the declared physical-line parser contract.

### Impact

M4Q semantic/page evidence is recoverable, but the historical transport cannot be used directly by M8.

No M8 semantic master was accepted from R2.
No provider call or web acquisition occurred in M8.

### Recovery

A deterministic transport-only recovery was created:

`docs/seo/serp/competitors/recovery/M4Q_R2_TARGETED_PAGE_EVIDENCE_2026-09-24_R1/`

Recovery rule:

```text
record begins at ^M4QR2TR\d{4}\t
non-ID physical lines continue the preceding record
continuation physical LF -> literal \n
no other normalization/change
```

Verified:

```text
RECOVERED_ROWS = 47/47
RECOVERED_COLUMNS = 21/21 for 47/47
UNMODIFIED_GOOD_ROWS = 45/45 exact text match
SEMANTIC_ROWS_ADDED = 0
SEMANTIC_ROWS_REMOVED = 0
RECOVERED_SHA256 = a9ec3a14319edc0a4721e702378e910461490be1deba4136afcdf2276c2585d5
```

### Permanent prevention

For any TSV contract using `QUOTE_NONE` + physical-newline records, Work/Main Chat acceptance must verify the **published/returned exact bytes** with:

```text
physical line count
column width per physical data line
expected row count
record-ID uniqueness
manifest byte/hash identity
```

A manifest row_count or a parser capable of multiline fields cannot substitute for that check.

### Status

`RECOVERED / CURRENT AUTHORITY MUST USE PARSER-SAFE RECOVERY TRANSPORT`.


## OSEO-F06 — GitHub Web 25 MiB limit blocked one M8 Work-return artifact

Date: 2026-09-24.
Stage: M8 return publication.

### Incident

Work R3 returned a valid `M8_RAW_OCCURRENCE_LEDGER.tsv` of 76,810,357 bytes.

GitHub Web upload rejected that single file because the browser upload surface limits individual files to 25 MiB, even though the file remains below Git's 100 MB ordinary blob limit.

Eight other M8 files were published normally.

### Impact

This was a publication-transport defect only.

The original Work-produced raw ledger remained byte-exact and was independently verified before publication:

```text
BYTES = 76810357
SHA256 = 2091432f5eb131b425349954f0518cc8122e98461d932d9b2d7de64e6828bcfc
DATA_ROWS = 25229
```

No Work rerun or semantic regeneration was required.

### Recovery

Main Chat:
1. verified the original attachment bytes/content;
2. created a deterministic gzip transport under 25 MiB;
3. installed a one-shot path-filtered GitHub Actions recovery;
4. owner uploaded one small gzip file;
5. workflow verified gzip hash, restored the original raw TSV, verified raw hash/size/line count, committed the raw TSV, and removed the gzip;
6. Main Chat remote-read back the original raw TSV and completed QA.

Published Git blob:

`50f4e750a446dfa7907c13d576d04e071255dfd2`.

### Permanent prevention

Before owner relay of future Work returns, inspect final artifact sizes.

If any required individual artifact exceeds GitHub Web's per-file upload limit but remains below Git's ordinary blob limit:

```text
DO NOT REGENERATE
DO NOT SPLIT AUTHORITY UNLESS METHOD REQUIRES IT
DO NOT ASK FOR REPEATED WEB UPLOADS

USE:
ordinary Git / GitHub Desktop
or a pre-gated deterministic compressed transport with exact hash verification
```

Transport recovery must end with the original authoritative file present byte-exactly in the repository.

### Status

`RECOVERED / REGRESSION RULE ADDED`.


## OSEO-F07 — M9 R1 clustering release under-specified operational Search comparison rules

Date: 2026-09-24.
Stage: M9 Search-only clustering.

### Incident

M9 R1 step preparation/pre-handoff/prompt were released before the current Main Chat cycle completed the mandatory two-level re-read + fresh external clustering-method check requested by the owner.

The R1 method direction was broadly correct, but its execution contract left several material choices implicit:

- exact URL equality/canonical comparison field for SERP overlap;
- current M4Q RU225 precedence versus historical M4A Search evidence;
- prohibition on mixing M6 region-213 controls into the Russia-225 overlap matrix;
- how `result_page_type_relation` must behave when no accepted page-type authority exists;
- deterministic 1:1 mapping of the 22 M8 Search-anchored Working identities to current M4Q query IDs;
- closed pair reason/evidence-grade vocabulary.

Leaving these implicit could allow Work to invent a clustering method while executing.

### Impact

No M9 Work return exists and no M9 clustering result was accepted.

No provider call, web acquisition or site mutation occurred.

Therefore this is a preparation/method-freeze defect only.

### Recovery

```text
M9 R1 EXECUTION AUTHORITY = SUPERSEDED
-> live HEAD
-> LEVEL 1 re-read
-> exact M9 LEVEL 2 re-read
-> accepted M8/failure history read
-> fresh current method research
-> freeze exact Search-anchor map
-> freeze URL/domain overlap fields and Search snapshot precedence
-> freeze page-type NA behavior
-> freeze pair reason/evidence grades
-> create M9 R2 step preparation
-> GitHub readback
-> pre-handoff R2
-> Work prompt R2
```

### Prevention

For SERP clustering, "use SERP overlap" is not an executable method until the contract explicitly defines:

```text
QUERY -> SEARCH SNAPSHOT IDENTITY
URL COMPARISON FIELD
DOMAIN COMPARISON FIELD
RANK CUTS
MISSING-SERP SEMANTICS
CURRENT-vs-HISTORICAL PRECEDENCE
PAGE-TYPE AUTHORITY
PAIR DECISION REASONS
CLUSTER CONFLICT RULE
```

### Status

`RECOVERY ACTIVE / M9 R1 NOT EXECUTABLE`.
