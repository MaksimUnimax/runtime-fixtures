# Контракт матрицы источников и общего исполнителя

04.11.2026. Основание: ADR-005 и RCA-001. Статус: неактивный кандидат переработки, не установленный релиз. Реализованная миграция — четыре новых табличных JSON-источника; старые скалярные адаптеры ещё не перенесены.

## Назначение

Совместимый источник добавляется описанием данных, а не Python-веткой. Код один раз реализует конечные общие примитивы; матрица задаёт request/response binding, типы, условия, пагинацию, полноту и ограничения. В JSON нет Python, SQL, callbacks или eval. Модель не редактирует production-каталоги и не получает доступ к credentials/URL.

## Ответственность файлов

- source_matrix.json: полные контракты источников; поля platform/url/method/quota_operation/interval/daily_limit/auth/request/payload_schema/response/proof_requirements/availability/axis.
- table_catalog.json: маршруты family/platform/view → source, пределы и точные причины недоступности.
- matrix_core.py: ограниченные выражения $path, $fn, $if, проверка дерева, Decimal и календарь.
- matrix_sources.py: общий request builder, header binding, JSON-row mapping, single/offset/cursor, целостность и полнота.
- table_analytics.py: общая нормализованная обработка filter/group/rank/series/compare и речь, без четырёх endpoint-specific декодеров.
- http_transport.py: проверка qualification, server-side credentials и HTTPS. Legacy scalar branches пока явно остаются.
- expression_catalog.json / speech_catalog.json: имеющиеся составные формулы и речевые ускорители.
- architecture_gate.py: источник-специфичные literals и eval/exec запрещены в новых общих модулях и row-интеграции. Это не формальная верификация всего Python и не заявление об отсутствии старых legacy-веток.

Вспомогательный tools/build_source_matrix.py создаёт первоначальный JSON при разработке; он не импортируется runtime и не нужен для дальнейшего добавления источника. Тесты правят JSON непосредственно.

## Язык binding

```json
{"$path":["period","from"]}
```

Явный путь словаря/массива; корни request: period, view, filters, store, progress, params. Default применяется только при отсутствующем поле. Null не превращается в ноль. Атрибуты Python, файлы, импорты и сеть недоступны.

```json
{"$fn":["nonnegative",{"$path":["row","amount"]}]}
```

Фиксированное имя и арность из версии движка: проверки чисел/идентификаторов/дат, метки/бренд, hash, prefix, точная арифметика знака, явный null_if_zero, сравнения, суммы и полное множество дней. Произвольная функция, regex или код из JSON не запускается.

```json
{"$if":[{"$fn":["eq",{"$path":["v","kind"]},"R"]},{"$fn":["negate",{"$path":["row","amount"]}]},{"$fn":["decimal",{"$path":["row","amount"]}]}]}
```

Исполняется одна ветка, но проверяются обе до использования. Неизвестная функция в невыбранной ветке также запрещена. Пределы: до 4096 узлов и глубина 32 в выражении, путь до 16 элементов; источник и весь каталог также ограничены.

## Проверка запроса и безопасности

Матрица schema=alice-source-matrix/v1, до 128 источников, до 1 МиБ. Верхние ключи закрыты. Собственная компактная payload_schema поддерживает object/array/integer/string/boolean, required/enum/границы/длины/форматы дат. Она НЕ объявляется полным стандартом JSON Schema. Boolean не integer, неизвестные поля отвергаются.

Auth headers читают credentials только внутри закрытого транспортного вызова. Ключей в JSON нет. Host/Content-Length/Connection/Transfer-Encoding и CRLF injection запрещены. Optional JWT claims проверяет квалифицированный класс токена, но НЕ заменяет проверку подлинности на стороне API.

Фиксированные HTTPS origins и endpoint, без userinfo/IP/query/fragment в базовом URL. Конкретный вызов требует свежего разрешения магазина, source qualification, registry/table hash. Один новый URL в файле не является разрешением на сетевой запрос. Заголовки и private данные не попадают в LLM/нормализованный отчёт.

## Нормализация ответа и полная выборка

Response: items/root_asserts/lets/row_asserts/map/include/currency/identity/pagination/totals/dataset_asserts и коды ошибок. Общая последовательность: массив → корневые проверки → safe bindings → проверки строки → identity → фильтр периода → нормализованные поля → все страницы → итоговые проверки → READY.

Single — квалифицированный полный ответ. Offset — переход по длине исходной страницы, не по числу строк после фильтра. Cursor — курсор из заявленного поля, монотонность/отсутствие зацикливания, до пустой страницы. Внутренний progress фиксирует recipe_hash и scope_hash; перенос на иной источник/магазин/период отвергается. При смене валюты/total, дубликате, пропущенном дне, нуле/отсутствии обязательного поля или превышении лимита не выдаётся ложный частичный успех.

До 20000 нормализованных строк и 6 МБ; ограничения задаются существующим bounded row-каталогом. Возвраты обрабатываются отдельно. Нулевая незаполненная цена становится null только по явному правилу рецепта; остальные нули сохраняются. Исходные saleID/srid/адреса не сохраняются в рабочей строке. Hash ID не объявляется криптографически гарантированной анонимизацией.

## Версии и выпуск

План фиксирует общий hash table_catalog + source_matrix; хранение, exact-only, UNKNOWN, access/replay/lease сохраняются. Новый рецепт → новая матрица/hash → static checks → прежняя регрессия → matrix-only extension proof → разрешённая live qualification → отдельный release → health/ledger/консоль. Нельзя выдавать офлайн-воспроизведение записанных настоящих данных за новый HTTP или пользовательскую приёмку.

## Пройденная область и оставшийся долг

Четыре перенесённых контракта: Ozon analytics sku/day, WB funnel/products, WB grouped/history, WB supplier/sales. Их request/response/sign/date/page semantics находятся в JSON; специальных веток этих источников в общем ядре/HTTP bridge больше нет.

НЕ перенесены старые providers.py/finance_stock.py/registry.py, рекламный OAuth token lifecycle, многошаговый stock task/status/download, старые агрегатные декодеры и контроль приёма новых скалярных metrics. Table T1 по-прежнему ограничен поддержанными слотами; свободный table AST, произвольные типы метрик/строк, joins/новые протоколы не объявлены готовыми. Эта область остаётся OPEN и не скрывается числом зелёных тестов.

## Внешние ориентиры

Перечитаны 04.11.2026: https://cel.dev/overview/cel-overview (parse/check/evaluate), https://calcite.apache.org/docs/ (разделение планирования и адаптеров). Это первичные ориентиры принципов, не доказательства корректности нашей реализации. CEL/Calcite не устанавливались; совместимость с их стандартами не заявляется.
