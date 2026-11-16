# R5 preview и период: установленная проверка 16.11.2026

Статус: INSTALLED_LIVE_BROWSER_PASS для исправления UI. Preview запускается без обещания замены текущего числа, подготовка показывает actual; при отличии сохраняет requested. Справка соответствует действующему backend-протоколу. Полная приёмка R5 и короткой истории не заявляется.

## Версии и квалификация

- Продукт [PR454](https://github.com/MaksimUnimax/runtime-fixtures/pull/454), source5e5e8cc8922342cab0bed90073da6942a5b8f284; [Source CI43832009335](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/43832009335) и [Documentation43832009308](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/43832009308) SUCCESS. Независимое source V3 review PASS; восемь проверок реального React-компонента с синтетическим HTTP и три проверки файловых границ PASS.
- Установщик [PR456](https://github.com/MaksimUnimax/runtime-fixtures/pull/456), exact58816a399173c824807b3d1041a623fbb6b2d1f3; [Source43835570334](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/43835570334) и [Documentation43835570261](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/43835570261) SUCCESS. Независимое read-only review PASS; 56 guards PASS под root и 56 под nobody. Это одни и те же 55 прежних проверок и один новый AST guard, а не 112 уникальных сценариев.
- Артефакт14210310609/run43832009335: ZIP52362969B, SHA256e9887701e02dfd6267d23edc9508c7cc48f63529f9c2acb5ce6d3f8afcb41eb5. CRC, обе TAR/sidecar и manifests проверены; platformTAR85dd68454485cf0c54e65887e5ad3c067509531d94f7a6cee9bce19e8b8ab739. Runtime TAR проверен, но не установлен.

## Установка и сохранённые границы

План8e9bb2bf6f8b3d3a3f69a7aae77006bf28efc93ada74414f8611c5c94b9f0ccf повторно проверен непосредственно перед переключением. Apply завершился exit0/APPLIED_WEB_ONLY. Текущий web: /opt/alisa-platform/stage/releases/alisa-r5-preview-5e5e8cc8922342ca, manifest789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655, PID1590442.

Перезапущена только alisa-web@stage.service. Снимок восьми остальных основных служб, их PID/Invocation, effective bases, окружения, staff-файлов и native selector совпал с PLAN до и после проверки. Все девять основных служб active; health проверил точный новый web target. Native остаётся alisa-wb-activity-e0a10bb47fe1cd83, manifestfa078b54e2bf1b57ae3c55e7ffba2a832367a17755a9c24eeedf7bc0d70ddb29. Миграций и ручных изменений БД не было. Права, ключи, привязки, сохранённые параметры и код параллельного R15 эта поставка не меняет; штатный preview создал один runtime job, как описано ниже.

## Реальный кабинет

Сохранённая сессия владельца открыла /app/parameters. Повторно выбран Ozon и существующий параметр потерь заказов; текущее значение было «Не задано».

Проверены новый текст справки и пользовательские даты 01–31.10.2026. Подготовка показала actual01–31.10, не сократила явно заданный диапазон и не запускала сбор. После явного выбора «Только показать, не сохранять» отправлен ровно один preview. Сообщение: «Расчёт без сохранения принят. Текущее число не изменится». После изменения select на replace сообщение осталось связано с уже принятой preview-командой; второй запуск не отправлялся.

Существующий запуск наблюдался через QUEUED/RUNNING до READY. Всего 37 новых вызовов, все RECEIVED/HTTP200, все относятся к единственному preview. UI сообщил: «Предварительный расчёт готов. Сохранённое значение не менялось». Отдельная кнопка повторно прочитала текущее значение: по-прежнему «Не задано». Ручная запись и replace не выполнялись.

Обе сессии кабинета и админки сохранились. После reload обе WB-карточки B14.card_views/B14.cart_additions имеют версию2 и «Период статистики действий в карточках WB». В админке88 определений, обе B14v2 и прежний fingerprintb12fb598ca0ac35223ce464c002f6594a08d8fdbb3f299113872c318338fb4bd. Перенос WB-вопросов в форму повторно не запускался в этом прогоне: это ранее принятая проверка WB-поставки.

## Очередь, cleanup и доказательства

До браузерного preview: active0, четыре прежних UNKNOWN, maxcall3676. После: active0, те же четыре UNKNOWN без изменения; один новый READY и maxcall3713. Старые неизвестные запуски не восстанавливались и не повторялись.

После live-проверки и подтверждения отсутствия потребителей удалён только собственный /dev/shm/alisa-r5-preview-5e5e8cc8, 178629374 логических байта. Проверенный ZIP и прежний web rollback base сохранены. После cleanup повторно проверены точный health, восемь сохранённых служб и active всех девяти. Нет оснований приписывать изменение общего свободного места только этой очистке.

Alisa evidence: /root/alisa-r5-preview-web-install-20261116/{SOURCE_REVIEW,EXACT_INSTALLER_CI,PLAN,BEFORE,APPLIED,POST_INSTALL,QUEUE_BEFORE,LIVE_BROWSER,CLEANUP,FINAL_READBACK}.json и PREPARE_PRIVATE/APPLY_PRIVATE.log. Easyscript evidence: /root/alisa-r5-preview-period-20261116/. Секреты, сырые payload, персональные и финансовые результаты в Git не включены.

## Остаток и следующий шаг

Различающиеся actual/requested и ответ, удержанный сервером до смены режима, проверены в изолированном компоненте. В реальном кабинете принят явный полный октябрьский интервал и смена режима после admission; эти области не подменяют live short-history или live race.

Следующий шаг — авторитетное подтверждение доступного периода обязательных источников с привязкой к магазину и его ревизии, затем единый контракт через prepare_calculation и start. Первый найденный заказ, пустые строки, ошибка API и дата регистрации Store не являются таким подтверждением. Физическая колонка и полная приёмка R5 остаются открытыми; общая матрица91/63 не сокращается за счёт этого UI-исправления.
