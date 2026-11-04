> Все исходные тесты сохранены; новые ранние проверки не требуют будущего UI. Точное назначение — [TEST_PLAN](TEST_PLAN.md). AL-F в названиях fixtures — область требований, а не очередность.

# Приёмка, тестовые данные и доказательства

## 1. Что уже выполнено этим комплектом

Только авторская подготовка документов и статическая проверка их согласованности. 146 продуктовых кейсов имеют NOT_RUN. Схема/ссылка/топологический граф прошли проверку документации; это не работающая платформа, не принятые платежи и не звуковая приёмка.

## 2. Обязательные уровни

L1 SOURCE_TEST — unit/schema/semantic gold без настоящего провайдера. L2 INTEGRATION_FIXTURE — настоящий PostgreSQL/worker/adapter с fake HTTP и fault injection. L3 INSTALLED_UI — установленная сборка кабинетов в изолированной среде, реальный браузер и DB. L4 PROVIDER_SANDBOX — фактический тестовый платёжный/email/OAuth внешний контур, указан отдельно. L5 LIVE_PROVIDER и LIVE_DIALOGS — разрешённые настоящие маркетплейсы/Яндекс. L6 LIVE_STATION — реальное устройство и слышимый результат. L7 PRODUCTION — отдельно разрешённая операция и наблюдение выпуска.

Каждая карточка roadmap задаёт минимальный внешний уровень. Отсутствие внешнего входа не отменяет L1–L3, но запрещает назвать их L5/L6. `ACCEPTED_SCOPED` хранит этот уровень и открытый остаток. Число тестов не заменяет качество/полноту конкретного сценария.

## 3. Набор тестовых фикстур

| Fixture ID | Состав | Где используется |
|---|---|---|
| FX-IDENTITY | tenants A/B/C, отдельные USER/ADMIN/OWNER, одинаковые имена магазинов | F01–06,F19 |
| FX-MAIL | test SMTP receiver, late/duplicate/failed delivery, OTP controlled clock | F01,F15,F18 |
| FX-STORES | Ozon Seller без/с Performance, WB, auth/scope/network/plan errors, смена identity | F03,F07,F09 |
| FX-GRANTS | paid/gift/compensation, future/expired/revoked, конкурентный grant | F04,F15,F16,F17 |
| FX-CALENDAR | Jan31 2027/2028, 2-month equivalence, gift7days, timezones | F15 |
| FX-JOBS | 3 страницы, async task, timeout-before/after-send, late result/cancel, UNKNOWN | F06–08,F20,F21 |
| FX-CATALOG | r1/r2 несовместимые/валидные, synonym collision, missing qualification | F09,F12 |
| FX-GAPS | P1 miss/P2 success, source error, secret markers, revisions/out-of-order | F10 |
| FX-DEMAND | 20 capped/5 tenants/30d, 5paid/3/14d, 100 repeats1tenant/day | F11 |
| FX-PAYMENTS | succeeded/canceled/pending/UNKNOWN, duplicate IDs/objects, test/prod, malformed amount | F13–16 |
| FX-MONEY | gross120000/refund20000/knownfee3000 minor + GIFT7d; все суммы synthetic | F17 |
| FX-DELETION | backup до удаления, независимый tombstone, expired result, legal-held billing metadata | F19,F21 |
| FX-LOAD | 10 tenants, one100heavy/others1, bounded pages, measured resources | F20 |
| FX-DEVICE | модель/прошивка/аккаунт/RC настоящей Станции; секреты не в репо | F22 |

JSON-файлы fixtures/ в комплекте — примеры контрактов, не вся реализация этих стендов. Fake provider и killpoint harness создаются внутри соответствующей функции. Отсутствие harness не засчитывается как продуктовый FAIL, но функция ещё не готова к приёмке.

## 4. Числовой эталон

Ожидаемые суммы не вычисляются тем же production кодом, который тестируется. Для денег: независимые ручные/Decimal расчёты на фиксированных synthetic строках, различение line amount/unit price, currency/date-axis/returns. Для провайдера указывается настоящая выборка, полнота и доступные контрольные поля; HTTP200 не равен финансовой сверке.

Для workload метрик указываются denominator/window/test filter; для demand — distinct episodes и capped tenant-day отдельно. Для календаря expected UTC и локальная дата фиксируются до запуска. Конкретные независимые ожидания по деньгам, календарным границам и capped demand сохранены в `fixtures/business_gold.json`; это синтетические входы и ожидания, не уже полученные результаты продукта.

## 5. Формат приёмочной квитанции

Receipt включает feature_id, case IDs, source commit, artifact SHA256, DB/runtime/catalog/policy versions, environment, test level, выполнявшего и независимого проверяющего, время, expected/actual, network call counts, safe evidence paths/hashes, verdict и оставшиеся риски. Схема — schemas/acceptance_receipt_v1.schema.json.

Screenshot подтверждает видимый UI, но не отсутствие второй DB-записи. Для idempotency нужны счётчики фактических строк/внешних вызовов; для redaction — поиск секрет-маркера во всех заявленных sink; для Station — факт настоящего устройства, не `text==tts`. Секреты, пользовательские финансовые строки и полный исходный вопрос не публикуются.

## 6. Regression и stop rules

P0: чужие данные/ключи, опасное неавторизованное действие. P1: неверные денежные данные, двойное списание/доступ, потеря подтверждённой оплаты, revival после отзыва. Такие дефекты блокируют затронутый выпуск. P2/P3 оцениваются по пользовательскому эффекту, с конкретной причиной принятого ограничения.

Сбой тестовой среды отдельно от продуктового дефекта. UNKNOWN не повторяется ради зелёного теста. Установка/платёжные операции не повторяются альтернативным инструментом после запрета. Новая попытка требует фактического устранения причины и соответствующего допуска, а не перезапуска без изменений.

## Квитанция поставки v0.5

Для управления очередью дополнительно применяется [схема квитанции шага](schemas/execution_step_receipt_v1.schema.json): AL-S, принятые входы, exact artifact, test IDs и отдельный оставшийся внешний scope. Старые квитанции AL-F остаются доказательством своих исходных требований, а не нового шага целиком.
