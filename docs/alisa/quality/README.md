# Октопорт маркет: общая работа тестера и автора матрицы

Начинать каждый сеанс здесь. Репозиторий `MaksimUnimax/runtime-fixtures`, ветка `alisa`, рабочая точка `docs/alisa/quality/`. Чат и архивы — передача материалов, не вторая очередь задач.

## Точный действующий выпуск — 5 ноября 2026

**Работает `20261105-v010-number-reason-r1`, установлен 12:22:29 UTC.** Манифест46файлов, SHA256 `025cda3aa6cad6d24be5c594c7b876ca0d9524be2aec051f84acbf146268d9e1`. ConfigSHA256 прежний `92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5`.

Readback13:18:35UTC: PID97710,46/46hashes, конфигурация не менялась, четыре службы/три таймера active, active jobs0/pending0, SQLite ok. Последний C-UE01-проход не менял действующий код, допуски/квоты, OAuth/платформу, не делал restart и marketplace/DeepSeek вызовов.

**DS03:** [ответ исполнителя рядом с отчётом тестера](inbox/20261105-TESTER-4d04edaa/IMPLEMENTER_DS03_R01_2026-11-05.md). Исправлена общая потеря NUMBER_RANGE в _read; настоящая ошибка структуры имеет собственное объяснение. 1240прежних+27новых проверки пройдены в этапе hotfix; два изменённых файла, без новых миграций/источников. Точный результат искусственного provider через установленный код: FAILED/NUMBER_RANGE, result=null, один fakeHTTP после второй итерации, понятная причина и next_action. **READY_FOR_RETEST, не независимый VERIFIED.**

## Независимые результаты сохраняются

[Safety-retest20261105-TESTER-4d04edaa](inbox/20261105-TESTER-4d04edaa/RETEST_REPORT.md): **18PASS/2PARTIAL/1FAIL/3SKIP**, пакет safety-r1 не принят из-заDS03. Исходный отчёт и FAIL не переписаны после установки исправления. Изоляция бесед, независимые страницы, календарь и другие пройденные условия сохраняют свой scope; numeric PARTIAL, окно restart и внешний replay не закрыты авторским unit-тестом.

N06/N08/N09-OZCP001 ранее VERIFIED на dialogue-fixes-r1 через Яндекс, commit6ffc7237. [Retest](inbox/20261105-TESTER-d7a5899c/RETEST_REPORT.md), [числовая сверка metadata](inbox/20261105-TESTER-d7a5899c/IMPLEMENTER_ACK_NUMERIC_Q01_2026-11-05.md). Исторические семь числовых PARTIAL/дваSKIP сохраняются. Независимый алгоритм того же API не является кабинетной сверкой.

**Текущая передача тестеру:** адресно повторитьDS03 на exact number-reason-r1 и соседние причины/обычную цену/UNKNOWN по implementer response. Искусственные числовые подстановки — только temporaryDB/fake transport, не production. [24safety-случая](testpacks/conversation_safety_r01/README.md) остаются историческим планом; не превращать их в новый PASS без наблюдения. [16JOIN-сценариев](testpacks/matrix_join_r01/ACTIVATED_RETEST_2026-11-05.md) также сохраняются.

Новый run — `inbox/<UTC-дата>-TESTER-<8hex>/`. Каждой реплике: запрос, полный безопасный ответ/закрытаяevidence_ref+hash, UTC, первый ответ, READY observation и дочитывание отдельно. Неизмеренноеnull. «Задание принято» не полный результат. Для числовогоPASS — независимый эталон той же оси/периода/магазина/валюты. Request с access_token/cookies не публиковать. Повтор новой реплики с новымID не заменяет replay прежнего сообщения.

## Последний проход основной задачи: C-UE01 source selection

**[Фактическая приёмка COST-SELECTION-R01](CUE01_COST_SELECTION_R01_ACCEPTANCE_2026-11-05.md), [модули/каталог/тесты/контракт](../runtime/v0.11/cost_source_selection_r01/README.md).** Это отдельный OFFLINE_VALIDATED кандидат, **не установленный голосовой шаблон**.

Восстановлены опубликованные исходники, проверен общий приоритет matched actual→qualified API estimate→qualified official estimate. Пропущенная запись не считается ни0, ни доказанным UNAVAILABLE. Комиссия использует явныйpercent, эквайринг прямуюamount, midpoint — настоящиеmin/max. Неизвестная стадия отмены не делает обязательным ручное подтверждение; разрешённый return tariff применяется как оценка, при проверенной применимости источника.

Исправлены две слабые границы кандидата: точный числовой предел сравнивается без контекстного округления, а adapter не доверяет присланным суммам/basis при совпадении одногоpin. Execute проверяет полный выбор по тем же evidence и актуальные права; retained expenses также требуют подтверждения. Read-pin не пересчитывает результат.

Смешанные суммы представлены отдельными fact/API/official частями; нулевой вклад неиспользованного основания не является утверждением о нулевых списаниях. Прежние ScenarioBindings/OwnerInputs/ReportContracts сохраняют обязательную рекламу/полноту/nonoverlap и явные owner omissions. Без рекламы/контроля итог обеих таблиц BLOCKED.

**258/258:96новых+88прежних сценарных+66OwnerInputs+8gate.** После чистой распаковки повторноPASS. Независимый synthetic gold3119/2039 подтверждает две таблицы, **не свежие денежные данные пользователя**. Старые162теста и основные модули не менялись. Новый расход упаковки добавлен JSON без правки Python. Бывшее упоминание119тестов до обрыва не используется как подтверждённое число.

Полный воспроизводимый серверный архив:78408байт/29файлов, SHA256 `c89509af17f63f6a30155d6a9b6bcf7b8a947cb6cf7acb0e68acff3aca0bd1d8`, путь в приёмке. Все source/test bytes в Git сверены с сервером. Не запускать loose-файлы без прежних dependency/fixture; в архиве они есть.

**Что ещё не готово:** этот слой потребляет уже нормализованные qualified envelopes. Сбор свежих заказных строк/начислений/тарифов, доказанное сопоставление и полнота, production authority и existing-worker/voice adapter ещё не завершены. CALCULATED/SELECTED имеет production_ready=false, financial_report_saved=false. Отдельный C-UE01 не объявляется установленным, его будущие тесты не заменяют DS03-пакет.

## Счётчики и мини-отчёт каждого прохода

[CATALOG_PROGRESS_CURRENT](CATALOG_PROGRESS_CURRENT.json), [MINI_REPORT_CONTRACT](MINI_REPORT_CONTRACT.md). Обязательные поля: реализовано, включено, осталось, что сделано за проход, что выполнялось сейчас, **что делаем дальше** и **следующая измеримая цель**.

**82реализовано,78включено,4подготовлено-не-включено.** Состав:42primary scalar,15сводок,2событийныхWB,6формул,16dataset иH00. Включены12dataset-представлений/14сочетаний с площадками. Последний source-selection проход добавил0голосовыхопределений/0включений. Tests/API calls/синонимы/внутренние cost components не шаблоны.

ЧетыреWB: wb_active_ads, wb_campaign_inventory, wb_active_ads_totals, wb_supported_ads — по-прежнему без допуска. У17из19семейств есть работающая часть, а не полное покрытие. Сверх4остаются production S03/C-UE01, физические выкупы/возвраты Ozon, Ozon B13 и cross-market mapping.

## Сохранённые ограничения и семантика

[WB_COVERAGE_S03_R01](WB_COVERAGE_S03_R01_ACCEPTANCE_2026-11-05.md):21кампания за3–4ноября→18статистик;21/21metadata; триmissing появились раньше периода; отдельный запросnull, широкий период2из3. Нет доказанного нуля/внутренней причины. В этом проходе WB не запрашивался; HTTP200 не разрешает включить неполную выборку.

B05 — дата начисления, не физический выкуп; положительные/обратные суммы раздельны, покупательская цена относится ко всей строке, среднее взвешено. PAY — положительные реализации, join внутри магазина posting+SKU, сохранность сумм/количеств; unknown не «без карты». Lookup31день не бесконечная история. Source coverage и enrichment coverage различаются. Старые цены/справочники/metadata/остатки/финансы сохранены.

Conversation reader-state-v1 остаётся: раздельные выбор/курсор по беседам, общий result; отмена только подписки текущего читателя, отмена job после последнего. Нет бесконечного копирования контекста. [Исходная приёмка](CONVERSATION_SAFETY_R01_ACCEPTANCE_2026-11-05.md), [завершение safety](CONVERSATION_SAFETY_R01_RESUME_RECEIPT_2026-11-05.md) — история до number-reason, не команда откатить рабочий hotfix.

## Постоянные документы и границы ролей

| Назначение | Документ |
|---|---|
| Точная установка DS03 | [Ответ исполнителя](inbox/20261105-TESTER-4d04edaa/IMPLEMENTER_DS03_R01_2026-11-05.md) |
| Последняя основная работа | [Cost selection](CUE01_COST_SELECTION_R01_ACCEPTANCE_2026-11-05.md), [контракт](../runtime/v0.11/cost_source_selection_r01/README.md) |
| Прежние вычислительные основы | [S03/scenario](S03_SCENARIO_BINDINGS_R01_ACCEPTANCE_2026-11-05.md), [OwnerInputs](../runtime/v0.11/owner_inputs_r01/README.md) |
| Каталог/мини-отчёт | [Счётчики](CATALOG_PROGRESS_CURRENT.json), [контракт отчёта](MINI_REPORT_CONTRACT.md) |
| Общие реестры | [BUGS](BUGS.json), [TEMPLATES](TEMPLATES.json), [RUNS](RUNS.json), [BOARD](BOARD.md), [IMPORT](IMPORT_MANIFEST.json) |
| Регламент | [Формы](forms/), [WORKFLOW](WORKFLOW.md), [TESTER_PROMPT](TESTER_PROMPT.md) |

Тестер публикует отдельные runs; исходныйFAIL не переписывается. Автор матрицы отвечает за runtime/матрицу, а другой исполнитель — platform/UI/BFF/issuer/MFA/PG. МатричныйS03 — ввод себестоимости, платформенныйAL-S03 — иной этап. Обычный QA inbox не заменяет продуктовый gap journal/catalog publication.

## Что делаем дальше

**Автор:** через общий SourceMatrix и существующий ledger сформировать свежие входы селектора: FBO/FBS original order lines; by-day item fees и актуальный dictionary типов; scoped price/tariff snapshots; реклама/хранение и controls пересечений. Затем использовать готовые selector+ScenarioBindings, а не писать ещё один расчётчик.

**Следующая цель:** две таблицы C-UE01 за свежий реальный период через существующий worker, источник каждой суммы, раздельные actual/API/official/period allocation, обязательная реклама и явные пропуски owner inputs; после этого exact build и независимые ответы/время Алисы. Не изменять сборку тестера незаметно и не считать synthetic258tests живой финансовой приёмкой.
