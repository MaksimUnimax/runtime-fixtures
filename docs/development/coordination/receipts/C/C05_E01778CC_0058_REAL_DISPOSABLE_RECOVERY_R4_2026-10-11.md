# C05 — реальный disposable recovery на e01778cc — 11.10.2026

## Задача и точная граница

- ID: `C05-E01778CC-0058-REAL-DISPOSABLE-RECOVERY-R4-20261011`, роль C, общий план C05, штатная очередь `IN_PROGRESS`.
- Исходник кандидата: `e01778cca4af25c366fd80acd55fca5349527052`, дерево `2f263d9367f07bd327298156dce7ad0aba2d7add`.
- Принятый rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`, дерево `5e3530ca38970a6487aa73b7297aa1953012eb7e`.
- Предшествующий C05 R3 на `3a64196c9fa54ed842e5d221fcb1266e5f962994` имеет strict DONE, но его успешная проверка **не перенесена** на новый код: между 3a и e017 изменились девять API/server исходников и тестовых потребителей. Существующий accepted harness blob `0e1dcb154937b631ec353a15da4aa2bdddd52321`, runtime identity blob `b0df0b27cd85214e10c0f128b0bbd00f5f40f3b5`, Drizzle journal blob `485ea5cee05f40fc8be7475d69601c848a12bb12` неизменны.
- Подтверждён Drizzle journal 47, latest `0058_extension_release_browser_artifacts`. Ни SQL миграции, ни B01/B04 source/lockfile в этой задаче не изменялись.

## Ресурсы и подготовка

- Девять старых зарегистрированных ресурсов C имели просроченный `HELD`, отчего первый новый `disk_lifecycle.begin` вернул код 75 `PREVIOUS_ARTIFACTS_UNACCOUNTED`. Все девять проверены по назначению, текущим потребителям, Git, процессам и грязным/ignored файлам; доказательства сохранены. Они удержаны штатным конечным `hold` до **11.10, 19:57 МСК**, без удаления и без вымышленного освобождения диска; ранее сохранённые пять HELD не затронуты.
- Новый ресурс C05 был зарегистрирован через native `begin`: `660adda264404b218f5f37bf06cc61ba`, резерв 1536 МиБ, `/root/octoport-control/temporary/C/c05-e01778cc-0058-r4-20261011`. После успешного прогона task-local scratch без уникальных исходников очищен под `controllers/coordination.lock`; native `disk_lifecycle close` вернул 0, запись **`CLOSED`**, путь отсутствует. По `df` до/после фактически появилось +552 МиБ (не сумма `du` каталогов). Квитанции: `/root/octoport-control/logs/C/c05-e01778cc-0058-recovery-r4-20261011/C05_R4_OWN_TEMP_CLEANUP_COMPLETE_20261011.json`, `/root/octoport-control/logs/C/c05-e01778cc-0058-recovery-r4-20261011/C05_R4_NATIVE_DISK_CLOSE_20261011.json`. Исторические 14 HELD сохранены без удаления.
- Только собственная тестовая БД C, loopback `127.0.0.1:15543`; исходный seed backup SHA совпал. Установленное `pnpm 10.34.5`, Node `v24.20.0` соответствуют принятому source lockfile.
- Два первых supervised запуска R1/R2 завершились `exit=1` после `RESTORE_READY`; оба имели `cleanup_verified=true`. Узкий диагностический прогон подтвердил `ERR_PNPM_NO_OFFLINE_TARBALL`, а не дефект PostgreSQL или API. Зафиксированы отказанные попытки, не выданы за PASS.
- Зависимости восстановлены через task-local кэш: существующее хранилище `pnpm` **скопировано**, недостающие bytes получены из публичного npm registry **только в собственный зарегистрированный кэш**; свежая копия exact e017 прошла `pnpm install --frozen-lockfile --offline` с кодом `0`. Общий store, пакетный lockfile и канонические A/B/C source не менялись. Диагностическое дерево и тар временной копии удалены после фиксации доказательств.

## Третий supervised прогон R3 — PASS

- Управляемый маршрут: `control.py C heavy --db --profile e2e`, MemoryMax 4096 МиБ, finite deadline 1800 секунд; записан `HEAVY_R3.stdout`.
- Зафиксированы `RESTORE_READY`, `CANDIDATE_SOURCE_READY`, `FORWARD_MIGRATION_PASS`, `UPGRADED_BACKUP_RESTORE_PASS`, `FLOOR_SOURCE_READY`, `SYNTHETIC_SETUP_READY`, `CANDIDATE_PHASE_1_PASS`, `FLOOR_PHASE_PASS`, `CANDIDATE_PHASE_2_PASS`, `CLEANUP_PASS`.
- Три реальные фазы: точный кандидат e017 → принятый floor d248 → точный кандидат e017. У каждой фазы исходник/tree совпадают с Git commit; API live/ready `200`, worker ready `true`, portal login `200`, portal proxy `200`. Остальные предусмотренные проверки bootstrap/device/forget также зафиксированы в первичном evidence, не воспроизводятся здесь как бизнес-данные.
- Тестовое восстановление: journal `40 → 47`; обновлённый backup **504199 байт**, SHA256 `99127e5b00009990abd4f760a5777781de9e0de7d5d36753216c64825e1c6ffc`. Размер и digest реального backup-файла проверены.
- `RESOURCE_JOB_FINISHED`: `exit_code=0`, `peak_mib=1404`, `cleanup_verified=true`. В primary evidence отмечены `disposableDatabaseDropped=true`, `privateTransientStateRemoved=true`, `tempWorkRemoved=true`; отдельная проверка PostgreSQL вернула **0** оставшихся баз `c05_rehearsal_*` и **0** активных процессов сценария.

## Доказательства и ограничения

- Первичный неизменный результат: `/root/octoport-control/logs/C/c05-e01778cc-0058-recovery-r4-20261011/evidence/c05-three-service-rollback-evidence.json`, SHA256 `29b3531b6f318720048456d028e62acf53adaa7c32798f279f8e1fc1c90bd5d1`.
- SHA-связанная итоговая квитанция: `/root/octoport-control/logs/C/c05-e01778cc-0058-recovery-r4-20261011/C05_E017_R3_EXACT_REAL_DISPOSABLE_RESULT_20261011.json`, SHA256 `1454a709217e1ac7e1048172fab43370ec299ef7e78ffb3827b49e2ed32c5dc3`.
- Предыстория и устранение зависимости: `HEAVY_R1.stdout`, `HEAVY_R2.stdout`, `HEAVY_R3.stdout`, `C05_R4_FOCUSED_DEPENDENCY_FIX_EVIDENCE_20261011.json` в том же каталоге; исходный C05 R3 (3a) остаётся отдельной ранее принятой работой.
- **Вердикт: PASS_DISPOSABLE_POSTGRESQL_REAL_APP_RECOVERY_CURRENT_0058_E017 (SOURCE_RUNTIME).** Это не `LIVE_DB_RESTORE`, не `DEPLOYMENT`, не `PRODUCTION`, не обычная авторизация/полезное действие расширения, не `LIVE_OWNER`. Подписи, CSRF, TTL и владелец production не подменялись.
- **Независимое B focused review получено**: `PASS_FOCUSED_SOURCE_RUNTIME_EVIDENCE_WITH_P2_DOC_SHA_CURRENTITY_HOLD`; P0=0, P1=0, P2=1. B сверил exact commit/tree, реальное свидетельство трёх фаз, журнал миграций, hash backup между первичной квитанцией и verifier, исходные ресурсы и статус `CLOSED`. B не повторял тяжёлый прогон и не обращался к C DB. Единственное P2 касается **устаревшего SHA этого документа в первоначальном review request** после последующего закрытия временного ресурса; это не REWORK реального восстановления. Для текущего SHA требуется отдельное read-only подтверждение B. Источник: `/root/octoport-control/peer-handoffs/C/B-C-C05-E017-R4-REAL-DISPOSABLE-INDEPENDENT-REVIEW-20261011.response.json`.
- **Задача остаётся `IN_PROGRESS`.** Реальный disposable SOURCE PASS и собственный temp resource `CLOSED` подтверждены; независимое B runtime SOURCE-review — PASS при одном незакрытом P2 документной SHA-currentity. Новый точный SHA передаётся отдельно как immutable review addendum; до ответа B P2 не считать закрытым. Clean task-owned candidate, пять обязательных CI на точном SHA, ready-main, non-force publication/readback и strict queue DONE **не подтверждены**. Отдельный C00 с явным отказом на экспорт остаётся `IN_PROGRESS`; запрещённая операция не повторялась.
