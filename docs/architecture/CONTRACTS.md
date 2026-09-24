# Контракты и версии

Сохраняем `control_plane_v1` и принятые auth/bootstrap semantics для уже
установленных клиентов. I1-SRV.1 использует отдельный `control_plane_v2` /
`bootstrap_snapshot_v2` / `bootstrap_envelope_v2`: строгий v1 payload остаётся
без `account.id`, а v2 подписывает канонический Seller Agents account UUID.
Для v1 сохраняется rollout authority `bootstrap.config`; v2 в этой волне
выбирает только последний опубликованный `CONFIG_RELEASE` своей версии.
Отдельный `bootstrap.config.v2` rollout и миграция базы не вводятся.
`profile_compatibility_v1` сохраняет свой schemaVersion; его `contractVersion` всегда указывается явно как `control_plane_v1` или `control_plane_v2`. Существующие v1-профили и их fingerprints не меняются, автоматического повышения версии нет.
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

### Текущий потребитель расширения

Единое расширение и control-client находятся в этом репозитории. Текущий I1 потребитель использует подписанный control_plane_v2/account UUID; сервер сохраняет отдельную совместимость v1. accessBasis=BETA достаточен для beta-доступа, subscription.state=NONE не подменяется подпиской, коммерческий device limit из BETA не выводится. Общий контракт меняется через одного автора C с проверками потребителей A/B; актуальная программа — docs/development/coordination/README.md.
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
Согласованная 2026-09-24 целевая политика доступа: [SUBSCRIPTION_ACCESS_POLICY](SUBSCRIPTION_ACCESS_POLICY.md). Плановое обновление примерно раз в 24 часа во время использования, одно на установку; перед командой проверка локальная. Для коммерческого доступа подтверждённый оплаченный срок плюс фиксированные 72 часа после его конца при отсутствии нового достоверного ответа; актуальный подтверждённый запрет прекращает новые запросы сразу. BETA остаётся отдельным основанием. Это утверждённые требования, не заявление о внедрённых TTL/полях.
При реализации сроки и привязку подписи согласовать явно с потребителями и release manifest; не менять смысл существующих полей неявно. Служебные события авторизации, совместимости, переноса и согласования имеют отдельные причины: суточный интервал лицензии не запрещает их и не требует запроса на каждую вкладку.

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
