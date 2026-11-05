# BASE-BATCH-02 · завершение H00 и объяснений, r3

05.11.2026. Продолжение владельца после обрыва. Граница неизменна: только matrix/runtime и собственные QA-документы, не products/alisa/issuer/UI/PostgreSQL/чужие locks.

## Факты перед правками

RDC Alisa online. 03:54:30 UTC ExecStart уже `/opt/alice-market/releases/20261105-v010-batch02-merge-r2/runtime.py`, active. Установка r2 зафиксирована 03:18:09; четыре live-service отчёта завершены, 6 HTTP200, повторные чтения без HTTP. Snapshot r2: a783d89332b55be00b7ad07a3d6af47baf8fde3094ccfd0e3adea7f0695063ed, 243812 байт, 75 файлов; прежний roundtrip 943/943. Запущен отдельный повтор тестов точного r2 без сети. Lock `.completeness-merge-owner.lock` наш, но status STAGED_MERGE_NOT_ACTIVE устарел; переустановку r2 из-за этого не выполнять.

## Два подтверждённых остатка

1. information_catalog.json и information.py перечисляют только scalar-features. Установленные dataset-справочник/цены/метаданные не отражаются в H00. planned_sentence ошибочно представляет себестоимость обязательной для любого вида юнит-аналитики; новые требования тестера допускают явно маркированные пропуски, но требуют рекламу и полноту расходов.
2. Engine.safe_submit применяет каталог только когда message==code. dataset.fail создаёт общую фразу с кодом, а dialogue.submit перехватывает Rejected отдельно. Поэтому сохранённый DATASET_NOT_QUALIFIED имеет только техническую заглушку без next_action. Это не повод менять правильные контекстные уточнения о дате/смысле.

## Изменение общего механизма

H00: добавить декларативный тип feature-ссылки на dataset query. Доступность проверять без HTTP через построение проверяемого плана и engine.authorized для текущего scope. Не рекламировать неqualified/отозванный источник. Список настраивается каталогом; ни одной ветки Python по имени площадки/нового блока.

Ошибки: один общий formatter для известных catalog codes и aliases, использовать в safe_submit и nonclarifiable dialogue rejection. Контекстные prompts остаются прежними; старые сообщения с unknown code и настоящим понятным уточнением не подменять. Новые причины DATASET_NOT_QUALIFIED/неподдержанный разрез добавить в JSON. reason/next_action/cause_status, text==tts, отсутствие raw exception echo и никаких новых jobs/API при отказе.

## Приёмка и установка

Сначала новые failing regressions на r2; затем отдельная immutable r3-копия. Все 943 старых проверки без изменения expectations; новые help/scope/dialogue/replay/error tests, JSON-only experiment, manifest/roundtrip. Права/данные/квоты/source-рецепты не менять. Перед переключением проверить held flock, собственный owner, actual ExecStart, 0 QUEUED/RUNNING/pending. Только alice-market restart с сохранностью SQLite, rollback на r2 без отката новых данных. После — no-network help/отказы на действующем gateway и один bounded существующий business scenario при необходимости. Тестер получает отдельный NOT_RUN-пакет с ответом и временем, не подменённый server smoke.

## Новые входы тестера

Зафиксирован commit 1c8d1c8f6ec3b3af18cc6726bb73a77ec6bd62f2: C-UE01 acquiring — прямое amount из API, не процент из денежного отношения. Файл TEMPLATE_CANDIDATE у TESTER-d391a4b1 — SOURCE_BACKED_FORECAST_RESEARCH_NOT_INSTALLED. Actual/estimate/period-allocation, цена продукта и COGS/ordered-units различаются. Это важные входы следующего составного этапа; H00 не объявляет C-UE01 реализованным. Исследовательские файлы тестера не редактируются.
