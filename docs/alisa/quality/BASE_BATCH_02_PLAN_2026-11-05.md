# BASE-BATCH-02 — общий пакет источников и табличных проекций

05.11.2026 UTC. Поручение владельца: продолжать максимальным полезным пакетом, матрица и обработка — наш участок; остальная платформа у второго исполнителя. Исходная проверка 01:12 UTC: active `20261104-v010-base-batch01`, все 34 runtime hashes совпадают, активных jobs=0, SQLite quick_check=ok. Git HEAD на чтении 03e9c0d5c5fce17ab12cc23af3968886ee23e03e. В quality/inbox пока только README, новых тестерских run нет.

## Цель и граница

Не возвращаться к Python-веткам по названию показателя/эндпоинта. Совместимые источники подключаются полными JSON-рецептами; группировка/выборка/выдача — общие операции. Если нужен новый класс примитива (flatten вложенных строк, курсор-составной объект, fanout пачек IDs), сначала задать контракт, покрыть отрицательными тестами и только затем применить к нескольким источникам. Наличие DSL-рецепта не означает qualified source, complete report или установку.

Пакет: B16 текущие цены Ozon/WB; S01 справочник идентификаторов товаров каждой площадки (без выдуманного cross-market mapping); S02 отправления Ozon и доступная метка оплаты; B13 рекламные счётчики WB и исследование квалифицированного Ozon-контракта; B05 товарные и дневные проекции уже подключённого начисленного источника. Нельзя silently заменять event date на accrual/order date, seller offer price на конечный чек/цену Ozon Карты, или неполную кампанийную выборку на весь рекламный кабинет.

## Первоисточники проверены 05.11

- https://dev.ozon.ru/news/734-Otkliuchenie-starykh-metodov-Seller-API-dlia-raboty-s-postingami/ — актуальны v3/posting/fbo/list и v4/posting/fbs/list; прежние v2/v3 отключены с 01.08.2026.
- https://dev.ozon.ru/news/801-Otkaz-ot-polia-total-v-metodakh-Seller-API/ — product/list, stocks, prices переходят с total на total_items 23.11.2026; поддержать обе квалифицированные формы и reject расхождение.
- https://dev.ozon.ru/news/497-Novye-metody-dlia-raboty-s-tovarami-tsenami-i-kontentom-Seller-API/ — v3/product/info/list и v5/product/info/prices.
- https://dev.wildberries.kg/docs/openapi/item-management — официальный портал WB, товарные карточки и цены/скидки.
- https://dev.wildberries.kg/docs/openapi/promotion — официальный портал WB, campaign discovery и fullstats. RU frontend дал 498; KG — официальная доступная версия документации, не причина менять российские API origins/учётные записи.

Это внешняя актуализация, отдельно от импортированных исследовательских CASE. Исторические source assertions не переписываются. Точные payload/response paths сверяются по официальной схеме и разрешённым ответам, не угадываются по старому SDK.

## Приёмка до включения

1. Изолированный собственный staged release/lock; active batch01, platform конфиги/БД/OAuth не менять при разработке.
2. Сохранить предыдущие матрицы; новые read-only recipes фиксируют origins, методы, payload schema, currency/axis/null semantics, пагинацию, cardinality/полноту и ограничения. Secret headers формируются только существующим HTTP boundary; токены не копируются в доказательства.
3. Неполная пагинация, повторный cursor, пропавшая requested кампания, неоднозначное соединение или неверная денежная строка — FAIL/NOT_READY, не частичный READY. Никакого join начислений с произвольным окном заказов без доказанного покрытия.
4. Новый совместимый рецепт и фраза добавляются только JSON при неизменных hashes Python; engine/queue/replay/cancel/TTL и права проверяются. Отдельно deterministic reference totals для flatten/group.
5. Новые реальные read-only запросы только bounded canary под штатным непривилегированным UID, с systemd credentials, общим ledger/квотами и точным qualification hash. 401/403/429/UNKNOWN фиксируются, без слепого повтора. Закрытый raw по существующему TTL; в Git лишь schema/count/status/hash/timing.
6. Только прошедшие source+offline+service проверки могут войти в новый release. Если часть scope не квалифицирована, она явно остаётся выключенной, а не блокирует весь независимый пакет.
7. Подготовить дополнение постоянному тестеру: каждый включённый блок/площадка, полная фраза, ожидаемый смысл/ограничения, поля фактического ответа и времени NOT_RUN. Не засчитывать service canary как прохождение консоли.

## Параллельная работа

Не редактировать products/alisa, platform STATUS, issuer/authority, adapter, frontend, PostgreSQL, DNS/TLS, Business Bridge или чужие locks. RT-JOB/RT-CAT остаются отдельными integration candidates. Новые служебные данные не должны создавать второй unbounded архив пользовательских диалогов.

Конечный отчёт: фактическая версия, какие источники/проекции реализованы и установлены, что осталось, сколько конкретных проверок/HTTP, ссылки на сохранённые исходники и один следующий рабочий шаг. Ни установка, ни независимая приёмка не заявляются до фактического подтверждения.
