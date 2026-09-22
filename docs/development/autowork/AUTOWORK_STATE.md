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
