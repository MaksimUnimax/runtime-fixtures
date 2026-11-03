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


## 2026-11-03 — pinpointed error in Yandex Store OAuth popup

**Grounded browser-side finding (public static Yandex assets, read only):** `https://dialogs.yandex.ru/store/account_linking/{skill_id}` loads Yandex Store frontend version **0.284.0**. JS page chunk `_next/static/chunks/pages/store/account_linking/%5Bid%5D-3b6ab197045ac18a.js` uses a React `useEffect` calling the store API helper `(0,C._$)(skillId, {"csrf-token":window.__sk})`. Its `.catch()` renders exactly **«Произошла ошибка»**. The corresponding helper from `_app-4aa3a66ea3abc261.js` requests:

`GET /store/app-store-api/dialogs/e1efec78-63de-43b0-87b9-0fb6ee0ed5fe/account_linking`.

This is Yandex's **own skill/account-linking metadata request**, preceding any redirect to our `https://alice-lab.octoport.ru/oauth/authorize`. Changing our OAuth implementation or toggling nested/root directive is not a grounded fix for the observed screen; both formats led to the same user-visible error.

**Independent unauthenticated probe:** Requests from Alisa (without user's Yandex ID cookies or CSRF token) gave:

- `GET /store/app-store-api/dialogs/{skill_id}` → **HTTP 200** with `{"result":null}`.
- `GET /store/app-store-api/dialogs/{skill_id}/account_linking` → **HTTP 404**, JSON message **`Skill not found`**, underlying URL `/api/catalogue/v2/dialogs/{skill_id}/account_linking`.

**Crucial scope:** anonymous 404 is NOT proof of the exact HTTP status seen in the logged-in user's browser; private/unpublished skills may be deliberately invisible anonymously. We need the status/response for this exact request in that user's authenticated popup to establish the precise failure.

**Evidence and likely actionable root cause:** Owner's screenshot shows `Тестирование Черновик` and private skill. Earlier assistant repeatedly instructed to keep a private *draft* without publishing. Yet official Yandex documentation `https://yandex.ru/dev/dialogs/alice/doc/ru/access` says changing access to **Приватный** and actually clicking **Опубликовать** are separate steps; private publication triggers automoderation and does NOT put the skill in the public catalog. Because the popup looks up this skill via the Store catalogue API, an unpublished or not-yet-available private skill is a plausible cause. **Not proven** without checking the existing skill's real publication status and authenticated Store API response.

**Proposed measured resolution:** In `События` verify whether a private published version actually exists. If not, on the existing skill while access type remains `Приватный`, use **Опубликовать**, observe outcome, then test the same account-linking popup only after published state is confirmed. Do NOT change to `Публичный`, create a second skill, expose real marketplace data, or assume publication guaranteed. If already privately published or the error persists, inspect Chrome DevTools Network for `/store/app-store-api/dialogs/.../account_linking`: record only **HTTP status, safe error message, request host and path** (NOT cookies, CSRF header, query strings, OAuth state or tokens). A real 404 for the owner session would strongly support catalogue unavailability; 401/403 suggests Yandex login/session/permissions; 5xx suggests provider failure. The next user action must be based on this result, not speculation.

**Server status:** Alisa web, synthetic job worker and DeepSeek Flash worker remain active. No successful external OAuth callback was seen during the failed popup attempts. Existing server probe with valid synthetic OAuth parameters returned HTTP200, but that is not real Yandex account linking. No user secrets collected in this audit.

**Correction to earlier analysis:** The primary app-store popup error is not merely an ungrounded possibility concerning our `start_account_linking` JSON; there is a specific failing frontend fetch to Yandex's own `/account_linking` metadata API. The previous pattern of switching directives without this evidence wasted owner time.


## 2026-11-03: owner screenshot confirms no publication event

Owner supplied screenshot of the existing \`Октопорт маркет\` Dialogs skill under \`События\`. It displayed exactly **one event, «Создан», about 16 hours earlier**, and no moderation or publication events. The same page showed **Приватный** and a **Черновик** section. These are distinct status dimensions; selecting private does **not** publish the skill.

Verified current official docs (2026-11-03): 
- https://yandex.ru/dev/dialogs/alice/doc/ru/access — private skill instructions are (1) open skill, (2) choose "Приватный", (3) **publish** it. It remains hidden from public catalogue, and private publication is auto-moderated.
- https://yandex.ru/dev/dialogs/alice/doc/ru/moderation — FAQ specifically says use **Опубликовать** for a private skill (with automoderation).
- https://yandex.ru/dev/dialogs/alice/doc/ru/publication — draft vs published states differ, a moderated draft and published version can coexist.
- https://yandex.ru/dev/dialogs/alice/doc/ru/auth/test-skill — docs also promise account-linking tests in developer console before publication, so **unpublished status is a concrete omission and strong hypothesis, not yet proven sole root cause of the OAuth popup failure**.

Prior read-only independent GET without owner cookies to Yandex Store's \`/store/app-store-api/dialogs/{skill_id}/account_linking\` returned **404 Skill not found**; this cannot be treated as proof of authenticated owner-session response. JavaScript of the popup shows that a failed metadata fetch displays "Произошла ошибка" before contacting our OAuth endpoint. The pre-existing Alisa safe OAuth log likewise had no new outbound link attempt during the owner's errors. Changing our directive from nested to root did not resolve the user's observable error; live server most recently had \`LINK_MODE=root\`.

**Specific next action:** Owner goes to existing skill \`e1efec78-63de-43b0-87b9-0fb6ee0ed5fe\`, open "Черновик" / "Основная информация" and look for **Опубликовать** or **На модерацию** in the management UI, while keeping **Приватный**. If any validator errors appear, capture visible error text and rectify exact field, never invent credentials or launch public release. Confirm outcome in \`События\` and do not retry publishing when the outcome is UNKNOWN. After published/approved status, repeat private OAuth popup once and correlate Store API and safe OAuth log. If still failing, capture only sanitized HTTP status of \`/store/app-store-api/dialogs/.../account_linking\` from owner-session Chrome DevTools; don't expose cookie, csrf-token, auth state/code or full URL.

**No publication performed by this assistant**; remote Yandex developer console owner session is not accessible via currently connected Browser plugin. Existing server and DeepSeek remain unmodified in this documentation update.


## Moderation dialog screenshot — 2026-11-03

Owner reached **«Готово к модерации»** modal for private Yandex Dialogs skill `Октопорт маркет` (ID `e1efec78-63de-43b0-87b9-0fb6ee0ed5fe`). Screenshot explicitly requests **comment to moderator with credentials for a test account if authorization is required**. Official Yandex docs `https://yandex.ru/dev/dialogs/alice/doc/ru/auth/send-to-moderation` confirm login/password and explanation of authentication process should be supplied. Private publication still needs submission; the private skill is not a public catalogue listing.

Server Alisa last observed: `alice-lab-web` active, `/healthz` HTTP200 `alice-lab-20261103-deepseek-r1`, synthetic-only store data, `demo-a` available in OAuth login form. Proposed safe moderator note: skill is a synthetic demonstration, choose `Учебный A`, use its dedicated current lab-only password stored in root-controlled `/etc/alice-lab/lab.env` under `LAB_TEST_PASSWORD`; verify `проверка связи`, `проверка нейросети`, protected `длинный тест` after account linking. No real Ozon/WB data or access. **Never publish LAB_TEST_PASSWORD, OAuth client secret, DeepSeek key or user token in this public repository.** Moderator-only input is for test password; secret should be inserted locally by owner and never sent through chat.

Previous popup error `Произошла ошибка` on account linking is **still unresolved**; publishing could change Store availability but cannot be declared a fix before a successful owner-session test. Another attempt to add a separate `demo-moderator` account was blocked by tool safety before server writes; the existing `demo-a` lab account is a temporary workaround for moderation (not a real retailer account). No service changes were confirmed from that blocked attempted write. If moderation reports login failure, record the exact outcome, do not claim acceptance.
