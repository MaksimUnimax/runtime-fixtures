# R5: совместимая веб-поставка preview/периода — 16.11.2026

Статус: INSTALLER_AUTHOR_GUARDS_PASS, NOT_PREPARED_NOT_APPLIED. Независимое review и exact installer CI проверяются отдельными evidence перед переключением. Текущая WB-поставка сохранена.

Продукт: 5e5e8cc8922342cab0bed90073da6942a5b8f284, PR454. Source43832009335 и Documentation43832009308 SUCCESS; независимое source V3 review PASS; 8 изолированных React/browser проверок и 3 файловых проверки PASS. Это не установленная приёмка и не открытие короткой истории. [Подробный source-отчёт](R5_PREVIEW_PERIOD_SOURCE_20261116.md).

Пакет artifact14210310609/run43832009335 доставлен прямо в файл на Alisa. ZIP52362969B, SHA256e9887701e02dfd6267d23edc9508c7cc48f63529f9c2acb5ce6d3f8afcb41eb5, CRC PASS. Обе вложенные TAR/sidecar и manifest проверены. PlatformTAR85dd68454485cf0c54e65887e5ad3c067509531d94f7a6cee9bce19e8b8ab739, 4654 файла. RuntimeTAR14052400b3cdd8fe11609b686f9cd44784f60a761446f30bc9b344605044f497, 106 файлов, не устанавливается.

Web base — alisa-wb-activity-e0a10bb47fe1cd83, manifest3fd0a1d22b68678918102b5072b0bd6118481d153436569da66a09a7ca43e534. Native WBmanifestfa078b54e2bf1b57ae3c55e7ffba2a832367a17755a9c24eeedf7bc0d70ddb29 остаётся прежним. Последний read-only снимок: active0, UNKNOWN4, maxcall3676.

Новый install_r5_preview_web_20261116.py переназначает принятый WB web-only installer на этот source/TAR и точную действующую веб-базу. Все 10 функций и остальные исполняемые управляющие выражения AST-идентичны принятому драйверу. Разрешены восемь конфигурационных присваиваний и описание модуля; новый guard проверяет этот предел, точные пути, source, TAR и сохранение остальных pins. Существующий catalog CI entrypoint включает guard. 56 проверок PASS как root и nobody; это 55 прежних проверок и один новый guard, не 56 новых уникальных сценариев. Первый guard остановился на отличии docstring, после исключения только неисполняемого описания прошёл; первый провал сохранён.

Поставка использует квалифицированный ui/web поверх прежних не-веб файлов, hash-pool/hardlink существующего materialize, сравнение contracts/locks, CAS selector и guarded rollback. Только web перезапускается; восемь остальных основных служб, native/R5/R15, staff overlay и сессии сохраняются. Нет миграций, изменения данных параметров, ключей, прав или привязок. Общий lock прежний: /run/lock/alisa-stage-rollout.lock.

Alisa evidence: /root/alisa-r5-preview-web-install-20261116/DELIVERY.json и artifacts/alisa-r5-preview-5e5e8cc8.zip; распаковка — /dev/shm/alisa-r5-preview-5e5e8cc8. В момент подготовки этого отчёта PLAN/APPLIED ещё отсутствуют. Easyscript evidence: /root/alisa-r5-preview-period-20261116/WEB_ROLLOUT_PINS.json, INSTALLER_*_PRIVATE.log, INSTALLER_REVIEW_REQUEST.md и результат независимого review. Секретов в отчёте нет.

Следующий шаг: exact installer CI и review → guarded prepare/проверка PLAN → web-only apply → облачный кабинет R5, корректные режим/период, обе сессии и WB-карточки → контроль восьми сохранённых служб/параметров/очереди → удаление собственного временного payload после отсутствия потребителей. Архив и предыдущий веб-релиз сохраняются для отката. Автоматическое подтверждение короткой истории и ручная приёмка физической колонки этим обновлением не закрываются; общая матрица остаётся 91/63.
