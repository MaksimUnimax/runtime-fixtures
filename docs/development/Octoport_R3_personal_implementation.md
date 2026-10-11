# Octoport R3 — личная реализация, не выпуск

Исполнитель: текущий OPERATOR лично. Другим диалогам реализация не поручена.
Исходная база: e01778cca4af25c366fd80acd55fca5349527052.
Требования: Octoport_parallel_architecture_20261010.html R3,
SHA256 207090f2bdd3db3daf22a405745652c6fae87e69d0919e779c708b663b6706ad.
Исходный индекс 65 доказательств: SHA256 ba9f13c638bc54d27b0057a799f4bbb88fdead57ce71593e9df33f48084e0191.

Полные входы, ожидаемые результаты, условия провала и уровни доказательства PAR
сохраняются в R3. Таблица ниже связывает требования с текущей реализацией, а не
заменяет исходные сценарии. Любая частичная SOURCE-проверка не закрывает сценарий.
SOURCE и PACKAGE-подмножества проверены по указанным ниже receipts. Полные сценарии, INSTALLED и OWNER остаются NOT_RUN. READY не заявлен.

## Фактически внесённые изменения

- Ограниченная bootstrap-очередь: FIFO двух scope, coalescing отдельных waiter,
  65 секунд ожидания / 60 секунд активного слота, явная отмена, scopeSeq,
  workerInstanceId/acquisitionId, поздние ответы, quarantine неподтверждённой
  записи прав. Подключена к control client; фактические client FIFO, multi-grant, refresh и общий deny проверены на PACKAGE-подмножестве.
- Существующий MANUAL_OPERATIONS writer: подтверждение точным readback,
  немедленный запрет после отказа записи/чтения, явный exclusive writerKey.
  Логическая сериализация не является гарантией fsync или переживания полной
  потери storage.
- Work model: терминальный Finish с первого перехода finishing, устойчивые
  work_session_id/work_generation, Hide/Show сохраняют поколение, Resume не
  открывает завершённую или неподтверждённую прежнюю работу. Новый Start доступен.
  Runtime и popup учитывают can_resume.
- Запись Work под существующей binding-блокировкой с точным readback. Отказ
  закрывает дальнейшие переходы в данном worker. Перезапуск после полной потери
  запретов не решён этой мерой.
- Модуль command-ledger: ключи блока, уникальная запись попытки, provider intent,
  сохранение UNKNOWN, отдельное подтверждение read-only повтора и копии буфера.
  Модуль подключён к фактическому dispatch и popup; отдельный обзор/подтверждение повтора и копии текстового буфера проверены на извлечённом пакете. Копия локальных результатов и вложений подключена и проверена на PACKAGE; полный crash matrix и INSTALLED не закрыты.
- Legacy замена owner и очистка payload сохраняют r3_commands.
- Старые проектные ID не переименованы.

## Матрица требований

| ID | Область | Изменения / текущая граница | Полный сценарий |
|---|---|---|---|
| PAR-01 | Параллельные разрешения ИИ | Client multi-grant/FIFO интегрированы; PACKAGE-подмножество, полный параллельный UX ещё не принят | NOT_RUN |
| PAR-02 | Bootstrap и поздние ответы | parallel-authority.js + client: bounded wait/active, scopeSeq, поздние ответы; SOURCE 20 и client PACKAGE-подмножество | NOT_RUN |
| PAR-03 | Standard / Work / Alice | Общий signed ChatGPT Standard/Work scope сохранён; scopeKey SOURCE и целевые runtime gates | NOT_RUN |
| PAR-04 | Независимые диалоги и магазины | APP-03 PACKAGE: два WB магазина/диалога и Ozon, закреплённые credentials | NOT_RUN |
| PAR-05 | Два клика / две вкладки | Единый MANUAL writer + content block origin + ledger; SOURCE и PACKAGE двойного подтверждения; двух реальных вкладок ещё нет | NOT_RUN |
| PAR-06 | AI account / UNKNOWN identity | Реальные locator proofs и нормализация ещё не изменены | NOT_RUN |
| PAR-07 | Guest Start / постоянный ID | PACKAGE: 40 conversation lifecycle cases + content source identity; Chromium guest Start ещё NOT_RUN | NOT_RUN |
| PAR-08 | Изменение popup / rebind | Контекст включает scope/epochs/grant/Work; SOURCE/PACKAGE неизменяемость, старые контексты отклоняются | NOT_RUN |
| PAR-09 | Hide / разрешённый хвост | APP-04 PACKAGE: Hide сохраняет разрешённый хвост; новая скрытая команда запрещена | NOT_RUN |
| PAR-10 | Finish на границах эффектов | Терминальный Finish и storage readback SOURCE; APP-04 и C3A-04 PACKAGE | NOT_RUN |
| PAR-11 | Допустимый Resume / терминальный Finish | terminal_state_known: неоднозначная старая inactive не Resume; новый Start доступен; SOURCE 15 + PACKAGE lifecycle | NOT_RUN |
| PAR-12 | Crash вокруг provider dispatch | Provider intent/outcome подключены к реальному manual queue; UNKNOWN и restart PACKAGE-подмножество | NOT_RUN |
| PAR-13 | Crash вокруг доставки результата | Существующая durable delivery сохранена; копия имеет отдельный intent и RAM dispatch fence; полный matrix не закрыт | NOT_RUN |
| PAR-14 | Общая квота кабинета | APP-10b PACKAGE: общая квота кабинета для карточек и marketplace methods | NOT_RUN |
| PAR-15 | 429 / Retry-After | Существующая политика сохранена, регресс не выполнен | NOT_RUN |
| PAR-16 | Группы API и installation cap | Существующие очереди сохранены, регресс не выполнен | NOT_RUN |
| PAR-17 | Logout / другой principal / поздний ответ | Client races PACKAGE: поздний 401 после logout не refresh нового principal; scheduler late-response fences | NOT_RUN |
| PAR-18 | Device и общий отзыв | Client PACKAGE: общий device deny закрывает оба grant; защита не сужена | NOT_RUN |
| PAR-19 | UNAVAILABLE / локальная ошибка ИИ | Общий identified UNAVAILABLE сохранён; локальные scope notifications ограничены AI | NOT_RUN |
| PAR-20 | Смена профиля / поздний receipt | Материальные права/profile меняют grantEpoch; обычный refresh сохраняет поколение; PACKAGE-подмножество | NOT_RUN |
| PAR-21 | Allow после deny / H-WIRE | Техническое доказательство свежести отсутствует | NOT_RUN |
| PAR-22 | Подпись / scope / account mismatch | Подписанные scope/account/cacheBinding проверяются отдельно; полный отрицательный matrix ещё не закрыт | NOT_RUN |
| PAR-23 | Потеря запретов / storage | Текущий worker закрывается; A/B/C NOT_DECIDED | NOT_RUN |
| PAR-24 | v2/v3 и границы TTL | V3 refresh + request deadline PACKAGE сохранены; issuer H-WIRE ещё UNKNOWN | NOT_RUN |
| PAR-25 | Offline нескольких grant | Два verified cached grant переживают restart; offline запрошенного AI использует его cache, client PACKAGE | NOT_RUN |
| PAR-26 | Firefox privacy-neutral | Не проверено, серверный Chromium не доказывает Firefox | NOT_RUN |
| PAR-27 | Разные установки | Не проверено | NOT_RUN |
| PAR-28 | Поздний sync после Finish / rebind | Не проверено | NOT_RUN |
| PAR-29 | Прерванная / повторная миграция | Legacy grant ограниченно переносится без TTL renewal; UNKNOWN сохраняется; неоднозначный Resume закрыт; полный migration matrix не закрыт | NOT_RUN |
| PAR-30 | Старый content / worker / rollback | protocol 2 content evidence; старый content отклонён до API с reload-required, PACKAGE; rollback ещё NOT_RUN | NOT_RUN |
| PAR-31 | Точный ZIP / установленный пакет | Промежуточные deterministic ZIP/source-extracted совпадают; final version/source commit/INSTALLED/выдача ещё отсутствуют | NOT_RUN |
| PAR-32 | Обычный клик / reload после UNKNOWN | PACKAGE: новый клик/изменённый hash/reload после UNKNOWN без API; document-local ambiguity закрывается | NOT_RUN |
| PAR-33 | Явный read-only повтор | Popup review + отдельное подтверждение; immutable fresh context, выбранные исходные ordinals, predecessor; PACKAGE-подмножество | NOT_RUN |
| PAR-34 | Неподдержанные / запись / подмена preview | Реальный operation registry READ/current/execution_enabled; changed-preview PACKAGE, write/unsupported SOURCE | NOT_RUN |
| PAR-35 | Двойное подтверждение / crash повтора | CAS approvalRevision + одноразовое confirmationId, private retry permit; двойное подтверждение PACKAGE; полный crash matrix ещё не закрыт | NOT_RUN |
| PAR-36 | Отправить копию | Отдельное подтверждение копии сохранённого текстового буфера; PACKAGE без нового API, original TTL | NOT_RUN |
| PAR-37 | Запрет / TTL / Finish / rebind для копии | SOURCE fences; PACKAGE Finish/expiry/logout запрещают копию; rebind/identity/deny полный installed matrix ещё NOT_RUN | NOT_RUN |
| PAR-38 | Двойной клик / crash копии | PACKAGE: duplicate confirmation одна delivery, worker crash запрещает скрытый Send; UNKNOWN intent сохраняется | NOT_RUN |
| PAR-39 | Границы независимости ИИ | Общий ChatGPT grant Standard/Work, отдельный Alice grant и общий deny; client PACKAGE-подмножество | NOT_RUN |
| AI-TREE-01 | Создание дерева нового ИИ | Серверная реализация отсутствует в PR36 | NOT_RUN |
| AI-TREE-02 | Черновик / публикация / RBAC / CSRF | Требование PR36, ещё не реализовано | NOT_RUN |
| AI-TREE-03 | Конфликт редактирования / монотонная публикация | Требование PR36, ещё не реализовано | NOT_RUN |
| AI-TREE-04 | Подписанный descriptor и локальный cache | Отдельно от grant/DOM, ещё не реализовано | NOT_RUN |
| AI-TREE-05 | Обрыв загрузки дерева | Ещё не реализовано | NOT_RUN |
| AI-TREE-06 | Offline / отзыв для дерева | Ещё не реализовано | NOT_RUN |
| AI-TREE-07 | Версия дерева закреплена за обменом | Ещё не реализовано | NOT_RUN |
| AI-TREE-08 | Вкладки / установки / редкая sync | Ещё не реализовано | NOT_RUN |
| AI-TREE-09 | Данные, не код; общие permissions | Ещё не реализовано | NOT_RUN |
| Popup / stores | Добавление и импорт внутри popup, проверка полей | Импорт не открывает вкладку; stale file/password preview отклонён PACKAGE; 6 SOURCE backup/canonical/conflict cases | NOT_RUN |
| Branding | Octoport, оставшийся OZON BRIDGE | Стартовая инструкция исправлена; финальный STORE-branding gate ещё NOT_RUN | NOT_RUN |
| CI PR35/36 | Применимые проверки документационного кандидата | PR36 получен для чтения, merge/main не утверждён | NOT_RUN |

## Первичные результаты

Каталог доказательств:
`/root/octoport-control/controllers/audits/EXTENSION-LIVE-CONTINUE-20261007T090339Z/`.

| Receipt | Факт |
|---|---|
| R3_SCOPE_TRANSFER_CONFIRMED_20261010.json | Передача runtime/client/popup подтверждена; WIP A сохранён |
| R3_PERSONAL_SCOPE_AMEND_1_20261010.json | Дополнительные личные пути, revision1877 |
| R3_PERSONAL_SCOPE_AMEND_2_20261010.json | Work writer, revision1878 |
| R3_PERSONAL_SCOPE_AMEND_3_20261010.json | Receipt preservation / content / patches, revision1880 |
| R3_BEGIN_AFTER_VERIFIED_CLEANUP_20261010.json | SOURCE резерв c33a2a3b040b4f6691f66710636f377b OPEN,128MiB |
| R3_BOOTSTRAP_SOURCE_RUN2_20261010.json | 13/13 SOURCE, точные хеши и исходный stdout |
| R3_LIFECYCLE_SOURCE_RUN2_20261010.json | 15/15 SOURCE, точные хеши и исходный stdout |
| R3_LEDGER_SOURCE_RUN1_20261010.json | 18/18 SOURCE, точные хеши и исходный stdout |
| R3_PR36_SOURCE_FETCH_20261010.json | PR36 head e2d72e09fa7e75c2f12cd09a770d194fb4702459; 11 документационных файлов |

Последующие изменения после receipt требуют проверки изменённой границы.
Источник успешного теста не означает автоматически успешный текущий файл.

## Оставшиеся границы решения

- Владелец не выбрал A/B/C восстановления после полной потери истории запретов.
  Не выбран и не имитируется ни один вариант.
- H-WIRE — гипотеза: нужны совместимость нескольких grant, refresh, deny,
  v2/v3 и доказательство свежести allow после deny. serverTime не ревизия прав.
- Независимый reviewer обязателен правилами, но привлечение других исполнителей
  запрещено владельцем. Собственный просмотр не считается независимым review.
  Другие разрешённые работы продолжаются, READY до допуска не заявляется.
- Авторизованные AI аккаунты исключены. Гостевые и локальные проверки разрешены
  только в согласованном существующем серверном Chromium.
- Ручная приёмка владельца не заполнена заранее.

Этот файл — рабочая трассировка. Он не заменяет исправление, испытанный ZIP,
инструкцию установки и пошаговые ручные сценарии.


## Personal phase 3, 2026-10-10T13:03:55.369812+00:00

Per-AI client grants, bounded bootstrap integration, scoped runtime authorization, and immutable grant/Work fences are now implemented in the personal worktree. No installed acceptance is claimed. Evidence: `R3_PERSONAL_IMPLEMENTATION_PHASE3_AFTER_WORK_20261010.json` and cursor of the same phase. Draft compose-7 SHA256 `2f42a900a867235207182632664b22f3adac5d046448ced0bab6ed27b7dc1b62` remains development 0.2.13, not the owner release.

Verified subsets: 20 scheduler/scope SOURCE cases and four actual packaged-client scope cases on compose-6; compose-7 races, v3 refresh, request deadlines, 10 core cases and 17 application cases. Application wrapper exit1 was reconciled with native command exit0 and cleanup_verified=true; primary error preserved. Ordinary-refresh and device-denial new test labels were corrected to PAR-20/PAR-18 subsets; historical receipt labels are not full PAR-04/PAR-05 acceptance.

Full PAR-01–39 and AI-TREE-01–09 stay NOT_RUN. Ledger click/provider/Send integration, explicit retry/copy UI, prompt trees, remaining popup/import/branding/CI work, migration, final exact version/install and owner ZIP remain unfinished. A/B/C recovery remains NOT_DECIDED.

## Текущая точка: compose-15, личная фаза 4

Промежуточный ZIP DEVELOPMENT 0.2.13: 2470945 bytes, SHA256
`e77cc7cd472eb43b8c2fd9d3c86ef26dafee1f25fd02d41fca53d985c6d3914a`.
Это не версия для выдачи и не установленная новая сборка.

- R3_LIFECYCLE_SOURCE_RUN3_20261010.json: 15 SOURCE PASS, включая неоднозначную старую inactive с start_intent_id.
- R3_LEDGER_SOURCE_RUN6_20261010.json: 20 SOURCE PASS, включая новый review изменённых параметров с сохранением прежнего UNKNOWN.
- R3_CORE_PACKAGE_RUN4_20261010.json: 11 PACKAGE PASS, включая document-local/provider ID evidence и отказ при неоднозначности.
- R3_CONVERSATION_PACKAGE_RUN1_20261010.json: 40 PACKAGE_OFFLINE PASS, в том числе new-chat promotion, временная потеря ID и поздние popup/content ответы.
- R3_APPLICATION_PACKAGE_RUN17_20261010.json: 21 PACKAGE PASS; фактические assembled worker/popup сообщения, имитация браузера/API. Новые PAR-подмножества не заменяют полный R3 и INSTALLED.

Ошибки и исправления сохранены в предыдущих RUN receipts, а не затёрты:
тип credentialRevision приведён к строковому контракту каталога; сравнение
snapshot выполнено с живым context, а не с другим snapshot без active;
подтверждённый результат сохраняется до исходного TTL для явной копии.
Тестовые manifest/IndexedDB API дополнены по реально вызываемому контракту.
Копия пока подключена к текстовому batch_watch_v1; вложения и локальные HELP/cache
результаты требуют отдельного завершения и проверки. H-WIRE, полная миграция,
деревья AI-TREE, импорт/branding/CI и финальная установка остаются незавершёнными.
A/B/C восстановления утраченной истории запретов не выбрано.

## Личная фаза 5 — compose-19

ZIP DEVELOPMENT 0.2.13: 2474755 bytes, SHA256
`b83e8c52d0c52f3ea6c0ed847671451ad7505d93d6fd9790979b62d10d7a6fa0`.
R3_APPLICATION_PACKAGE_RUN20_20261010.json: 23 PACKAGE PASS.
R3_CORE_PACKAGE_RUN5_20261010.json: 12 PACKAGE PASS.
R3_BACKUP_SOURCE_RUN1_20261010.json: 6 SOURCE PASS.

Уточнение предыдущей точки: копия теперь поддерживает локальную справку и
attachment_watch_v1. Перед подтверждением, Attach и Send проверяются сохранённые
файлы (размер/SHA256); пропавший или повреждённый файл не загружается заново.
Имена/байты/descriptor и исходный TTL сохраняются. Copy не меняет UNKNOWN API
и не создаёт provider intent. Успешная первоначальная доставка сохраняет
существующие файлы до срока, без отдельного архива и обновления TTL.

Импорт остаётся в текущем popup. Изменение файла/пароля отменяет preview;
поздний ответ проверки не может разрешить другой файл. Финальный apply связан
с проверенными входами. Строка «OZON BRIDGE» стартовой инструкции заменена
«OCTOPORT», существующий STORE builder уже задаёт публичное имя Octoport.

Ранние runtime/extracted compose-1…14 удалены лишь после полного совпадения с
сохранёнными ZIP и проверки процессов/cwd/exe/fd/maps. Сохранены все архивы и
receipts, failed compose-16 и текущие пакеты. Cleanup receipt SHA256:
`580ba44b31cb6d4e06c87094b9d1bede1b2d9c28da257ee7bae7af75b736c59a`.
Наблюдаемое освобождение 67 MiB; резерв 128 MiB остаётся OPEN, не уменьшен.

Это не завершение задания. AI-TREE01–09, H-WIRE, полная миграция/совместимость,
прочие неохваченные PAR и точный новый установленный пакет ещё не закрыты.
INSTALLED/OWNER: NOT_RUN; A/B/C: NOT_DECIDED; готовность не заявлена.


## Phase 6: personal per-AI tree foundation (2026-10-10)

Personal implementation continues; this is not release or installed acceptance. PR36 candidate e2d72e09fa7e75c2f12cd09a770d194fb4702459 supplies the separate tree contract, not evidence of merged implementation.

- Permanent registry AI IDs own independent drafts and immutable publications. PostgreSQL trigger copies the published template atomically for both current and older registry writers; existing AI rows get independent empty unpublished drafts. Template content remains unspecified.
- Existing RBAC/CSRF and transactional audit remain required. CAS detects conflicting edits; rollback creates a newer publication. Canonical data-only tree payload uses the existing Ed25519 key trust system with a distinct domain, nonce and account/device/session binding. This is a new tree endpoint, not a change to bootstrap v2/v3 permission wires.
- Verified local per-AI cache coalesces reads, preserves old copies and returned pins, verifies restart reads and rejects replay, corruption and unconfirmed writes. Actual Start/command integration is still pending at this checkpoint.
- SOURCE domain: 6/6 (R3_AI_TREE_SOURCE_RUN1). SOURCE real crypto/cache: 13/13 (CLIENT_SOURCE_RUN1). Isolated PostgreSQL: DB_RUN1 failed (template audit target was incorrectly sent to a UUID column); DB_FIX1 stores template identity in metadata with null UUID; DB_RUN2 11/11 passed, cleanup verified. Strict typecheck including the DB test: TYPECHECK_RUN5 passed. These are limited subsets, not full AI-TREE-01–09 or PAR-01–39 acceptance.
- No production migration, deployed server, new installed extension or owner acceptance. H-WIRE, full old/new worker migration, installed Chromium and delivery remain open. A/B/C recovery policy NOT_DECIDED.


## Phase 7: runtime tree integration (2026-10-10)

Start acquires only its signed AI tree (rare/coalesced client pull); pending Start durably pins the exact body/envelope/version and revalidates before sending. Missing or failed tree update is reported in popup; existing marketplace protocol instructions remain packaged and are not represented as an AI tree. No foreign tree substitution. A permitted verified cached copy survives update failure, with current access checked again. Manual command admission pins its local tree copy without a network request; the existing immutable command context and provider restrictions remain authoritative.

Fixed remaining pending-Start use of global current AI profile: saPendingGuard now selects pending.ai_id/provenance.aiFamily. Changed the outgoing source header from Seller Agents to Octoport.

Exact development compose-20 ZIP SHA256 828310095424add8e888f28461796bcff66182ea77647dd94fc20e9673eeec9c (2503478 bytes; development version0.2.13, not final delivery). Builder confirms deterministic archive and extracted/source bytes. PACKAGE: R3_AI_TREE_CLIENT_PACKAGE_RUN1 16/16, R3_APPLICATION_PACKAGE_RUN22 24/24, R3_CORE_PACKAGE_RUN6 12/12. Additional targeted R3_APPLICATION_PACKAGE_RUN23 confirms pending ChatGPT Start survives Alice grant, then binds correctly. RUN21 failure was the legacy test provider callback counting the new tree endpoint; fixed explicit control/provider fixture routing, package bytes unchanged. Full AI-TREE/PAR matrix remains NOT_RUN where these subsets do not prove the entire scenario.

INSTALLED and OWNER still NOT_RUN. Fresh process inspection corrected a narrow executable-name filter: browser is /mnt/browser/chrome PID1999480 with driver1999452, not a missing Chromium. Preserved QA owner is the original CONTROLLER_EXTENSION_CONTINUATION_20261007T090339Z stream; no browser action or restart performed in this phase. Remaining: complete applicable compatibility/H-WIRE evidence, server/API integration checks, versioned candidate, exact installed guest/local Chromium scenarios, delivery/manual scenarios. A/B/C loss-of-deny-history choice and independent-review gate remain unresolved; no delegation or READY.

## 2026-10-11 phase 8 — tree revocation and existing configuration synchronization

Resumed exact HEAD568c74cc with four preserved WIP files; RDC returned, no duplicate executor/test. Claim1892 remains personally owned with no conflicts. Current registry658 was read and canonical continuing self-audit updated to659; all39 workflows reviewed. Own source/package/DB leases reconciled through native hold with actual39/70/<1MiB consumers; existing DB container+volume absent, no reserve reduction or foreign cleanup.

The tree data endpoint now distinguishes common access/device/security denial (authenticated403) from data/service failure (503). Access basis, account/subject, device, extension/browser compatibility and identified AI gate must all allow publication lookup. Responses use no-store even on authentication failure. Client requests use no-store and the existing Firefox technical-data consent projection; refusal sends no identified tree request. A proven current-principal403 invalidates all grants, including an eventual denial after timeout; cached data cannot restore authorization. A503 keeps a previously verified copy only while current access permits it. Tree data still cannot grant Work.

Tree synchronization now joins the existing client-initiated bootstrap/configuration path, with existing per-AI cache coalescing/infrequent metadata checks. No tab polling, new timer, marketplace-triggered synchronization or AI/marketplace/delivery effect is added. Start and commands retain pinned versions.

SOURCE: R3_WIRE_TREE_SERVER_SOURCE_RUN3_20261011.json39/39 (API5 + issuer34), no deployment freshness assertion. Strict typecheck RUN6 found earlier H-WIRE test union narrowing missing; explicit identified-authority assertion fixed it, RUN7 exit0 includes both API/issuer tests and previous tree/DB/admin code. This is a test typing repair, not a server access change.

PACKAGE: deterministic compose22, development version0.2.13,2505521bytes, SHA256cab8b23915f0b35d2130e6c4950940d61d36806ae067391ea6b16ebeb1fd0fc8; source/extracted match and repeat archive match true. R3_APPLICATION_PACKAGE_RUN25_20261011.json29/29 passes. New boundary scenarios cover503 fallback versus403deny, late403 after timeout/no hidden retry, Firefox absent-consent/no request, and existing configuration synchronization/no business effects. Compose21/app24 were the prior28-scenario intermediate, not final delivery.

Remaining: R3 migration/compatibility and applicable installed guest/local tests, exact versioned successor/server compatibility, final accessible archive/manual matrix. Full PAR/AI-TREE outcomes and INSTALLED/OWNER remain NOT_RUN beyond named subsets. The new tree endpoint/schema are not deployed. No publication/READY, no independent review fabricated, no A/B/C history-loss choice selected, no authenticated AI tests or delegation.

## 2026-10-11 phase 9 — observed storage corruption, compatibility and CI prerequisites

Auth records now carry authStateSchema2. A legacy record is verified by the existing signature/principal/environment/clock path and migrated inside the same existing storage key, with a deterministic sourceDigest/migrationId and exact readback. No multi-key auth transaction or additional queue is introduced. The original signed envelope, expiry, generations and single actual AI scope survive; repeat restore does not manufacture another grant or renew TTL. No credentials are printed or duplicated into a new vault.

An unsupported root schema, incomplete migration marker, malformed grant map, mismatched grant fence or invalid epoch is retained on disk and quarantined in memory. It cannot fall back through the old global allow. Failed commit closes the running worker. The existing security fallback may remove the old allowing auth record when removal succeeds; if both set and remove fail, no effect is allowed in that worker. This does not resolve invisible total loss of deny/logout history across restart: owner choice A/B/C remains NOT_DECIDED. Unsupported unmodified0.2.14 rollback remains prohibited; this code does not pretend to make an older binary obey a new marker.

PACKAGE compose23 development0.2.13:2508759bytes, SHA256c0e3c8dddb9519056824adc96108e549fb06fb5507310580004efc2e4efedd94; deterministic archive/source-extracted match. Application RUN27:32/32; parallel-client RUN4 and client-races RUN5 exit0. RUN26 failed because a test tried to JSON-clone an auth record correctly removed by the existing deny fallback; the test now separately proves successful removal and failed removal, keeping the original safeguard. Production bytes were not changed for that test correction.

SOURCE admin routes RUN1:26/26, including sixteen new exact-target permission/CSRF/serialization cases. Real HTTP guards are tested with a stub data service; disposable DB transaction11 evidence is separate, and admin installed UI is still NOT_RUN. Required server formatting was corrected in17 personally owned files, explicit-any removed from a gate fixture, format check2/lint1/typecheck9 exit0. This is not all five required remote CI workflows or independent review.

Versioned candidate preparation: recipe0.2.15, browser-version validation in builder, and default development configuration version bound to the same recipe. Store authority/version/trust/origin checks remain intact. Existing0.2.14 archive and43 installed files were freshly matched to93ca3188...; unchanged immutable old package. New0.2.15 package has not yet been built/installed at this checkpoint. No server catalog, live DB, profile or release is modified.

Fresh browser inventory came from the existing single-owner driver; no browser/profile restart. Claims1897 include the admin API regression, builder and own DB test formatting, with no conflicting writer. Source scope remains personal, no assistants. Remaining exact versioned build/installed guest-local QA, source-vs-installed proofs, delivery and unresolved owner/review gates remain mandatory; checkpoint is not completion.
