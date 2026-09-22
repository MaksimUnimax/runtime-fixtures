# Контракты и версии

Сохраняем `control_plane_v1` и принятые auth/bootstrap semantics для уже
установленных клиентов. I1-SRV.1 использует отдельный `control_plane_v2` /
`bootstrap_snapshot_v2` / `bootstrap_envelope_v2`: строгий v1 payload остаётся
без `account.id`, а v2 подписывает канонический Seller Agents account UUID.
Для v1 сохраняется rollout authority `bootstrap.config`; v2 в этой волне
выбирает только последний опубликованный `CONFIG_RELEASE` своей версии.
Отдельный `bootstrap.config.v2` rollout и миграция базы не вводятся.
Точные URL новых endpoints определяются из схем при переносе; не создавать независимо написанный клиент по предположениям из Markdown.

## Идентификаторы

| Поле | Смысл |
|---|---|
| accountId | Аккаунт Seller Agents; не аккаунт ИИ и не магазин |
| deviceId / installationId | Серверная авторизованная установка; не tabId |
| storeId | Постоянная сущность магазина сервиса |
| providerAccountId | Подтверждённая идентичность кабинета, если API её предоставляет |
| credentialRevision | Локальная версия набора секретов; значение ключа не передаётся |
| conversationKey | AI family + origin + account scope + стабильный ID диалога |
| bindingId / bindingRevision | Общая привязка диалога и её версия |
| workSessionId / generation | Локальная рабочая сессия и отсечение поздних callbacks |
| executionId / itemId | Локальные идентификаторы разрешённого пакета и элемента |
| requestId | Идемпотентность управляющего изменения |
| configVersion / profileRevision | Версии подписанной конфигурации и профиля |

Если AI account scope недоступен надёжно, нельзя склеивать диалоги эвристически по заголовку. Используется ограниченный локальный scope с явной неопределённостью межбраузерной сверки.
ConversationKey на сервере передаётся как account-scoped opaque digest; полный URL, название и история не нужны. Секрет для стабильного HMAC-домена аккаунта служит только этому назначению, не является marketplace key.

## Служебные операции

- Auth/device activation/refresh: существующий контракт, ротация refresh атомарна; в установке один refresh flight.
- Bootstrap: подписанные account/device/access/compatibility/AI-policy; payload S1.1 дополнительно сообщает `accessBasis` (`BETA`, `COMMERCIAL`, `NONE`). Поле optional для старых потребителей, но сервер всегда выдаёт его. Для BETA подписка остаётся `NONE`, entitlement-коммерция не симулируется, а обычные TTL/offline-grace не ограничиваются несуществующим коммерческим expiry.
- OTP verify принимает стабильный `Idempotency-Key` на логическую попытку. Сервер хранит только HMAC-идентификатор и минимальную квитанцию replay; портал переиспользует ключ только при retry той же попытки.
- S1.1 admin contract: `GET/POST /v1/admin/beta/admission` с optimistic `revision`, bounded reason, explicit action и requestId.

### Future I1 extension impact

The unified extension is not imported in this repository. At I1 its bootstrap consumer must treat `accessBasis: BETA` as sufficient control-plane access, preserve `subscription.state=NONE` as a genuine no-subscription value, and avoid deriving a commercial device limit from the BETA basis. Existing extension bootstrap parsing must tolerate the optional field while the unified contract version remains `control_plane_v1`.
- Shop metadata: список/создание/переименование/удаление, revision и idempotency; без raw credential.
- Binding reconcile: изменения конкретных привязок с baseRevision/requestId и последними локальными маркерами.
- Transfer request/status/channel: отдельный редкий путь с согласованием получателя.
- Diagnostics/aggregates: схемы allowlisted, ограниченные пачки, deduplication.
- Beta admission/admin: атомарная регистрация и отдельные административные команды [BETA_ADMISSION](../product/BETA_ADMISSION.md).

Поля новой схемы появляются в packages/contracts, затем сервер и клиент реализуют одну и ту же версию.
Добавление нового необязательного блока не делает старый клиент недействительным. Изменение смысла обязательного поля требует версии/периода совместимости.
В бете ответ DEVICE_LIMIT_REACHED не используется как коммерческое ограничение установок.

## Сроки и отказ

Уже принятый source snapshot содержит issuedAt, expiresAt, offlineGraceUntil. Не менять эти сроки неявно при миграции.
Техническая цель для беты: фоновое обновление примерно раз в час активной установки с jitter; валидный локальный snapshot используется без запроса на каждую команду.
Конкретные signed TTL и предел автономности сохраняются из принятой source policy и фиксируются в release manifest до интеграционного выпуска. Они должны позволять этот интервал; если нет — корректировать policy явно с тестом, а не менять браузерный таймер наугад.

Первая активация требует сервера. Уже авторизованная работа при сети/5xx идёт в пределах подписанного допуска.
После offlineGraceUntil новые API-запуски требуют успешного обновления; уже полученный допустимый результат остаётся локальным и обрабатывается по TTL/состоянию сессии.
Известный отзыв/запрет не маскируется как offline. Конфликт optional reconcile не превращается в ошибку базовой авторизации.

## Ошибки

Стабильный code, безопасное message, requestId, retryable и при наличии retryAfter; клиент ветвится по code.
Группы: AUTH_REQUIRED/DEVICE_REVOKED; CLIENT_UPDATE_REQUIRED; BETA_CLOSED/BETA_CAPACITY_REACHED; STORE_IDENTITY_MISMATCH; BINDING_CONFLICT; SOURCE_OFFLINE/TRANSFER_EXPIRED; LOCAL_QUOTA_WAIT; PROVIDER_RATE_LIMITED; RESULT_EXPIRED; DELIVERY_UNKNOWN.
retryable означает допустимость по политике, а не приказ автоматически повторить бизнес-запрос.
Ошибка на один item не удаляет остальные результаты пакета.

## Версии и совместимость

Расширение и сервер имеют независимые версии. Release manifest связывает extensionVersion, browser package hash, source commit, contract versions, minimum compatible server, profile schema/strategy versions и migration version.
Bootstrap не сбрасывает квоты, credentials, завершённые execution или локальный buffer из-за смены AI profile.
Новые схемы БД вводятся expand/contract с проверкой работающей предыдущей версии; rollback кода не объявляется rollback необратимой миграции.

## Stream 2 Telegram operator control contracts

Telegram operator control plane имеет два независимых lane contract:

**LLM**: status, interval, run-now, latest run/result/incident.

**SWAGGER_API**: status, interval, run-now, pending official-source requests, upload intake/result.

Canonical command surface:

- `/llm_status`
- `/llm_interval <duration>`
- `/llm_run`
- `/swagger_status`
- `/swagger_interval <duration>`
- `/swagger_run`

Buttons invoke those same underlying operations.

Durable control state stores each lane independently: enabled/status, configured interval, next/last run, active run ID and last result. A manual run does not mutate interval. Same-lane active run returns deterministic ALREADY_RUNNING (or an explicitly versioned queued-run policy); one lane does not implicitly start the other.

Swagger operator request contract contains requestId, provider, officialSourceUrl, expected content type/format, created/expires timestamps and state. Reply/document intake binds to the pending request and produces a quarantined candidate with SHA-256/provenance. Candidate states are at least RECEIVED/QUARANTINED, VALIDATED, REJECTED and CONSUMED. Validation does not equal architect acceptance.

Telegram events and uploaded specs have `executionAuthority=false` by architecture. They cannot mutate Stream-1 Work/Bootstrap/offline permissions, commercial/device entitlement or production adapters.
