# C-UE01 / SOURCE-PRODUCER-R01 — план до кода

5 ноября 2026 года. Владелец продолжил основную задачу и сообщил, что safety-отчёт уже передан тестеру. **Активную conversation-safety-r1 не менять и не перезапускать.** Работа в отдельном кандидате; platform/UI/identity/PG/issuer/чужие locks вне области.

## Прочитанные основания

- Git HEAD f6463fc2ee83d8b8693ce191cd616cb770d9c00f; tester-d391a4b1 revision automatic-cancellation-return-tariff-fallback-r9, blob b1aeeacbde06860ef7f6076c0826816eb0bbc2cb. Его поля/правила не переписываются нашими догадками.
- Полный S03/scenario archive dc9024077b5d33b85890c7bfaf648fe30b5ebd488faaf802e7a0984ef3d4587b: 88+66+8 исторических проверок; источник сумм и actual→tariff selection ранее отсутствовали.
- Readback 10:43:19 UTC: active conversation-safety-r1, PID78925,46/46 hashes, active jobs0, SQLite ok. Счётчик только accrual-key60 за24ч — не разрешение потратить весь бюджет; другие типы квот проверяются отдельно.
- Действующие SourceMatrix/HTTPTransport уже умеют raw read-only FBO/FBS, product info/prices, finance/balance, daily ads, accrual/by-day. Нынешние публичные проекции отбрасывают часть prices/acquiring/tariffs/order-line полей, поэтому новый source projection не объявляется готовым от наличия старого отчёта.
- Повторно проверены первичные источники: https://dev.ozon.ru/news/734-Otkliuchenie-starykh-metodov-Seller-API-dlia-raboty-s-postingami/ (v3FBO/v4FBS); https://dev.ozon.ru/news/699-Novye-metody-dlia-finansovykh-otchetov-v-Seller-API/ (новые accrual APIs); https://dev.ozon.ru/start/448-Spravochnik-metodov-Seller-API-dlia-Ozon-Logistiki/ (PartialReturn child не второй исходный заказ). Официальный docs.ozon.ru/api/seller не дал читаемого текста в web; не заменять схему сторонней копией как якобы официальной.

## Цель текущего среза

Общий producer подготавливает уже реализованные cohort/expenses envelopes для ScenarioBindings. SourceMatrix отвечает за страницы и поля; новый общий селектор — за проверяемые соответствия, приоритеты и основания. Формулы, имена полей, статусы, допустимые схемы и группы расхода — JSON, не ветви Python по Ozon/названию C-UE01. Нет нового постоянно работающего финансового executor.

Контроль перед вычислением: весь исходный заказной период/магазин, доказанная пагинация, валюта, quantity, SKU/offer/product mapping, точная связь posting/order/item и cardinality. Split/parent-child неоднозначность не приписывается случайному SKU. Неполная информация возвращает конкретный gap, а не неизвестные нули.

Расходы: matched actual при подтверждённой полноте и применимости; иначе квалифицированный API tariff; иначе разрешённый актуальный официальный tariff. Midpoint только между реальными min/max. Эквайринг — direct amount, комиссия — explicit percent только в соответствующем поле. Не выводить процент из отношения денежных сумм. Для неизвестной стадии отмены использовать разрешённую conservative return tariff estimate, не обязательное ручное подтверждение. Событие handover не выдумывается. Неприменимость в контрфактическом сценарии не маскируется как фактический нулевой debit.

Fact и tariff могут сочетаться между строками: сохранять детализацию оснований (при необходимости отдельные однородные компоненты в JSON-каталогах сценариев), не маркировать смешанную сумму ACTUAL. CPO не прибавляется второй раз к daily spend, finance overhead не дублирует matched/tariff unit costs. Реклама и подтверждение полноты/пересечений обязательны. Owner cost250/tax exclusion в r9 — явные данные владельца только для этого согласованного примера, не default всего сервиса.

## Реальные источники и границы

Однодневный период 2026-11-04, новые ответы, без повторного использования старых денежных значений для fresh результата. Начальный budget до12 read-only HTTP вместе с grant/пагинацией; получить FBO/FBS, price/tariff snapshot, balance, daily ads, accruals и при необходимости types/mapping. Прежде проверить действующий ledger/quota; использовать существующие интервалы/ключи без обхода или повышения лимита. Никаких marketplace writes. Raw response только в приватном ограниченном evidence; Git получает shapes/counts/hashes и синтетические fixtures. Не ретраить UNKNOWN/429 автоматически.

Если источники или определения неполны — публиковать проверенный код и точный неполный результат, без ложного CALCULATED/READY. Не увеличивать82/78/4 внутренними helper-полями/сценариями. Live source qualification и текущая голосовая доступность различаются.

## Приёмка

Сохранить baseline S03/scenario, независимые synthetic ожидаемые суммы, негативные тесты: missing/zero/partial/null/currency/period/duplicates/cardinality/source mutation, current tariff vs actual, cancellation fallback, same charge double-count, policy/authority/TTL/restart. JSON-only добавление новой категории затрат без правки общего Python. При наличии достаточных свежих источников пройти real-data producer→ScenarioBindings в отдельной проверке; voice/worker activation требует отдельного exact release и приёмки, а не просто выгрузки таблицы.

Первый readback RDC был остановлен клиентом до исполнения без конкретной причины. Аргументы проверены (read-only metadata/counters); один неизменённый штатный повтор завершился успешно. Не использовались другой транспорт или обходы. Отказ не приписан серверу.

Итог: source/code/evidence hashes, новые результаты и реальные пределы, актуальный мини-отчёт с количеством определений, что сделано, что дальше и следующая измеримая цель. Сборка тестера остаётся неизменной.
