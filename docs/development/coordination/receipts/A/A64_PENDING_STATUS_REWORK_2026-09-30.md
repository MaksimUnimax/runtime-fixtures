# A64 pending Start status rework — 2026-09-30

## Trigger

C reviewed exact A candidate `64f1735e3a07447dc4b9c79fc2b7d0d0f41dfd52` and found one bounded UX defect:
an accepted asynchronous Start still returned through generic `action()`, which unconditionally replaced the visible status with final `Готово`.

Request:
`/root/octoport-control/peer-handoffs/A/C-A-A64-PENDING-STATUS-REWORK-20260930T1602Z.request.json`.

## Change

- Start wraps a successfully accepted request with a local popup-only `WORK_START_ACCEPTED` marker.
- Generic `action()` renders final `Готово` only for ordinary completed actions.
- Accepted Start after refresh shows:
  - `Работа запущена` only when Work is already `active_visible` / `active_hidden`;
  - otherwise a persisted `lastStart` pending/failure/unknown message when available;
  - otherwise explicit non-final `Запуск принят. Ожидаем подтверждение инструкции и ответа ИИ`.
- `accepted:false` and malformed `ok:true` responses remain fail-closed through `requestStart()`.

No changes to send, binding, revision, no-replay, auth/workAllowed, runtime diagnostics, popup CSS, backend or frozen packages.

## Focused validation before commit

Environment:
- Node `v24.20.0`
- pnpm `10.34.5`

Disposable current-tree LOCAL_DEVELOPMENT composition:
- deterministic build PASS
- source/extracted bytes match
- ZIP SHA-256 `90e2fe78eaca37cf2c642b6053b1ecac97dea8603012b872e7c33662d4437702`

Source and extracted:
- `client-start-diagnostics.mjs`: PASS
  - accepted=true pending => visible non-final status, never `Готово`
  - accepted=true already active => `Работа запущена`
  - accepted=false => actionable failure
  - malformed ok response => fail closed
  - ordinary non-Start action => `Готово`
  - prior tab-scoped/reopen/privacy assertions preserved
- `application.mjs`: PASS, including existing Start/no-replay scenarios
- live provider calls: 0

Resource job:
`octoport-test-a-45800b3844b3402cb5f0e9463ab69ad4.service`,
exit 0, peak 144 MiB, cleanup verified.

The pre-existing dirty `client-support-snapshot.mjs` remains untouched and is excluded from this candidate.
