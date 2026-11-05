# MATRIX-JOIN-R01 — фактическая offline-приёмка

05.11.2026 UTC. **OFFLINE_VALIDATED / NOT_LIVE_QUALIFIED / NOT_DEPLOYED.** Продолжение собственного runtime/matrix участка. Рабочая dialogue-fixes-r1 оставлена для независимого retest N06/N08/N09. Platform/UI/issuer/adapter/PostgreSQL и чужие locks не изменялись.

## Основание и точная база

План опубликован до реализации: MATRIX_JOIN_R01_PLAN_2026-11-05.md, commit **74dd205deb3db9d30006a1eb483bfca772d91166**. Прочитаны OZON_PAYMENT_METHODS_CASE.json на61b544f4c9a768ec7ff07411675b22c84a6f5bbb и B05/B13 candidate. Поле unit_number подтверждено сохранённой response_shape в customer-price/accrual-probe; это старое доказательство схемы, не новая live-квалификация.

05:29:29 UTC readback: active `/opt/alice-market/releases/20261105-v010-dialogue-fixes-r1`,44/44 manifest SHA совпали; отдельный B05/B13 candidate44/44 тоже совпал. Новый отдельный путь: **`/opt/alice-market/releases/20261105-v010-matrix-join-r1`**. В нём объединены текущие исправления ISO/объяснений, прежние B05/B13 JSON и общий availability-error boundary; ни активная копия, ни прежний candidate не переписаны. Объединённый baseline до нового join прошёл1030/1030.

## Законченная функция и пять представлений

Новый общий `dataset_relations.py` исполняет ограниченное many-left-to-one-right enrichment. Ссылки на stages, composite keys, подбор целевых строк, количественный контроль, переносимые поля, unknown policy и окно источника задаются JSON. Нет provider-specific ветвей, eval, SQL, произвольных URL или вызова LLM для арифметики.

Один join использован в пяти определениях:
- `realization_payment_lines` — отдельные положительные товарные строки и метка оплаты;
- `realization_payment_totals` — количество/суммы/взвешенная средняя по метке;
- `realization_payment_days` — день начисления + метка;
- `realization_payment_items` — SKU + метка;
- `realization_payment_items_days` — день + SKU + метка.

Это **кандидаты**, не уже доступные вопросы рабочей Алисы. Три новые нормализованные source bindings используют прежние URL/методы/quota keys: начисления с posting key и два metadata-per-item источника FBO/FBS. Они дополнительно требуют `posting_product_join_qualified=true`, которого в live config не добавляли. Положительные строки выбраны явно; обратные начисления не включены в этот payment-report и не представлены как net sales. Старые B05-возвратные показатели сохранены.

## Смысл и контроль соединения

Соединяются `accrual.unit_number` и `posting.posting_number` плюс SKU. В новых нормализованных строках posting key хранится как hash; сырой posting number не копируется в выдачу. Способ оплаты берётся из источника, не из цены, bonus или bank_coinvestment. Новые непустые метки сохраняются как отдельные значения. Другие метки не называются картами чужих банков. Разница средних не выдаётся за скидку одной и той же покупки.

Справа допускается только один ключ. Даже идентичный дубликат отвергается, а не тихо схлопывается. Если отправление найдено, но SKU расходится, это JOIN_ITEM_MISMATCH, а не неизвестная оплата. Сумма целевых единиц на posting+SKU не превышает соответствующее item quantity. Правые поля не могут заменить исходную денежную колонку. Суммы/количества до и после join сверяются.

Все целевые левые строки сохраняются. Missing metadata → unmatched, пустая/неизвестная метка → unknown_value; это разные counters и суммы покрытия. Ни один из этих случаев не считается «без карты». Сопоставление выполняется отдельно в каждом проверенном store block; одинаковые ключи разных магазинов не пересекаются.

Метаданные запрашиваются также за **31 день до начала периода начисления**, непересекающимися частями максимум31 день. Это ограниченное окно поиска, НЕ гарантия всей исторической полноты: более старое отправление может остаться unmatched. Целевая сумма не исчезает. Проверки доступности применяются к фактическим окнам. Действующие row/byte/page/task limits сохранены.

## Полнота результата

`complete=true` означает завершённую и проверенную выборку исходных страниц и полного ответа. Для нового семейства дополнительно обязательны `join_coverage` и `enrichment_complete`: последний может быть false, даже если все страницы получены. Покрытие произносится до таблицы; числовые partition totals хранятся отдельно. Это не разрешение объявить полную классификацию или использовать неизвестную обязательную зависимость C-UE01.

Repository заново строит проекцию и coverage из исходных нормализованных данных перед READY. Exact result schema допускает только старые поля либо старые+две новые; strict bool и canonical JSON сравнение не допускают поддельное/удалённое покрытие и0 вместо false. Миграций таблиц нет. Derived enriched rows не сохраняются второй копией финансовых строк: сохраняются исходные datasets и небольшая metadata покрытия, действующая retention не меняется.

## Что изменилось в коде

Новый универсальный модуль, общие изменения dataset_pipeline.py/repository.py, architecture gate и JSON definitions. `semantics.py`, dialogue.py, engine.py и failure_explanations.py остаются точными hotfix-файлами. HTTPTransport, финансовые формулы и credentials не меняются. Из предыдущих тестовых файлов расширена только функция `fixture` в test_dataset_pipeline.py для трёх новых synthetic source IDs; все прежние assertions и остальные AST-узлы совпали. Другие прежние test-файлы побайтово неизменны. Это не ослабление проверки неизвестного источника.

## Фактические тесты

**1035/1035** полного основного набора:1023 hotfix +7 прежних B05/B13 динамических сценариев +5 новых query-сценариев. Отдельно **57/57** прежних независимых B05/B13 и **70/70** новых join/window/source/queue проверок. Все failures/errors/skips0, TCP/DNS0, live marketplace/DeepSeek0. Не складывать повторные прогоны как новые уникальные тесты.

Проверены: деньги строки/взвешенное среднее; quantity>1; reverse exclusion; отсутствие/unknown/будущая метка; duplicate/foreign key; parent найден,SKU неверен; capacity; невозможность перезаписи; временные окна; все страницы; restart; cancel/revocation; UNKNOWN без автоматического retry; сбой последней metadata-страницы; exact-cache; forged/omitted coverage; два магазина с одинаковыми posting/SKU; сохранность N06/N08 hotfix.

Независимый artificial gold:6 положительных единиц, покупательские суммы390, продавецкие610; одна reverse-строка исключена; Ozon Банк3 единицы/240, средняя80. Это **не данные пользователя**. Отдельная неизвестная метка60 и unmatched40 сохраняются в total100, не классифицируются как non-card.

**JSON-only опыт:** две новые пары источников (4 bindings) и два разных joined отчёта добавлены изменением ровно2 JSON-файлов. Все **30 manifest runtime Python-файлов** неизменны. Получены2 READY, exact HIT,4 fake HTTP и0 внешних. Старый JSON-only опыт offset/cursor источников тоже прошёл. Проверка новых определений не требует нового provider handler.

## Что нашла собственная проверка

Первый join прогон:10 неуспехов RESULT_SCHEMA — закрытый старый result contract не принимал coverage. Исправлен общий контракт с повторной верификацией, coverage не удалено ради PASS. Первый full run:5 новых dynamic routes получили UNKNOWN из-за отсутствующих fake source responses. Расширена fixture-функция без изменения assertions. Логи первоначальных FAIL сохранены. Первый ручной вызов architecture audit передал str вместо Path; исправлена команда, не архитектурная проверка.

## Архив и повторяемость

Полный server-side пакет:
`/root/alice-lab-evidence/matrix-join-20261105/ALISA_MATRIX_JOIN_R01_2026-11-05.zip`

**301054 байта,89 файлов,88 manifest entries**.
SHA256 **114f2c28f38472cc07fab559814a2a4c33636afa53dfee390fe0a4f4df81fb43**.
Runtime manifest:45 файлов, SHA256 **27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d**.

Внутри весь runtime, JSON definitions, прежние и новые tests, runners, patch/fixture diff, authoring history, first-failure/final evidence, README и draft retest. Нет live config, credentials, рабочей SQLite или финансовой выборки. После чистой распаковки повторно1035/1035,57/57,70/70 и JSON-only PASS. Команда `python3 -B run_join_checks.py` воспроизводит все группы.

Git review-код: `runtime/v0.11/matrix_join_r01/dataset_relations.py` и `JOIN_CORE.patch`, commits43ad7dede4979029edc8b6852387ba9e4dcf37e2 иe2df7132a1add99a91f366bda7304523b1b140d9. Модуль blob d85e120972e65f708792bd72bfa18ec3f5c3cd89, patch blob18c23e89eb73bd6d3ea9e3e555e3f1dd3b754917 совпали с серверными байтами. Patch с fuzz0 воспроизводит3 общих изменённых файла от hotfix. Эти два loose Git-файла НЕ являются полным runnable архивом: JSON/test files находятся в полном ZIP.

## Передача и следующий шаг

12 новых внешних сценариев в NEXT_RETEST.md имеют **DRAFT_NOT_ASSIGNED / NOT_DEPLOYED / NOT_RUN**, ответы/время null. Они не заменяют текущий независимый hotfix retest. Исходные BUGS/tester run и7 PARTIAL/2 SKIP не переписаны и не приняты этой авторской проверкой.

Следующий gate: ограниченная реальная квалификация join keys, item quantities и metadata coverage для текущего кабинета через общий ledger и действующие квоты; проверить ранние даты создания, пропуски, дубли и предел positive/reverse. Затем — отдельная установка и назначение tester run. Не включать proof flag по одному HTTP200. B13 live-coverage, платёжный lookup completeness и составная C-UE01 остаются открытыми; код join не делает юнит-экономику автоматически готовой.
