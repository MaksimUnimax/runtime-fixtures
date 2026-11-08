# OWNER-BINDING-R1 — подключение со стороны платформы

8 ноября 2026. Это передача matrix-side входа, не установленный API и не разрешение менять платформенную авторизацию или работающий навык.

## Точная граница готовности

В отдельном кандидате `/opt/alice-market/candidates/20261108-owner-binding-r1` реализован приём внешнего подтверждённого snapshot себестоимости/налогов/собственных расходов через прежние OwnerInputs, ScenarioBindings и Worker. Нового issuer, хранилища, SQL-таблиц, сетевого клиента и расчётчика нет.

В просмотренных исходниках установленных platform/admin releases `alisa-482ed11832b666af` и `alisa-73180172646b7012` producer owner snapshots и current-verifier не найдены. Установленный `contracts/runtime/port-v1.json` объявляет `RUNTIME_NOT_CONNECTED`. Это ограниченное наблюдение кода/контракта, не утверждение об отсутствии данных во всех БД. Рабочие БД и секреты ради поиска расходов не читались. **Реальные owner inputs этим проходом не подтверждены; live-интеграция NOT_RUN.**

## Вход в существующий граф

Использовать `owner_bound_adapter(graph_authority, owner_authority, policy=None)` из `adapters/fresh_queue_adapter.py` полного пакета. Возвращается прежний FreshScenarioQueueAdapter, который регистрируется под существующим именем fresh_scenario. Оба доверенных callback обязательны. Default политики этой точки входа — `normalization_owner_snapshot.json`, без owner_profile/r9. Пустая, смешанная или legacy-политика отвергается; fallback к 250 ₽ отсутствует.

Старый квалификационный путь R4 сохранён для воспроизводимости и регрессии. Его нельзя выдавать за новый production-input путь или использовать как запасной вариант при отказе owner authority.

Существующий graph_inputs/v1 сохраняет schema/revision/issued_at/expires_at/payload. Payload имеет **ровно** `owner_bundle`, `scope_hash`, `started_utc`, `lookup_day`. Время timezone-aware, started_utc соответствует issued_at.

`owner_bundle` имеет ровно поля: schema=`alice-owner-binding/v1`; issuer, approval_ref, binding_revision; scope_hash, store_id, store_entity; mapping_revision, product_map; snapshot — прежний S03 envelope `{payload, sha256}`.

scope_hash — канонический hash разрешённого `{tenant, revision, stores}`. Store берётся из серверного plan, не назначается клиентом. product_map связывает нормализованный ключ SKU с подтверждённой сущностью товара платформы. Текущие ограничения: один магазин, до 200 товаров, взаимно-однозначное сопоставление. Many-to-one aliases требуют отдельной квалификации. Отсутствующая связь не заменяется частичным совпадением артикула.

## Что требуется от платформенного исполнителя

1. Предоставить штатный producer approved owner snapshots из авторизованного хранилища. Реальные значения определяются владельцем/его сохранёнными утверждёнными записями, не старым аналитическим примером и не моделью.
2. Атомарно закрепить snapshot revision, approval, mapping revision и текущую область аккаунта/магазина. Передать существующие S03 поля с состояниями VALUE / EXCLUDED_BY_OWNER / NOT_PROVIDED. Цена товара из API не заменяет себестоимость.
3. Инжектировать `owner_authority(kind, metadata, request, action)` с проверкой текущих прав и точных одобренных hashes/versions. Только literal True означает разрешение; отсутствие callback, исключение, False и truthy 1 означают отказ. Callable не приходит из NLP или пользовательского JSON.
4. Сохранить независимую graph_authority для аккаунта, графа, источников и актуальных access/security/source revisions. Owner authority не расширяет её полномочия.
5. Выполнить отдельную интеграционную приёмку на реальном approved snapshot и exact package до любого голосового rollout. Не писать напрямую в чужую SQLite и не создавать второй runtime port в обход платформенной проверки.

## Контракт current-verifier

При kind=`binding` metadata содержит issuer/approval_ref/binding_revision/binding_hash; mapping_revision/mapping_hash; snapshot_hash/owner_revision/catalog hash/policy hash; tenant/scope_hash/store_id/store_hash; access_revision/store_access_revision/source_revision; period/currency/timezone/expires_at. Request — контекст scope/store_entity/currency/period/as_of.

При kind=`owner_input` добавляется resolution metadata прежнего OwnerInputs; request содержит scope_hash/entity/currency/period/fields. Проверяется конкретная сущность, поля, exact snapshot/mapping и текущий отзыв.

Binding actions: execute/read/commit; внутренний resolver: resolve/execute/read. Проверки повторяются при приёме, исполнении, перед публикацией, чтении и replay. Новая одобренная версия не меняет арифметику принятого задания: старое либо продолжает с прежней всё ещё разрешённой версией, либо получает отказ. Отзыв после READY запрещает выдачу сумм.

**JSON-schema и hashes не авторизуют данные.** Нельзя включать production с `lambda ...: True`, самоподтверждением bundle или одной строкой issuer. Доверенный verifier должен обращаться к текущему платформенному состоянию через штатную границу безопасности.

## Деньги и сроки

Денежное значение — точная десятичная строка, не float. Для unit_cost — интервалы действия; tax_amount/own_cost_amount — сумма за точный период. Матрица не вычисляет налоговую ставку и не распределяет месяц на дни без правила. Явный ноль, отсутствие значения и разрешённое владельцем исключение различны.

Недостающие отдельные поля сохраняются как omissions по прежнему сценарию. Это не полный набор затрат и не чистая прибыль. Snapshot/graph/source ограничивают срок результата минимумом своих сроков. Старый snapshot не обновляется автоматически при чтении.

## Пакет и приёмка

[Полный пакет](../runtime/v0.11/owner_binding_r1/README.md) содержит actual source, common patch, структурную схему, явно synthetic пример, 54 Worker-проверки, 12 проверок входа/объяснений и JSON-only gate дополнительного расхода.

Офлайн: `python3 -B verify_owner_binding.py --output /tmp/alisa-owner-binding-check`. Live/permissions/installer скрипты старых кандидатов в полном dependency layout для этого не запускать. Независимое ревью и реальный platform issuer/current-verifier остаются открытыми. Не выдавать авторские искусственные проверки за production.
