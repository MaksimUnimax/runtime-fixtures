# AL-S07: платформенная проверка прав для RuntimePort

09.11.2026. **SOURCE_QUALIFIED_NOT_INSTALLED**. База `779956a01d41b7aa8fcb638aabfb33b3eddbde65` (PR 405). Независимое review — PENDING. Автор меняет только адаптер платформы, его конфигурацию/закрытый маршрут, собственные тесты и соответствующий CI. Код матрицы, runtime, Station и их действующие БД этим изменением не затрагивается.

## Поведение

`RuntimeAuthority` использует существующие Customer/Membership, WebSession либо OAuthlib TokenFamily, AccessLedger/AccessGrant и Store/CredentialRevision. Новых таблиц, миграций, identity или расчётной матрицы нет. При каждом обращении заново проверяются аккаунт, членство, действующий период, магазин, подтверждённые ключи и их ревизии. Отсутствующая AccessLedger не превращается в неявную ревизию 1.

`for_session(token, store_ids)` и `for_alice(token, store_ids)` возвращают Authorizer для уже опубликованного RuntimeClient. `prepare` выдаёт Django-signed admission ticket максимум на 120 секунд с ограничением по сроку сессии/токена и доступа. Ticket связан со средой, service/catalog, всеми pins, отпечатком native scope и текущей записью сессии/токена. Открытый браузерный/OAuth токен и ключи магазина в ticket и persisted runtime pins не входят. Vault ciphertext не читается и не расшифровывается.

`current` повторно проверяет читателя и ticket перед вызовом и перед выдачей. Выход, отвязка навыка, замена access token при refresh смена OAuth-клиента и выключение привязки навыка запрещают новые обращения этого читателя. Выключенная authority отказывает до обращения к базе.

Короткий ticket — допуск на приём, а не срок всего расчёта. После durable acceptance worker использует `resolve(pins, action)`: повторно проверяет продуктовые права и точный scope. Выход одной сессии не отменяет общее задание для другой действующей сессии того же пользователя. Блокировка аккаунта, отзыв периода/ключа, изменение security/access/store pins или native mapping запрещают дальнейший dispatch/read. Cancel конкретного задания остаётся отдельной операцией.

## Явная привязка магазинов

`BindingFile` свежо читает доверенную конфигурацию оператора: public tenant/store UUID → конкретные native tenant/store/identity/access/source revisions. Название, email и один provider ID не создают привязку. Файл принадлежит root, обычный, без symlink, не доступен на запись группе/остальным; родители также доверенные и не допускают такую запись. Допустим root:service-group 0640. Проверяются размер, строгая JSON-схема, отсутствие повторов и совпадение environment/service/catalog.

Каждая запись содержит точные IDs/kinds/revisions действующих CredentialRevision и отдельную положительную `credential_revision` поколения связки. Изменение привязки меняет scope fingerprint даже при забытом bump поколения; ранее выданный ticket перестаёт проходить проверку. Фактические привязки владельца тестовыми значениями не создаются.

Первый квалифицированный native Ozon scope требует подтверждённую пару SELLER + PERFORMANCE; WB — WB. Это ограничение данного S07 mapping, а не изменение существующих форм подключения/Seller-only сценариев. Селективный scope под отдельные источники требует отдельного контракта с владельцем runtime. Ни один отсутствующий магазин не пропускается молча. Общие технические пределы не означают гарантированную поддержку максимума: ticket, запрос и ответ дополнительно ограничены по размеру.

## Закрытый RPC

`POST /internal/runtime/authority`, выключен по умолчанию, без публичного BFF-маршрута. Настройки: `ALISA_RUNTIME_AUTHORITY_ENABLED`, отдельный `ALISA_RUNTIME_AUTHORITY_TOKEN`, `ALISA_RUNTIME_BINDINGS_PATH`, `ALISA_RUNTIME_SERVICE_ID`, `ALISA_RUNTIME_CATALOG_RELEASE_ID`. Service token отличается от browser/auth/staff/skill/owner-runtime tokens. Конфигурация проверяется на старте; ошибок с раскрытием ввода нет.

Тело: `{schema: runtime_authority_v1, request_id: UUID, service_id, operation, payload}`. Операции: `verify` с `{ticket}` и `resolve` с `{pins, action}`. Лимит тела 131072 байта; Origin, query string, Transfer-Encoding, неизвестные поля, дубли JSON и неверные типы отклоняются. Ответ `{payload, mac}`; HMAC-SHA256 подписывает канонический payload и request_id, включая безопасный отказ. Неверная схема до проверки UUID даёт request_id null. При выключенной функции 404 без БД.

Runtime consumer обязан независимо проверять HMAC, уникальный request_id и product/schema, использовать отдельный закрытый транспорт с конечными timeout/размерами и преобразовывать строгий scope JSON в собственный Scope. Возвращённый JSON сам по себе не является готовой установленной интеграцией.

## Проверки автора

В PostgreSQL **16.15**: **43/43** тестов authority. На той же PostgreSQL и оригинальном pinned RT-JOB-R01.1: **8/8** тестов через настоящий Unix listener, очередь SQLite и worker. Provider/model — только синтетический транспорт; внешняя сеть/DNS запрещены. Отдельный fixture переводит JSON scope в runtime Scope; production consumer не подменялся этим fixture.

Подтверждены browser/OAuth admission, отзыв доступа/ключей, замена mapping без bump, отсутствие повторного расчёта при чтении, один durable submit при повторе ID, отзыв ключа внутри provider call с запретом выдачи, продолжение после logout для другой действующей сессии и после естественного истечения admission ticket. Миграции/model consistency и защита append-only runtime-роли — PASS. Собственная тестовая база и роли удалены, тестовый контейнер остановлен и удалён. Хеши проверенных исходников совпали побайтно с рабочим деревом; сведения в `runtime-authority-20261109/qualification.json`.

Первый SQLite bootstrap остановился до тестов: штатная миграция требует PostgreSQL; ограничение сохранено. Первый PG прогон выявил лишнее чтение сессии при выключенной функции: feature gate перенесён до чтения. Исправлено ожидание теста для request_id недоверенного тела. В отрицательном roundtrip исходная фраза возвращала METRIC_AMBIGUOUS до постановки задания; сценарий заменён на квалифицированную фразу с отзывом непосредственно внутри provider call. При дополнительной проверке воспроизведён пропуск после смены OAuth-клиента: старые grant и ticket принимались. Добавлено точное совпадение client_id и при выдаче, и при проверке ticket; новый отрицательный тест сначала упал на обоих действиях, после исправления прошли 38 + 8 проверок. Логика матрицы не менялась.

CI теперь явно запускает 43 PostgreSQL-тестов authority. Ещё 8 Unix roundtrip требуют отдельно предоставленный оригинальный пакет RT-JOB и в обычном CI не исполняются. Запуск из `products/alisa`:

```sh
.venv/bin/python tests/integration/qualify_runtime_authority.py --output dist/s07-authority-qualification.json
# Дополнительно, с неизменённым оригинальным RT-JOB-R01.1:
.venv/bin/python tests/integration/qualify_runtime_authority.py --output dist/s07-roundtrip-qualification.json --runtime-source /absolute/path/to/pinned-runtime
```

Используется уже оговорённая пустая disposable CI PostgreSQL на loopback 55480, ALISA_TEST_DB_ALLOW=1 и отдельный ALISA_TEST_PG_DSN. Live environment не наследуется. Новая база/роли создаются только при точном совпадении тестовой идентичности и отсутствии посторонних БД. Код не ослабляет append-only права для подготовки fixtures.

## Следующий допуск

Общий CI первой ревизии выявил гонку в существующем S06 browser fixture: сразу после click проверялся callbacks/cookie, хотя перехваченный настоящий POST ещё выполнялся. В safe qualification record отмечен `s06_consent_denial_has_no_code_and_clears_pending_cookie`; закрытие контекста после раннего отказа затем порождало вторичный TargetClosedError. Fixture теперь сначала ожидает доставленную страницу собственного broker boundary и лишь затем проверяет все прежние callback/cookie invariants. Ожидание добавлено и после approve, и после deny; ответы сервера не подменяются, существующие проверки не ослабляются. Результат общего CI точной опубликованной ревизии хранится отдельно от авторских 38 + 8.

Независимое review, затем совместная квалификация consumer и **актуального** runtime владельцем ядра. Требуются подтверждённые реальные mapping и отдельные закрытые настройки. Старый R01.1 нельзя устанавливать поверх актуального ядра ради прохождения теста; listener должен использовать его же engine/worker и единственный execution-policy owner. Переключение пользовательского навыка и показ отчётов в кабинете этим source-пакетом не выполнены. Новые магазинные ключи и Ozon-приложение для разработки не нужны.

## Исправления по Sol 6.1 review

Независимое read-only review исходника ceae673: CHANGES_REQUIRED, три P2 и один P3. Автор подтвердил все четыре; исходники reviewer не менял. Точный PostgreSQL тест воспроизвёл deadlock при ledger-locked выдаче grant/notification и authority, удерживающей Tenant/Customer. Для родительских записей выбран FOR NO KEY UPDATE: изменения аккаунта по-прежнему сериализуются, FK KEY SHARE не создаёт цикл с ledger. AccessLedger/Store/Credential locks сохранены.

Dependency failures больше не превращаются в AUTH_REQUIRED: verify, prepare и current сохраняют безопасный DEPENDENCY_UNAVAILABLE, включая RPC 503 и повторную проверку клиента. Подпись/сессия/чужие pins по-прежнему отказывают. Неоднозначный error envelope мутации остаётся UNKNOWN; TTL результата перепроверяется после последнего current. До исправления: authority 43 теста, четыре failure + один реальный deadlock; client 26 тестов, шесть failure. После: 43/43 + 26/26 + 8/8 roundtrip, без внешних API. Повторное независимое review исправленного source ожидается; первоначальный CHANGES_REQUIRED не заменён авторским PASS.
