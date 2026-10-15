# Исправление ревью: мониторинг, Telegram и API Watch

Актуальное основание: [полный отчёт владельца по main 03740125](https://github.com/MaksimUnimax/runtime-fixtures/blob/c404944c163691e5118b8f33de7107da1830fcd7/review-files/code-review-2026-10-14-03740125.md), прямая команда 14.10.2026 06:12 МСК. В отчёте пять открытых P2. Прежние sourceSeen и два HTTPS дефекта независимо воспроизведены как исправленные; повторная разработка не выполняется. Первоначальная база PR97: `0374012512cf9cc7640a0583a107a3f6a37dd9d4`.

## Поведение кандидата

- Ошибки чтения/сохранения результата мониторинга обработаны в обеих ветках фоновой задачи и в периодическом tick. Ожидающий caller получает исходный отказ; диагностика содержит безопасные code/lane. Синхронный и асинхронный отказ диагностического callback не завершает Node. Durable lease сохраняется, успех не выдумывается, runner повторно ради восстановления не выполняется.
- Telegram продвигает offset всей raw-страницы, включая неподдерживаемые updates. Прогресс монотонный; прежний per-update запрет повторного выполнения при неоднозначном handler failure и авторизация сохранены.
- Семейный retry budget расходуется один раз за законченный acquisition pass. 13 документов WB получают два ограниченных retry-прохода. Частичный успех не сбрасывает failure episode. HTTP 429 сохраняет один повтор и максимальный Retry-After с прежним ограничением.

## Независимое ревью и доработка

A лично проверил точный `92a24875728faf65fc3a1c466aafe38113dde72c` и вернул REWORK_REQUIRED. Нового source-дефекта в мониторинге и Telegram в проверенном scope не найдено; native PostgreSQL им не проверялся. В API Watch найден смешанный случай 403 + 503/429: family retry повторно запрашивал документ, требующий источника оператора. Приёмки этого SHA нет.

Доработка ставит OPERATOR_SOURCE_REQUIRED выше transient-отказа. Старый retry deadline отменяется с сохранением episode и счётчика. Scheduled проход не запрашивает operator-held семейство, в том числе при пробуждении общей SWAGGER_API lane повторами Ozon. Используется последнее authority evidence точного documentKey/URL; явный проход оператора и новая конфигурация могут получить свежее evidence. Pending manual request и принятые snapshots не удаляются.

На исходном `92a24875` все девять адресных проверок доработки воспроизвели дефект. После исправления 295 тестов API Watch прошли; затем добавлены три положительных контроля явного прохода и изменения URL/documentKey. Последняя проверка затронутых suites: 17/17 PASS, API Watch typecheck и ESLint всех новых/изменённых TypeScript файлов PASS. Ошибка TypeScript счётчика в новом тесте исправлена; её первичный неуспешный результат сохранён и не считается продуктовым repro.

## Исходные проверки PR97

Node 24.20.0, Vitest 3.2.6, конечные cgroup; ответы Telegram/WB синтетические. На неизменённой базе исходных изменений — девять падающих assertions и три положительных контроля. После исправления 16 новых тестов прошли: отдельные процессы Node, stale-owner и второе направление, 100 неподдерживаемых Telegram updates, handler-failure fence, WB passes 0/15/75 минут, частичный успех, Retry-After и authority blockers.

На `92a24875` — 381 уникальный затронутый Vitest-тест PASS; typecheck monitoring-control, api-watch и telegram-operator, lint и diff check PASS. В первоначальном общем запуске swagger-handoff.test.ts имел отказ из-за cwd; из monitoring-control прошёл 31/31 без изменения исходника. Ошибочный собственный fixture без ensureDefaults и ожидание SQL-поля вместо публичного activeRun исправлены; эти красные результаты сохранены отдельно. Telegram typecheck выполнен с предусмотренным общим бюджетом памяти и существующими точными зависимостями; package.json и lockfile не менялись.

Пять обязательных GitHub CI на `92a24875` успешны. Они не доказывают successor SHA и не заменяют независимое ревью.

## PostgreSQL и оставшиеся границы

Добавлен изолированный native integration test для существующей disposable PostgreSQL среды Server CI: реальный PG trigger отклоняет сохранение результата; frozen baseline сохраняет catch вызывающего кода и затем завершает Node, кандидат должен пережить отказ, сохранить lease и выполнить второе направление. Отдельный контроль проверяет сохранение runner failure как FAILED. Третий сценарий проверяет 39 загрузок 13 WB документов с настоящими PG schedule/retry stores. HTTP остаётся синтетическим. Frozen scheduler из `03740125` проверяется по исходному SHA256 после нормализации только import-путей/форматирования.

Первоначально эти native проверки ещё не были выполнены; фактические результаты точных successor SHA приведены ниже. Installed, deployment и production acceptance не заявляются. Для нового successor нужны независимое review и пять CI точного SHA перед main.

Профиль ИИ и command-ledger ещё не исправлены этим кандидатом. Передача общих активных путей запрошена у существующих авторов через канонический учёт; чужие WIP, R3, Chromium и профиль Тестера сохраняются. Управление — dot; аудит Контроллера и дисковая очистка владельца сюда не переносились.

Первичные red/green/typecheck evidence и checkpoint сохранены в существующем серверном scope CONTROLLER-4P2-TRUSTEDROOT-20261010T120000Z с префиксом REVIEW_FIX. Самопроверка автора не является независимой приёмкой.

## Повторное независимое ревью 15a60300

A независимо воспроизвёл P2: старый 403 перекрывал более поздний явный 503/принятый источник с одинаковым validatedAt. На точном 15a60300 получены три собственных RED и 14 положительных контролей; +1ms и +1000ms контролям одинаковый timestamp не подменялся.

Store теперь назначает causal sequence в существующем safeProvenance, не меняя validatedAt или схему. PostgreSQL назначает следующий order и вставляет запись в одной транзакции под advisory lock; номер не выбирается caller. InMemory использует сохранённые записи общего state, поэтому смена экземпляра не сбрасывает order. При совпадении времени sequence выбирает более позднюю запись; неоднозначные legacy записи без sequence сохраняют блок до нового явного evidence. Все 304 API Watch tests, typecheck и changed-file lint прошли.

В Server CI на 15a60300 фактически прошли две PG-проверки: runner failure сохраняется как FAILED и WB получает 39 загрузок. Baseline/finalization сценарий остановился при импорте frozen CommonJS fixture, поэтому приёмки этой границы нет. Import-only воспроизвёл SyntaxError отсутствующего named export; явный CommonJS interop успешно загружает прежний класс без изменения frozen scheduler. Дочерний процесс пишет безопасный caller-catch marker синхронно; глобального подавления unhandled rejection нет. Добавлены настоящие PG проверки одинакового времени 403 -> 503/принятый источник и трёх конкурирующих store writers с попыткой caller подменить order. Новые native сценарии ещё требуют выполнения на successor SHA.

A подтвердил отсутствие передачи client.js: OPERATOR-0214-PARALLEL-AUTHORITY-20261010.owner_scope_update.scope_release остаётся PENDING, OPERATOR — назначенный личный автор. Существующий A04 08d777f3 WIP того же файла сохраняется. Для profile/ledger требуется адресная передача dot + OPERATOR; чистый Git не заменяет её. Независимого принятия PR97 пока нет.

На точном `600fcd66ca523da35863771c87b6eee90d2d736e` все пять обязательных CI завершились success; Server CI действительно выполнил шесть native PG сценариев (6/6 PASS), всю integration suite (1854 PASS) и E2E (202 PASS). Таким образом, PG-trigger baseline/candidate и durable одинаковое время/конкурентные writers впервые фактически подтверждены. Это не независимая приёмка и не закрытие profile/ledger.

Дополнительное первичное evidence A для 15a60300 отдельно требует OPERATOR_SUPPLIED AUTHORITY_ACCEPTED того же documentKey/URL. Добавлены адресные source/PG проверки этой trusted record границы с валидированным OpenAPI артефактом и сменой экземпляра store. Изменений продукта после600 нет. Последняя локальная проверка: 24/24 затронутых tests, typecheck/lint и collection семи native сценариев PASS; тип acquisitionMode нового fixture исправлен после TS2322. Новый native OPERATOR_SUPPLIED сценарий и CI successor SHA ещё не выполнены. Auth/upload/installed приёмка этим record-port fixture не заявляется.

## Откат часов: независимое ревью 01bff390

На точном `01bff39025edbe1333f67b51517fa267bba1cbc3` Server CI подтвердил 7/7 native PG, 1855 integration и 202 E2E. Четыре обязательных CI успешны; I1 run 38514476070 отменён. Его пакет из 84 файлов не содержит result.json или точной фазы. Причина отмены UNKNOWN; сборка не доказывает установленную приёмку. Прежние отказы и отдельный автор PR93 сохраняются.

Сохранённое независимое ревью A R5 вернуло REWORK_REQUIRED_SOURCE_PRODUCT: validatedAt сравнивался раньше store-owned sequence, поэтому откат на 1 мс сохранял старый 403 после более позднего явного 503/принятого 200. Evidence A синтетическое, без PostgreSQL. Собственный повтор до исправления на неизменённом продукте 01bff390 дал 6 RED и 20 PASS: оба исходных случая, operator-supplied accepted, полный report pipeline, новый explicit после legacy и обратный переход accepted -> новый 403.

Теперь первым сравнивается causal sequence хранилища. Legacy записи без sequence предшествуют новым sequenced writes; между legacy записями сохранён прежний timestamp порядок и fail-closed при равном времени. Номер назначает хранилище, caller его не выбирает. Изменение validatedAt, схемы и полномочий оператора не требуется.

После исправления 312 API Watch tests, typecheck, lint и diff check PASS. В native suite подготовлены 11 сценариев: сохранены прежние семь и добавлены rollback 503/200/operator-supplied accepted, отдельный PG legacy equal-clock control с явным восстановлением. Локально выполнена только collection без соединения с БД. Новый exact-SHA CI и независимая приёмка ещё нужны. Профиль ИИ и ledger остаются открытыми до подтверждённой передачи трёх общих активных файлов.

## Совместимость с новым main: HTTP-date Retry-After

Адресный handoff A от 14.10.2026 10:05 UTC указал новую семантическую зависимость: опубликованный C parser HTTP-date в acquire.ts ещё не был соединён с retry/scheduler PR97. В существующую копию обычным merge включён main daf22c0b, в том числе принятый parser C с Git blob 0c1aec538e9c18ad517d7984976649a1d9cc1153. Новая реализация parser здесь не создавалась. У восьми прежних собственных product/native файлов сохранена побайтная идентичность ed18c889; опубликованные runtime/DB/backup изменения других авторов сохранены.

В собственный retry-pass.test.ts добавлены семь проверок реальной связки acquisition -> report -> family retry -> scheduler с синтетическим HTTP. На прежнем продукте ed18c889 получены 5 RED и 7 PASS: три формы HTTP-date, просроченная дата и срок выше cap уходили в default 60 минут; numeric и invalid-date controls проходили. После merge все 54 targeted acquisition/retry/clock tests прошли. Все 320 API Watch tests, typecheck, lint, format и diff check PASS. Проверено отсутствие fetch до срока, один 429 retry (26 запросов для 13 документов), неизменный failure episode и отсутствие третьего прохода; прежний 5xx сценарий с 39 запросами сохраняется отдельно.

Добавлен native PG сценарий срока HTTP-date после смены экземпляров scheduler/store: 13 запросов до retry, zero early refetch и ровно 26 после единственного 429 retry. Локально выполнена только collection 12 native сценариев; фактическое PostgreSQL выполнение и CI нового exact SHA ещё нужны. Предыдущие 11 PG/1859 integration/202 E2E/five CI и installed-synthetic 0.2.24 PASS сохраняются за ed18c889. Новая база содержит опубликованную версию 0.2.25; её installed acceptance здесь пока не заявляется.

A R6 является независимым scoped source/test PASS clock-fix, не полной приёмкой successor с новой acquisition семантикой. Запрошено independent review объединённого кандидата. Профиль ИИ и ledger остаются OPEN: адресная передача трёх файлов по-прежнему PENDING. Исходные пять сохраняются в checkpoint; audit/disk/Tester/R3 и прежние B/C платформенные отказы не перехватывались. Удалённые errors.json/events.jsonl не читались, не восстанавливались и не создавались.


## Review of main 1691d7c0: all six source repairs

The follow-up review at `3a774090554dcedafbd3338bf7d247ebab73b30c` expands this candidate to all six P2 findings. The three original fixes remain: monitoring rejection containment, Telegram raw-update offset progress, and one retry-budget entry per WB family pass. It also addresses the independently reported failed-start orphan timer.

Automatic Swagger discovery now atomically reuses request history by family, document, URL and bundle version. It cannot overwrite a candidate or reopen a cancelled/expired request. An explicit operator request creates a new generation. PostgreSQL locks the absent-row case within the transaction; concurrent full report passes retain one generation. The tests upload a complete synthetic 13-document WB bundle and check both terminal history and pending-request idempotency.

A changed signed AI profile participates in grant identity, revoking captured contexts for that AI. Refresh timestamps and config version alone retain the grant. Generated-worker tests use actual fixture signatures and check revision, content and compatibility changes, neighbor AI isolation, provider admission, late result, retry and copy guards.

The existing command writer compacts completed RESULT receipts from previous Work sessions for the same account. It retains uncertain provider/delivery effects, their predecessor chains and current Work replay fences. New Work can recover capacity after 2000 completed records without deleting UNKNOWN history. Source tests cover expired and unexpired payloads, foreign-account protection, uncertain delivery preservation and restart replay fencing. Generated-worker tests exercise actual Finish, Start and worker restart with 2000 seeded completed markers and no provider requests.

Local source checks and generated-worker results are separate from native PostgreSQL and installed acceptance. The previous exact `13cfa4c6` receipts are historical and do not approve these new source changes. The final candidate requires fresh exact-SHA CI and independent review. The repairs do not establish production deployment or server disk reclamation.

The compactor resolves receipt and retry-approval dependencies to a fixed point before removing any completed history. An insertion-order regression preserves a transitive retry chain rooted in UNKNOWN. The source writer/ledger suite runs explicitly in I1 CI in addition to generated source/package runtime tests.


## Independent follow-up: confirmed COPY and stopped reservations

Independent reviewers rejected `5017d56d` on confirmed COPY capacity and a delayed scheduled reservation. The accepted no-orphan-timer observation remains scoped to its original startup failure case.

COPY approval `consumedBy` names a delivery, while RETRY names an execution. Compaction now validates the COPY delivery's confirmed state, execution, confirmation, context, buffer, expiry and revision before removing completed previous-Work history. Unknown delivery outcomes, pending send intents, missing or inconsistent links, unknown approval kinds, partial provider execution and transitive retry ancestry remain durable fences. A real writer test executes reserve, provider intent/result, preview, confirmation, delivery intent and confirmed outcome. A 666-COPY plus two-result fixture reaches 2000 markers and then admits three commands in a new Work. The composed worker repeats that boundary using actual Finish, Start and restart, with no provider requests.

Every scheduled or forced reservation carries the scheduler lifecycle across the asynchronous store call. A stopped or failed startup cannot dispatch its late reservation. A conditional `releaseUnstartedRun` write clears only its matching lease, restores due scheduled work while preserving earlier retry deadlines, and leaves prior results intact. It cannot clear a replacement owner's run. Cancellation storage failure is reported and retains the lease without dispatch or fabricated success. Read-only NOT_DUE/ALREADY_RUNNING responses do not mask a different lane's storage error. Work whose runner was already entered continues to settle through the existing result path.

New source regressions reproduce both independent negatives before the repair. Four new isolated native PostgreSQL scenarios cover stop before/after acquisition, conditional ownership/history/deadline preservation, and a trigger-rejected cancellation. Their final exact-SHA CI result must be recorded separately from local in-memory validation. The branch incorporates published main `5b6e42dd`, preserving both upstream R3 source suite invocations alongside the ledger writer suite.
