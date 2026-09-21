# Stream 2 Permanent Governor — Telegram Operator Amendment

Date: 2026-09-21
Type: PERMANENT RULE / ROADMAP AMENDMENT
Base permanent governor authority: e394e92ab9c40879d7f8c1ed1e48244017ea7518

This amendment is permanent. It does not bind the governor to today's current cursor, branch, SHA, or provider incident.

## Permanent purpose addition

Stream 2 includes an operator control/notification plane implemented through Telegram.

The operator plane serves two permanently separate monitoring lanes:

- LLM monitoring
- Swagger/API monitoring

These lanes may share a bot service and generic incident shell, but they must preserve separate commands, schedules, run state, history and notifications.

## Permanent operator-control rules

1. Only allowlisted Telegram operator identities may access internal monitoring controls or reports.
2. Bot token is a server-only secret.
3. LLM command namespace and Swagger/API command namespace are separate.
4. Each lane has independent durable schedule configuration.
5. Each lane has independent forced-run control.
6. Forced run does not modify schedule interval.
7. Duplicate same-lane forced execution must be prevented or deterministically queued; blind overlap is forbidden.
8. Different lanes may operate concurrently when safe.
9. Material monitoring changes/problems notify the operator with privacy-safe metadata.
10. No-change scheduled runs are silent by default; explicit status remains queryable.

## Permanent LLM operator surface

Required control concepts:
- /llm_status
- /llm_interval
- /llm_run
- corresponding separate Telegram buttons

LLM monitoring notifications never include raw private AI sessions, prompts, responses, cookies or storageState.

## Permanent Swagger/API operator surface

Required control concepts:
- /swagger_status
- /swagger_interval
- /swagger_run
- pending official-source request visibility
- corresponding separate Telegram buttons

When automatic official-source acquisition is blocked and an operator-accessible official URL exists, Stream 2 must be able to request human-assisted acquisition.

Permanent flow:

official provider URL
→ Telegram operator request
→ legitimate operator browser download
→ Telegram document attachment
→ authorized/correlated server quarantine
→ provenance + SHA-256 + Swagger/OpenAPI validation
→ operator-supplied official-source candidate
→ API-watch analysis
→ operator result notification

The operator upload is never automatic authority.

## Permanent file-ingestion rules

- allowlisted operator only
- pending request correlation
- bounded accepted document formats
- bounded file size
- no code execution
- quarantine before validation
- provenance record
- SHA-256
- parse/schema validation
- explicit REJECTED/VALIDATED/CONSUMED state
- no silent Git commit of uploaded specs
- no seller-report or Stream-1 storage reuse

## Permanent no-authority firewall

Telegram and monitoring outputs have zero Stream-1 execution authority.

They cannot alter:
- Start/Resume
- Bootstrap
- offline grace
- store/marketplace permissions
- device admission
- commercial entitlement
- ordinary provider execution
- report delivery

No monitoring result or uploaded specification may auto-patch production code or auto-enable an API operation.

## Permanent roadmap addition

S2-TG0 — documentation/architecture.
S2-TG1 — bot foundation/operator authorization/notifications.
S2-TG2 — independent durable schedules and forced-run controls.
S2-TG3 — Swagger operator handoff/quarantine/provenance/validation.
S2-TG4 — end-to-end operator hardening/acceptance.

These steps are part of the complete Stream-2 roadmap and may be dependency-scheduled with LLM/API lines by the architect.

## Permanent A1 acquisition rule

S2-A1 official source authority may be acquired by:
- automatic legitimate first-party acquisition, or
- validated operator-assisted acquisition from an official source URL.

Human assistance is a legitimate acquisition transport, not an authority override.

## Existing permanent rules remain in force

The existing governor's owner-only STOP rule, architect/Codex role boundary, privacy rules, Stream-1 non-interference, no-auto-patch, failure-batch discipline, Git safety, owner-deferred handling and exact evidence/acceptance language remain unchanged.
