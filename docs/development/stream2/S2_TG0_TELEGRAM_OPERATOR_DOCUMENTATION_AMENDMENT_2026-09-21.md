# S2-TG0 — Telegram Operator Documentation Amendment

Date: 2026-09-21
Status: ARCHITECT DOCUMENTATION CHANGE

## Owner requirement

The owner added Telegram as the Stream-2 operator control/notification plane and required:

- all monitoring problems/changes reported to the operator in Telegram;
- Swagger official download links sent to the operator when automatic acquisition is blocked;
- operator may download the official Swagger/OpenAPI file and attach it back to the bot;
- bot receives the document and stages it on the VPS for API monitor/Codex consumption;
- LLM monitoring and Swagger/API monitoring are different functions;
- each function has its own command namespace;
- each function has its own independently configurable interval via Telegram;
- each function has its own forced-start command/button.

## Architecture decisions made by architect

- dedicated Stream-2 operator bot service;
- initial Telegram transport: long polling, avoiding a new public inbound webhook;
- numeric Telegram user-id allowlist;
- server-secret bot token;
- separate durable LLM and Swagger control state;
- same-lane ALREADY_RUNNING protection;
- different lanes may run concurrently;
- protected Swagger acquisition uses requestId + reply attachment correlation;
- initial document formats JSON/YAML/YML;
- quarantine/provenance/SHA-256/parse validation before consumption;
- operator-uploaded document is a candidate, not accepted authority;
- no auto-patch and no Stream-1 execution authority.

## Documentation updated

- docs/ROADMAP.md
- docs/STATUS.md
- docs/product/SPEC.md
- docs/decisions/DECISIONS.md
- docs/decisions/OPEN_ITEMS.md
- docs/development/ACCEPTANCE_MATRIX.md
- docs/architecture/DATA_AND_SECURITY.md
- docs/architecture/CONTRACTS.md
- docs/development/stream2/STREAM2_TELEGRAM_OPERATOR_CONTROL_PLANE_2026-09-21.md
- docs/development/stream2/CURRENT_FRONTIER_2026-09-21.md
- docs/development/stream2/current-frontier-2026-09-21.json
- docs/development/stream2/PERMANENT_ARCHITECT_AUTOWORK_GOVERNOR_TELEGRAM_AMENDMENT_2026-09-21.md

## Existing Stream-2 reports reflected

Current docs preserve the reported accepted local authority:
S2-L5A/L5B/L6/L7/L8, S2-O2, accepted O3 slices, bounded Q1 LLM/Ops, bounded A1 sentinel, A1 reconciliation, frontier/governor authorities, and the verified source-authority bundle.

Full S2-A1 is NOT promoted.

## Roadmap effect

Current implementation order for this owner-priority addition:
TG1 → TG2 → TG3 → TG4.

After TG3/TG4 the validated operator-assisted first-party source path can unblock bounded S2-A1 recovery where automated provider acquisition is protected.

## Non-interference

No runtime implementation, Telegram bot deployment, scheduler implementation, provider probe, Stream-1 product code change or historical acceptance rewrite is part of this documentation amendment.

## Publication receipt

Remote documentation branch:
`docs/stream2-telegram-operator-control-plane-2026-09-21`

Draft PR:
#24 — Stream 2: Telegram operator control plane requirements and roadmap

This publishes the owner-approved documentation amendment only. It does not pretend the locally accepted Stream-2 implementation graph has been published to remote main.

TG0 architectural/documentation content is complete on this branch; canonical merge/reconciliation with the unpublished accepted Stream-2 graph remains a source-authority operation, not a requirements decision.
