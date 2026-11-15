**SOURCE_APPROVE** для точного HEAD `ae7a4219042bb7d7ee3c7de30d90990007b7c9ad`.

Закрытые замечания:

- Граф ORIGINAL/CORRECTION/SALE_REVERSAL теперь проверяется до cohort-фильтра: parent должен существовать и быть ORIGINAL, а posting, SKU, scheme, type, currency и quantity должны совпадать. Поэтому событие вне cohort с `parent_id` на событие внутри cohort больше не может изменить его сумму. Проверка находится в `products/alisa/services/platform/src/alisa_platform/owner_data/economics_cohort.py:130`.
- Добавлены негативные случаи для correction и sale reversal с неправильным posting, а также случай, где корректная foreign-пара целиком исключается из cohort: `products/alisa/tests/economics_cohort/test_sources.py:121`.
- Posting allocation ограничена группой `other` (type 93) и физическими единицами; для commission, acquiring и processing без SKU код требует item attribution. Распределение помечается как `QUALIFIED_POSTING_ALLOCATION` в `products/alisa/services/platform/src/alisa_platform/owner_data/economics_cohort.py:163`.

По прочитанному в разрешённом scope контрпримера для этих замечаний не нашёл. Проверил точный HEAD и diff; **тесты, API, DB и CI не запускал**. `catalog.json` и `economics_current.py` в этом коммите не менялись.

Отдельная граница кандидата: связь source verifier с реальным ledger/raw API всё ещё не реализована. Это оставляет кандидата без подтверждения готовности live collector; не считаю это дефектом исправления correction graph. Этот вердикт — только SOURCE review, не live- или full-CI approval.
