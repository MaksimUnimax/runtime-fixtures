# Проект API и событий платформы


**Статус:** контракт v0.5 для новой реализации. Ни один URL ниже не объявлен уже установленным. Формальное описание новых платформенных routes — [api/openapi.yaml](api/openapi.yaml). Оно не заменяет официальный протокол OAuth/Яндекс/провайдера оплаты и существующий IPC runtime.

## 1. Поверхности

User API `/api/v1` на пользовательском origin; staff API `/staff/api/v1` только на отдельном admin origin. Browser cookie sessions host-only; mutation требует CSRF/Origin и Idempotency-Key. Email-code challenge принадлежит identity origin. Прежние платформенные challenge routes в OpenAPI помечены deprecated и не реализуются как второй auth authority; поведенческие проверки выполняются через IdP. Наличие cookie не является достаточной MFA.

OAuth endpoints навыка `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` проектируются по проверенному библиотечному/legacy протоколу, не как обычный JSON CRUD. Alice webhook `/integrations/alice/webhook` и payment webhook `/integrations/payments/yookassa` имеют отдельные адаптеры, доверенные ограничения и bounded body; CSRF-сессия браузера к ним не применяется. Валидный skill_id/user_id без пользовательского токена не даёт финансовый доступ.

## 2. Общие правила

UUID resource IDs; tenant определяется аутентифицированным контекстом. Чужой object ID возвращает безопасный 404 либо 403 по согласованной endpoint policy, не раскрывая свойства. Unsafe browser method требует request idempotency; ключ+route+actor scope сохраняются с хешем тела. Повтор того же тела возвращает прежний эффект; другое тело даёт 409 IDEMPOTENCY_CONFLICT. Никакой идемпотентный ответ не содержит повторно выдаваемый plaintext API-secret.

Optimistic updates используют `expected_revision`; stale → 409 REVISION_CONFLICT с безопасной текущей revision. Коллекции имеют cursor pagination, default 50/max100; следующий cursor непрозрачен и scope-bound. Время RFC3339 UTC, длительности явно в months/days, money amount_minor integer/currency. Date-only финансового периода имеет IANA timezone и ось.

Mutation response: resource/receipt id, state, revision, trace_id. Error: `{error:{code,message,trace_id,retryable,retry_after_seconds?}}`; сообщение безопасно, retryable не разрешает автоматически повторить неизвестную внешнюю операцию.

Коды: AUTH_REQUIRED, MFA_REQUIRED, PERMISSION_DENIED, NOT_FOUND, VALIDATION_FAILED, IDEMPOTENCY_CONFLICT, REVISION_CONFLICT, ACCESS_REQUIRED, ACCOUNT_BLOCKED, CREDENTIAL_REVOKED, CAPABILITY_UNAVAILABLE, PROVIDER_PLAN_REQUIRED, QUOTA_WAIT, UNKNOWN_OUTCOME, RESULT_EXPIRED, CATALOG_INCOMPATIBLE, DEPENDENCY_UNAVAILABLE. Причина gap — отдельный semantic enum.

## 3. RuntimePort v1

Операции: `capabilities(context)`, `submit(query,context)`, `status(job_ref,context)`, `cancel(job_ref,context,request_id)`, `read_result(job_ref,context)`, `revoke_scope(scope,revision)`, `current_versions()`.

Trusted context создаёт только платформа после session/OAuth validation: tenant_id, actor_id, store_scope IDs/revisions, access/security revisions, business timezone, catalog_release_id, runtime_contract_version, execution_ticket, not_after, logical_query_id, trace_id. Транспорт — разрешённый Unix socket с peer credentials на одном host, mTLS/эквивалентная service-auth при разделении. Схема JSON проверяет форму; она не подтверждает личность вызывающего.

`submit` возвращает durable job ref и accepted_at, либо отказ без побочного marketplace HTTP. Webhook не ждёт полной аналитики. `read_result` возвращает существующий результат и expiry; истёкшее даёт RESULT_EXPIRED/410 и не пересчитывается. `cancel` не обещает отменить уже отправленное стороннему API. UNKNOWN требует evidence-based reconciliation; нельзя translate UNKNOWN into retryable failure.

Отзыв проверяется перед новым dispatch и выдачей. Ticket для естественного окончания срока не отменяет security epoch. В accepted job закреплены definitions/source/credential revisions. API-поля, отсутствующие в текущем runtime, реализуются адаптером после проверки минимального source diff, а не прямой записью в чужую SQLite.

## 4. События

Все domain events имеют schema_version,event_id,occurred_at,producer,trace_id,payload. Схема query gap дополнительно содержит logical_query_id/episode_revision, псевдоним tenant и версии очистки/матрицы. До финальной классификации reason может отсутствовать; при final outcome причина должна соответствовать перечислению. Это сохранённая техническая детализация, не новый бизнес-статус «успех».

События: `payment.confirmed.v1`, `access.changed.v1`, `credential.revoked.v1`, `query.gap.v1`, `catalog.assignment.changed.v1`, `support.idea.resolved.v1`. Consumer effect и inbox processed — одна локальная транзакция. Доставка at-least-once, эффекты идемпотентны; глобальное exactly-once не обещается.

Provider notification может не иметь нашего event_id: адаптер создаёт внутренний inbox ID и связывает `(provider,merchant,environment,event_type,object_id)`. Изменённое тело уведомления о том же объекте не разрешает вторую выдачу; актуальный provider GET определяет денежный факт. Payload содержит только минимальные нужные поля, без карточных реквизитов.

## 5. Версии и совместимость

Unknown schema/enum не «угадывается». Additive optional fields принимаются только если версия и политика consumers это разрешают; ключевые trust envelopes strict. При изменении strict schema выпускается version и contract fixtures. Новый catalog package не может добавить engine primitive, которого нет в фактическом бинарном коде.

## 6. Приёмка контракта

Positive/negative fixtures проверяют форму, unknown fields и limits. Integration tests доказывают tenant, session, MFA, money equality и effects. JSON Schema не доказывает безопасность токена, достоверность API-данных или отсутствие дублей при crash. Для каждой операции нужны tests на фактический DB-effect, не только HTTP-код.

OpenAPI в этом комплекте покрывает платформенные routes, поля и типы. При реализации библиотечные OAuth routes и vendor-adapters получают отдельный проверенный contract snapshot. Это целевая спецификация, а не готовый сервер или SDK.

## 7. Полные пути вложений и чеков

Загрузка поддержки: инициализация → AWAITING_UPLOAD с max_bytes/upload_deadline → PUT бинарного тела на фиксированный same-origin `/content` → QUARANTINED → проверка файла и секретов → READY или REJECTED. На скачивание допускаются только READY в срок и с правом на исходное обращение. Нет произвольного upload URL. Проверка размера потоковая; превышение возвращает 413; истечение 410; неготовое/отклонённое вложение 409. Предлагаемый тестовый потолок 10 МиБ — новая техническая детализация, не коммерческое обещание.

Чеки: `/payments/{payment_id}/receipts` показывает отдельные состояния; `/receipts/{receipt_id}/document` возвращает только подтверждённый документ правильного merchant и среды после проверки доступа. На failure/UNKNOWN нет фиктивного чека и нового списания. Формат документа зависит от утверждённой кассовой интеграции D04.

`GET /auth/csrf` отдельно на user и staff origin создаёт только CSRF-контекст, не login. Staff challenge/MFA/recovery сохраняют отдельную библиотечную поверхность; конкретные маршруты согласуются при AL-F02 без переиспользования user-session.

## 8. Изменение v0.5: отдельный identity и public funnel

User/staff BFF имеют `/auth/start`, `/auth/callback`, собственный logout; endpoint metadata идёт из discovery authority. Новый OIDC не использует `/oauth/token` навыка. Hosts, callbacks и client IDs приведены в [IDENTITY_AND_UNIFICATION](IDENTITY_AND_UNIFICATION.md).

`POST /api/v1/leads` и подтверждение заявки — отдельные public subject-bound операции с rate limit, сроком и idempotency, не создание user. События funnel принимаются через bounded allowlist, без raw query/credentials. Требуемые схемы и лимиты заполняются внутри AL-S01 до его приёмки.

Контекст product_id определяется сервером. Для ручных commands другого product нет универсального proxy URL. Staff проходит OIDC + MFA и продуктовую проверку прав. API одного продукта не принимает токен другого audience.

[api/entrypoints-v0.5.yaml](api/entrypoints-v0.5.yaml) фиксирует добавленные поверхности и origin; основной OpenAPI остаётся проектом доменного API. Полный vendor OAuth не воспроизводим в самодельной сокращённой YAML — его контракт снимается с выбранной библиотеки и проверяется при AL-S02/06.
