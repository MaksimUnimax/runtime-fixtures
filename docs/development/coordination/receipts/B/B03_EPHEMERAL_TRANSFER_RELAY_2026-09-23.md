# B03 bounded ephemeral relay receipt — 2026-09-23

Role: B
Task: B03 ServerEphemeralTransferRelay
Evidence level: SOURCE / local package tests only.
Installed, live, deployment and production acceptance: NOT CLAIMED.

## Revisions

- Canonical main merged before implementation review: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`.
- B branch merge boundary: `ebf38e892112f99dd7315be1ba63fbd31ff154dc`.
- B03 implementation commit: `ae15d486cef926b48a7f4749dde4c2b6c978a403`.
- Luna child `b03-bounded-relay` reviewed as an uncommitted isolated diff; parent integrated only the four B-owned files and owns the final result.

## Behavior closed in B03

- Relay remains process-memory-only; packet bytes are not serialized or logged.
- UTF-8 envelope size is fail-closed at 131072 bytes using `TRANSFER_PACKET_TOO_LARGE`.
- Default resident caps: 64 packets global, 8 per account, 8 MiB envelope bytes global, 1 MiB per account.
- Quota exhaustion uses existing `TRANSFER_CONFLICT`; no new shared contract code was introduced.
- Account/source identity is retained in relay accounting and checked on receive.
- Capacity is reserved before the durable `markPacketAvailable` transition; reserved packets are unreadable.
- Reservation metadata does not contain the replacement envelope, so a failed replacement does not duplicate packet payload memory.
- If the durable transition fails, reservation accounting is released and any prior active packet is restored to visibility.
- If TTL expires between durable transition and relay activation, submit fails closed with `TRANSFER_EXPIRED`; no success is fabricated.
- One unref'd timer tracks the earliest active/reserved expiry. `get`, `has`, `expireDue`, ACK, cancel and `clear` release relay accounting as applicable.
- A new relay after process restart is empty; existing `SOURCE_OFFLINE` behavior remains truthful.
- Oversized packet errors stay inside the existing HTTP 409 transfer-error response surface; OpenAPI artifact remains unchanged.

## Parent review corrections beyond the child draft

The parent reproduced and fixed two race defects before accepting the implementation:

1. Replacement rollback: the child draft overwrote the old active relay entry with a reservation before durable transition. A failed second `markPacketAvailable` reduced resident packets from 1 to 0. A RED regression reproduced this, then the reservation model was split from active packet storage so the prior packet survives failed replacement.
2. Activation-after-expiry: durable availability could complete after the reservation TTL had expired while `activate()` returned false. The parent now treats that as `TRANSFER_EXPIRED` rather than returning a successful submit with no retrievable packet.

## Verification on the parent working tree

Toolchain: Node `v24.20.0`, pnpm `10.34.5`.

- Credential-transfer domain: 20/20 PASS.
- Focused API route error mapping: 1/1 PASS.
- Combined focused boundary: 21/21 PASS.
- Full API package: 21 files / 248 tests PASS on the final behavior.
- `@product/credential-transfer` typecheck: PASS.
- `@product/api` typecheck: PASS.
- `@product/api openapi:check`: PASS; no shared artifact drift.
- Focused ESLint with zero warnings: PASS.
- Focused Prettier check: PASS.
- `git diff --check`: PASS.

Logs:
- `/root/octoport-control/logs/B/b03-parent-red.log` — parent RED replacement-rollback reproduction.
- `/root/octoport-control/logs/B/b03-parent-race-acceptance.log` — final focused acceptance including expiry race.
- `/root/octoport-control/logs/B/b03-api-final.log` — final full API package run.

## Remaining boundaries

B03 is a B candidate, not standalone protocol acceptance. PLAN requires A02+B03 to be reviewed jointly for reliable transfer behavior. No shared-contract edit, DB/schema/migration edit, live database mutation, installed-browser proof, deployment or production action is claimed here. B01 legacy lineage and B02 control-plane-v1/v2 catalog compatibility review remain independently open.
