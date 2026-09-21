# Stream 2 — Telegram Operator Control Plane

Date: 2026-09-21
Status: OWNER-APPROVED ARCHITECTURE / IMPLEMENTATION NOT_STARTED
Scope: Stream 2 only.

## 1. Purpose

Telegram becomes the permanent human operator control and notification plane for Stream 2.

It serves two independent functions:

1. LLM monitoring.
2. Swagger/API monitoring.

Telegram does not become a Seller Agents product execution authority and does not control ordinary Work.

## 2. Lanes

### LLM lane

Targets: ChatGPT, Alice, DeepSeek, Grok, Claude, Gemini, Qwen, Kimi.

Operator controls:
- /llm_status
- /llm_interval <duration>
- /llm_run
- buttons: Status / Run now / Change interval

State is durable and independent from Swagger/API monitoring.

### Swagger/API lane

Targets:
- Ozon Seller API
- Ozon Performance API
- Wildberries API

Operator controls:
- /swagger_status
- /swagger_interval <duration>
- /swagger_run
- /swagger_pending where pending human acquisition requests exist
- buttons: Status / Run now / Change interval / Pending downloads

State is durable and independent from LLM monitoring.

## 3. Service architecture

Initial implementation decision:

- dedicated Stream-2 Telegram operator service;
- Telegram Bot API long polling, so no new public inbound webhook is required;
- bot token is a server-only secret;
- operator authorization uses an explicit numeric Telegram user-id allowlist;
- durable control/request state is stored in the existing Stream-2 server persistence domain;
- bot service never runs Seller Agents Work and never receives marketplace credentials.

Conceptual components:

Telegram
→ Stream2 Operator Bot
→ Operator command router
→ LLM lane control
→ Swagger lane control

Monitoring events
→ Stream2 notification outbox
→ Operator Bot
→ Telegram operator

Protected official Swagger source
→ pending operator request
→ Telegram message with official URL + requestId
→ operator normal browser download
→ Telegram document reply
→ bot download
→ server quarantine/inbox
→ validation/provenance
→ S2-A1 candidate
→ semantic/API analysis
→ Telegram result

## 4. Durable lane controls

Each lane owns independent durable state.

Minimum logical fields:

- lane
- enabled/status
- configured_interval
- next_run_at
- last_run_at
- active_run_id
- last_result
- updated_at

Changing one lane never changes the other.

A forced run does not modify configured_interval.

If the same lane already has an active run, forced start returns ALREADY_RUNNING with the active run id. No duplicate overlapping execution is started blindly.

Different lanes may run concurrently.

## 5. Notification policy

LLM event classes:
- LLM_CHANGE_DETECTED
- LLM_MONITOR_PROBLEM
- LLM_AUTH_REQUIRED
- LLM_FORCED_RUN_COMPLETE

Swagger/API event classes:
- SWAGGER_CHANGE_DETECTED
- SWAGGER_MONITOR_PROBLEM
- SWAGGER_OPERATOR_DOWNLOAD_REQUIRED
- SWAGGER_UPLOAD_ACCEPTED
- SWAGGER_UPLOAD_REJECTED
- SWAGGER_FORCED_RUN_COMPLETE

Safe Telegram message fields:
- lane
- provider/target
- classification
- severity
- observation timestamp
- run id
- safe evidence reference
- concise explanation

No-change scheduled runs are silent by default. Explicit /status always exposes the latest safe state. Forced runs return acknowledgement and final safe result.

## 6. Human-assisted Swagger acquisition

Automatic official-source acquisition remains preferred.

If an official source is protected from the VPS but operator-accessible:

1. API monitor creates a pending acquisition request.
2. Request stores provider, official URL, expected format, requestId, created/expires timestamps.
3. Bot sends authorized operator official URL + requestId + instruction.
4. Operator opens the official URL with a normal browser and downloads the file.
5. Operator replies to the bot message with the document attachment.
6. Bot verifies operator authorization and reply/request correlation.
7. Bot downloads the Telegram document to the VPS quarantine area.
8. System records provenance and SHA-256.
9. System validates file type, size, parseability and Swagger/OpenAPI structure.
10. Valid document becomes OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE.
11. S2-A1 comparison/classification consumes the candidate.
12. Result is reported to operator.

No access-control bypass is performed.

## 7. File inbox

Canonical logical location:

/var/lib/octoport/stream2/operator-inbox/swagger/

Implementation may use a repository-standard equivalent if one already exists, but the security semantics are fixed.

States:
- RECEIVED / QUARANTINED
- VALIDATED
- REJECTED
- CONSUMED

Initial accepted formats:
- JSON
- YAML
- YML

Archives are not accepted initially.

Files are data only and are never executed.

## 8. Provenance

Each file candidate records at minimum:

- requestId
- provider
- original official URL
- authorized operator Telegram user id
- Telegram chat/message id
- Telegram document file_unique_id where available
- original filename
- MIME/content type
- file size
- received_at
- SHA-256
- validation result
- parser/schema version
- consumption result

Telegram upload alone never means ACCEPTED API AUTHORITY.

## 9. Validation

Validation must reject at least:

- unauthorized sender
- no matching pending request
- expired request
- provider mismatch
- unsupported extension/type
- excessive configured size
- malformed JSON/YAML
- document that is not recognizable Swagger/OpenAPI
- content that attempts execution/script behavior
- duplicate inconsistent upload for same request

A valid file remains a candidate until S2-A1 authority rules accept the source provenance/currentness.

## 10. Security

Bot token:
- server secret only
- never Git
- never docs
- never Telegram output
- never extension/client package

Operator authority:
- numeric Telegram user id allowlist
- username/display name is not sufficient identity
- unauthorized users receive no internal status or action access

Telegram must never contain or persist:
- cookies
- storageState
- auth headers/tokens
- owner AI private conversation content
- marketplace credentials
- seller reports/business payloads
- OTP
- private keys

## 11. Stream-1 firewall

Telegram and Stream-2 monitoring always have executionAuthority=false.

They cannot:
- allow/deny Start
- allow/deny Resume
- alter Bootstrap
- alter offline grace
- alter store/marketplace permission
- alter device admission
- alter commercial entitlement
- replay provider commands
- deliver seller reports
- auto-patch adapters

Detected changes produce evidence and engineering review only.

## 12. Relationship to S2-A1

Before this owner amendment S2-A1 automatic acquisition was blocked on protected first-party provider surfaces.

The new recovery model is:

automatic official acquisition
OR
operator-assisted official acquisition
→ provenance/validation
→ bounded S2-A1 authority recovery

S2-A1 remains PARTIAL / NOT_ACCEPTED until those authority criteria pass.

S2-A2–A10 remain dependency-blocked until sufficient A1 authority exists.

## 13. Roadmap

S2-TG0 — architecture/documentation.
S2-TG1 — bot foundation, authorization, notifications/status.
S2-TG2 — independent durable schedules + run-now controls.
S2-TG3 — Swagger operator handoff/inbox/validation.
S2-TG4 — end-to-end hardening and acceptance.

After TG3/TG4, use the operator-assisted path for bounded S2-A1 recovery when automatic official acquisition is blocked.

## 14. Acceptance

Acceptance requirements are tracked as A33–A40 in the global acceptance matrix and SA-OBS-TG-01..08 in SPEC.

Implementation must prove:
- lane separation
- schedule independence/persistence
- forced-run independence
- unauthorized denial
- no duplicate same-lane run
- safe notifications
- protected-source request
- attachment correlation
- file validation/provenance/SHA-256
- candidate-not-authority semantics
- no auto-patch
- no Stream-1 execution authority
- restart recovery
- Telegram outage does not deny Work
