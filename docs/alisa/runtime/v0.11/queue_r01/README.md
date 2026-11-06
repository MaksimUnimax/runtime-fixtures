# QUEUE-R01 — общий исполнитель составных отчётов

**SHARED_WORKER_OFFLINE_VERIFIED / NOT_INSTALLED.** Реализован opt-in TaskGraphRuntime в прежних Engine, Worker и Repository. Граф стадий и разрешённые проекции задаются JSON; прежние source/normalizer/selector/scenario компоненты используются повторно. Нет второго scheduler/HTTP-клиента/журнала квот, новых таблиц или автоматического включения голосового маршрута.

[Полная приёмка](../../../quality/CUE01_QUEUE_R01_ACCEPTANCE_2026-11-06.md) · [Изолированное независимое ревью](../../../quality/testpacks/cue01_queue_r01/README.md).

## Файлы для просмотра кода

`task_graph.py` — закреплённый план, стадии/пагинация, одинHTTPза шаг, boundedcaptures, checks по calls ledger, resultprojection/TTL/read-проверки.

`scenario_queue_adapter.py` — связка ранее квалифицированных cohort/expenses/owner входов с ScenarioBindings и страницами ответа.

`fresh_queue_adapter.py` — внутрипамятная связка девяти source-shaped ответов с прежним normalizer, без приватных response-файлов.

`CORE_GRAPH_HOOKS.patch` — точные изменения четырёх существующих файлов: engine.py,repository.py,architecture_gate.py,failure_catalog.json. Патч сам по себе не устанавливает зависимости и live-source qualifications.

Эта папка предназначена для review. Полный runnable layout с tests, матрицами, зависимостями, legacy regression и сохранёнными FAIL/PASS находится в архиве, а не в четырёх loose-файлах.

## Воспроизведение

На Alisa: `/root/alice-lab-evidence/cue01-queue-r1-20261106/ALISA_CUE01_QUEUE_R01_2026-11-06.zip`.
484666байт,147файлов,146manifest entries; SHA256 **575cf96aa1cad5de42a53d74dd0b42d803e2e9f166670935b449b4e06648fc1a**.

После чистой распаковки: `python3 -B verify_all.py`. Проверены **1267runtime+403integration=1670/1670**. В403:90новыхqueue/raw/boundary,7новыхS05compat и306прежних компонентных. Повторные прогоны не увеличивают счёт. Подтверждён отдельный двухпроцессныйrestart на temporarySQLite.

В тестах нет живых API/credentials/workingDB. Две artificial таблицы3210/2000 и2479/2002 — независимые тестовые эталоны, не финансы пользователя. Реальные результаты FRESH-SOURCE-R01 от5ноября являются отдельной квалификацией вне productionWorker.

## Сохранение параллельной работы

Наблюдаемая активная сборка — `20261106-store-check-6098-r1`, установленная другим исполнителем. В кандидате сохранены её точные http_transport/shared_http иchecker-файлы. База74файла закреплена в base_identity. Candidate runtime manifest52файла, SHA256 **5b4868f72d1a00d5c8373708780bd4cf797f1c3074acef798be014e89c18a542**.

Нельзя раскатывать этот кандидат поверх старой number-reason-базы и терятьS05. Serviceunits/permissions/конфигурация/PG рабочего сервера данным этапом не менялись. SharedHTTPcompat не является повторной полной приёмкой платформенногоS05.

## Граница и продолжение

Задание в общей очереди работает на временнойSQLite с искусственными ответами. Живые квалифицированные source-рецепты, productionauthority/owner binding и голосовойrouter пока не включены. Fake source registrations не разрешают запросы к настоящемуAPI.

Следующий шаг — подключить реальные ранее квалифицированные источники и права к тому же графу, провести ограниченный свежий запрос черезWorker, затем отдельныйvoice-release и независимый тест ЯндексДиалогов. Рабочий каталог остаётся82/78/4; внутренние graph-модули и тесты не считаются новыми голосовыми шаблонами.
