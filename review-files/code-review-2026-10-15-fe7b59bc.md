# Ревью runtime-fixtures — 15 октября 2026, main fe7b59bc

Проверен **`fe7b59bc7691b3ffeb58d330d7ab19b06585fd30`**, актуальный удалённый `main` при повторной сверке перед отчётом. Рассмотрен delta **26 файлов** от предыдущей базы `299d611340703117a0292cce14a092870ace99cc`, включая WB renewal/consumption receipt, catalog backup context, beta invitation IDNA, bootstrap HTTP diagnostics и package/UI version 0.2.29. Дата — Asia/Qyzylorda.

**Результат: один открытый P2. Оба точных замечания прошлого отчёта исправлены и перепроверены в памяти и native PostgreSQL.** Новый P2 — отсутствие подключения библиотечной защиты контекста к настоящему импорту резервной копии. Это вновь подтверждённый незакрытый путь; регрессией изменения положения кнопки он не является.

В GitHub публикуется только этот Markdown отдельной веткой. Продуктовый код, тесты, lockfile, `main`, рабочий сервер и его БД не менялись. Проверки выполнены в облачной копии и собственных synthetic/disposable fixtures.

## 1. [P2] Подключить guard контекста к настоящему импорту резервной копии

Места: [catalog.js:99–110](https://github.com/MaksimUnimax/runtime-fixtures/blob/fe7b59bc7691b3ffeb58d330d7ab19b06585fd30/packages/bridge-core/src/stores/catalog.js#L99-L110), [включение guard только при третьем аргументе](https://github.com/MaksimUnimax/runtime-fixtures/blob/fe7b59bc7691b3ffeb58d330d7ab19b06585fd30/packages/bridge-core/src/stores/catalog.js#L239-L242), [создание настоящего каталога](https://github.com/MaksimUnimax/runtime-fixtures/blob/fe7b59bc7691b3ffeb58d330d7ab19b06585fd30/apps/extension/src/application/runtime.js#L98-L102), [runtime import call](https://github.com/MaksimUnimax/runtime-fixtures/blob/fe7b59bc7691b3ffeb58d330d7ab19b06585fd30/apps/extension/src/application/runtime.js#L248-L254).

`applyBackupImport()` теперь умеет проверять activation context внутри очереди и непосредственно перед записью. Однако `backupContextSupplied` включается только при наличии третьего аргумента. Рабочий `saBackupImport()` по-прежнему вызывает `saCatalog.applyBackupImport(decoded.payload, plan)` с двумя аргументами. В options настоящего `SellerAgentsStoreCatalog.create()` также нет `assertBackupContext`.

Поэтому новая защита действует в прямых library tests, но не в обычном пользовательском пути. Сравнение account ID не различает старую и новую активацию одного аккаунта. Запрошенный до выхода импорт может дождаться очереди и записаться после нового входа, хотя его старое поколение уже утратило authority.

### Независимое воспроизведение на generated worker 0.2.29

Использованы извлечённый из свежей сборки worker, настоящий `SA_BACKUP_IMPORT` handler, настоящий catalog writer, обычные публичные auth handlers и корректно зашифрованная резервная копия с синтетическими данными. Browser/storage/server transport синтетические; подпись bootstrap проверяется штатным клиентом.

1. Сохранён synthetic store и создан encrypted backup с новым store ID для того же аккаунта.
2. Предшествующая обычная запись каталога удержана на synthetic storage port; новый импорт из разрешённого `popup.html#backup-import` расшифровывает файл, строит план и ожидает в настоящей очереди каталога.
3. Пока импорт ожидает, выполнены публичные `SA_AUTH_RESET` и `SA_AUTH_START`, обычный token exchange и корректно подписанный bootstrap. Подтверждены промежуточный signed-out state, повторная активация того же account и generation **1 → 4**.
4. Предшествующая запись отпущена. Старый импорт завершается с `ok:true`, новый store физически присутствует в `seller_agents_stores_v1`. Нового подтверждения импорта после повторного входа не было.

```json
{"changeGeneration":false,"beforeGeneration":1,"afterGeneration":1,"sameAccount":true,"importOk":true,"errorCode":null,"persistedImportedStore":true,"catalogWrites":3,"encryptedBackup":true,"publicBackupSender":true,"transition":"none"}
{"changeGeneration":true,"beforeGeneration":1,"afterGeneration":4,"sameAccount":true,"importOk":true,"errorCode":null,"persistedImportedStore":true,"catalogWrites":3,"encryptedBackup":true,"publicBackupSender":true,"transition":"public_reset_start_signed_bootstrap"}
```

Первая строка — положительный контроль обычного импорта. Вторая нарушает ожидаемую границу: после смены activation context старый queued import не должен записывать stores. Assertion отсутствия такой записи падает. Это реальная запись catalog в generated-worker harness; метод импорта, native writer, encryption и авторизация sender не заменены заглушками. Инъекция ограничена задержкой предыдущей storage write и синтетическими ответами API.

Дополнительный простой контроль смены generation через публичный `SA_AUTH_CANCEL` также воспроизвёл запись при 1 → 2. Основное доказательство выше использует полный reset → signed reactivation, а не только этот сокращённый переход.

Репозиторный `client-catalog-backup-context-boundary.mjs` при этом проходит **25** библиотечных проверок: там callback явно передаётся в `create()`, а context — третьим аргументом. Проверка совместимости старого двухаргументного вызова подтверждает, почему рабочий handler остаётся без guard.

**Последствие:** изменение activation generation не отменяет ожидающий импорт в том же аккаунте. Старое действие продолжает менять каталог после выхода/нового входа. Подтверждён именно этот случай; импорт в чужой аккаунт или принятие неподписанного bootstrap не утверждается.

**Исправление:** подключить предусмотренный `assertBackupContext` к авторитетному activation context рабочего клиента; захватывать неизменяемый context для пользовательского импорта и передавать его третьим аргументом в catalog. Проверка непосредственно перед физической записью должна оставаться синхронной и отклонять смену поколения. Сохранить существующие account isolation, sender admission, encryption и readback; одной проверкой после записи проблему не закрыть.

**Регрессия:** normal import → PASS; held writer → queued encrypted import → reset → signed login в тот же account → release → старый импорт получает отказ и **0 дополнительных catalog writes**. Проверять настоящий popup/worker путь, а не только прямой вызов catalog с вручную установленным callback. Отдельно сохранить отказ для другого account и корректную обработку storage failure.

## Перепроверка двух прежних WB P2

Предыдущий отчёт: [main 299d6113](https://github.com/MaksimUnimax/runtime-fixtures/blob/8d9a611c9d73c42192445a428c21854275d29c66/review-files/code-review-2026-10-15-299d6113.md).

| Замечание | Результат на fe7b59bc |
| --- | --- |
| Невалидный upload блокирует исправленный файл, `/swagger_new` возвращает тот же запрос | **FIXED.** Wrong JSON даёт VALIDATION_FAILED; явный renewal создаёт новый ID; corrected bundle 13/13 становится CANDIDATE_READY. Старый failed artifact остаётся одним неизменённым артефактом. Проверено настоящими bot handlers в memory и native PG. |
| Однажды обработанный bundle подменяет все будущие forced acquisitions | **FIXED.** После завершённого v1 новый forced pass делает **13 fetches**, получает official v2, сохраняет **26 snapshots**, `addedCount=13`, источники CHANGED. Положительный контроль official acquisition проходит. Проверено в memory и native PG. |

Четыре независимых прежних отрицательных assertions теперь **PASS**. Fixture для renewal выбирает именно новую generation: failed history намеренно остаётся в `listPending`, его сохранение не ошибочно представлено как отсутствие нового запроса.

Native WB suite дополнительно проходит **13 тестов**: bigint readback и size/SHA negatives, bot → authority → snapshot/inventory/report, новые DB connections, атомарный отказ в середине 13-member authority, validation-failure renewal, неизменный product baseline, completed consumption receipt, 403 hold, restart после седьмой inventory и потерянного report ACK, конкурентное завершение и snapshot publication. Это первичные локальные результаты, а не перенос заявлений из документа автора исправления.

Потребление candidate теперь подтверждается receipt, связанным с точным artifact/digest, 13 authority members и сохранённым terminal report. Одного request status или terminal report без receipt недостаточно для прекращения восстановления. Историческая v1 больше не выдаётся за новый official probe; при 403 scheduled hold и отсутствие retry storm сохраняются в пройденных сценариях.

## Выполненные проверки

**Штатные Vitest: 1098 уникальных PASS в 75 файлах.**

| Набор | Тесты / файлы |
| --- | ---: |
| Bootstrap, admin/auth, API, feedback, beta | 252 / 17 |
| API Watch и Telegram | 455 / 27 |
| Worker, monitoring/storage, DB/transfer units | 265 / 22 |
| Native PostgreSQL integrations | 80 / 7 |
| Дополнительный package-cwd swagger-handoff suite | 31 / 1 |
| Packaged v2 signature preflight | 15 / 1 |

Native integrations: WB handoff 13; monitoring boundaries 19; P7.2 correction 10; beta admission 25; transfer 11; runtime recovery 1; expiry readback 1. Повторные scheduler/storage tests пакетного запуска и внутренние assertions интеграций не суммируются повторно.

Выбранный основной набор выполнялся тремя конечными группами с двумя workers и собственным 3 GiB virtual-address cap. В процессе появился новый main с version/UI delta; финальные основные/native проверки, relevant release/package checks и negative worker reproduction повторены на `fe7b59bc` / 0.2.29. Промежуточные результаты `ab3abd9e` отделены в evidence и не посчитаны повторно.

**Python bootstrap HTTP observer: 25 PASS.** Проверены точная выбранная Request/Response identity, allowlisted transport-failure classes, безопасный elapsed interval и ранний отказ уже aborted запроса. Во время wait поздний requestfailed не представлен как успешный body parse. Browser-installed proof из этого не выводится.

**Node release safety: 112 PASS. Typecheck: 10 пакетов PASS:** `@product/api`, `@product/worker`, `@product/api-watch`, `@product/telegram-operator`, `@product/bootstrap`, `@product/admin-ai`, `@product/admin-auth`, `@product/credential-transfer`, `@product/monitoring-control`, `@product/beta-access`.

**Extension:** source catalog context guards 25 PASS; A24 export/import suite PASS; actual generated worker/application 60 PASS. Позиционирование кнопки — **21 source geometry case PASS**, включая wide/multiline root, native Copy control, viewport и перекрывающие controls. Hash/differential внешнего patch и deterministic Chromium/Firefox store package contracts проходят. Эти положительные suite не закрывают отсутствующую connection нового guard в основном import handler.

Новый независимый generated-worker script: положительный normal-import control PASS, stale same-account reactivation assertion **FAIL**. Exit code 1 — подтверждение описанного P2, а не зелёный тест. Первоначальный activation fixture был исправлен до полноценного proof: token response должен содержать штатный `status=activated`; итоговая версия проходит подпись/bootstrap и положительный контроль. Первичная ошибка настройки fixture не объявляется продуктовым дефектом.

Beta invitation changes проверены unit/native наборами и typecheck с новым pinned `tr46`. Выполнен frozen-lockfile install из существующего pnpm store с обычной проверкой integrity; tracked dependency declarations/lockfile не изменялись агентом. В проверенных IDNA/DNS сценариях новых замечаний не подтверждено.

Operations suite и неизменные полные browser матрицы в этом проходе не повторялись; их прежние результаты не выданы за новые проверки текущего SHA. Отдельные исходные profile/ledger/Work/transfer recovery regressions проходили на промежуточном main; итоговая заявленная package acceptance ограничена перечисленными проверками финальной 0.2.29.

## Сборка, изоляция и ограничения

Свежая development build **0.2.29**: `SELLER_AGENTS_I1_C1_v0.2.29_LOCAL_DEVELOPMENT.zip`, **2579722 bytes**, SHA256 **`68d25edfb1118bf6c1bf8ac774b0f61414ccf8407c383c1155bb1bfcc79657bf`**. `repeat_archive_match=true`, `source_extracted_bytes_match=true`. Это development package, не подтверждение магазинной подписи, установленной версии или live-owner сценария.

Native PostgreSQL собственный, только **`127.0.0.1:55452`**, disposable `postgres` / `product_control_plane_test`; независимые WB cases используют свои schema scopes. Live DB/credentials не использовались. Backup proof применяет manufactured credentials и собственные ephemeral signing keys через штатную верификацию клиента; account ID, токены, пароль и содержимое backup в отчёт не включены. Реальных marketplace/AI/Telegram/provider запросов не было.

Installed-browser запуск не повторялся: прежний адресный отказ `Loading of unpacked extensions is disabled by the administrator` не обходился. Административная политика не менялась, альтернативный браузер/роль ради повтора не использовались. Generated worker/VM/storage fixtures — отдельный уровень; они не являются установленной браузерной приёмкой. Реальные SMTP/TG, branded-browser/owner acceptance и production deployment здесь не проверялись.

Перед проверками было около **32 GiB MemAvailable**, **28 GiB** свободного workspace и более **2 млн** свободных workspace inode. После cleanup workspace **2.8/32 GiB**, `/tmp` около **149 MiB / 17 GiB**; свободных workspace inode по-прежнему более 2 млн. Собственная PostgreSQL остановлена, её pgdata удалена; новых контейнеров и серверных runners не создавалось. Evidence сохранены в `/tmp/runtime-fixtures-review-20261015-fe7b59bc`, включая `validation-summary.json`, `backup-reactivation-proofs.json` и `wb-consumers-proofs.json`.

Рабочий сервер не подключён. Его организационные состояния/notices и `/root/octoport-control/controllers/organization/errors.json` — **NOT_RECHECKED**; закрытая локальная серверная область не читалась. Проверены доступные repo instructions, scope, Git cleanliness/history и remote база. WIP, чужие активные процессы и серверные настройки не менялись. Актуальная серверная занятость диска и эффект очистки не измерялись.

**Публикация:** Chrome / Firefox / Opera — SOURCE/PACKAGE подготовка проверена, фактическая стадия кабинетов и первой подачи **UNKNOWN**. Dashboard не проверялся. Автор выпуска должен связать конкретный store-candidate с обычной установкой/обновлением, reviewer flow и фактическим ответом магазина; development ZIP этого не доказывает. Новое действие владельца из данного code review не требуется. Safari остаётся после релиза.

## Публикация отчёта

Ветка **`codex/code-review-2026-10-15-fe7b59bc`**, файл `review-files/code-review-2026-10-15-fe7b59bc.md`. Публикуется только Markdown, без изменения продуктового `main`. После push проверяются remote SHA, HTTP 200 raw-файла и побайтовое совпадение с локальным отчётом.
