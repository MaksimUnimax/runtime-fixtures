# S03 / OWNER-INPUTS-R01

05.11.2026. **OFFLINE_VALIDATED / NOT_INSTALLED / PLATFORM_ADAPTER_REQUIRED.**

Общий runtime-модуль разрешает введённые владельцем значения для точных товаров/магазинов и дат. Это не готовый голосовой шаблон C-UE01 и не интерфейс кабинета. Рабочий `matrix-join-r1` не менялся.

## Реализованный контракт

Матрица owner_input_catalog.json содержит три вида входов: себестоимость физической единицы с датами действия; сумму налога за точный период, включая явно подтверждённое исключение; собственные расходы за точный период. Значения не зашиты в программу. Число250 в synthetic tests — пример, не настройка магазина и не значение по умолчанию.

Один `OwnerInputs.resolve` проверяет schema/Decimal/границы, точный scope, entity, валюту, период, версии, пересечения и полномочия. Четвёртый вид «упаковка на физическую единицу» добавлен в тесте исключительно JSON, Python SHA остался прежним. Изменения себестоимости внутри периода остаются разными сегментами, а не одной средней.

VALUE, EXCLUDED_BY_OWNER, NOT_PROVIDED различаются. Null не0; net_price маркетплейса не владелецкая себестоимость. Сумма за месяц не распределяется на день без отдельного правила: PERIOD_ALLOCATION_REQUIRED. Физическая себестоимость не превращается в COGS/ordered_units. Количество/даты потреблённых единиц и отмены учитывает будущий общий составной план, а не этот resolver.

## Полномочия и pin

```python
resolver = OwnerInputs(catalog)
result = resolver.resolve(envelope, request,
    authorize=trusted_authorize, now=trusted_server_epoch,
    action='resolve')
# Следующий этап заново проверяет права и прежнюю неизменную версию.
result = resolver.resolve(envelope, request,
    authorize=trusted_authorize, now=trusted_server_epoch,
    action='execute', pin=accepted_pin)
```

Envelope `{payload,sha256}`. Payload: schema/revision/scope_hash/catalog_hash/issued_at/expires_at/entries. Entry: id/field/entity/currency/period/state/value. Request: scope_hash/entity/currency/period/fields. Полные примеры исполняются в тестах; никакое поле не скрывается за неявным default.

`authorize(metadata, normalized_request, action)` должен вернуть именно True после реальной проверки identity, actor/store/product mapping, разрешений, назначения exact content hash и revocation. Ошибка callback — OWNER_INPUT_AUTH_UNAVAILABLE, отсутствие — AUTH_REQUIRED; truthy1 не допускается. SHA и правильный JSON не дают полномочий. Callback получает hash/revision/scope, но не копию финансовых строк. Существующие issuer/runtime_task_v1/админка не заменяются новым самодельным протоколом.

Pin: hash фактов + revision + hash каталога + нормализованный request hash. Новый snapshot не переинтерпретирует старый job. Изменение суммы даже при том же revision отвергается относительно pin. Нет выбора последней строки среди пересекающихся фактов. Порядок списка fields не меняет смысл запроса.

## Хранение и пределы

Нет HTTP, SQL, writes, daemon или накопления диалогов внутри модуля. Снимок<=1МиБ; данный каталог<=2000 записей,<=366дней запроса,<=1024сегментов; до64полей. Авторизационный snapshot живёт максимум24часа. Это не удаление деловой истории себестоимости в платформе: её хранение/retention остаётся платформенной задачей. Runtime обрабатывает ограниченный snapshot и pin. Даты — заданный бизнес-календарь, timezone/деноминатор не угадываются.

## Фактическая приёмка

66/66 локально и на Alisa в отдельном candidates-каталоге. Отдельно8/8 взаимодействия с точными существующими report_contracts.py/catalog из active matrix-join-r1. В тесте настоящий ReportContracts, но synthetic adapter/authority/inputs. Нет liveDB/ключей/HTTP. Bridge в test_report_gate_integration.py — тестовый, не готовый production adapter.

Проверены отсутствие default, явный0 против неизвестного, tax exclusion, gaps/overlap, валюты, чужойscope, ревизии, expiry, revoke, мутация, JSON duplicate/nonfinite, ёмкость, price×units против unit cost, неавторизованная подмена snapshot и JSON-only extension. Взаимодействие не позволяет убрать обязательную рекламу/полноту и не выдаёт READY финансового отчёта.

Код/каталог/66tests доступны в этой папке. Запуск `python3 -B test_owner_inputs.py`. Дополнительная проверка: `ALISA_RUNTIME=/path/to/matrix-join-r1 python3 -B test_report_gate_integration.py`.

Самодостаточный ZIP владельцу дополнительно содержит две unchanged gate dependencies с provenance, runner/manifest, инструкции и replay logs, чтобы выполнить все66+8 без сервера. Это не полный runtime и не установщик. На сервере candidate: `/opt/alice-market/candidates/20261105-owner-inputs-r1`.

## Учтённые требования C-UE01 и следующий шаг

Прочитан TESTER-d391a4b1 revision automatic-cancellation-return-tariff-fallback-r9 (blob b1aeeacbde06860ef7f6076c0826816eb0bbc2cb): owner input не подменяется API net_price; actual, tariff estimate и allocation различаются. Unknown physical stage не вводит новый обязательный manual gate — разрешённая владельцем тарифная оценка относится к будущему составному плану. Реклама/полнота остаются обязательными.

Следующее: runtime-адаптер owner facts в общий расчётный план, exact quantity/date COGS и отдельная policy распределения расходов; после — два сценария C-UE01 без отмен/с отменами. Authority/mapping/UI сохраняются за платформенным исполнителем. S03 целиком и C-UE01 не объявляются установленными. Новых внешних сценариев тестеру в этом проходе не назначено; текущая установленная matrix-join-r1 не перезапускалась.
