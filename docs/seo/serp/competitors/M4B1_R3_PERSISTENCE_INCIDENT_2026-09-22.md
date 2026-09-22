# Octoport SEO — M4B1 R3 persistence incident

Date recorded: 2026-09-22
Status: **CONFIRMED PROCESS FAILURE / ORIGINAL R3 ARTIFACT RECOVERY REQUIRED**

## 1. Exact failure timeline

### 2026-09-18 15:27 (+05)

GitHub commit: `6c77986ec8795766ee8e8af7fec1b9744916a6ad`

Message: `seo: authorize M4B1 canonical coverage R3`

This commit authorized R3 but contained only R3 gate/release/progress/rule-read updates. It did **not** contain R3 Work-return artifacts.

### 2026-09-18 16:53 (+05)

The owner attached:

`octoport-seo-m4b1-coverage-closure-r3-2026-09-18(1).zip`

This is the first exact moment when the complete R3 Work return was available to Main Chat.

At that moment the mandatory persistence sequence should have been:

```text
R3 ZIP received
-> unpack 9 outputs
-> owner upload to GitHub staging
-> remote readback
-> Main Chat return QA
-> only then prepare/release R4
```

That did not happen.

### No R3 upload commit exists

GitHub history for:

`docs/seo/serp/competitors/work_return/M4B1_COVERAGE_CLOSURE_2026-09-18_R3/`

contains the original staging README and later 2026-09-22 mistaken uploads/cleanup only.

There is no historical commit containing the nine `M4B1R3_*` Work outputs.

### No later than 2026-09-19 06:08:53 (+05)

The saved R4 prompt explicitly instructed Work:

`Then read ALL 9 R3 output files already present in this Work execution context`

This proves the R3 files were being carried forward only as transient Work/chat execution-context attachments rather than durable GitHub authority.

The same prompt explicitly froze R3 as 4,500 merged URLs, 2,888 new identities, 2,845 inspected page-evidence rows, and 47 HOLD states across 39 entities.

### 2026-09-19 07:20:22 (+05)

GitHub commit: `b5eecfede1f3dde1d8e583a6031d6733232e22f6`

Message: `Add files via upload`

This uploaded the R4 return directly on top of `6c77986...`.

Parent chain:

```text
6c77986...  R3 release
    |
    +-- b5eecfe...  R4 upload
```

There is no R3 artifact publication commit between them.

## 2. Exact root cause

The root cause was **not deletion of committed R3 files**.

The files were never committed to GitHub.

The exact process defect was:

```text
OWNER PROVIDED R3 ZIP
-> MAIN CHAT TREATED R3 FILES AS "PRESENT IN WORK EXECUTION CONTEXT"
-> MAIN CHAT RELEASED R4 USING TRANSIENT ATTACHMENTS
-> REQUIRED GITHUB STAGING / REMOTE READBACK / RETURN-QA GATE WAS SKIPPED
-> TRANSIENT CHAT/WORK FILE CONTEXT LATER DISAPPEARED
```

`ROOT_CAUSE = MAIN_CHAT_BYPASSED_MANDATORY_WORK_RETURN_PERSISTENCE_GATE`

Specifically:

1. The R3 ZIP arrived at 16:53.
2. Main Chat failed to convert that attachment into durable repository state.
3. Instead of blocking R4 until the nine files existed in GitHub, the R4 prompt relied on files already present in the Work execution context.
4. The large-data rule itself was not the problem; Work was correctly used.
5. The failure was at the handoff/persistence boundary after Work, where transient Work artifacts were treated as if they were durable accepted project authority.
6. Later R4/R5 could continue because their prompts and current-state tables carried aggregate R3 counts forward, masking the missing underlying 2,845-row R3 page-evidence corpus.

## 3. Why the loss was not detected earlier

The defect was masked because:
- R4 preserved R3 aggregate/current-state counts;
- later stages validated equations/current totals rather than rechecking physical existence of all nine historical R3 artifacts;
- the repository staging README existed, so the expected target directory itself was present;
- no pre-M4C full durable-input manifest required physical presence of every accepted historical page-evidence layer until current M4C preparation.

## 4. Current recovery state

The original R3 ZIP is documented as having existed and been uploaded by the owner at 2026-09-18 16:53 (+05).

Current File Library search does not expose the ZIP binary or the nine `M4B1R3_*` files.

Current GitHub history does not contain those files.

Therefore recovery must use the original attachment / original Work conversation if available. Fabrication from R4 aggregates is forbidden.

## 5. Current gate

```text
M4B1_R3_ACCEPTED_HISTORY = PRESERVED
M4B1_R3_ORIGINAL_OUTPUTS_DURABLE = false
M4C_PREPARATION = HOLD_R3_ARTIFACT_PERSISTENCE_RECOVERY
NEW_R3_CRAWL_ALLOWED = false
R3_RECONSTRUCTION_FROM_AGGREGATES = forbidden
```

The first acceptable recovery is restoration of the original nine R3 outputs unchanged.