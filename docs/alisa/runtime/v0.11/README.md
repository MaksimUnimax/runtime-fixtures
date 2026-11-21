# RuntimePort · текущая точка продолжения

04.11.2026. **RT-JOB-R01.1: READY_FOR_INTEGRATION_REVIEW, только runtime/offline.** Рабочий навык остаётся scalar-matrix-r4; новый порт не установлен. Весь AL-S07 не принят.

Читать:
1. [Согласованная граница исполнителей](RT_JOB_R01_SCOPE_2026-11-04.md).
2. [План продолжения до реализации](RT_JOB_R01_RESUME_PLAN_2026-11-04.md).
3. [Фактическая приёмка и артефакты](RT_JOB_R01_ACCEPTANCE_2026-11-04.md).

Полный текущий код/схема/800 тестов находятся в **ALISA_RUNTIME_PORT_RT_JOB_R01_2026-11-04.zip**, SHA256 d5db0d7220048af0cea155e80a4af638ec4e60d21a5c07baf685bd14a40341d3, 240089 байт, 68 файлов. `rt_job_r01/runtime_port_contract.py` из f18a878 — ранняя частичная публикация валидатора, НЕ самостоятельный работающий порт. Для продолжения нужен полный pinned ZIP, не один этот файл.

## Стык второго исполнителя

Наш код: матрица, существующий Engine/Repository/Worker, RuntimePort и отдельный ограниченный Unix IPC. Ваш код: products/alisa, platform adapter, issuer/authority, пользовательский кабинет, identity, PostgreSQL. Нельзя писать в runtime SQLite из платформы или создавать второй аналитический executor.

Определены методы:
- submit(task, peer) → durable UUID job_ref, logical_query_id, accepted_at и trace_id;
- status(job_ref, context, peer);
- read_result(job_ref, context, peer) → полный сохранённый pages/fetched_at/expiry, без повторного HTTP или изменения голосовой страницы;
- cancel(job_ref, context, request_id, peer);
- capabilities(context, peer), current_versions через versions_for(peer).

Wire: одна JSON-строка `{schema_version:"runtime_port_v1", operation, payload}`. Submit payload — весь неизменённый runtime_task_v1 v0.5; status/read_result — `{job_ref,context}`; cancel — дополнительно request_id; capabilities — `{context}`; current_versions — `{}`. Точный syntax/examples, размеры, ошибки, cleanup, source patch и factory-композиция находятся в README_RT_JOB_R01.md внутри пакета.

Product alisa_market закрепляется в серверной Peer, создаваемой по SO_PEERCRED/service configuration, а не полем JSON. Схема v0.5 не содержит product_id: неизвестное поле запрещено.

Обязательные доверенные callbacks:

```python
verify(ticket, service_id) -> verified_claims
resolve(nonsecret_pins, action) -> semantics.Scope
```

verify проверяет issuer/signature/audience/product/revocation/срок и возвращает все подтверждённые поля context без execution_ticket плюс product_id. resolve проверяет текущие grants/security/access/credential/store revisions и catalog assignment, возвращает явную mapping публичных UUID в runtime Scope. Никакого автоматического доверия к tenant_id или приведения revision по догадке.

Actions resolve: submit, capabilities, status, read_result, cancel и execute. Для accepted worker execute получает nonsecret pins без истёкшего admission ticket/not_after, но актуальные права всё равно обязательны. Свежий read требует свежий ticket. Отсутствие callbacks — AUTH_REQUIRED; непредвиденная ошибка — DEPENDENCY_UNAVAILABLE, без fallback.

Один Engine с этим execution_policy должен обслуживаться одним Worker. Не запускать новый listener против live SQLite вместе с прежним worker, не знающим policy. Это интеграционное условие, а не команда сейчас менять рабочий сервис.

## Возможности R01

Поддержан законченный utterance до 1200 символов и Europe/Moscow. Template submit, remote revoke_scope, другие timezone пока CAPABILITY_UNAVAILABLE. Такое ограничение явно публикует capabilities. Нет обещания, что вся schema или все будущие вопросы уже исполнимы. Нераспознанные вопросы не становятся другим показателем.

Повторы scoped по tenant+actor+request_id; новый ticket не создаёт второй расчёт. Изменённый смысл — IDEMPOTENCY_CONFLICT. Idempotency 24 часа; истёкший результат не пересчитывается чтением. UNKNOWN требует отдельной сверки, не автоматического retry. Метаданные защищены TTL/capacity; полные финансовые данные и ticket не дублируются в receipts.

## Проверка и следующий gate

800/800 = 717 baseline +83 новых. Baseline test-файлы не изменены. Чистая распаковка и manifest проверены. Реальные SQLite/worker/Unix, искусственные authority/provider; внешних обращений нет. Это авторская runtime-проверка, не платформенный E2E.

Следующий gate: согласовать service UID/identity, verify/resolve, mapping и catalog assignment; подключить platform adapter в отдельном стенде; выполнить AL-S07 Alice→job_ref→ЛК и негативные права/replay/expiry с реальным квалифицированным отчётом. Домены, UI, identity и platform STATUS здесь не редактируются.
