# Передача исполнителю · юнитэкономика по заказам

Владелец поручил создать описание шаблона; рабочий шаблон реализуется другим исполнителем и проверяется отдельно. Пакет не является установленным релизом.

1. Прочитать [Ozon: особенности и алгоритм](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/OZON_ORDER_UNIT_ECONOMICS.md), [Ozon JSON](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/OZON_ORDER_UNIT_ECONOMICS.json).
2. Прочитать [WB: особенности и алгоритм](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/WB_ORDER_UNIT_ECONOMICS.md), [WB JSON](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/WB_ORDER_UNIT_ECONOMICS.json).
3. Реализовать через общий оператор/каталог: дата, площадка, себестоимость, налог — параметры. Исторический C-UE01 не выдавать за готовый по наличию JSON.
4. Сначала проверить [синтетический числовой пример](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/SYNTHETIC_GOLD.json), затем независимый числовой эталон одного набора исходных заказов, включая будущие отмены/возвраты, рекламу и все расходы.
5. Проверить [ограничения и находки](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/BUG_REPORT.md). Для Ozon неизвестная стадия отмены имеет точные поля и действие; для WB не переносить деньги/поля Ozon.
6. Вернуть fix commit, build/catalog hash, перечисление новых общих примитивов и source qualification, статус установки. Тестеру — точный набор реплик в Яндекс Диалогах, ожидаемые суммы, причины всех неполных ответов. Запрос/ответ/время каждого шага обязательны.

Частный отчёт и данные магазина приложены владельцу отдельно, в публичный Git не добавлены. Свежий WB-сбор: [RUN_REPORT](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/inbox/20261105-TESTER-3f3405f9/RUN_REPORT.json). Прежние исследования Ozon: [сравнение начислений](../20261105-TESTER-a9c46e21/COMPARISON_AND_FALLBACK.md). Реестр: ../../README.md. Статус текущего кандидата не заменяет работающую сборку Алисы.
