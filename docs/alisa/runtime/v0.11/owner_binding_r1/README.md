# OWNER-BINDING-R1 — внешний snapshot данных владельца

8 ноября 2026. **Matrix-side реализовано и проверено офлайн; production producer/current-verifier не подключены; не установлено.**

[План](../../../quality/OWNER_BINDING_R1_PLAN_2026-11-08.md) · [Контракт платформенной стороны](../../../quality/OWNER_BINDING_R1_PLATFORM_HANDOFF_2026-11-08.md) · [Фактическая приёмка](../../../quality/OWNER_BINDING_R1_ACCEPTANCE_2026-11-08.md).

## Что действительно изменено

Новый общий `adapters/owner_snapshot_binding.py` проверяет строгий owner_bundle, область магазина, snapshot и product mapping, их версии/hash/сроки и доверенный внешний callback. Он использует прежний OwnerInputs; не является issuer и не рассчитывает деньги.

В двух прежних файлах — `adapters/fresh_queue_adapter.py` и `fresh_source/normalized_source_engine.py` — добавлен общий вход внешнего owner snapshot и проверенное сопоставление product entities. Существующие selector, ScenarioBindings и формулы продолжают расчёт без копии арифметики. Python Engine/Worker/Repository/HTTP и существующие OwnerInputs/ScenarioBindings не менялись.

Новая JSON-политика `fresh_source/normalization_owner_snapshot.json` не содержит owner_profile. Точка подключения `owner_bound_adapter(graph_authority, owner_authority)` выбирает именно её; пустая/mixed/legacy-политика и отсутствие callback отвергаются. Исторический r9 сохранён только в прежнем квалификационном пути и не используется как fallback нового входа.

Catalog failure explanations дают безопасные причины отсутствующей проверки прав, отзыва, несовпадения области, неподтверждённого сопоставления и истечения owner snapshot. Отдельные отсутствующие денежные поля сохраняются как omissions по прежнему правилу, не как нули.

Это расширение общего кода для новой семантики входа, **не утверждение, что весь проход был JSON-only**. После добавления механизма проверено расширение совместимой функции только каталогами: упаковка за период добавлена в изолированной копии изменением четырёх JSON, без изменения Python.

## Полный исходный пакет

Кандидат Alisa: `/opt/alice-market/candidates/20261108-owner-binding-r1`.

Архив: `/root/alice-lab-evidence/owner-binding-r1-20261108/ALISA_OWNER_BINDING_R1_2026-11-08.zip`.

**550299 байт; 187 файлов; 186 записей MANIFEST.**

SHA256 архива: `168d668f3950234b4893d954ad6cfec67e95f0bad47fb7c531d0745346c2b072`.

SHA256 MANIFEST: `1c079999ced382861837958e762f01030daf745648d1761b61a4313b7986da54`.

Включены полная база R4 и зависимости, новый модуль, фактический общий patch, JSON-политика, структурная схема и явно synthetic пример, все тесты, безопасные журналы и readback. `owner_contract/PLATFORM_HANDOFF.md` описывает точное подключение. Малые Git-документы не заменяют dependency layout этого архива.

Нет рабочих ключей, config, пользовательской SQLite и реальных финансовых ответов/owner snapshots. Исторические live runners и permissions-скрипты из базы не запускать как проверку или installer.

Офлайн-повтор:

```sh
python3 -B verify_owner_binding.py --output /tmp/alisa-owner-binding-check
```

## Проверки

**1840/1840**: 1774 прежних R4, 54 новых Worker/owner checks, 12 новых entrypoint/error checks. Дополнительно отдельный JSON-only extension gate PASS; он не прибавляется как выдуманное число unit-тестов. Все provider ответы искусственные, временные SQLite, попыток реальной сети 0. Повтор чистой распаковки фиксируется в приёмке и не увеличивает уникальное число.

Проверены разные unit costs товаров и интервалы действия, введённые налог/own expenses, omissions/ноль/исключение, запрет месячного prorating, exact-cache/replay, изменение входа после принятия, новая версия как другое задание, revoke между источниками/перед публикацией/после READY, минимальный TTL, неверные store/scope/catalog/mapping/hash, отсутствие/False/truthy/exception verifier, пропущенное соответствие товара, чтение без пересчёта и восстановление engine на той же temporary DB. Последнее не выдаётся за новый внешний production restart.

## Что ещё отсутствует

Подтверждённые реальные owner данные и штатный producer/current-verifier не установлены в рамках этого прохода. В двух просмотренных platform/admin source releases такой вход не найден; установленный runtime contract объявляет disconnected capability. Это не повод брать 250 ₽, налог или прочие значения из старого примера.

Нужны платформенный producer/verifier, интеграция реального approved snapshot и mapping, затем ограниченный live-run и независимая приёмка точной версии. Установка/голосовой маршрут — отдельный допуск. Независимое ревью NOT_RUN, DS03 и прежние PARTIAL/SKIP открыты. Активная S05 и каталог **82/78/4** не менялись.
