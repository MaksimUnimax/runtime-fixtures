# Seller Agents / Octoport — Autowork State

Status: CURRENT DURABLE STATE — SINGLE-EXECUTOR PILOT
Last reconstructed: 2026-09-22

## Accepted/current state

Primary live engineering worktree:

- branch: `work/stream1-q1c-live-smtp-otp-2026-09-22`
- current HEAD: `5fff0caf4e517040d178edf055556a00993c1bb7`
- worktree: clean

Current live services:

- API: active/running
- worker: active/running
- portal: active/running
- `https://api.octoport.ru/health/live`: 200
- `https://api.octoport.ru/health/ready`: 200

Current signed-bootstrap state:

- historical signing-event persistence defect repaired in source;
- migration `0032_s1_signing_reason_contract_guard` applied;
- configured signer resolves ACTIVE;
- canonical signing-catalog tool returns `ALREADY_HEALTHY` without mutation;
- production API restarted through existing service path;
- first `control_plane_v2` config release published;
- V2 config version: 1;
- `control_plane_v2 / bootstrap_snapshot_v2 / bootstrap_envelope_v2`;
- publication audit: PASS.

Current implementation commits on the live engineering branch:

- `a4864a4` — harden signing-event persistence contract;
- `c99a5a0` — make signing-catalog CLI executable;
- `5fff0ca` — record current signing-contract/V2 boundary.

## Active acceptance boundary

The final live device continuation for package version `0.2.4` reached an
owner approval gate.

Observed:

- device authorization start: PASS;
- owner approval: timeout / not performed;
- exchange: CLOSED after expiry;
- no access/refresh credentials issued;
- signed V2 Bootstrap therefore not reached in that final run;
- final active test devices: 0;
- final active test sessions: 0.

This is not a product defect by itself.

## Owner-deferred ledger

### OWNER-DEFERRED-I1-LIVE-DEVICE-APPROVAL

TYPE: `OWNER_DEFERRED_TEST`

ROADMAP_AREA:
R3 / R5 — live device authorization → signed V2 Bootstrap → refresh →
revoke/invalidation.

CANDIDATE_REVISION:
`5fff0caf4e517040d178edf055556a00993c1bb7`

MISSING_OWNER_ACTION:
Approve the bounded `Q1 Live Chrome V2 Final` device authorization during a
fresh live run and later perform the owner revoke step when requested by that
same bounded live sequence.

WHY_AUTOMATION_CANNOT_LEGITIMATELY_PERFORM_IT:
The acceptance specifically proves owner-controlled device approval/revocation
authority. It must not be forged or bypassed.

AUTOMATED_EVIDENCE_ALREADY_OBTAINED:
Production V2 signing/config path is healthy and publication succeeded; prior
device start/exchange paths have independently succeeded; current services are
live/ready.

ACCEPTANCE_BLOCKED:
Final live signed V2 Bootstrap + refresh + post-revoke access/refresh
invalidation proof.

FUTURE_OWNER_PROCEDURE:
Run one fresh bounded device authorization; owner approves before expiry;
executor continues through exchange, signed V2 Bootstrap, refresh, owner revoke,
and post-revoke invalidation checks.

STATUS:
OPEN / SKIP DURING AUTOWORK.

### OWNER-DEFERRED-TELEGRAM-PROVISIONING

TYPE: `OWNER_EXTERNAL_ACTION_DEFERRED`

ROADMAP_AREA:
R11 — Telegram monitoring operator production provisioning.

MISSING_OWNER_ACTION:
Create/provide production Telegram bot provisioning and owner/admin Telegram
identity binding through the approved secret/config path.

WHY_AUTOMATION_CANNOT_LEGITIMATELY_PERFORM_IT:
No production bot token or owner/admin identity binding currently exists.
Secrets must not be invented or committed.

ACCEPTANCE_BLOCKED:
Live Telegram operator acceptance and real WB one-file operator handoff.

STATUS:
OPEN / SKIP DURING AUTOWORK.

## Environment-deferred items

Remote publication of the current Stream-1 implementation commits has been
reported unavailable from the live engineering worktree because GitHub
credentials are not present there. Do not repeatedly retry unchanged
credentials.

This does not block local/server engineering or the separate GitHub connector
used for architect-owned documentation.

## Current roadmap cursor

Highest confirmed current program area:

- R3 live server↔extension authority is implemented through production V2
  config publication, with final owner-controlled live device acceptance
  deferred.
- R5 installed/operational acceptance contains useful executable work that does
  not require the deferred owner device approval.
- R9–R12 monitoring areas remain available when dependency-correct, but Telegram
  production provisioning is owner-deferred.

## Next dependency-correct executable work

Reconstruct and execute the strongest current installed unified-extension
acceptance that can be performed autonomously on the server:

1. identify the current intended Chromium extension artifact/build;
2. verify package/source identity;
3. establish real Playwright Chromium extension-loading capability;
4. install/load the current unified extension in a dedicated test profile;
5. execute the highest-value current installed functional matrix that does not
   require owner secrets or provider access-control bypass;
6. capture failures as a complete batch;
7. fix real product/harness defects directly if found;
8. rerun affected regression;
9. record precise browser/runtime evidence;
10. do not claim Chrome/Opera/Yandex/Firefox/Safari from Chromium evidence.

## Resume rule

On resume:

1. read the universal governor;
2. read this state file;
3. verify current Git/runtime facts;
4. correct stale state forward-only;
5. skip unresolved owner/external items;
6. continue with the highest-value executable dependency-correct work;
7. update this file after material acceptance/rework/defer.

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

## STOP CHECKPOINT — 2026-09-22

OWNER_STOP = ACTIVE

No new implementation work may start until the owner resumes autowork.

### Current live engineering worktree

- worktree: `/root/runtime-fixtures-s1-q1c-live`
- branch: `work/stream1-q1c-live-smtp-otp-2026-09-22`
- HEAD: `5fff0caf4e517040d178edf055556a00993c1bb7`

Current dirty state was intentionally preserved; no reset/cleanup was performed.

Dirty files:

- `apps/extension/application-patches.json` — current composer-readiness repair candidate owned by this autowork pass;
- `tests/regression/extension-core/client-i1/browser_c1_acceptance.py` — current RED/acceptance coverage owned by this autowork pass;
- `tests/regression/imported/ozon-v0.1.22/validation/regression/run_direct_binary_provider_attachment_gate.mjs` — pre-existing/unknown dirty change, left untouched and not claimed by this work.

Owned diff:

- 2 files;
- 30 insertions;
- `git diff --check`: PASS.

No active test process remains from the last browser run.
Temporary synthetic Health ports 43100/43200 are not listening.

### Active candidate

STATUS: `REWORK_REQUIRED`

Candidate intent:

- make Work Start tolerate a normal bounded delay before the AI composer becomes usable;
- fail closed with `COMPOSER_NOT_FOUND` when readiness never arrives;
- do not add browser-specific sleep logic;
- do not add retry after irreversible Send.

Current implementation candidate:

- adds `WORK_START_COMPOSER_READY_TIMEOUT_MS = 8000`;
- adds bounded `waitForWorkStartComposerContext()`;
- `sendWorkSessionPrompt()` waits for a real composer context before reading/staging text.

Current regression additions:

- `BR-C1-37`: composer exists but is hidden for 3 seconds, then becomes visible; Work Start must eventually activate;
- `BR-C1-38`: composer never becomes ready; wait must be bounded and fail closed.

### Evidence

Before repair:

- `BR-C1-37` was RED in Playwright Chromium for both source and extracted runtimes.

After current repair candidate:

Playwright Chromium:
- `BR-C1-37`: PASS source + extracted;
- `BR-C1-38`: PASS source + extracted;
- local deterministic composed build: PASS;
- local synthetic package SHA256: `678af0b21d3921a439b86c82e5b286f70ff3c2872e128083d8920bbd657b2417`.

Real Opera:
- `BR-C1-37`: FAIL;
- `BR-C1-38`: FAIL;
- therefore the current candidate is NOT ACCEPTED.

Earlier Opera evidence remains valid:
- installed extension/service worker/popup/storage/restart work in real Opera;
- broad browser-application fixture passes in Opera;
- signed verifier passes in Opera;
- offline continuation passes in Opera;
- timing probe showed Work Start fails with 0–2 second pre-start delay and succeeds after about 4 seconds.

Do NOT collapse this into "Opera unsupported"; current evidence indicates a narrower Work Start/browser-readiness problem.

### Exact unresolved root cause

The 8-second bounded wait fixes the synthetic delayed-composer condition in Playwright Chromium but does not yet make the same focused Work Start cases pass in Opera.

The next run must first determine WHY the Opera content runtime still fails before changing the implementation again.

Required provenance direction on resume:

`Opera focused failure`
→ content-script/runtime lifecycle evidence
→ whether patched wait executes
→ actual composer visibility/context observed by the extension
→ browser-specific launch/content-script timing or product logic owner
→ only then next repair.

Do not add an Opera-only sleep or special-case branch without dependency proof.

### Accepted/current roadmap position

R3:
- production V2 config publication remains complete;
- signing-contract repair remains complete;
- final owner-controlled live device approval → signed V2 Bootstrap → refresh → revoke/invalidation remains `OWNER_DEFERRED_TEST`.

R5:
- active area;
- installed Playwright Chromium extension evidence exists;
- real Opera extension loading/popup/storage/restart evidence exists;
- current Work Start readiness repair is `REWORK_REQUIRED`;
- Chrome/Yandex legitimate native extension-install route remains unresolved;
- Firefox installed acceptance remains unfinished.

R11:
- production Telegram bot token/admin identity provisioning remains owner-external/deferred.

### Safe resume point

When owner resumes autowork:

1. verify this checkpoint and current worktree HEAD/dirty files;
2. do not touch the unrelated dirty direct-binary regression file unless its provenance is established;
3. investigate the Opera failure with bounded diagnostic evidence before another product-code edit;
4. determine why the patched Work Start wait is insufficient in Opera;
5. repair the owning abstraction only after three-level dependency proof;
6. rerun focused Chromium + Opera cases;
7. only then run affected C1/P1/offline regression and decide ACCEPT/REWORK;
8. update this state file.
