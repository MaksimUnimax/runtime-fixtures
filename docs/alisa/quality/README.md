# Октопорт маркет: совместная работа тестера и автора матрицы

Начинать каждый сеанс здесь. Репозиторий `MaksimUnimax/runtime-fixtures`, ветка `alisa`, общий центр `docs/alisa/quality/`. Чат и архивы не создают вторую очередь задач.

## Текущая контрольная точка — OWNER-BINDING-R1, 8 ноября 2026

**Авторский статус: MATRIX_OWNER_INPUT_OFFLINE_PASS / READY_FOR_PLATFORM_INTEGRATION / NOT_INSTALLED.**

[Фактическая приёмка](OWNER_BINDING_R1_ACCEPTANCE_2026-11-08.md) · [Полный исходный пакет](../runtime/v0.11/owner_binding_r1/README.md) · [Контракт платформенной стороны](OWNER_BINDING_R1_PLATFORM_HANDOFF_2026-11-08.md) · [План до изменения](OWNER_BINDING_R1_PLAN_2026-11-08.md).

В существующий C-UE01 граф подключён внешний подтверждаемый snapshot себестоимости/налога/собственных расходов. Используются прежние OwnerInputs, ScenarioBindings, формулы и Worker; нет второго калькулятора, issuer, хранилища или API-клиента. Новый общий binding-модуль и две общие точки внедрения заменяют зависимость нового пути от примерного owner_profile. Python Engine/Worker/Repository/HTTP и прежние OwnerInputs/ScenarioBindings не менялись.

Новая точка `owner_bound_adapter(graph_authority, owner_authority)` выбирает policy без owner_profile/r9. Не принимает пустую/mixed/legacy-политику, отсутствие/False/truthy/exception verifier. Hash и schema не дают разрешения сами по себе. Snapshot, mapping, scope и версии закреплены в job; текущие права проверяются при dispatch, публикации, read/replay. Изменение исходного объекта не меняет принятый расчёт; новая версия — другой exact-cache ключ.

Разные себестоимости товаров и интервалы действия поддержаны прежним resolver; налог и расходы — точный период. Ноль, пропуск и разрешённое исключение различаются. Месячный расход автоматически не распределяется на дни. Отдельные отсутствующие значения остаются omissions, не чистой прибылью.

### Проверки

**1840/1840 PASS** = 1774 прежних R4 + 54 новых Worker/owner + 12 entrypoint/error. Дополнительно JSON-only extension gate: упаковка добавлена четырьмя каталогами на изолированной копии без изменения Python. Полная чистая распаковка повторила те же 1840/1840 и gate PASS **8 ноября 03:48:13 UTC**. Повторы не увеличивают уникальное число.

Отдельный synthetic retention probe подтвердил удаление owner snapshot из jobs.plan и control receipt после expires; draft/result/progress очищены, quota ledger сохранён. Системные часы и TTL не менялись. Ни этот probe, ни JSON gate не превращены в выдуманное дополнительное число unit-тестов.

**В текущем проходе настоящих marketplace HTTP0, реальных owner данных0, working DB не использовалась.** Artificial источники и temporary SQLite не выдаются за live-интеграцию.

### Производственная граница — ещё не закрыта

В двух просмотренных установленных platform/admin source releases producer owner snapshots/current-verifier не найден; установленный contracts/runtime/port-v1.json содержит RUNTIME_NOT_CONNECTED. Это ограниченный просмотр кода/контракта, не аудит всех БД. Настоящая одобренная себестоимость/налог/расходы магазина не подтверждены.

Платформенному исполнителю опубликован точный [handoff](OWNER_BINDING_R1_PLATFORM_HANDOFF_2026-11-08.md): штатный producer approved snapshot/mapping и current authority. Документ не означает выполненную другим исполнителем интеграцию. Не подставлять r9=250 ₽ и не включать всегда разрешающий verifier. **Live owner integration, независимое ревью, установка и голосовая приёмка — NOT_RUN.**

## Полный актуальный пакет

Кандидат `/opt/alice-market/candidates/20261108-owner-binding-r1`.

Архив `/root/alice-lab-evidence/owner-binding-r1-20261108/ALISA_OWNER_BINDING_R1_2026-11-08.zip`.

550299 байт; 187 файлов; 186 manifest entries. SHA256 `168d668f3950234b4893d954ad6cfec67e95f0bad47fb7c531d0745346c2b072`.

MANIFEST SHA256 `1c079999ced382861837958e762f01030daf745648d1761b61a4313b7986da54`.

Проверка: `python3 -B verify_owner_binding.py --output /tmp/alisa-owner-binding-check`. Включены полный dependency layout, actual code/common patch, JSON-политика, схема, явно synthetic пример, тесты и безопасные доказательства. Нет working config, ключей, пользовательской SQLite или настоящих финансовых ответов. Исторические live/permissions scripts не запускать как installer.

## Последняя настоящая квалификация — R4, не текущий owner-input запуск

[Приёмка MATRIX-LIVE-R4](CUE01_MATRIX_LIVE_R4_ACCEPTANCE_2026-11-08.md): 8 ноября 03:11 UTC за 7 ноября получены 9 источников, 10 HTTP200 с grant, один READY job, две таблицы и 6 страниц. Первый ответ110,06мс, ready11548,81мс, read12664,36мс; exact HIT0 добавленных HTTP. Отдельный Decimal checker совпал по34 денежным строкам/знаменателям на тех же API. Natural TTL не выдал старые суммы. Это не cabinet или независимый verdict и не Яндекс UI.

R4 использовал только ранее согласованный пример r9:250 ₽/физическую единицу, tax excluded, own costs not provided. Он не стал production default. В R4 JSON квалифицирована DeliveryToHandoverPlaceByOzon как last_mile, исключён двойной дневной агрегат и добавлена detail/finance сверка. Предыдущий FAILED R3 сохранён.

[Полный R4 пакет](../runtime/v0.11/matrix_last_mile_r4/README.md) и [review task](testpacks/cue01_matrix_live_r4/README.md) остаются исторической точной версией, не переименовываются в новую owner-binding приёмку. [Предыдущая версия README](https://github.com/MaksimUnimax/runtime-fixtures/blob/2f057286b1409dd3de9be8482366115eb0ed351b/docs/alisa/quality/README.md) сохраняет полные сведения R4.

## Работающий сервис, архитектура и каталог

После отдельного аудита установлен **alisa-runtime-06f3c053e7719290**; web/admin/platform работают из **alisa-06f3c053e7719290**. Identity сохранил 7afa и прежнюю привязку MFA. [Отчёт исправлений](AUDIT_FIXES_2026-11-08.md) содержит точные manifests, native 1076/1076 и независимый INSTALLED_SMOKE. Сведения ниже о 1840 проверках OWNER-BINDING-R1 относятся к отдельному неустановленному кандидату; его статус не повышен установкой аудиторских исправлений. Перед новым проходом снова сверить Git, locks/WIP, ExecStart и manifest; чужие locks не освобождать и старый релиз поверх текущего не устанавливать.

Один общий runtime, разрешённый граф/формулы/источники в матрице и закреплённые доверенные адаптеры. Exact-only кеш — полный идентичный результат при текущих правах и сроке. Не собирать новый результат из несовпадающих старых частей; unknown не повторять; partial не считать READY; отсутствующие суммы не превращать в нули; исторические данные не заменять текущим снимком.

**82 реализовано / 78 включено / 4 WB выключено.** Новых voice definitions/enablements нет. Internal binding, тесты и captures не увеличивают счётчик. WB wb_active_ads/wb_campaign_inventory/wb_active_ads_totals/wb_supported_ads всё ещё имеют недоказанную полноту. Кроме них открыты production S03/C-UE01, сложные split/lifecycle, physical events Ozon, рекламные счётчики и межплощадочное сопоставление.

## Независимые статусы и совместная работа

Независимое ревью нового точного пакета — NOT_RUN. Авторские PASS не копировать в verdict. [Safety retest](inbox/20261105-TESTER-4d04edaa/RETEST_REPORT.md):18PASS/2PARTIAL/1FAIL/3SKIP; [DS03 fix](inbox/20261105-TESTER-4d04edaa/IMPLEMENTER_DS03_R01_2026-11-05.md) получил [независимый адресный SOURCE PASS](inbox/20261108-AUDIT-DS03/RESULT.json); полный прежний safety retest и live numerical acceptance не объявлены завершёнными. N06/N08/N09-OZCP001 ранее VERIFIED на своей версии; прежние числовые PARTIAL/SKIP остаются.

Новый независимый прогон — отдельный inbox/<UTC-дата>-TESTER-<8hex>/. Нужны exact build/hash, фактические запросы/ответы и раздельные времена; неизмеренное null, непройденное NOT_RUN. Секреты и контакты не публиковать. Не назначать неустановленную C-UE01 как доступный голосовой сценарий.

[BUGS](BUGS.json), [TEMPLATES](TEMPLATES.json), [RUNS](RUNS.json), [BOARD](BOARD.md), [IMPORT](IMPORT_MANIFEST.json), [WORKFLOW](WORKFLOW.md), [TESTER_PROMPT](TESTER_PROMPT.md), [счётчики](CATALOG_PROGRESS_CURRENT.json), [мини-отчёт](MINI_REPORT_CONTRACT.md) — общий центр. Автор матрицы ведёт runtime/матрицу/шаблоны; другой исполнитель — platform/BFF/UI/auth/MFA/PostgreSQL. Матричный S03 не равен платформенному AL-S03.

## Следующее действие и цель

Подключить штатные production producer/current-verifier к опубликованной матричной границе, получить реальный approved snapshot и product mapping. Затем один ограниченный Worker-run с этими данными, revoke/read проверки и отдельная числовая сверка. Независимое ревью точного пакета можно проводить изолированно. **Цель: подтверждённый расчёт на реальных данных владельца; она ещё не достигнута.** Голосовая установка требует отдельного допуска точной версии и настоящих Яндекс Диалогов.

## Колонка: можно начинать частные проверки

[Первый запуск и границы готовности на Станции](STATION_START_2026-11-08.md). Приватный «Октопорт маркет» опубликован; справка проверена в консоли без экрана. Физическая колонка ещё не принята. Полный путь нового клиента относится к AL-S06–S07; ждать AL-S18 для первых частных проб не нужно.

