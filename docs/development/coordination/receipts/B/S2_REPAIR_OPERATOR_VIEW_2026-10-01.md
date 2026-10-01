# S2 — интерфейс оператора случаев ремонта мониторинга — 2026-10-01

Status: **SOURCE + DISPOSABLE API/BFF/ADMIN BROWSER VERIFIED; INDEPENDENT REVIEW PENDING; NOT LIVE/PRODUCTION**

## Что реализовано

Добавлен read-only экран `/health/repairs`, доступный ссылкой из Health. Оператор вводит точный SHA-256 scope; список ограничен 25 строками, пагинация использует только opaque cursor API. List и detail всегда передают `scopeSha256`.

Экран показывает: состояние случая; что изменилось между закреплённым и текущим наблюдением; candidate и его fingerprints; baseline/rollback; тестированную версию/браузер/package; suite/H4/installed/matrix/results evidence; assignment; решение оператора; серверную операцию; отсутствующие доказательства и отдельные stale reasons. Состояния pending/rejected/revoked/not-yet-valid/expired/stale/current/in-progress/applied имеют русские подписи.

`executionAuthority=false` показан как явная причина отсутствия применения. В UI нет approve/apply/publish/rollout mutation. Сырые provider payload, секреты и данные клиентов не выводятся.

## Сквозной read-only путь

Product API и PostgreSQL read-model существовали до этой задачи и не изменялись. Для browser-доступа добавлены только два GET в существующий admin BFF allowlist:
- `GET /v1/admin/health/repair-cases`;
- `GET /v1/admin/health/repair-cases/{repair_case_id}/{revision}`.

`repair_case_id` проходит существующую UUID-проверку, `revision` — существующую positive-integer проверку. Repair POST/PUT/PATCH/DELETE не разрешены. Disposable E2E API harness подключает тот же существующий `createMonitorProfileRepairReadRepository(database)`, который уже используется production main wiring; это только parity тестового harness.

## Проверки

Final light gate:
- `apps/admin/lib/repair-ui.test.ts`: 8 PASS;
- `apps/admin/lib/control-plane-route.test.ts`: 135 PASS;
- вместе 143/143 PASS;
- admin TypeScript typecheck PASS;
- ESLint, Prettier и `git diff --check` PASS.

Final browser/API gate выполнялся через B heavy supervisor с отдельной disposable PostgreSQL и портами 34100/34200/34300. Resource receipt: `/root/octoport-control/resource-jobs/7c7ae40d272f438d823ddac1b0b3321a/receipt.json`: command/systemd exit 0, OOM 0, cleanup verified, peak 2491416576 bytes. Playwright `test-results/.last-run.json`: `status=passed`.

Browser suite содержит четыре сценария:
1. ADMIN_OWNER получает реальный пустой scoped repair list через обычный admin page → BFF → Fastify GET → PostgreSQL repository.
2. ADMIN_SUPPORT получает 403 через обычный BFF/API и UI не выдаёт страницу без полного набора read permissions.
3. Контролируемый partial read-model показывает missing current observation/H4, stale reason и `executionAuthority=false`, не создавая apply action; list/detail сохраняют тот же scope.
4. 503 отображается privacy-safe без raw upstream/SQLSTATE.

Первые два сценария не используют browser route interception для repair GET. Третий и четвёртый намеренно используют контролируемые read-only ответы только для UI-состояний partial/error; они не заявляются как DB evidence.

## Граница приёмки

Это SOURCE + disposable authenticated API/BFF/admin-browser evidence. Это не live operator acceptance, не ручное одобрение реального monitor candidate, не production deployment и не разрешение применять профиль. Product schema, migrations, repair API permissions, decision/apply routes и production execution authority не изменялись. Независимый review exact parent candidate обязателен перед публикацией.
