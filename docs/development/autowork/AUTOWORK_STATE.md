# Seller Agents / Octoport — Autowork State

Status: DURABLE CURRENT-STATE AUTHORITY FOR SINGLE-EXECUTOR PILOT

This file stores CURRENT state.

It is deliberately separate from:

`SINGLE_EXECUTOR_RDC_AUTOWORK_GOVERNOR.md`

The governor is universal and must not contain a hard-coded current cursor.

This file may change after every material accepted step, rework boundary,
defer, owner STOP, or resume.

---

## Reconstruction status

CURRENT_STATE_RECONSTRUCTION = REQUIRED_ON_FIRST_AUTOWORK_RUN

The first active run under the single-executor governor must reconstruct the
current project state from:

- repository ROADMAP / STATUS / SPEC / DECISIONS / OPEN_ITEMS;
- accepted evidence;
- current Git branches/worktrees;
- current runtime/server facts when relevant;
- current direct owner instructions;
- prior accepted/deferred history.

Do not infer a current cursor from this template.

---

## Accepted frontier

To be populated from live authority on the first active execution cycle.

---

## Active candidate

NONE RECORDED IN THIS TEMPLATE.

A live active candidate must be reconstructed rather than invented.

---

## Latest accepted revisions

To be populated from live authority.

Never place private secrets here.

---

## Owner-deferred ledger

No current entries are asserted by this template.

Use one block per item:

```text
ID:
TYPE: OWNER_DEFERRED_TEST
ROADMAP_AREA:
CANDIDATE_REVISION:
MISSING_OWNER_ACTION:
WHY_AUTOMATION_CANNOT_LEGITIMATELY_PERFORM_IT:
AUTOMATED_EVIDENCE_ALREADY_OBTAINED:
ACCEPTANCE_BLOCKED:
FUTURE_OWNER_PROCEDURE:
STATUS:
```

When the governor is pasted again, unresolved owner-deferred items are skipped
and autowork continues elsewhere.

Do not repeatedly ask the owner.

---

## Owner-external ledger

Use one block per irreversible/external requirement:

```text
ID:
TYPE: OWNER_EXTERNAL_ACTION_DEFERRED
ROADMAP_AREA:
EXACT_EXTERNAL_ACTION:
WHY_OWNER_AUTHORITY_IS_REQUIRED:
ALREADY_PROVEN:
BLOCKED_ACCEPTANCE:
INDEPENDENT_WORK_REMAINING:
STATUS:
```

---

## Environment-deferred ledger

Use one block per environment/tool/provider blocker:

```text
ID:
TYPE: ENVIRONMENT_DEFERRED
ROADMAP_AREA:
BLOCKER:
EVIDENCE:
RETRY_CONDITION:
INDEPENDENT_WORK_REMAINING:
STATUS:
```

Do not repeatedly run unchanged probes.

---

## Provisional decisions

Use one block per current reversible owner-review decision:

```text
ID:
TYPE: PROVISIONAL_OWNER_REVIEW
DECISION:
REASON:
ALTERNATIVES:
CONSEQUENCES:
REVERSIBILITY:
AFFECTED_ROADMAP_OR_FILES:
STATUS:
```

Owner correction supersedes it forward-only.

---

## Unresolved dependencies

Record only real dependencies proven by current authority.

Do not manufacture dependencies from old roadmap text.

---

## Next dependency-correct candidates

Recompute after every accepted/reworked/deferred material step.

Do not keep stale next-step choices after repository/runtime truth changes.

---

## Resume rule

On resume:

1. read the universal governor;
2. read this state file;
3. verify current live Git/runtime facts;
4. correct stale state forward-only;
5. skip unresolved owner/external items;
6. select the highest-value executable dependency-correct work;
7. continue automatically.

---

## Security

Never store here:

- passwords;
- OTPs;
- API tokens;
- marketplace credentials;
- cookies;
- browser storageState;
- Authorization headers;
- private keys;
- Telegram bot token;
- raw seller reports;
- private AI conversation content.
