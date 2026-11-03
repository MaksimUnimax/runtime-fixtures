# Алиса + DeepSeek + аналитика Ozon/Wildberries — контекст и журнал работ

**Статус:** рабочая документальная ветка отдельного голосового продукта.  
**Источник:** последовательность сообщений владельца и ответов ассистента в текущем диалоге, дополненная только явно обозначенными наблюдениями подключённого сервера Alisa.  
**Дата первоначальной фиксации:** 03.11.2026.  
**Ветка:** \`alisa\`, создана от основного репозитория \`MaksimUnimax/runtime-fixtures\`, базовый \`main\` на момент создания: \`c5d0ad95397c376928da7462d7606993e32fbbd4\`.

> **Важно:** здесь содержится подробная реконструкция решения и последовательности работ, **не дословный экспорт всей переписки** и не приватные внутренние рассуждения модели. Сохранены причины выбора, отвергнутые альтернативы, числовые гипотезы, пользовательские решения, доказательства, ошибки и незакрытые проверки. Нельзя принимать историческое утверждение помощника за результат технического испытания.

## Что за продукт

Отдельный от архитектуры Octoport продукт: **владелец магазинов задаёт голосовой вопрос через Яндекс Станцию**, официальный навык Яндекс Диалогов обращается к нашему HTTPS-сервису, сервис проверяет учётную запись и разрешённые подключения, читает подготовленные или загружает новые данные **Ozon Seller / Wildberries**, считает показатели обычным программным кодом и озвучивает результат через Алису. **DeepSeek** — внешний API для понимания сложных русских запросов, а не «мозг» для арифметики. На первом этапе только **Алиса на колонках и DeepSeek**, **без новой платформы агентов, Сбера и обязательной мобильной версии**.

**Решение владельца:** число магазинов в аккаунте **не ограничивать**; при добавлении указывается название, маркетплейс и реквизиты доступа. Один раз связывается аккаунт сервиса с Яндексом, а не каждый магазин отдельно. Не требовать поштучного согласования магазинов в связке Алисы.

## Навигация по документам

| Файл | Что сохранено |
|---|---|
| [01_TIMELINE.md](01_TIMELINE.md) | Хронология всей ветви беседы: аудиты Octoport, переход к голосовому продукту, проверки и фактические исходы |
| [02_PRODUCT_SCOPE_AND_DECISIONS.md](02_PRODUCT_SCOPE_AND_DECISIONS.md) | Подтверждённые решения владельца, предложения ассистента, отказанные альтернативы, полный UX и требования |
| [03_SYSTEM_ARCHITECTURE.md](03_SYSTEM_ARCHITECTURE.md) | Логическая архитектура, магазинный учёт, извлечение данных, маршрутизация, очереди, ETA, безопасность, напоминания |
| [04_YANDEX_DIALOGS_RUNBOOK.md](04_YANDEX_DIALOGS_RUNBOOK.md) | Точный существующий навык и ссылки на разделы; настройки, OAuth, HTTPS, сценарии, тесты без/с колонкой |
| [05_SERVER_ACTUAL_STATE.md](05_SERVER_ACTUAL_STATE.md) | Что действительно развернуто на Alisa, версии, сервисы, файлы, результаты тестов и неизвестное |
| [06_DEEPSEEK_MODELS_AND_TESTS.md](06_DEEPSEEK_MODELS_AND_TESTS.md) | DeepSeek Flash/Pro, выбор, тарифные допущения, ключи (без секретов), реальные API-проверки и бюджет |
| [07_VERIFICATION_MATRIX.md](07_VERIFICATION_MATRIX.md) | Таблица TESTED / SIMULATED / OPEN / FAILED для каждого ключевого звена |
| [08_ECONOMICS_MARKET_TIMELINES.md](08_ECONOMICS_MARKET_TIMELINES.md) | Рынок, устройства, расчёт для 3 000 клиентов, серверы, тарифы, бюджет $300/мес и границы срока |
| [09_OAUTH_POPUP_INCIDENT.md](09_OAUTH_POPUP_INCIDENT.md) | Последний скриншот: «Авторизоваться» → «Произошла ошибка», доказанная и неизвестная причина |
| [10_NEXT_ACTIONS_AND_ACCEPTANCE.md](10_NEXT_ACTIONS_AND_ACCEPTANCE.md) | Реальная очередь разработки, проверки безопасности, условия запуска, выдачи и эксплуатации |
| [11_SOURCE_REGISTER.md](11_SOURCE_REGISTER.md) | GitHub, исходные Яндекс/DeepSeek/Ozon/WB документы, серверные источники, ранние артефакты |
| [12_CHANGELOG.md](12_CHANGELOG.md) | Протокол последующих пополнений и сохранение авторства изменений |
| [13_OCTOPORT_BACKGROUND.md](13_OCTOPORT_BACKGROUND.md) | Контекст прежних аудитов Octoport и главное: не переносить его архитектуру в отдельный продукт |
| [server-snapshot/](server-snapshot/) | Снимок только несекретных исходников текущего лабораторного приложения, если приложен и проверен отдельно |

## Правила достоверности

- **OWNER DECISION:** прямое решение владельца в диалоге; не превращать предложения ассистента в такие решения.
- **DOC:** опубликованная документация платформы, сама по себе не аппаратный PASS.
- **OBSERVED:** подтверждено на конкретном сервере/через опубликованный HTTPS в момент замера.
- **LOCAL TEST:** исполнено на искусственных данных; не доказательство работы реальной Станции/Ozon/WB.
- **LIVE PROVIDER TEST:** настоящий вызов DeepSeek, но не интеграция финансовой отчётности.
- **PROPOSED:** проектное решение, ещё не реализовано/не согласовано.
- **UNKNOWN/FAIL:** неизвестный исход или подтверждённая ошибка; не устранять выдуманной отметкой PASS.

**Секреты запрещено публиковать:** API-ключи, OAuth client secret, учебный пароль, access/refresh tokens, содержимое \`/etc/alice-lab/lab.env\`, \`/var/lib/alice-lab/secrets/\`, DB с реальными клиентскими данными, заголовки Authorization и полные приватные журналы. Репозиторий **публичный**. Не добавлять эти данные даже «для полноты истории». IP и технические пути оставлены в документах там, где необходимы для воспроизводимости; SSH с доступом по паролю следует рассматривать как отдельный риск и ограничивать штатными средствами.

## Как продолжать

При каждом следующем фактическом этапе работы над Алисой: сверить live-state, обновить соответствующую страницу с \`UTC\`, источником, версией, отрицательными проверками и фактическим результатом, добавить запись в \`12_CHANGELOG.md\`; не переписывать старый FAIL и не объявлять пакет установленным без наблюдения. **Автоматическая работа между диалогами не запущена.** Владелец просит продолжать ведение этой ветки до его явной отмены при выполнении последующих поручений.

**Граница выполнения при создании записи:** создана документальная ветка и документы; не выполнялись новый deploy, платные вызовы, миграции данных или исправления OAuth только ради записи контекста.


## OAuth incident update — 2026-11-03

**Issue:** On skill `e1efec78-63de-43b0-87b9-0fb6ee0ed5fe` (display name “Октопорт маркет”), Yandex Dialogs draft correctly displayed an “Авторизоваться” card from `response.directives.start_account_linking`; clicking it opened `dialogs.yandex.ru/store/account_linking/...` with “Произошла ошибка”, before any confirmed external login. **Root cause not yet proven.**

**Independent server checks (Alisa):** TLS valid; `https://alice-lab.octoport.ru/healthz` returns HTTP 200; `GET /oauth/authorize` with safe synthetic OAuth parameters `response_type=code`, `client_id=dialogs-lab`, `redirect_uri=https://social.yandex.net/broker/redirect`, `scope=reports:read` returns HTTP **200** (~46 ms). Prior synthetic OAuth issuance and refresh tests passed; they are not a genuine Yandex account-linking PASS. `LINK_MODE=nested`; both official reference and the screenshot show a supported card, while the “make skill” tutorial documents a conflicting root form. Do not change response shape without a controlled diagnosis.

**Diagnostic change deployed:** Nginx OAuth-only safe request log at `/var/log/nginx/alice-lab-oauth-safe.log` logs only date, method, path (no query), status, upstream status and duration; no client IP, cookies, auth headers, secrets, state or code. Verified synthetic GET log `GET /oauth/authorize 200 200`. Services remain active and the main `octoport.ru` points to its separate server.

**Next action in Yandex console:** Validate the saved **Связка аккаунтов** for this exact skill: client ID `dialogs-lab`; client secret matches server (never publish); authorize `https://alice-lab.octoport.ru/oauth/authorize`; token `https://alice-lab.octoport.ru/oauth/token`; refresh `https://alice-lab.octoport.ru/oauth/refresh`; scope `reports:read`. Save and reload. On one controlled click of “Авторизоваться”, compare the contemporaneous safe OAuth log. If no `GET /oauth/authorize`, the break is upstream of our OAuth endpoint (Yandex configuration/session/browser); if 400/401, inspect server validation; if 200, trace the next OAuth step. Avoid blind replays of UNKNOWN outcomes. Request a settings screenshot with the secret masked if console state cannot be inspected from connected tools.


## OAuth follow-up: root directive test — 2026-11-03

**Observed:** At 2026-11-03 02:26 UTC the live Yandex Dialogs draft continued to call the skill webhook (HTTP 200), but the OAuth-specific Nginx log at `/var/log/nginx/alice-lab-oauth-safe.log` showed **no `GET /oauth/authorize` after the user clicked «Авторизоваться»**. No evidence that our OAuth frontend was contacted. This localizes the current failure upstream of that endpoint, but does **not** establish whether the cause is the Dialogs client config, authorization response placement, Yandex broker or browser state. The supplied console text listed OAuth field names, not readable saved input values; their correctness cannot be assumed.

**Official documentation conflict:** The specific Yandex tutorial `https://yandex.ru/dev/dialogs/alice/doc/ru/auth/make-skill` prescribes a top-level `start_account_linking` with no `response`; the reference `https://yandex.ru/dev/dialogs/alice/doc/ru/response-start-account-linking` shows `response.directives.start_account_linking`. The previous nested format rendered the authorisation card, but the Yandex broker pop-up failed with «Произошла ошибка». Neither variant has yet produced a completed real Dialogs account link.

**Controlled change:** On server Alisa only, backed up the private environment file to `/root/alice-lab-evidence/lab.env.before-root-link-test-20261103` without exposing its content, set `LINK_MODE=root`, restarted only `alice-lab-web.service`. An independent synthetic request through `https://alice-lab.octoport.ru/alice/webhook` confirmed HTTP 200 and exact JSON top-level keys `start_account_linking` and `version` with **no `response`**. A separate regular «проверка связи» round-trip passed. `alice-lab-web`, `alice-lab-worker`, `alice-lab-llm` remain active, no unexpected restarts. **Actual user-facing Yandex result after this change is pending.**

**Next one-time observed case:** Start a new draft session, request a protected LLM lab action, click the Yandex card once. Correlate Nginx OAuth log. If no callback, inspect the actually saved client ID (expected `dialogs-lab`), authorize URL `https://alice-lab.octoport.ru/oauth/authorize`, token URL `https://alice-lab.octoport.ru/oauth/token`, refresh URL `https://alice-lab.octoport.ru/oauth/refresh`, scope `reports:read` and secret equality **without publishing the secret**. In Chrome DevTools Network with Preserve log, capture only request host/path, status and sanitized error category, never full query/state/code/token. Do not interpret a successful synthetic OAuth test as real Yandex OAuth success. If the root format breaks card rendering, restore previous mode from the saved private configuration before doing further tests.
