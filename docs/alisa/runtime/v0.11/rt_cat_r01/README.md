# RT-CAT-R01 · опубликованные скалярные шаблоны через RuntimePort

04.11.2026. **OFFLINE / READY_FOR_INTEGRATION_REVIEW. Не установлен.** Основание: исходный runtime RT-JOB-R01.1 и документация реализации v0.5. Не является полной приёмкой AL-S08/11/13. Работа автора ядра; UI, роли админки, authority, issuer, platform adapter и production assignment принадлежат платформенному исполнителю.

## Что реализовано

`PublishedTemplates` загружает ограниченный набор неизменяемых release-пакетов. Каждый пакет — `manifest` (побайтово исходная catalog_release_v1 schema v0.5) и `payload` runtime_templates_v1. SHA payload должен совпадать с content_sha256 и approved_hash. Это проверка целостности, НЕ проверка полномочий. Обязательный доверенный callback платформы подтверждает реальное утверждение, назначение release, допуск источников и актуальное отключение шаблона.

`RuntimePort(..., templates=catalog)` разрешает штатный runtime_task_v1 с query_input.kind=template. Строго типизированные слоты переводятся непосредственно в тот же структурированный план общего движка; строка не склеивается и не отправляется на повторный разбор. canonical_utterance в записи — проверенное описание смысла, не исполняемый код и не обход правил финансового источника. Никаких новых HTTP-веток, вычислителей по ID шаблона или ключей в каталогах.

`capabilities` показывает только PUBLISHED, разрешённые для всего подтверждённого scope шаблоны; дополнительно учитывает runtime-блокировку источника. Черновик или DISABLED не исполняется. Неподдержанные фильтры/группировки не отбрасываются. Каталог не получает доступ к credentials, SQL, Python/eval или динамическим URL.

## Контракт пакета

```text
manifest: catalog_release_v1.schema.json из v0.5 без правок
payload:
  schema_version: runtime_templates_v1
  base_catalog_bundle_sha256: hash существующих матриц ядра
  templates:
    id, version, state: DRAFT|PUBLISHED|DISABLED
    title, description, canonical_utterance
    platforms: ozon / wb (только совместимые с исходными показателями)
    expressions: существующий ограниченный язык query_program
    time_axes: точные оси всех исходных показателей
    proof_ids: ссылки на доказательства manifest
    limitations: ограничения выдачи
    slot_policy:
      period: required
      grouping: [marketplace, total]
      product_filters: false
```

`required_engine_capabilities`: runtime_template_scalar_v1; `engine_contract_version`: runtime_port_v1. ID release нельзя заменить другим содержимым. Библиотека ограничена 32 релизами, 200 шаблонами на пакет, 512 КиБ на пакет. Старый принятый job хранит release/content/template hash, template_version, нормализованные слоты и календарную дату. Добавление новой версии не переинтерпретирует старый граф. Runtime не хранит бесконечную историю релизов: платформа загружает только нужный ограниченный набор; удалённый или отозванный release недоступен, а не молча пересобирается.

## Обязательная авторизация

Кроме прежних verify/resolve RuntimePort нужен callback:

```python
authorize_catalog(manifest, nonsecret_pins, action, template_id_or_None) -> True
```

Он возвращает именно True лишь после проверки утверждённого hash, роли утвердившего, назначения tenant/actor/revisions и текущего доступа. None/False запрещены; отсутствие callback → AUTH_REQUIRED; непредвиденная ошибка → DEPENDENCY_UNAVAILABLE. Самодельный issuer не добавлен. Proof ID/approved_hash, записанные пользователем в JSON, не являются разрешением. Платформенные статусы и роли админки runtime не подменяет.

Callback вызывается на принятии, исполнении и чтении. При критическом отключении он обязан запрещать нужный template_id также для ранее принятого задания. Изменение текста/формулы создаёт новый immutable release и новое утверждение; возврат к старому release выполняет платформа своим проверенным assignment, а не перезаписью файла на месте. Offline-тесты доказали неизменность уже принятого задания при добавлении другого release, но промышленный workflow админки/подписания/rollback не реализован этим модулем.

## Вход и ограничения R01

```json
{"kind":"template","template_id":"<опубликованный-id>","slots":{"period_from":"2026-10-01","period_to":"2026-10-31","grouping":["marketplace"]}}
```

Это только query_input внутри неизменённого runtime_task_v1. Context, ticket, service identity и authority остаются обязательными. Пример не является готовым авторизованным запросом.

Поддержаны скалярные выражения существующего ядра, один полный период, marketplace/total, Europe/Moscow. Нет молчаливого исключения неподдержанной площадки. Пока не поддержаны шаблонный табличный AST, пользовательский произвольный фильтр/SKU, сравнение двух периодов через этот вид слотов и исторический snapshot. Они дают CAPABILITY_UNAVAILABLE/валидационный отказ, а не похожий отчёт. Utterance-путь RuntimePort сохраняется. Репозиторий, источники и существующие 800 тестов не переписаны.

## Композиция второго исполнителя

```python
catalog = PublishedTemplates(packages, base_bundle_hash=bundle_hash(),
                             authorize=authorize_catalog)
port = RuntimePort(engine, authority, catalog_release_id=legacy_release,
                   service_id=trusted_service_id, templates=catalog)
```

Это composition example, не команда подключить production socket. Один Engine/Worker владеет runtime SQLite. Импорты/типы см. runtime_port.py; платформенный код взаимодействует через прежний IPC, не импортирует runtime для вторых расчётов. Нет нового endpoint кабинета, внешней сетевой публикации или изменения контрактной JSON schema.

## Проверки

**846/846 = 800 прежних + 46 новых**, errors/failures/skips=0, TCP/DNS attempts=0. Все 13 прежних test-файлов сохранены побайтово. Новые: real queue/SQLite/Unix с fake authority/provider, immutable releases, scope/catalog revoke, новые slots, invalid/disabled/draft, точные повторы, restart, результат по ref, отсутствие LLM/парсера при запуске template и JSON-only добавление формулы с неизменными Python-хешами.

Продуктовых API-вызовов, DeepSeek, реальной консоли и изменения active runtime в этой работе нет. Это авторская offline-проверка, не независимый retest тестера. Пять импортированных Ozon CASE не считаются выпущенными шаблонами и отсутствуют в активном каталоге; их зависимости записаны в единой QA-очереди.

## Проверка пакета

В полном каталоге runtime: `python3 -B architecture_gate.py`, `python3 -B run_checks.py`. В workspace QA: `python3 docs/alisa/quality/tools/qa_check.py --check`, `python3 -m unittest discover -s docs/alisa/quality/tests -v`. Оба набора независимы: 20 проверок документов не добавляются к 846 тестам ядра и не называются сетевыми.

## Следующая работа

Общий декларативный источник SRC-OZON-ACCRUAL: cursor/date/signed money, line-vs-unit, границы периода и полнота; затем первые два кандидата цены/дневные количества и исходные OZCP-001/002/003/005 передать тестеру на повтор. Параллельно платформенный исполнитель подключает реальный catalog authority/assignment и RuntimePort adapter на изолированном интеграционном стенде. Установка в рабочую Алису только после этого допуска и новой совместной приёмки.
