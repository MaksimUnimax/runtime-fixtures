# apps/api

Перенесён исходный Fastify API и его тесты. S1.1 beta access/admission принят; реальное подключение единого расширения остаётся следующим серверным участком I1.

Точка импорта: blood_sand@3f16bbf6387cc62303e292fcfe61449c8f243b92.
Фактический результат проверок — [квитанция переноса](../../docs/migration/evidence/SERVER_IMPORT_ACCEPTANCE.md).
Запуск и команды — [локальная разработка](../../docs/server/LOCAL_DEVELOPMENT.md).

## Разделение подключений credential transfer

API использует DATABASE_URL для штатных репозиториев, включая регистрацию и изменение устройств. CREDENTIAL_TRANSFER_DATABASE_URL обязателен отдельно: тот же PostgreSQL endpoint и имя БД, другой LOGIN. Только этот отдельный pool передаётся transfer fence и его admission; основной pool не подменяет его при отсутствии настройки. Существующий строгий admission проверяет фактические права transfer LOGIN, включая отсутствие записи devices. Оба pool закрываются при завершении API, даже если закрытие одного завершилось ошибкой.

Это SOURCE-контракт настройки. Код запуска не создаёт роли, не выдаёт права и не меняет рабочие подключения. Provisioning/rollout требуют отдельных полномочий; существующие credentials не следует копировать в исходники или логи. Для проверки обычных device-операций и изолированного transfer используются независимые тестовые подключения, а production wiring проверяется api-databases.test.ts.

E2E reset в Server CI использует существующий guarded fixture helper и реальный epoch guard, сохраняя его allowlist одноразовой БД и проверку прямого test-superuser. Триггер не отключается.

Database pool separation validates the effective connection boundary before creating either pool. Both PostgreSQL URLs must explicitly name a LOGIN, host and database; an omitted port is normalized to 5432 in the URL passed to the driver. Query options are limited to `sslmode`, `sslcert`, `sslkey` and `sslrootcert`; other driver configuration fields are rejected with a credential-free diagnostic. TLS certificate files remain the driver's responsibility. This SOURCE contract does not provision roles, change credentials or authorize live configuration changes.
