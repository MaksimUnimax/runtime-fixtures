# Октопорт маркет: общая работа тестера и автора матрицы

Начинать сеанс здесь. Репозиторий `MaksimUnimax/runtime-fixtures`, ветка `alisa`, единая рабочая точка `docs/alisa/quality/`. Чат/ZIP передают материалы, но не создают вторую очередь задач.

## Текущий действующий сервер — 6 ноября 2026

Фактический ExecStart: **`20261106-store-check-6098-r1`**, PID145588, запуск03:31:03UTC другим исполнителем. Финальный readback очереди04:44:32UTC подтвердил74/74файла S05manifest, configSHA256 `92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5`, четыре основные службы/три таймера active, active jobs0, SQLite quick_check ok. Историческое number-reason-r1 не является командой отката.

Новая база выделяет shared_http и содержит checker/IPC. При подготовке очереди эти файлы сохранены побайтово в кандидате; действующий сервис, platform/PG/permissions, ключи, конфигурация и рабочие задания не изменялись. Поле active=false внутри исторического integrationmanifest не заменяет чтение ExecStart.

## Последний завершённый этап: QUEUE-R01

**[Фактическая приёмка](CUE01_QUEUE_R01_ACCEPTANCE_2026-11-06.md)** · [Исходники и пакет](../runtime/v0.11/queue_r01/README.md) · [Изолированное независимое ревью](testpacks/cue01_queue_r01/README.md).

Статус **SHARED_WORKER_OFFLINE_VERIFIED / NOT_INSTALLED**. Общий TaskGraphRuntime подключён opt-in к прежним Engine/Worker/Repository. Одно задание проходит source-стадии, вычисление и публикацию страниц. Jobs.progress сохраняет checkpoint/пагинацию, calls/rates остаётся единственным журналом квот. Новых таблиц, scheduler/HTTP-клиента/демона нет. Graph/source/capture/labels/limits задаются JSON; доверенный адаптер и его hash не приходят из пользовательской фразы.

Проверены очередь, отмена, независимые читатели, exact HIT, replay, current-rights послеREADY, минимальныйTTL источников и штатная очистка. Два отдельных Python-процесса подтвердили восстановление без повторного запроса завершённого источника. UNKNOWN/потерянныйcheckpoint не запускают повтор; прежний ограниченный429retry сохранён. Если квота станет доступна после срока входов — явная ошибка, не увеличение лимита.

Сквозные проверки используют настоящие Worker/Repository/SQLite и прежние normalizer/selector/ScenarioBindings, **но искусственные ответы источников**. Два DTO дают эталон3210/2000, девять provider-shaped источников —2479/2002. Это не свежие деньги пользователя и не настоящий вызовOzon. ПриREADY rawcaptures удаляются; в проверенных проекциях контакты и токены не сохраняются. Чтение готового отчёта не выполняет формулы/HTTP заново.

### Проверка и пакет

После сохранения совместимости S05: **1267/1267 runtime +403/403 integration =1670/1670**. В403 входят90новыхqueue/raw/boundary,7новыхHTTPcompat и306прежних компонентных. После чистой распаковки04:41:25–04:43:02UTC повторноPASS; повторы не увеличивают число тестов. Architecture/JSON-only PASS; реальныеAPI/DeepSeek/credential reads0.

Архив наAlisa: `/root/alice-lab-evidence/cue01-queue-r1-20261106/ALISA_CUE01_QUEUE_R01_2026-11-06.zip` —484666байт,147файлов, SHA256 `575cf96aa1cad5de42a53d74dd0b42d803e2e9f166670935b449b4e06648fc1a`. Содержит полныйsource/dependency/testlayout и квитанции; нет workingconfig/credentials/реальных финансов/SQLite. `python3 -B verify_all.py` после распаковки запускает толькоoffline-проверки. LooseGit-файлы не самостоятельный runtime.

**Граница:** живые source-recipes/productionauthority/ownerbinding/voice-router ещё не подключены к этому графу. Candidate не установлен; проверка fake registrations не является допуском реальныхAPI. Речевые страницы пока технические, окончательная клиентская редактура/полнота errorcatalog требует voice-gate. Запланированный push через умныйдом этим этапом не реализован.

## Предыдущая реальная квалификация C-UE01

[FRESH-SOURCE-R01](CUE01_FRESH_SOURCE_R01_ACCEPTANCE_2026-11-05.md) — отдельный реальный запуск5ноября:10HTTP200, когорта4ноября18единиц/2отмены,12matched cost records, две таблицы и34денежные строки независимого same-API oracle. Lookupфакта4–5ноября, тариф5ноября явно оценочный. Выполнялся вне productionWorker и не подставлялся как свежий результат нового прохода.

Себестоимость250/физическую единицу и исключённый налог относятся к утверждённому примеру r9, не defaults сервиса. Неуказанные owncosts остаютсяomission. Главный знаменатель — исходно заказанные единицы, не только оставшиеся. CPC/CPO раздельны, реклама/хранение периода распределены явно; факты и тарифные оценки не называются однимACTUAL. Полнота жизненногоцикла/split/partial-return не доказана одной простойкогортой.

## Тестер и независимые статусы

[Safety-retest](inbox/20261105-TESTER-4d04edaa/RETEST_REPORT.md):18PASS/2PARTIAL/1FAIL/3SKIP наconversation-safety-r1; исходныйFAILDS03 не переписан. [ИсправлениеDS03](inbox/20261105-TESTER-4d04edaa/IMPLEMENTER_DS03_R01_2026-11-05.md) сохраняет NUMBER_RANGE, result=null и отсутствиеповторногоHTTP; независимого retest после него автор очереди ещё не видел. Статус READY_FOR_RETEST, неVERIFIED.

N06/N08/N09-OZCP001 ранееVERIFIED черезЯндекс наdialogue-fixes-r1. [Retest](inbox/20261105-TESTER-d7a5899c/RETEST_REPORT.md), [metadata сверка](inbox/20261105-TESTER-d7a5899c/IMPLEMENTER_ACK_NUMERIC_Q01_2026-11-05.md). Старые семьчисловыхPARTIAL/дваSKIP и последующиеPARTIAL/SKIP сохраняютоснования.

QUEUE-R01 можно независимо проверять толькоизолированно по[12группамусловий](testpacks/cue01_queue_r01/README.md); исходыNOT_RUN. Не проситьтестера запускатьнеустановленнуюC-UE01вДиалогах. Новыйrun — `inbox/<UTC-дата>-TESTER-<8hex>/`. КаждаяUIреплика: запрос, полныйбезопасныйответ/закрытаяevidence_ref+hash, первыйответ/READY/дочитывание отдельно; неизмеренноеnull. ДлячисловогоPASS нуженэталон тойжеоси/периода/магазина/валюты. ПолныйRequest/access_token/cookies вGitнепубликовать.

## Счётчики и обязательный итог прохода

[CATALOG_PROGRESS_CURRENT](CATALOG_PROGRESS_CURRENT.json), [MINI_REPORT_CONTRACT](MINI_REPORT_CONTRACT.md). Всегда: реализовано, включено, осталось, что сделано, текущаязадача, **что дальше**, **следующая измеримаяцель**.

**82реализовано /78включено /4подготовлено-не-включено**, подтверждено действующимкаталогом6ноября. 42primaryscalar+15сводок+2WBсобытийных+6формул+16dataset+H00. Включены12dataset/14platformvariants. Общая очередь/адаптеры/тесты не новые голосовыешаблоны; заQUEUE-R01новыхвключений0.

WBкампании wb_active_ads,wb_campaign_inventory,wb_active_ads_totals,wb_supported_ads остаютсявыключены:21запрошено/18получено, missingnull не доказанныйноль. ВэтомпроходеWBнезапрашивался. Сверх4остаютсяproduction S03/C-UE01, событиявыкупов/возвратовOzon, OzonB13, cross-marketmapping исложныеlifecycleслучаи.

Постоянные[BUGS](BUGS.json),[TEMPLATES](TEMPLATES.json),[RUNS](RUNS.json),[BOARD](BOARD.md),[IMPORT](IMPORT_MANIFEST.json),[WORKFLOW](WORKFLOW.md),[TESTER_PROMPT](TESTER_PROMPT.md) — единаясистема. Авторматрицы отвечаетзаruntime/матрицу; другойисполнитель — platform/UI/BFF/issuer/MFA/PG. МатричныйS03 иplatformAL-S03 не одинэтап.

## Что делаем дальше

Подключить **реальные уже квалифицированные source-рецепты и текущие права/ownerinputs к тому же проверенному графу** наS05-совместимойбазе. Не создаватьещёодинрасчётчик иливторойжурналквот. Следующаяцель: один ограниченный свежий реальный C-UE01 черезобщийWorker, затемотдельнаяголосоваяпоставка и независимые запросы/полныеответы/время вЯндексДиалогах. Productionпереключение тольконаexactreleaseпослеотдельногодопуска, непоодномуснимкучата.
