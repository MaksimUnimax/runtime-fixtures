# Stream 2 — Telegram production prerequisites

Status: **ARCHITECTURE / OPERATIONS AUTHORITY**

Date: 2026-09-22

## Current production truth

The Telegram operator codebase may exist and have automated tests, but the production Telegram integration is **NOT LIVE** until all required operator credentials and identity bindings exist.

Current owner-confirmed state:

- production Telegram bot token: **ABSENT**;
- production owner/admin Telegram identity binding: **ABSENT**.

Therefore:

- no claim that the real Telegram bot is running is valid;
- no live `/swagger_pending` acceptance may be claimed;
- no live WB single-bundle Telegram attachment flow may be claimed;
- no operator should be told to send a bundle to a bot that has not been provisioned.

## Mandatory prerequisite gate

Before any live Telegram acceptance, the following owner-controlled prerequisites must exist:

1. A real Telegram bot created by the owner.
2. Its token stored only in the approved production secret/env location.
3. The owner/admin Telegram identity bound to the operator allowlist using the actual implementation's supported configuration.
4. The Telegram operator service deployed with those values.
5. A safe live smoke proving the bot can receive an owner command and reject unauthorized users.

The token must never be pasted into chat, committed, printed in logs, or stored in documentation.

## Roadmap placement

Stream 2 production operator path is:

```text
A1–A10 implementation accepted
→ WB single-bundle core accepted
→ Telegram production credentials / owner binding   ← CURRENT EXTERNAL PREREQUISITE
→ deploy/start real Telegram operator
→ live Telegram WB one-file UX acceptance
→ owner sends one WB bundle to the bot
→ real WB authority
→ real A2→A10 production continuation
```

## Planning rule

The architect must not schedule a live Telegram UI/attachment acceptance before confirming that token, owner/admin identity binding, and the deployed service are present.

Codex must not be asked to "verify the real bot" when those prerequisites are absent.

