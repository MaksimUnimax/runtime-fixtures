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
