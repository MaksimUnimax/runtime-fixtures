# S03 · текущая установленная staff boundary

**ACCEPTED_FOR_DECLARED_CURRENT_S03_STAFF_SCOPE_ONLY.** [Независимая приёмка](AL_S03_CURRENT_INDEPENDENT_REVIEW_20261105.json) завершена после свежего readback. Авторизованное продолжение после77244b2f: резерв восстановлен, новое сочетание компонентов проверено. Source/product code этого потока не менялся.

| Компонент | Фактический release |
|---|---|
| Admin | `alisa-3e91b1aa5d405d0e` |
| Web / platform API / Identity | `alisa-07290e7c17f556bf` |
| Shared current | `alisa-77d0f8ee2643ef65` |

[Exact bindings, CI и полные receipts](AL_S03_CURRENT_EVIDENCE_20261105.json) · [процедуры и их ограничения](s03-current-20261105/README.md) · [план текущего возврата](AL_S03_CURRENT_MIXED_PLAN_20261105.md).

| Проверка current07290 | Результат |
|---|---|
| Вход и права | PASS24: fresh native TOTP, signed native MFA/nonce/client/Subject/Person, фактический PG session.mfa_type, users.read deny, отзыв двух контекстов |
| Отключение / fallback / возврат staff | PASS48: только admin shell временноe820; API/web/Identity07290 сохранены; staff API/native client закрыты, payloads очищены, native bearer401, actualTTL60 выдержан, новый TOTP после возврата, прежние token401/flow400 |
| Финальная read-only QA | PASS72: точные4406/42+4408/42, private files/modes, отдельные staff keys, runtime безDDL и crossDB CONNECT, шифрование фактора, privacy audit/logs, READY служб и4 timers, non-synthetic mail guard |

Counts относятся к отдельным процедурам и не суммируются как уникальные сценарии. Вход выполнялся только существующими двумя собственными `example.invalid`; OWNER/bootstrap/identity не создавались, recovery factors одноразовые. Общий mail batch не запускался. В течение current07290 проверки состояние non-synthetic mail rows не менялось; новая public/mail функциональность другого потока этим не принимается.

После промежуточного DD2 smoke24/rollback48 другой поток установил07290. DD2 first smoke и final остались FAILED: unmanifested derived infra bytecode. Их receipts не переписаны. Новый07290 проверен заново по exact CI manifest; независимое сравнение подтвердило неизменность staff-critical source. Временный native lock holder удерживал5 существующих rollout locks через тесты и независимый readback. Новый runner/controller не создавался.

Резерв: inactive-only dedup идентичных собственных vendor copies дал453MiB, затем302MiB; после тестов3455MiB свободно при минимуме3072. Все архивы и пути release сохранены, active inodes не затронуты. Inactive mtimes нормализованы к canonical; исходная metadata сохранена приватно. Для восстановления отдельных timestamps нужно сначала разорвать hardlink.

Проверки документации:6PASS и docs-checkPASS. Публикация только в существующий Draft PR386; main не сливается. Production, доставка на реальный адрес, общая identity/БД и последующие функции остаются за пределами этой приёмки. Следующий продуктовый шаг — AL-S04, выдача срока доступа, после закрытия текущего gate.

В11:32:52UTC собственный lock holder остановлен,5 rollout locks освобождены. Повторный readback после освобождения: тот же tuple,4READY. Это приёмка состояния на указанное время; последующая смена компонентов требует новой привязки.
