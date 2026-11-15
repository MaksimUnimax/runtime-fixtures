## REQUEST_CHANGES

Исправление R10 закрывает прежний дефект: fee type 69 без SKU теперь отклоняется, а распределение type 93 по исходным физическим единицам помечается как `QUALIFIED_POSTING_ALLOCATION`, не как SKU-фактический расход. Добавленные проверки покрывают оба отказа и метку распределения.

Остальные просмотренные границы выглядят согласованно: неизвестные owner-суммы не превращаются в нули; `calculate` требует точного набора строк и unit costs; текущие параметры и себестоимость добавлены только в ответ в памяти, не в checkpoint. Проверка `publication_check` повторно читает текущие owner и coefficient fences. Исторический replay явно ограничен арифметикой выбранных старых фактов/тарифов и не заявляет квалификацию полного provider ledger.

**Дефект — correction может молча выпасть из расчёта.** В `products/alisa/services/platform/src/alisa_platform/owner_data/economics_cohort.py:147` событие с posting вне cohort пропускается до проверки `nature` и `parent_id` на строках 150–152. Например, исходный fee `fee1` относится к posting `p1` в cohort, а correction с `parent_id="fee1"` ошибочно или иначе указывает `posting="old-posting"`. Correction попадёт в `outside_cohort`; исходный fee останется в сумме без коррекции, хотя ниже код требует совпадения posting с parent. Это может дать неверный расход вместо fail-closed отказа.

Тесты, product/API и DB не запускал; ничего не менял и не публиковал. Это read-only review, не live/deploy/CI approval.
