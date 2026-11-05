# MATRIX-JOIN-R01 — фактическое включение девяти определений

05.11.2026. **ACTIVE_SERVICE_SMOKE_VERIFIED / READ_ONLY_CANARY / READY_FOR_EXTERNAL_TESTER**. Новый внешний Яндекс-прогон ещё NOT_RUN. Работа только собственного runtime/matrix участка; платформа второго исполнителя не изменялась этой работой.

## Основание и точный выпуск

Владелец разрешил «Делай» после предложения включить проверенные B05/join и оставить WB fullstats закрытым. До изменения опубликован MATRIX_JOIN_R01_ACTIVATION_PLAN_2026-11-05.md, commit18583a2c0f9dbb4686bf2b1bb6c0f3a8f32014ff. Исходная версия dialogue-fixes-r1, её независимые N06/N08/N09 VERIFIED и прежние PARTIAL/SKIP сохранены раздельно.

**06:44:02.660638 UTC** включён `/opt/alice-market/releases/20261105-v010-matrix-join-r1`.
Manifest45файлов SHA256 **27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d**.
Dataset source hash **12557d9e4602479845ba8fdce6dbe46d2e98184b0ed08ca62e1072fbe946efe4**.
Dataset query hash **adab3109d326b113d49cec97eb77029336b1f7c8b8aef0a7f24333ff10589c1c**.
Config before **116fc64c60907de9bcd372f0c4aaffc2b7a421b4c1d32281d72795de65e6c96f**, after **92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5**.

Использован именно ранее проверенный кандидат без редактирования его45 manifest-файлов. Общий текст диагностики начинается «Матрица0.10, базовый пакет1», но дополнительно содержит **«Дополнительный пакет наборов данных:20261105-join-r1»**. Версию устанавливать по ExecStart/manifest, не по одному старому общему заголовку.

## Что включено

Четыре B05: accrual_items, accrual_days, accrual_items_days, accrual_price_lines. Пять joined-представлений: realization_payment_lines, realization_payment_totals, realization_payment_days, realization_payment_items, realization_payment_items_days.

Добавлены только4 source operations существующему Ozon-магазину: ds_ozon_accrual_rows, ds_ozon_accrual_join_rows, ds_ozon_fbo_join_items, ds_ozon_fbs_join_items. Для трёх join bindings допуск posting_product_join_qualified=true связан с точным candidate и Q01; статус READ_ONLY_CANARY, не коммерческая сертификация. Обоснование Q01: отдельный алгоритм на реальных телах03–04ноября,29/29target rows, совпадающие totals/weighted means; это не кабинетная сверка.

Прежние6dataset-источников и3query определения побайтово сравнивались до переноса их hashes. Их допуски/смысл сохранены. Scalar/table qualifications, account/store/access revisions, credential bindings/ключи не менялись. Новых provider-клиентов/фразовых обработчиков в этом проходе нет.

**Все четыре WB-кампанийных определения остаются выключенными:** wb_active_ads, wb_campaign_inventory, wb_active_ads_totals, wb_supported_ads. Ни ds_wb_campaigns, ни ds_wb_adstats не добавлены в рабочие qualifications/capabilities. Ранее установленная неполнота21→18,3missing не превращена в0. Прежний рекламный расход и остальные работающие показатели сохраняются.

## Что проверено до переключения

Снова1035/1035основного набора,57/57отдельныхB05/B13,70/70join; failures/errors/skips/network attempts0. Architecture и JSON-only PASS. Повторы не считаются новыми уникальными тестами. Этот набор относится к runtime, не к неустановленным RuntimePort/RT-CAT/platform.

Config proposal проверен настоящими Configuration/Engine на temporary SQLite без Transport.execute/секретов/HTTP:14допустимых сочетаний view×площадка (9новыхOzon +5прежних),4WBотказа и3hotfix-сценария. Все21адресный контроль прошли. По старым6источникам definitions/query неизменны, обновлены только global fingerprints матриц. Новые9планов не получали заранее выдуманный runtime READY.

## Безопасность установки

Проверены exact active path/manifests/config, собственный flock, отсутствие выполняющегося конкурирующего runtime-владельца,0QUEUED/RUNNING и0pending. Штатно остановлен только alice-market, повторён idle-check, создана закрытая SQLite backup и исходный config для адресного rollback.

Атомарно изменены только qualifications и dataset_capabilities. Добавлен один drop-in `zzzzzzzzzzzz-matrix-join-r1.conf`; daemon-reload/start, проверены actual MainPID65567/путь процесса/socket/config. **Миграций0, восстановленияSQLite0.** При старте schema hash совпал; jobs64→64, calls336→336. Old-source-qualified dataset plans закреплены на прежних hashes и не переинтерпретируются новым каталогом; их исторические записи не объявляются новыми результатами.

Ошибки запуска не было, rollback не понадобился. Старый dialogue-fixes-r1 и private config-before сохранены; возможный rollback меняет только наш drop-in/config, не восстанавливает БД поверх новых сообщений. OAuth/webhook/таймеры/платформенные файлы не правились.

## Проверка действующего сервиса

**06:45:59.900916–06:47:50.417485 UTC**. Штатный web UID→Unix gateway→реальный установленный Worker→API. Не консоль Яндекса и не Станция.

Девять новых jobs завершились READY/complete. **54реальныхHTTP, все200; DeepSeek0.** 31страница прочитана и сравнена с сохранённым результатом; text==tts. Повтор того же message ID идентичен; повтор исходного вопроса дал exact HIT того же job; чтения/повторы новыхHTTP не создали. Всего73gateway-ответа, включая диагностику/отказы/повторы.

Период всех новых отчётов — **04.11.2026**, не весь месяц.

| Query | Первый ответ,мс | READY наблюдался,мс | Все страницы прочитаны,мс | Страниц | HTTP |
|---|---:|---:|---:|---:|---:|
| accrual_items |145.08|1651.51|2492.69|4|1|
| accrual_days |139.09|1143.13|1538.36|1|1|
| accrual_items_days |123.33|1628.84|2413.29|4|1|
| accrual_price_lines |142.93|1649.44|2658.36|5|1|
| realization_payment_lines |131.55|19200.48|20189.65|5|10|
| realization_payment_totals |166.49|19724.73|20303.91|2|10|
| realization_payment_days |142.75|18704.47|19304.60|2|10|
| realization_payment_items |141.49|18697.48|19521.31|4|10|
| realization_payment_items_days |151.13|18710.47|19807.04|4|10|

Время READY включает интервал наблюдения; первый ответ — приём задания, не полный отчёт. Join запрашивает также31день метаданных и соблюдает shared limiter, поэтому не представлен как мгновенный отчёт. По10HTTP на каждый joined-вариант — разные полные задания exact-cache, не перепользование старого частичного результата для другого вопроса.

Во всех5PAY-сценариях **12/12строк сопоставлены**, unknown0,unmatched0,enrichment_complete=true. Положительные исходные суммы и количества совпали между всеми9представлениями. Это внутренняя межвидовая сверка, не новый независимый числовой эталон; предыдущий Q01 independent-algorithm evidence хранится отдельно.

Семь отрицательных контролей (N06/N08/N09 +4WB) прошли с правильными кодами/причиной/следующим шагом, точными повторами и0jobs/HTTP. Достоверный первоначальный VERIFIED тестера не переписан.

## Квоты и пределы

На06:48UTC использовано за24часа: accrual88/100, FBO47/100,FBS29/100. Это действующий внутренний budget runtime, не официальная квота площадки. Лимиты не увеличены. Тестеру переданы однодневные04.11сценарии; перед новым run сверить актуальный остаток, не нажимать «обнови» и не повторять UNKNOWN ради PASS. FLOWповторы совмещать с тем же готовым заданием.

Ось B05 — начисление, не физический выкуп. PAYявно положительные реализации, не net. Lookback31день ограничен: unmatched может возникнуть на другом периоде, он сохраняет деньги/количество и явно показывает неполноту. Неизвестная метка не «без карты», чужая площадка/магазин не подмешиваются. `complete` и `enrichment_complete` различаются.

## Числа и остаток разработки

Программный recount06:48:01: **82реализовано,78включено,4реализовано-не-включено**. За проход0новых определений, **+9включений**. Единица — определение матрицы, не синоним/тест/API/вариант площадки.

42исходныхscalar+15сводок+2WBсобытийных+6формул+16dataset+H00=82. Теперь12из16dataset definitions разрешены,14сочетаний с площадками. Четыре оставшихся — WBкампании. Сверх этих4незакрыты6направлений: S03 input, конечныйC-UE01, физические выкупыOzon, физические возвратыOzon, Ozon B13 counters, cross-market product mapping. Из19семейств17имеют работающую часть; это не17полностью принятых семейств.

## Передача тестеру, артефакты, следующий шаг

16новых внешних сценариев:9отчётов,4ожидаемыхWBограничения,exact-repeat,pagination,H00. План/пустаяформа: testpacks/matrix_join_r01/ACTIVATED_RETEST_2026-11-05.md; все LIVE_DIALOGS outcome NOT_RUN/времена null. Полные реальные ответы только в закрытый evidence; в Git очищенные тексты/hash/ref. Независимая сверка чисел остаётся обязательной; прежние7PARTIAL/2SKIP и последние2PARTIAL автоматически не закрыты.

Переносимый пакет `ALISA_MATRIX_JOIN_R01_TESTER_2026-11-05.zip`: **10416байт,6файлов**, SHA256 **eaa1c1e8280da451ba62f1d8e0d325c40bbad80930e9b70795677ec7c82d68f6**. Проверены5manifest entries,16уникальныхcase и пустые результаты; это не ещё16выполненных тестов. Пакет не содержит runtime.

Полный неизменённый runtime/tests snapshot на сервере: `/root/alice-lab-evidence/matrix-join-20261105/ALISA_MATRIX_JOIN_R01_2026-11-05.zip`, SHA256114f2c28f38472cc07fab559814a2a4c33636afa53dfee390fe0a4f4df81fb43,301054байт. Свежая установка/допуски/проверки: `/root/alice-lab-evidence/join-activation-r1-20261105/` (activation.json,config-precheck.json,predeploy-regression/result.json,active-service-smoke.json,catalog-progress.json). Config-before/SQLitebackup остаются приватными, в public artifact не включаются.

**Следующий шаг:** тестеру внешний16-case run на exact release с ответами/временем/эталоном; автору — календарные/статусные сведения о3missing WBкампаниях и затем C-UE01 с явной рекламой/полнотой/непересечением, без подмены отсутствующего0. Не расширять допуск WB только потому, что полученHTTP200.