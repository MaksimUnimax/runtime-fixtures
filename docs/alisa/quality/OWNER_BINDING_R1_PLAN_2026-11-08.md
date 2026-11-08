# OWNER-BINDING-R1 — план перед изменениями

8 ноября 2026. Продолжение по команде владельца после MATRIX-LIVE-R4, checkpoint 100dda7bb069d0bf8ea22c5af1c666b7df81ea8b. Область исполнителя: матрица, шаблоны, общий расчётный путь. Не платформа/авторизация/интерфейсы и не rollout.

Проверены 170 записей R4 MANIFEST, действующая S05 сборка/PID145588 и 74 файла, собственный замороженный checkpoint и locks. Другие участки не изменяются. Кандидат: /opt/alice-market/candidates/20261108-owner-binding-r1. Evidence: /root/alice-lab-evidence/owner-binding-r1-20261108.

## Фактически найденная граница

В просмотренных установленных platform/admin source releases (alisa-482ed11832b666af и alisa-73180172646b7012) не найден issuer owner snapshots / unit_cost / tax_amount / own_cost_amount. Установленный contracts/runtime/port-v1.json объявляет disconnected capability / RUNTIME_NOT_CONNECTED. Это результат ограниченного просмотра кода/контракта, не утверждение о содержимом всех пользовательских БД. Рабочие БД/секреты для поиска расходов не читались.

S03 OwnerInputs и ScenarioBindings уже существуют: версии, даты, явное исключение, пропуск, ноль, полномочия и pins. Матрица должна использовать их, а не писать второй resolver. Успешный R4 применял r9 example; подтверждённого производственного snapshot на входе нет. Поэтому реальные числа из аналитических экспериментов не переносятся и новый живой расчёт с выдуманным issuer не выполняется.

## Связный пакет

1. Ввести общий строгий matrix-side контракт передачи owner snapshot и квалифицированного product mapping. Tenant/store/revisions/period/currency берутся из разрешённого графа, а не из свободного текста. Hash обеспечивает целостность, но не право: обязателен доверенный внешний verifier текущих полномочий и exact утверждённых входов.
2. Подключить этот контракт к существующим FreshScenarioQueueAdapter/MemoryNormalizer/QualifiedSourceNormalizer через общий расширяемый вход, затем прежние selector/ScenarioBindings/OwnerInputs. Не копировать арифметику и не создавать очередь, SQL-таблицы, HTTP-клиент или issuer.
3. Отдельная production-input политика JSON без owner_profile/r9. Отсутствующий bundle/verifier — отказ до provider IO; неизвестные отдельные значения остаются omissions по существующему контракту. Налог VALUE/EXCLUDED_BY_OWNER/NOT_PROVIDED и ноль различны. Месячный расход не распределяется на день без правила.
4. Проверять current authority на ingress/execute/commit/read/replay, закреплять snapshot и mapping в graph input hash, ограничивать expiry минимальным сроком. Обновление одобренной версии не меняет уже принятое задание; отзыв не допускает старый ответ.
5. Отрицательные и числовые проверки на synthetic inputs, полный Worker/SQLite путь, регрессия R4, JSON-only добавление совместимого owner поля, чистый архив. Независимый verdict не присваивать.
6. Передать платформенному исполнителю точный код/контракт и список отсутствующих producer/current-verifier подключений. Не считать существование schema/fixtures производственной интеграцией. Рабочая S05 и счёт 82/78/4 неизменны.

Цель прохода: работающий проверенный matrix-side путь с внешним owner snapshot без r9 defaults; отдельно честно зафиксировать состояние настоящего источника, live-интеграции и независимой приёмки.
