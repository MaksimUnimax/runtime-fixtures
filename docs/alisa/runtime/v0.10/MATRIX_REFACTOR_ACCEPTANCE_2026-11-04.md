# Приёмка переработки по ADR-005 — 04.11.2026

## Статус без подмены

**PARTIALLY_MIGRATED / NOT_DEPLOYED.** Новый табличный контур переработан: четыре API-контракта перенесены из endpoint-specific Python-веток в data-only source_matrix.json. Это уже выполненный кодовый refactor, не только план. Однако весь старый скалярный контур, новые сетевая квалификация/активация/консольная приёмка пока не закрыты. Действующий runtime остаётся 0.9 build8.

Новая неактивная копия: `/opt/alice-market/releases/20261104-v010-matrix-refactor-r2`. Предыдущий events-rows-r1 сохранён. Принадлежащий этой задаче `.events-rows-v010.lock` не снят и чужие работы не перехватывались. Параллельные исследования цен Ozon в ветке alisa не переписывались.

## Почему исполнитель отклонился от задачи

Документация существовала: REPORT_v0.1.0, ADR-001 и требование стабильного ядра. Исполнитель сначала закрывал отдельные WB/Ozon сценарии специальными if-ветками, не завершив общий контракт источников. В JSON вынесены URL/квоты, а request/response/page semantics оставлены в Python. Успех функциональных тестов ошибочно трактовался как архитектурная приёмка.

Обязательного исполняемого условия «новый источник без изменения Python» не было. Это ошибка порядка разработки и критерия проверки, не вина пользователя, API, ключей или отказавшего установочного инструмента. Отказ установки случился позже и не объясняет неправильную архитектуру.

До корректирующего кода опубликован [RCA-001](RCA_001_ARCHITECTURE_DRIFT_AND_WORK_RULES.md), commit `6472c35f9b263bebdf1d18640bd8a94c72ded4f5`. Канонический контракт — [ADR-005](ADR_005_MATRIX_ONLY_EXTENSION_CONTRACT.md). Теперь каждое изменение привязывается к требованию/gate и доказательству. Число зелёных тестов не заменяет этот gate.

## Что действительно переписано

Новые общие модули `matrix_core.py` и `matrix_sources.py` не содержат provider/endpoint identifiers. Они выполняют ограниченный язык $path/$fn/$if, строгую проверку дерева, фиксированные GET/POST, bindings заголовков/параметров, mapping JSON-строк, single/offset/cursor, типы/даты/валюты/проверки полноты. Нет eval/exec/импортов кода/сети/файлов из матрицы; ключи не входят в матрицу или нормализованные данные.

В source_matrix.json перенесены четыре полных контракта: Ozon analytics sku/day, WB funnel/products, WB grouped/history, WB supplier/sales. Включены конкретные поля, знаки продаж/возвратов, временные оси, правила null/zero, totals/day coverage и квоты/доступность.

В table_analytics.py убраны четыре специальных request/decoder branches. Выбор source теперь route-данные table_catalog.json. HTTPTransport использует одну ветку для всех таких matrix recipes. Старые scalar branches явно сохранены и ещё требуют переноса; они не считаются архитектурно закрытыми.

Общая row algebra, скалярный DAG, очередь, права, replay, TTL, UNKNOWN и очистка не заменены новыми независимыми сценариями. Новый вопрос не создаёт новый программный модуль.

## Главный тест: реально только JSON

`MatrixOnlyExtension.test_two_novel_sources_json_only_queue_transport_normalization_ranking` создаёт чистую копию и фиксирует SHA256 всех **24 Python-файлов**. Затем меняет только source_matrix.json/table_catalog.json: добавляет два ранее неизвестных совместимых синтетических источника с другими endpoint/body/JSON-field names, offset и cursor.

В новом процессе выполняется Engine → Repository → Worker → HTTPTransport с искусственным ответом → общий декодер → полный набор страниц → ranking/выдача → exact-cache HIT. Четыре fixture-вызова, ни одного внешнего HTTP. Проверены правильный рейтинг после всех страниц, отдельный возврат и отсутствие исходного event ID в отчётной БД.

Все 24 Python-хеша до/после идентичны. Подмены Python-констант/функций/callback не применялись. Manifest proof `e68505eccd03ce99219523e416d1065dc6dcf37382ad01ce921454b8cb672dcc`.

Это доказательство возможности двух новых форматов из поддержанного класса, не утверждение существования синтетических URL. Старый тест двух вложенных формул и нового речевого синонима только JSON также сохранён: он проверяет компиляцию в новом процессе и неизменность Python, не новый финансовый HTTP.

## Тесты

Baseline до правок — 681/681. Финальный набор — **717/717 = 681 прежних +36 новых**, failures/errors/skipped=0, forbidden TCP/DNS=0, external_api_calls=0. Все 11 прежних test-файлов побайтово сохранены; добавлен test_matrix_sources.py.

После первоначальных 712 зелёных проверок дополнительные malformed-schema пробы выявили недостаточную проверку proof_requirements и TypeError вместо типизированного отказа для неправильных schema/path типов. Исправлено общим валидатором, добавлено ещё5 регрессий. Этот промежуточный недостаток не скрыт.

Новые проверки: architecture audit плюс намеренно нарушающий пример, неизвестная операция в холодной ветке, лишние поля/глубина, missing/null/zero, boolean vs integer, credential isolation, URL/header injection, неизменность matrix copies, source/scope pinned pagination, malformed qualification и настоящий JSON-only extension через очередь.

После чистой распаковки финального ZIP все66 хешей совпали и те же717 тестов прошли повторно. Полный patch применён к неизменённому предыдущему candidate с fuzz=0; все8 добавленных/изменённых файлов совпали. Повторные тесты не увеличивают количество уникальных проверок.

## Сохранённые настоящие API-ответы

Новый общий интерпретатор на Alisa проверен на ранее разрешённых исходных JSON: Ozon80 товаров и31 день (суммы разных разрезов совпали), WB94 карточки/6 дней истории, 5 событий дня и317 событий внутри октября с полным курсором/знаками возвратов/отбором дат. Квитанция нового кандидата: `/root/alice-lab-evidence/matrix-refactor-20261104/qualification.json`.

Credentials не читались, live-cache не заполнялся, новых HTTP=0. Это повторный разбор сохранённых настоящих ответов, не новая сетевая квалификация и не кабинетная сверка. Сырые API-данные остаются в private probe-reports под TTL и в Git/ZIP не включены.

## Вебхук и диалог

Заключительный прогон **2026-11-04T04:37:08.787124Z**: текущий код web-фасада → временная OAuth-БД/синтетический токен → настоящий Unix IPC → временная queue/worker → записанные API-ответы → text/tts. **58 checks PASS, семь scenarios READY**, 8 чтений сохранённых тел, новых внешних HTTP=0. Сценарии: рейтинги Ozon/WB, дни/недели Ozon, дни WB, события WB за день/месяц, сохранение периода, explicit WB, replay/auth revoke и отсутствие токенов в отчётной БД.

58 перекрываются с общим набором и не прибавляются к717. Это не новый пользовательский запрос в консоли Яндекса и не звук Станции. Квитанция `candidate-webhook-acceptance.json` в новом evidence-каталоге.

## Контроль сервера

**2026-11-04T04:38:39.156534Z**: source hashes локально и на Alisa совпали, scoped architecture_gate PASS. Четыре основные службы и три retention timer active. ExecStart всё ещё `/opt/alice-market/releases/20261103-v09-retention-r8/runtime.py`. Credentials, live-конфигурация и OAuth не менялись; marketplace/DeepSeek обращений этой работы0.

Ранее отклонённый installer не запускался альтернативным транспортом, кодировкой или переименованием. Здесь созданы новые исходники в отдельной неактивной копии и выполнены независимые проверки. Рабочий build8 не выключался. При локальном публичном source-download был DNS-сбой контейнера; source-модули штатно опубликованы в Git и загружены на Alisa с проверкой pinned commit/SHA256. Это перенос публичного исходного кода, не перенос/обход установки.

## Где ещё не выполнено полное требование

| Gate/область | Статус |
|---|---|
| M01, новые общие source-модули/row-мост | PASS scoped; не аудит всей legacy-системы |
| M02, четыре контракта в данных | PASS по regression и записанным настоящим ответам |
| M03, два новых источника JSON-only | PASS, 24 Python неизменны, synthetic full-runtime |
| M04, формулы/синоним JSON-only | PASS прежнего compile/new-process теста |
| M05–M08, покрытые негативные/состояние/версии | PASS заявленных тестов, не формальная гарантия любого входа |
| M09, свежий live-canary, активация, консоль | OPEN |
| Старый scalar providers/finance_stock/registry | OPEN |
| Рекламный auth workflow, async stock report | OPEN |
| Произвольные новые scalar metrics/table IR/P2 | OPEN за пределами текущей поддержанной схемы |

Приоритет следующего этапа — перенос старых source/request/response/schema workflows и снятие code-only semantic whitelist по тому же контракту, не возвращение к специальным обработчикам. Для новой принципиальной операции сначала ADR/общий примитив/тест, затем только матрица. Только после полной заявленной приёмки — отдельный release и настоящая консоль.

## Документация и код

[Спецификация](matrix_refactor/MATRIX_BINDINGS_SPEC.md), [generic core](matrix_refactor/matrix_core.py), [generic sources](matrix_refactor/matrix_sources.py), [матрица](matrix_refactor/source_matrix.json), [архитектурный gate](matrix_refactor/architecture_gate.py).

Две опубликованные базовые Python-версии дополняются [MATRIX_SCHEMA_HARDENING.patch](matrix_refactor/MATRIX_SCHEMA_HARDENING.patch); в полном ZIP и staged-копии эти три ужесточения уже применены. Полный архив содержит связанный код, новые тесты, итоговую документацию и complete delta; Git-папка отдельных файлов не объявляется автономным установщиком.

Архив **ALISA_MATRIX_ONLY_REFACTOR_CANDIDATE_2026-11-04.zip**: **265369 байт, 67 файлов**, SHA256 **840a902296f2a08e02a23df73eb1ad22084265080dad037a83a8383abc1c1d38**. Никаких живых БД, API-ключей, финансовых ответов, cookies и полного пользовательского Request. Отдельный JSON verification содержит результаты clean extraction и patch replay.

Финальные изменённые runtime SHA256:
- matrix_core.py: 2d18a22a1015cad8e3b8865b6bae76fda485447a7f997d61d72d482cf7d82e5f
- matrix_sources.py: 1ed14eedf7a18ecf9bc315ec1804613b4a29f1e92dda67b8774ea448aeb045d2
- source_matrix.json (pretty): a51fa51ea349eddb3b58da28cc02ade81d8384a4103499d2b7f4c7790038f420
- table_catalog.json: 1fae2a30c643c8b8f1405ea0975b6d5e578e928b97297d37c8037581fe35f017
- table_analytics.py: 7e1f574b108b4957a04785e71bbf4dacd81ddfb60d2c48ca0652c9cac02c62af
- http_transport.py: cbae00e429c67fc2d1c3b768839b74d0422773ecfd83d45ed6330a8d4b79a950

table/source combined hash: `5687ab1aeb3c8c3e094d00de543e05a5095fe737bcf45f95cdf12cffaece7ae4`. Сам по себе hash не является live-разрешением или сертификатом корректности.
