# Почему WB отсутствует в кабинете — 16.11.2026

Статус READ_ONLY_MAPPING_GAP_CONFIRMED. Живая смена площадки в AL-T09-01 ещё не принята. Отсутствие WB воспроизведено и объяснено состоянием регистрации магазинов, а не поиском каталога.

| Слой | Ozon | WB |
| --- | --- | --- |
| Тот же активный native account |1|1|
| Ссылка на существующие credentials в native config |есть|есть|
| Legacy runtime-bindings текущего tenant |есть|нет|
| Store текущего tenant кабинета |ACTIVE,1|нет|
| RuntimeStoreBinding текущего tenant |1|нет|

Связь проверена в обе стороны: tenant текущего Ozon-магазина совпадает с legacy mapping; native tenant совпадает с RuntimeTenantBinding; полный native descriptor Ozon из mapping точно совпадает с account config, где найден WB. Другой аккаунт для этого вывода не использован. Это доказывает наличие WB в том же native account, но само по себе не создаёт новый портал-доступ.

Read-only PostgreSQL-транзакция с default_transaction_read_only=on и statement_timeout=2s прочитала только нужные metadata. Проверены provider/status и kind/status/check_code credentials без ciphertext. Содержимое ключей площадок не читалось; использовано существующее соединение сервиса с БД, новые credentials не создавались. Никаких Store/credential/binding/grant/job изменений и внешних вызовов не выполнено. Доказательство Alisa: `/root/alisa-catalog-units-install-20261116/WB_MAPPING_READBACK.json`.

Исходник stores/service.py:listing возвращает Store своего tenant. runtime_adapter/store_registry.py:enroll создаёт привязку после успешной проверки принадлежности и активных credentials; overlay сверяет текущий tenant, store identity и revision. Поэтому изменение только runtime-bindings.json не добавит магазин в список кабинета и не заменяет штатную регистрацию/проверку.

Следующий шаг — подготовить штатное включение существующего WB в кабинет с проверкой принадлежности, дубликатов и совместимости со станцией; сохранить исходные native IDs и текущий Ozon. Затем проверить в настоящем браузере список магазинов, поиск/карточку WB и перенос его вопроса/периода без отправки. До этого AL-T09-01 остаётся PARTIAL. Установленный web, доступ, R5 и параллельный R15 не менялись.
