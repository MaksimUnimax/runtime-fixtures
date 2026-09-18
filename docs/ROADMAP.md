# Общий roadmap

Статусы относятся к Seller_Agents, а не автоматически к исходным проектам.
D0 и D1 COMPLETED. D1.S1 (сервер), D1.E0 (карта расширений), D1.E1 (исходники/тесты/пакеты) приняты. D2 IN_PROGRESS, D2.1 ACCEPTED, D2.2 ACCEPTED; D2.3 internal adapter ACCEPTED / SOURCE-PACKAGE-REMOTE PASS; D2.4 DEVELOPMENT_APPLICATION_VERIFIED / SOURCE-PACKAGE-NATIVE-CI-READBACK PASS; перенос не означает готовность единого продукта.

| Этап | Работа | Критерий завершения |
|---|---|---|
| D0 | Каркас, ТЗ, архитектура, правила и карта миграции | Документы опубликованы, ссылки/решения проверены, отчёт владельцу |
| D1 COMPLETED | Отдельный перенос источников архитектором | Точные source-коммиты и файлы сопоставлены; сохранены проверки и ограничения; независимые исходные контуры воспроизводимы |
| D2 | Объединение расширений в общее ядро и адаптеры | Установленная единая сборка работает с Ozon/WB без смешения магазинов; проверки идут на каждом шаге |
| S1 параллельно D2 | Codex: сервер под новую бету, препрод, почта, общий доступ | Настоящая авторизация установленной сборки и бесплатный доступ |
| I1 как только готов первый общий сценарий | Раннее подключение расширения к серверу | Вход → команда → маркетплейс → результат в ИИ; автономность подтверждена |
| D3/S2 | Согласованные магазины, состояния, редкая синхронизация, перенос; эксплуатация/мониторинг | Полный функциональный кандидат беты |
| Q1 | Общая установленная и эксплуатационная приёмка | Критические сценарии, финальные пакеты, совместимые версии и восстановление приняты |
| B1 | Бесплатная бета с управляемыми регистрациями | Минимальный сайт работает; открытая владельцем квота; выпуск принятых браузерных пакетов |
| B2 | Обратная связь и улучшения | Измеряются самостоятельное подключение, полезность, ошибки и время поддержки |
| M1 позже | Монетизация, ограничения установок, подробные воронки | Отдельная продуктовая готовность и согласованная коммерческая политика |

S1.1 `DONE / REMOTE ACCEPTED`: free beta access and atomic admission are
published on canonical `main` at merge commit
`d0b54aa5e659932d3fa2d996b572e06aadfffe62`. The exact post-merge authority,
source lineage, CI runs, scope, and boundaries are recorded in
[S1.1 remote acceptance](server/S1_1_REMOTE_ACCEPTANCE_2026-09-14.md).

## D1 — границы

Подэтапы расширений: [D1.E0 — источники/карта](migration/EXTENSION_IMPORT_MAP.md) завершён; [D1.E1 — неизменённый Ozon baseline, WB reference и исходные тесты](migration/EXTENSION_IMPORT_NEXT_STEP.md) завершён; [приёмка](migration/evidence/extension-import-2026-09-14/README.md): remote CI и readback PASS. D1.E0 выявил разный TTL WB и внешний matrix input Ozon; исправление поведения относится к D2, фиксация проверочного входа — к D1.E1.

Перенос не означает автоматическое принятие WB. Его текущий FAIL и незакрытая полнота сохраняются.
При необходимости исходный WB помещается в изолированный reference-каталог по migration/PLAN.md, без подключения к production-графу.
Не выполнять WB R1–R8 до установленной provider-neutral приёмки.
Старые Ozon design forks не объединять без semantic differential и доказанной необходимости.

## D2 — внутренняя последовательность

D2.4 DEVELOPMENT_APPLICATION_VERIFIED: [каталог и общая application orchestration](development/EXTENSION_APPLICATION.md), development 0.2.3; [квитанция](migration/evidence/extension-application-d2-4-2026-09-14/README.md). Пункты 4–5 проверены на source/ZIP и native synthetic fixture в указанном объёме; полная installed приёмка D2 впереди. Следующий отдельный интеграционный участок — ранний I1.

D2.3: [адаптер WB/shared queue](development/EXTENSION_WB_ADAPTER.md), [квитанция](migration/evidence/extension-wb-adapter-d2-3-2026-09-14/README.md). Внутренний API в actual worker/package принят по source/ZIP/remote CI/readback. На момент D2.3 пользовательские WB popup/Start/delivery ещё не были подключены. D2.4 соединяет эти адаптерные порты с этапом 4.

D2.2: очередь вынесена в bridge-core, контекст пакета защищает dispatch и delivery. [Приёмка](migration/evidence/extension-context-d2-2-2026-09-14/README.md) завершена: source/package/remote CI/readback PASS. На момент D2.2 настоящий каталог и WB adapter оставались следующими шагами.

Первый шаг D2.1: общие Work/discovery/execution/delivery-модули подключены в development-сборку Ozon 0.2.0. [Описание](development/EXTENSION_CORE.md), [приёмка](migration/evidence/extension-core-d2-1-2026-09-14/README.md): source/package/remote CI/readback PASS. Это начало последовательности ниже, а не готовое единое расширение.

1. Сопоставить subsystem authority и зависимые файлы.
2. Проверить общий Work Start/Finish, capture, очередь и доставку.
3. Подключить отдельные marketplace adapters.
4. Добавить общую модель магазинов и popup.
5. Проверить Ozon/WB в разных диалогах и два магазина одной площадки.
6. Подключить I1 до окончания всех последующих функций.
7. Доводить редкие сценарии отдельными задачами без зависимости обычного выполнения от сервера.

## Серверная параллель

Старый порядок «сначала весь P8–P10, затем реальное расширение на P11» заменён ранним I1.
Сохраняются принятые домены и проверки. Codex получает задачи по новым требованиям, не переписывает принятый сервер целиком.
S1.1 free beta eligibility и quota регистраций приняты. `I1-SRV.0`–`I1-SRV.4` исторически приняты на canonical `main` at `5d7c8853cc69dd95bc6e713cac3fb2aa0a63383c` / PR6 ([I1-SRV.3 evidence](server/I1_SRV_3_BOOTSTRAP_TRUST_HANDOFF_ACCEPTANCE_2026-09-15.md), [I1-SRV.4 evidence](server/I1_SRV_4_ERROR_REVOCATION_OFFLINE_ACCEPTANCE_2026-09-15.md)). `I1-SRV.5` accepted at `086ae20c2858849ec13b1ab67c2f7661259022c3` only for server/reference lifecycle and fixture gates. C1 is separately accepted at `56c81a3521c02502b65fd713aec890e5a30f038d` only for source/package/native and installed-local development scope. The history-preserving synchronization candidate remains on `integration/i1-c1-srv5-2026-09-16`; C2.1 is accepted at `4acc5fb3336e3e38fa30d6a7ec16c80730bcd7e1`, C2.2-A is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `5d93bccac163c8728a8d7a3b1d4b9f23ea16b680`, tree `531033ac08f001dd55427c4ae969a6c4b5d6b861`, C2.2-B is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `8a5d9e6ca611d69512ad28fc00684c63bdc87324`, tree `1fb11a510d6dd314a0647c5348e56d1a26bc007e`, C2.2-C is `ACCEPTED / REMOTE VERIFIED` on tested implementation head `a1d0a9dc83daf80536f58bf56d498206da8a1eb3`, tree `1f7a54c0ac0c1c95b680071f7036f084715bac4c`, C2.2-D1 is accepted on exact tested server-vocabulary head `fdccf06fbdb3d67beafd0ca1759db74018f6a475`, and C2.2-D2 is accepted on exact tested implementation head `860b4799eb5bf627e14bfbc7bcfff53a241a2800`, tree `305d326add8f04a9bb28dbbaee99abefbfdbe466`. PR18 was merged into the integration line at `c6fc2363f25e02e5ff7ce548164df7a37b94bcf8`; PR19 at `ff55e8aaf3d473582ccce37a89c45098789fa2b3`; D1 PR20 at `66140093650dae057b4bb9017d49f48faeb7c5db`; D2 PR21 at `a2c9cdbd48914f6abf1e40221de4b64f1e5e76a7`. These merges preserve their exact-tested implementation commits/trees without redefining exact-tree evidence. Canonical `main` is `bc718cc5c677ad0eb4598e7de3ad766473ff0847`; PR7 and PR8 remain draft/unmerged and PR9 remains the draft synchronization/integration PR. See the [reference acceptance](server/I1_SRV_5_REFERENCE_ACCEPTANCE_2026-09-16.md), [synchronization handoff](server/I1_SERVER_EXTENSION_SYNC_2026-09-16.md), [sync evidence](server/evidence/i1-sync-2026-09-16/README.md), [C2.2-A acceptance](migration/evidence/extension-i1-c2-2a-2026-09-16/r4/README.md), [C2.2-B acceptance](migration/evidence/extension-i1-c2-2b-2026-09-17/r1/README.md), [C2.2-C acceptance](migration/evidence/extension-i1-c2-2c-2026-09-17/r1/README.md), and [C2.2-D2 acceptance](migration/evidence/extension-i1-c2-2d2-2026-09-17/r1/README.md).
The synchronization candidate is the dependency boundary before C2; it does not reorder the wider roadmap. Real OTP/email provider and preprod remain deferred to S1.2; P8.4 H3 remains separate Stream B authority. Health/P8.4 acceptance remains separate. S1.2 real email/preprod, D3, full D2/I1, beta and release remain open.

C2.2-A is closed only for online-first verified cached-bootstrap configuration acquisition with the durable effective-time floor, signed cache re-verification, context binding and ownership/obsolescence fences. C2.2-B is closed only for read-only projection of those already verified signed `features`, `entitlements`, and signed AI metadata; it always exposes `executionAuthority: false` and does not create `capabilities` or `workAllowed`. C2.2-C is closed only for the independent immutable packaged-local capability-presence authority: the current package records Ozon, Wildberries, ChatGPT web and Alice web adapter presence, with `executionAuthority: false` and zero signed permission bindings. C2.2-D1 is closed only for the explicit server-owned BOOLEAN/CAPABILITY permission vocabulary `source.ozon`, `source.wildberries`, `ai.chatgpt`, `ai.alice`; it does not seed or grant them. C2.2-D2 is closed only for the immutable read-only fail-closed mapping/intersection of those four signed entitlement keys with the four packaged capabilities. Missing/false signed permission denies, signed `features` cannot substitute, unknown keys cannot infer a binding, non-BOOLEAN reviewed values fail closed, and every D2 surface remains `executionAuthority: false`.

The next capability-related dependency is now server-side and remains **before** Work/offline wiring. Current `beta-access` resolves only `BETA | NONE` and contains no per-capability permission policy. Current Bootstrap signs commercial entitlements only when commercial access is independently eligible; beta-only snapshots therefore currently sign `entitlements: {}` and D2 correctly denies. The next bounded step must define an explicit reviewed Seller Agents capability-permission policy for the authorized access bases and emit only that reviewed policy through the existing signed entitlement map. It must not infer capability permission from beta status, signed feature names, provider-specific entitlement keys or package-local ids. `NONE` and malformed/unknown policy remain fail-closed; commercial plan entitlements remain authoritative for commercial access; beta/commercial overlap must be explicit. Only after this server result is separately accepted may a later step make D2 participate in executable Work authority while retaining account/session generation, compatibility, AI-profile, Health, freshness and state-machine gates. Offline Work, provider replay, joint offline command-result completion and scheduler integration remain closed.

Health, S1.2/D3, full I1/D2, the Octoport domain migration, beta, deployment and release remain separate open work.
C3H corrected-autonomy and post-C3H P2 joint offline command/result recovery are `IMPLEMENTED_CANDIDATE` items with automated evidence ready for architect review; neither is marked accepted. Receipts: [C3H corrected autonomy](development/client-i1/C3H_CORRECTED_AUTONOMY_FULL_ACCEPTANCE_2026-09-18.md) and [P2 joint result recovery](development/client-i1/POST_C3H_P2_JOINT_OFFLINE_COMMAND_RESULT_RECOVERY_2026-09-18.md). Scheduler/integration remains the next dependency and is not started; Stream 2 monitoring remains separate and untouched.
Расширенное администрирование мониторинга и платежи не предшествуют первому общему сценарию.
Минимальный сайт регистрации/установки/обратной связи обязателен до B1; продающие воронки развиваются позже.

## Браузеры и ИИ

Chrome, Opera, Yandex, Firefox и Safari — архитектурные цели. Принятая поддержка фиксируется по фактическому браузеру/ОС/ИИ/пакету.
Отсутствие Mac не разрешает назвать Safari проверенным. До реальной приёмки отображается соответствующий статус.
Новые ИИ подключаются отдельными адаптерами после проверки; их число не является мерой готовности беты.
