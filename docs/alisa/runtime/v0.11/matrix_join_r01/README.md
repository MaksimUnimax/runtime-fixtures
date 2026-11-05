# MATRIX-JOIN-R01 · общий join в матрице

05.11.2026. **OFFLINE_VALIDATED / NOT_LIVE_QUALIFIED / NOT_DEPLOYED.** [Фактическая приёмка](../../../quality/MATRIX_JOIN_R01_ACCEPTANCE_2026-11-05.md), commit92c377ca49f6157521a533c320d8271a6f26e6cd. [План до реализации](../../../quality/MATRIX_JOIN_R01_PLAN_2026-11-05.md).

Рабочая dialogue-fixes-r1 не изменена, текущий независимый retest не заменяется. Candidate `/opt/alice-market/releases/20261105-v010-matrix-join-r1` объединяет hotfix и предыдущие B05/B13 определения в отдельной копии.

## Контракт

`query.relations[]` описывает bounded many-to-one left enrichment: id/label, left/right datasets, composite key pairs, parent-key positions, типизированный left_where, optional quantity capacity, сохраняемые суммы/количества, переносимые metadata fields, coverage field и missing policy. `stage.window` задаёт nonpositive calendar offsets и размер непересекающихся частей. Это данные, не SQL или исполняемый пользовательский код.

Модуль `dataset_relations.py` не знает Ozon/WB, endpoints или credentials. Допустимое новое соединение и новые поля не требуют новой функции в Python. Источники исполняются прежним transport/queue, соответствующие операции и квоты остаются матричными.

Три новых нормализованных source bindings добавляют posting key в начисления и quantity каждого SKU в FBO/FBS metadata. На их основе пять query definitions: строки; оплата; день+оплата; товар+оплата; день+товар+оплата. Пользовательский источник времени — начисления, положительные строки выбраны явно; обратные не подмешаны. Metadata lookback31 день не гарантирует исторической полноты.

## Жёсткие проверки

Правый ключ уникален; дубликаты не схлопываются молча. Если posting совпал,SKU нет — ошибка. Количество левых целевых строк не превышает соответствующее item quantity. Правые metadata не перезаписывают левую сумму. Суммы/количество до и после join равны. Соединение выполняется отдельно для каждого store; одинаковые ключи между магазинами не смешиваются.

Unknown label и unmatched metadata различаются, целевые строки не теряются. Unknown не означает «без карты». Непустые будущие метки не переименовываются. Не выводить карту из bank_coinvestment и не считать разность средних скидкой той же покупки.

`complete` — полнота получения источников/выдачи; `enrichment_complete` — полнота сопоставления; `join_coverage` — counts и суммы групп покрытия. Отчёт с неизвестными данными не скрывает их: coverage озвучивается. Repository пересчитывает всё из сохранённых исходных строк и строго сравнивает canonical JSON перед READY. Удалить coverage ради успешного сохранения нельзя.

## Воспроизведение

Полный runtime + JSON + старые/новые tests + runner находятся в серверном архиве:
`/root/alice-lab-evidence/matrix-join-20261105/ALISA_MATRIX_JOIN_R01_2026-11-05.zip`

SHA256 **114f2c28f38472cc07fab559814a2a4c33636afa53dfee390fe0a4f4df81fb43**,301054 байта,89 файлов,88 manifest entries. После чистой распаковки `python3 -B run_join_checks.py`:1035 main,57 B05/B13,70 join — PASS; новый JSON-only опыт тоже PASS.45 runtime files, manifest27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d.

Две новые пары источников и два соединения добавлены только двумя JSON при неизменных30 manifest runtime Python-файлах;2 READY/HIT,4 fixture HTTP,0 external. Старый synthetic fixture расширен для новых operation IDs без изменения assertions; доказательство AST в archive evidence. Первые FAIL-логи сохранены.

Git здесь содержит generic module и core patch для ревью. Это не полный runnable directory: дополнительные JSON definitions, tests, fixtures и authoring history находятся в полном ZIP. Patch byte-identical серверному, fuzz0 воспроизводит три общих файла от hotfix. Не применять только patch без нового module/матрицы и полного тестирования.

## Следующая граница

Реально квалифицировать unit_number, item quantity, даты/coverage metadata и отсутствие двойного соответствия в разрешённом кабинете через общий ledger/квоты. Только после этого включать новый proof flag и обсуждать установку.12 следующих tester-сценариев в archive docs/NEXT_RETEST.md имеют DRAFT_NOT_ASSIGNED, ответы/времена NOT_RUN/null. Исходные N06/N08/N09 и7 числовых PARTIAL/2 SKIP этим не закрываются. C-UE01 и B13 live полнота остаются открытыми.
