# S05 · текущая передача проверки ключей

**Актуально 08.11.2026, 04:28 UTC:** исправления сохранения входа и старого сообщения об успешной авторизации установлены: web/Identity `alisa-da73a089d3125429`. Новые изменения другого исполнителя сохранены: API/admin `alisa-06f3c053e7719290`; shared `alisa-482ed11832b666af`. Обычная регистрация собственной учётной записи, сохранение сессии, выход и повторный вход по паролю и доставленному почтовому коду проверены на основном сайте. [Итог, точные версии и receipts](AUTH_NAVIGATION_20261108.md). Исторические checkpoints ниже не описывают текущие pointers. Подтверждение связи Performance с Seller кабинетом этим исправлением не добавлено.

**Актуально 08.11.2026:** web/API и отдельный checker установлены из `5dff6e8883e25ac464d6e8c64e4ab5a7280c70f7`. Реальный Seller и WB через установленный adapter/socket проходят; Performance принят как `AUTHENTICATED_UNLINKED`, без promotion/доказательства общего кабинета. Identity 7af, admin 731 и основное ядро сохранены. Владельцу нужно повторить проверки в его карточке; прямых изменений её статусов не было. [Точный итог и границы](AL_S05_REAL_KEYS_REPAIR_20261108.md). Ниже — исторические checkpoints.

**Текущий web 9b716 / API6098:** в форме Ozon доступны оба ключа, Seller и Performance. [Последний установленный результат](AL_S05_DUAL_OZON_20261106.md); прочие компоненты сохранены. Исторические checkpoints ниже не являются текущими pointers.

**Позднейший установленный web patch:** web `d9918bcb3695b432`, API 6098; public stores GET/POST без cookie исправлены с 422 на 401. Все остальные компоненты сохранены. [Точный текущий отчёт](AL_S05_SESSION_EXPIRY_20261106.md). Ниже сохранены предыдущие checkpoints; открытые Seller/Performance/live границы не закрыты этим исправлением.

**Актуальный итог 06.11, 04:04 UTC: INSTALLED_READY_FOR_OWNER_TEST.** На https://alisa.octoport.ru/app/stores включены web/API 6098, stores migration/vault и отдельная служба checker. Действующие admin/Identity 731 и shared current 482 сохранены. Точный интегрированный core прошёл 1 035 offline checks; фактические activation core/platform — 25/41 PASS, IPC — 6 PASS. Независимый установленный review принят в ограниченном read-only scope. Authenticated customer smoke требует нового обычного входа, live provider acceptance остаётся открытым. [Установленный результат](AL_S05_INSTALLED_REPORT_20261106.md), [receipts и процедуры](s05-installed-20261106/PROGRESS.md). Ниже — сохранённый прежний handoff до активации, он больше не описывает текущие pointers/сервисы.

**SOURCE_PACKAGE_QUALIFIED_CURRENT_CORE_PATCH_READY_NOT_ACTIVATED.** Пользователь поручил продолжать на https://alisa.octoport.ru/. Админка передана другому потоку; её домен, текущая Identity, SMTP и действующие назначения не входят в эту поставку. Это продолжение предыдущего handoff, а не отмена его ограничений.

## Что готово

Кандидат `6098b31384ae23a43fb869abd3e67f165bc644fa`, tree `746cd1be53a45a47c3ac6cf5fb64041aced785b0`, [Draft PR395](https://github.com/MaksimUnimax/runtime-fixtures/pull/395). CI 42148492021 и 42148492013 завершены SUCCESS. Проверены полные payload обоих архивов: runtime 7 файлов / 0 ссылок, platform 4451 файл / 42 ссылки. [Exact binding](s05-runtime-20261106/ci-package-binding.json).

Новый runtime handler использует отдельный versioned Unix protocol; проверяет caller до чтения, не пишет plaintext, убивает и дожидается зависшего child, не следует redirect, не использует proxy, проверяет TLS. WB403 и неподтверждённые Ozon402 не выдаются за ошибку роли или оплаты. Shared HTTP primitive сохранит прежний single bounded read аналитического транспорта.

24 TLS/Unix проверки прошли в CI и независимо от CI повторены автором в отдельной копии на самом Alisa под nobody/PrivateNetwork/512MiB/60sec; внешних вызовов площадок — 0. S05 PostgreSQL/Unix — 40, integrated browser — 175 (15 S05), packaged — 96, native core — 92, S04 regression — 36 и open-registration — 130 пройдены в изолированной CI среде; это не установленный кабинет. Прежний R01 replay — 800 также прошёл, отдельно от актуального ядра.

На свежей копии текущего ядра выполнены 949 проверок tests/ и 86 top-level dataset tests — всего 1 035, ошибок, пропусков и внешних вызовов — 0. Применён только [подготовленный текущий patch](s05-runtime-20261106/current-core-http-extraction.patch) в собственной копии, а не на работающем сервисе. [Qualification](s05-runtime-20261106/current-core-qualification.json), [exact patch binding](s05-runtime-20261106/current-core-patch-binding.json), [независимый patch review](AL_S05_RT_CHECK_CURRENT_CORE_PATCH_REVIEW_20261106.json). Авторский native запуск не назван независимым тестом.

## Фактическая работающая версия

Свежий readback 06.11: web/site/admin `alisa-c8666516683e7b2b`; Identity/shared `alisa-482ed11832b666af`; четыре health READY. Platform runtime сообщает RUNTIME_NOT_CONNECTED. Alice runtime WorkingDirectory `/opt/alice-market/releases/20261105-v010-number-reason-r1`; HTTP SHA256 `c5bef1600d8f70449c908c8abd974d358d18cb74243df4d5683c7c228000ba2f`. Нового store-check.sock нет. Это не результат применения S05.

RDC сначала был offline, затем связь восстановлена. На конце квалификации свободно 3 825 393 664 байта и, по предыдущему замеру, 582 986 inode; memory full avg10=0.00, MemAvailable — 6 217 644 KiB до конечных проверок. Три собственные qualification units завершены exit 0 / inactive / empty cgroup. Рабочие конфиги, БД, staff, release pointers и активный HTTP файл не изменялись.

## Конкретный остаток до включения

1. Согласованный автор runtime адаптера включает новый модуль и shared primitive в новый exact current-core release. Старый R01 patch к работающему файлу не применять. Готовый текущий patch рассчитан только на c5bef160…; after SHA — ecc93ed7…. Повторно проверить текущие WorkingDirectory/хеши до cutover; не редактировать чужой активный путь. В этой поставке общий core cutover не выполнялся.
2. Настроить отдельную native product service с доверенным UID, memory/tasks/deadline/kill group; отдельный socket `/run/alice-market/store-check.sock`. Дать platform минимальный проход в parent и доступ только к новому socket, не к старому gateway или credential directory. Parent 0750, UID 996 сейчас подходит server guard, но platform UID 993 не имеет прохода. Не добавлять platform в широкую alice-lab группу. Родитель не должен быть group/world-writable. Копировать наблюдённые UID без свежей сверки нельзя.
3. Принятый platform package установить отдельно; создать отдельный private vault keyring. Под существующими rollout locks и migration role применить только additive stores.0001_initial после точного migrate --plan и сохранения ledger/authority/config fingerprint. Ни identity migration, ни handover, ни SMTP изменения не выполнять.
4. Связать STORE_CHECK_SOCKET/UID и stores flag; переключить только web/site текущего scope с сохранением admin/identity/shared pointers. Проверить restart/возврат, vault ACL, старые sessions и tenant isolation. Additive schema не откатывать вниз; неизвестные чужие config/pointer изменения не затирать.
5. WB identity принимает только authenticated UUIDv4 sid. Seller остаётся IDENTITY_NOT_VERIFIED до доказательства именно привязки Client-Id/key к кабинету и отрицательного canary. Performance token не доказывает тот же Seller кабинет; crosswalk отсутствует и promotion запрещён. Нельзя включить эти флаги ради зелёного CONNECTED.
6. Реальные ключи вводит владелец в его кабинет. Старые alice-lab/расширение credentials не импортировать и в чат не запрашивать. Только после этих проверок можно заявлять установленное подключение площадки.

Текущий шаг завершён как подготовленная, проверенная поставка runtime-side источника/пакета и exact current-core patch. Полная AL-S05 и live provider acceptance остаются открытыми.

## Неактивная копия на сервере

После независимого package review точный runtime tar размещён в новом `/opt/alice-market/store-check-releases/rt-check-6098b31384ae23a4`. Повторно проверены 7 payload SHA и manifest SHA; каталог root:root 0700, архив и receipt 0600. Это только неактивная поставка: новых product units/socket/config, миграций, pointer changes и рестартов нет. Активный HTTP SHA и все пять platform pointers сохранились. [Фактический readback](s05-runtime-20261106/inactive-runtime-package-install.json).
