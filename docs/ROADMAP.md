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
S1.1 free beta eligibility и quota регистраций приняты. `I1-SRV.0`, `I1-SRV.1`, `I1-SRV.2` и `I1-SRV.3` приняты; `I1-SRV.4` — `IMPLEMENTED CANDIDATE / OWNER_ARCHITECT_REVIEW_PENDING` ([I1-SRV.3 evidence](server/I1_SRV_3_BOOTSTRAP_TRUST_HANDOFF_ACCEPTANCE_2026-09-15.md), [I1-SRV.4 evidence](server/I1_SRV_4_ERROR_REVOCATION_OFFLINE_ACCEPTANCE_2026-09-15.md)). `I1-SRV.5` остаётся не начатым и выполняется только после принятия предыдущего шага.
После принятия `I1-SRV.5` Stream A останавливается на synchronization boundary перед extension implementation / S1.2 / D3. Реальный OTP/email provider и preprod в текущую волну не входят: S1.2 отложен до этого I1-sync и нового явного решения владельца. P8.4 H3 остаётся отдельной authority Stream B и не входит в Stream A I1.
Расширенное администрирование мониторинга и платежи не предшествуют первому общему сценарию.
Минимальный сайт регистрации/установки/обратной связи обязателен до B1; продающие воронки развиваются позже.

## Браузеры и ИИ

Chrome, Opera, Yandex, Firefox и Safari — архитектурные цели. Принятая поддержка фиксируется по фактическому браузеру/ОС/ИИ/пакету.
Отсутствие Mac не разрешает назвать Safari проверенным. До реальной приёмки отображается соответствующий статус.
Новые ИИ подключаются отдельными адаптерами после проверки; их число не является мерой готовности беты.

## Stream 2 — Telegram operator control plane (owner amendment 2026-09-21)

Это постоянное дополнение к отдельному Stream 2 Monitoring / Health / Change-Detection.

Stream 2 теперь имеет два независимых операторских контура:

1. **LLM monitoring** — ChatGPT, Alice, DeepSeek, Grok, Claude, Gemini, Qwen, Kimi.
2. **Swagger/API monitoring** — Ozon Seller API, Ozon Performance API, Wildberries API.

Оба контура управляются через авторизованного Telegram-оператора, но имеют разные команды, расписания, принудительные запуски, состояния и уведомления. Сбой одного контура не останавливает другой и не влияет на обычный Work расширения.

### Telegram roadmap

| Этап | Работа | Критерий завершения |
|---|---|---|
| S2-TG0 — Telegram operator documentation/architecture | Зафиксировать требования, архитектуру, решения, security/privacy, acceptance и связь с S2-A1 | Нормативные документы согласованы; runtime ещё не заявляется |
| S2-TG1 | Отдельный Telegram operator service, allowlist операторов, секрет bot token, lane-specific status/notifications | Авторизованный оператор получает безопасные события; посторонний пользователь ничего не получает |
| S2-TG2 | Независимые durable schedules и forced-run control для LLM и Swagger/API | /llm_interval и /swagger_interval независимы; /llm_run и /swagger_run запускают только свой lane; настройки переживают restart |
| S2-TG3 | Human-assisted Swagger handoff: official URL → operator download → Telegram document → quarantine/inbox → validation/provenance → API-monitor candidate | Файл коррелирован с requestId, SHA-256 и official source; неподходящие/несвязанные файлы отвергаются |
| S2-TG4 | End-to-end operator acceptance/hardening | Уведомления, restart recovery, forced runs, schedule persistence, Swagger round-trip, unauthorized denial и privacy/security PASS |

### Связь с API-watch

S2-A1 остаётся **PARTIAL / NOT_ACCEPTED**: автоматический доступ к части first-party источников Ozon/WB ограничен provider challenge/fetch boundaries. Новое операторское решение не объявляет A1 завершённым; оно добавляет легитимный второй путь acquisition: бот присылает official URL → оператор скачивает файл через обычный браузер → возвращает документ боту → система валидирует provenance и использует его только как **operator-supplied official-source candidate**.

S2-A2–A10 не открываются до достаточной authority S2-A1.

Telegram/monitoring не имеет права менять Bootstrap, offline grace, Start/Resume, marketplace permission, commercial/device policy или автоматически патчить продукт.
