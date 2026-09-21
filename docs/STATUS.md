# Текущее состояние

Дата проверки: 2026-09-15.
Этап: D1 COMPLETED — D1.S1/D1.E0/D1.E1 приняты. D1.E1 IMPORT_ACCEPTED: 232 файла, remote CI и readback PASS. D0 COMPLETED; D2 IN_PROGRESS, D2.1 ACCEPTED; D2.2 ACCEPTED — SOURCE/PACKAGE/REMOTE CI/READBACK PASS; D2.3 INTERNAL_ADAPTER_ACCEPTED — SOURCE/PACKAGE/REMOTE CI/READBACK PASS; D2.4 DEVELOPMENT_APPLICATION_VERIFIED — SOURCE/PACKAGE/NATIVE_FIXTURE/REMOTE_CI/READBACK PASS; S1.1 DONE / REMOTE ACCEPTED.
Product implementation: SERVER_IMPORTED_AND_VERIFIED; EXTENSION_BASELINES_IMPORTED_AND_VERIFIED; COMMON_CORE_COMPOSED_OZON_VERIFIED; BATCH_CONTEXT_VERIFIED; WB_INTERNAL_ADAPTER_VERIFIED; WB_APPLICATION_ROUTE_CONNECTED; COMBINED_OZON_WB_DEVELOPMENT_VERIFIED; REAL_ACCOUNT_AUTH_NOT_CONNECTED.
I1-SRV.2 ACCEPTED; I1-SRV.3 ACCEPTED; I1-SRV.4 IMPLEMENTED CANDIDATE / OWNER_ARCHITECT_REVIEW_PENDING; I1-SRV.5 NOT_STARTED; S1.2 NOT_STARTED. I1-SRV.0 and I1-SRV.1 remain accepted. Evidence: [I1-SRV.2 acceptance](server/I1_SRV_2_DEVICE_AUTH_INTEGRATION_ACCEPTANCE_2026-09-15.md), [I1-SRV.3 acceptance](server/I1_SRV_3_BOOTSTRAP_TRUST_HANDOFF_ACCEPTANCE_2026-09-15.md), [I1-SRV.4 acceptance](server/I1_SRV_4_ERROR_REVOCATION_OFFLINE_ACCEPTANCE_2026-09-15.md).
Deployment: NOT_STARTED.
Browser releases: NOT_CREATED.
Live provider tests in this stage: NOT_RUN.

## Компоненты

| Компонент | Исходное состояние | Состояние в Seller_Agents |
|---|---|---|
| Ozon 0.1.22 | 3b102f68; PRE-HANDOFF PASS, LIVE CERTIFICATION PENDING POST INSTALL | 36 runtime-файлов перенесены; local/remote source и package routes PASS; live pending сохраняется |
| WB 0.3.0 | 006af272; INSTALLED FAIL; provider-neutral migration REOPENED / COMPLETENESS NOT PROVEN | 40 runtime-файлов перенесены в reference; 52 исходных suites дают 1075/0 на source и ZIP; installed FAIL сохраняется |
| Сервер | Замороженный P8.4 Foundation на 3f16bbf; H3 browser actions/P8.5/P8.6 не начаты | SERVER_IMPORT_ACCEPTED: новый полный CI PASS, 594-file readback MATCH; deployment не выполнен |
| Единое расширение | Целевая архитектура согласована | D2.4: каталог, общий popup/Work и доставка в development 0.2.3; source/ZIP/native fixture/remote CI/readback PASS; beta auth и live pending |
| Лимит регистраций беты | Новое требование владельца | S1.1 DONE / REMOTE ACCEPTED; exact authority and CI are recorded in [S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md) |
| Редкая синхронизация/перенос ключей | Приняты целевые механики | Специфицированы, не реализованы |
| Сайт/админка | Исходные приложения сервера | Перенесены и проверены вместе с сервером; S1.1 beta access/admin admission принят; real extension auth остаётся I1 |
| Мониторинг DOM/API | Есть основа Health, целевые правила API watcher | Расписания в этом этапе не создавались |

Снимки и подтверждения: [SOURCES](migration/SOURCES.md), [SOURCE_STATUS](migration/evidence/SOURCE_STATUS.md).

## Текущий результат

D2.4 DEVELOPMENT_APPLICATION_VERIFIED: каталог/общий popup и прикладная Work/delivery Ozon/WB в development 0.2.3; [описание](development/EXTENSION_APPLICATION.md), [приёмка](migration/evidence/extension-application-d2-4-2026-09-14/README.md). Code `96af54f1d67c20f6eca2ade552fde20948f1e66d`: 109 gate processes, 10 application-групп, полный CI 34846554237 SUCCESS. Native Chromium source/extracted: Start, baseline старой истории, WB HELP/API, текст/no replay, Hide/Show, PDF через IDB/File/attachment/Send, Finish. Скачанный ZIP совпал; 924 Git-файла и 84 production inputs MATCH. Это ограниченная development приёмка; I1/auth, реальные ИИ/браузеры и общий D2 остаются открыты.

D2.3: [квитанция](migration/evidence/extension-wb-adapter-d2-3-2026-09-14/README.md), [границы и зависимости](development/EXTENSION_WB_ADAPTER.md). 105 source/ZIP gate processes PASS, включая 17 групп WB. Один shared guarded queue для Ozon/WB. Сохранены WB API authority и запреты, добавлены context fences и наблюдённый Retry-After. WB выполняется во внутреннем adapter API с локальными application ports в harness; на момент D2.3 настоящие popup/Start/delivery ещё не были соединены. Это не единая установленная сборка. Remote CI 34839904748 SUCCESS; скачанный ZIP побайтово совпал, 97 Git-файлов и все 77 production inputs сверены. Внутренний adapter API принят.

D2.2: [квитанция](migration/evidence/extension-context-d2-2-2026-09-14/README.md). Общая очередь, pinned context и защита от смены реквизитов/привязки во время выполнения. Статус: ACCEPTED; 101 процесс source/ZIP PASS, полный remote CI PASS, скачанный package и 67 production inputs MATCH. Это один Ozon slot, не реализованный каталог аккаунтов/магазинов.

D2.1: [квитанция](migration/evidence/extension-core-d2-1-2026-09-14/README.md), [архитектура и команды](development/EXTENSION_CORE.md). Выделены Work/discovery/local execution/delivery modules с Ozon ports. 99 процессов source/extracted-package проверки PASS локально; включают 15 новых групп сценариев и сохранённые Ozon/attachment/transaction gates. Remote CI и readback PASS; скачанный CI package совпал с локальным, все 50 inputs сверены с Git. Это первый шаг, не завершение всего D2.

D1.E1: [квитанция](migration/evidence/extension-import-2026-09-14/README.md), [команды](development/EXTENSION_BASELINE.md). Перенесены 76 production/reference-файлов и 156 тестовых/справочных входов без изменения байтов. Ozon: 14 source + 11 package gate-вызовов, 66 syntax checks; WB Node: 35 suites, 754/0 на source и ZIP. Проверены повторная упаковка, исходные hashes и остановка runner-а по ошибке. Remote CI PASS: ещё 17 WB browser suites, 321/0 на каждом маршруте; суммарно 52 suites, 1075/0 на source и ZIP. Все три CI artifact скачаны и независимо сверены; 232 удалённых файла совпали с исходниками. Серверный код, конфигурация и lockfile не изменены.

D1.E0: [карта расширений](migration/EXTENSION_IMPORT_MAP.md), [квитанция](migration/evidence/extensions-2026-09-14/README.md), [расхождения](migration/evidence/extensions-2026-09-14/FINDINGS.md). Сверены 76/76 production-файлов с точными ZIP, 100 связей статической загрузки и 176 входов проверок/исторических документов. Локально выполнены закреплённый 514 gate Ozon и проба WB retention; последняя подтверждает 24-часовой default вместо целевого часа. Полная повторная product/installed приёмка не проводилась. Сервер в D1.E0 не изменён.

Историческая приёмка D0: [DOCUMENTATION_ACCEPTANCE](migration/evidence/DOCUMENTATION_ACCEPTANCE.md). Новый сервер прошёл полный CI: 1272 unit, 1507 integration и 85 browser E2E, плюс отдельный regression пути Playwright. Квитанция и границы — [SERVER_IMPORT_ACCEPTANCE](migration/evidence/SERVER_IMPORT_ACCEPTANCE.md). Это серверная приёмка переноса; единое расширение и owner acceptance beta-кандидата остаются отдельными решениями.

S1.1: free beta access and atomic admission приняты в canonical `main` merge-коммитом `d0b54aa5e659932d3fa2d996b572e06aadfffe62`; точная post-merge authority и exact-head CI записаны в [S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md). В принятую область входят beta access basis/admission, атомарная регистрация, OTP/admin/API/bootstrap и соответствующие PostgreSQL проверки; реальная account auth расширения по-прежнему не подключена.

I1-SRV.0 ACCEPTED; I1-SRV.1 ACCEPTED; I1-SRV.2 ACCEPTED; I1-SRV.3 ACCEPTED. I1-SRV.4 is an implemented candidate pending owner/architect review; it defines stable server errors, durable revocation outcomes, and executable verified-cache policy without changing HTTP codes or the database. Runtime key download, TOFU, extension consumption, and database migrations remain out of scope. D2.4 remains `DEVELOPMENT_APPLICATION_VERIFIED`, and `REAL_ACCOUNT_AUTH_NOT_CONNECTED` remains true.

## Следующий этап

[D1.E1](migration/EXTENSION_IMPORT_NEXT_STEP.md) завершён. D2.1 и D2.2 приняты. D2.3 внутренний adapter принят по source/package/remote CI/readback. D2.4 соединение с каталогом/popup/Work/delivery принято в development 0.2.3. S1.1 принят в canonical `main`; [post-merge authority и CI](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md) зафиксированы. Следующий будущий серверный участок — ранний I1, реальная авторизация расширения на сервере; [границы](development/EXTENSION_APPLICATION.md). I1 и S1.2 этим состоянием не реализуются. Для серверной параллели сохраняется [поручение](development/SERVER_CODEX_HANDOFF.md); перенос расширений не реализует и не открывает H3/P8.5/P8.6. Если владелец передаст новую принятую версию расширения, сначала обновить источник и карту, не подменять выбранные байты по последнему имени ветки.
WB R1–R8 остаются закрыты до установленной приёмки исправленного provider-neutral контура.

## Как обновлять

Для каждого принятого изменения указывать версию/коммит, вид проверки, результат и ограничения. Нельзя одновременно оставлять текущему этапу статусы DONE и PENDING. Исторические неуспешные попытки находятся в evidence, а не в текущей строке.

## Stream 2 — current authority and Telegram operator amendment (2026-09-21)

Текущая принятая локальная Stream-2 authority не опубликована на GitHub remote и сохраняется проверенным self-contained bundle.

- S2-L8: **FINAL ACCEPTED / NOT_REMOTE_VERIFIED**.
- S2-A1 R6/R7 authority sentinel: **ACCEPTED BOUNDED**, но full S2-A1 остаётся **PARTIAL / NOT_ACCEPTED**.
- Последняя A1 reconciliation: `24ba470a7b4a0f019115992e43a4c79f6be931c5`, reconciliation-only / no feature advance.
- S2-A2–A10: NOT_STARTED / blocked until sufficient A1 authority.
- Stream-2 source-authority bundle SHA-256: `d9d33ed66fe6f34c16f2a97f05e8ea592ae2244fd446612cf282d1438e07a9ff`; `git bundle verify` and disposable restore PASS.
- Remote publication: `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.

Owner amendment 2026-09-21: Stream 2 получает постоянный **Telegram operator control plane**. LLM monitoring и Swagger/API monitoring — разные функции с отдельными командами, durable intervals, forced-run controls, status/history и notifications. Для protected Swagger/OpenAPI источника бот должен передать оператору официальный URL и requestId; оператор скачивает файл легитимно и возвращает его Telegram document attachment; файл попадает в quarantine/inbox, получает provenance + SHA-256 + validation и только после этого становится candidate для S2-A1.

Current priority для Stream 2: **S2-TG0 → TG1 → TG2 → TG3 → TG4**, затем bounded S2-A1 recovery через автоматический или operator-assisted first-party source path. TG implementation на момент этого статуса ещё не заявляется выполненной.
