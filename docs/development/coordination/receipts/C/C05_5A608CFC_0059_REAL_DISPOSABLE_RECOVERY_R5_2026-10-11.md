# C05 — PostgreSQL 0059 и реальный recovery на исходниках Chrome 0.2.15

**Дата:** 11.10.2026. **Роль:** C. **Задача:** `C05-5A608CFC-0059-REAL-DISPOSABLE-RECOVERY-R5-20261011`.
**Уровень:** `SOURCE_RUNTIME_REAL_DISPOSABLE`, не `DEPLOYMENT`, `PRODUCTION`, `INSTALLED_SYNTHETIC` или `LIVE_OWNER`.

## Область и неизменная база

- Кандидат: исходный Git-коммит пакета Chrome 0.2.15 `5a608cfc3e89366cdfbab4e61d1d65c7a36ab7c6`, дерево `2cdcaa35ec513335d4f9b4325b6a7246eb5dfa8f`. Это **не** опубликованный `main`.
- `main` во время проверки: `e01778cca4af25c366fd80acd55fca5349527052`, Drizzle журнал47 / `0058_extension_release_browser_artifacts`.
- Исходник Chrome 0.2.15: Drizzle журнал48 / `0059_ai_prompt_trees`. Новые таблицы: `ai_prompt_tree_heads` и `ai_prompt_tree_publications`.
- Принятый rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`; тестовые фазы `5a608 → d248 → 5a608`.
- Сценарий C05: Git blob `0e1dcb154937b631ec353a15da4aa2bdddd52321` и runtime identity blob `b0df0b27cd85214e10c0f128b0bbd00f5f40f3b5` — те же, что у ранее принятого e017-прогона. Новый `pnpm-lock.yaml` blob `ff578d7d4a20db11055c937fbe9af10265ac494b`.
- Никаких изменений общих миграций B01/B04, исходников 0.2.15/OPERATOR, живого сервера или пользовательской базы.

## Ресурсы и воспроизводимость

- Штатный `disk_lifecycle.begin` выделил собственный ресурс C `3305995ef166433299b39f2d5980f4d9`, 1536 МиБ, временная директория `/root/octoport-control/temporary/C/c05-5a608cfc-0059-r5-20261011`.
- Node `v24.20.0`, `pnpm 10.34.5`. Первичная строго офлайн-установка обнаружила `ERR_PNPM_NO_OFFLINE_TARBALL`; затем `pnpm fetch` получил недостающие публичные зависимости **только в локальный зарегистрированный кэш**. Повторная установка на свежем `git archive` с `--frozen-lockfile --offline` — **exit 0**.
- Оригинальные исходники, lockfile и общий pnpm store не изменялись. Квитанция: `/root/octoport-control/logs/C/C05_5A608_R5_OFFLINE_PINNED_SOURCE_DEPENDENCIES_PASS_20261011.json`.
- Тестовая PostgreSQL исключительно роли C на локальном Docker/loopback. До прогона — **0** баз `c05_rehearsal_*`.

## Реальный C05 rehearsal — PASS

- `control.py C heavy --db --profile e2e --timeout-seconds 1800`: три реальные фазы **candidate 5a608 → floor d248 → candidate 5a608**.
- Все 13 этапов `C05_PHASE` пройдены, включая `FORWARD_MIGRATION_PASS`, `UPGRADED_BACKUP_RESTORE_PASS`, оба `CANDIDATE_PHASE_PASS`, `FLOOR_PHASE_PASS` и `CLEANUP_PASS`.
- Миграции: журнал **40 → 48**, последняя `0059_ai_prompt_trees`. Резервная копия после миграции **512727 байт**, SHA256 `55ae65305bd5b8cd04fa9b79d1e4f9a5dc0bb93b86de4ee3ce023ae0ca418630`. В read-only `pg_restore --list` найдены обе новые таблицы и секции данных.
- В каждой фазе API live/ready **200**, worker ready **true**, portal login и proxy **200**; 10 проверок в каждой фазе, в том числе синтетические проверки bootstrap и удаления.
- Supervisor: **exit 0**, `cleanup_verified=true`, пик памяти **1415 МиБ**. Фактическая отдельная проверка PostgreSQL после прогона показала **0** оставшихся `c05_rehearsal_*`; внутренние промежуточные рабочие директории и частное тестовое состояние удалены сценарием.
- Первичное доказательство: `/root/octoport-control/logs/C/c05-5a608cfc-0059-recovery-r5-20261011/evidence/c05-three-service-rollback-evidence.json`, SHA256 `993a231f8ef6a12c03ae701123b7baa3632fa9ab2c41205aaaddc82242fe019f`.
- Проверенная сводная квитанция: `/root/octoport-control/logs/C/c05-5a608cfc-0059-recovery-r5-20261011/C05_5A608_R5_ACTUAL_0059_THREE_SERVICE_PASS_20261011.json`, SHA256 `e766895b6883e80840d9e0d23a0cc71f8d6f0f28d31561e357f52b6ee45d95e5`.

## Отдельная проверка нового API — PASS

- Строго на том же SHA `5a608cfc…`, исходник `apps/api/src/bootstrap-routes.test.ts`, Git blob `b03516f599f9eebf727af3c63778b950dff6bf35`.
- `pnpm --filter @product/api exec vitest run src/bootstrap-routes.test.ts`: **один файл, 5/5 тестов PASS**, exit 0. Проверяются в том числе транспорт дерева промптов, negotiation и отказы безопасности. Supervisor exit 0, cleanup verified, пик **438 МиБ**.
- Квитанция: `/root/octoport-control/logs/C/c05-5a608cfc-0059-recovery-r5-20261011/C05_R5_FOCUSED_BOOTSTRAP_TREE_ROUTE_5_OF_5_PASS_20261011.json`, SHA256 `f00671e16b6439c7cf76019e857db0847af9ac71529942c5f085725102cb622c`.
- Это source/fixture-тест, **не** подписанный реальный bootstrap установленного Chrome 0.2.15.

## Незакрытая очистка собственного ресурса

- Доказательства и 11 воспроизводящих скриптов/журналов сохранены отдельно от временного каталога.
- Поддеревья воспроизводимого исходника и кэша (565 и 521 МиБ по `du`) удалены **после точной проверки отсутствия у них активных cwd/fd/mmap**. Непосредственная разница `df`: **+576 МиБ** физически свободного места, без заявления освобождения системной резервации.
- Два старых stdout журнала `pnpm` ещё имеют открытые файловые дескрипторы у RDC Node. Эти файлы **не удалялись и не перемещались**. Весь ресурс зарегистрированным штатным `hold` сохранён до **11.10.2026 примерно 22:32 МСК**, состояние `HELD`, пока не будет подтверждён безопасный release/close.
- Квитанции: `/root/octoport-control/logs/C/c05-5a608cfc-0059-recovery-r5-20261011/C05_R5_TASKLOCAL_CACHE_PARTIAL_SAFE_CLEANUP_20261011.json`; `/root/octoport-control/logs/C/C05_R5_TASKLOCAL_NATIVE_HOLD_RDC_FD_CONSUMER_20261011.json`.
- 14 прежних ресурсов C и рабочие копии других ролей не очищались.

## Результат, ограничения, продолжение

**Результат:** `PASS_SOURCE_RUNTIME_DISPOSABLE_5A608_0059_THREE_SERVICES` и `PASS_FOCUSED_PROMPT_TREE_API_5_OF_5`.

**НЕ подтверждены:** фактическое внедрение этого SHA на тестовом/production сервере, состояние серверного каталога совместимости `0.2.15`, реальный подписанный bootstrap, обычный owner login, Chrome-installed useful flow, полный CI5/ready-main/публикация и независимое review именно этого нового результата.

Наблюдавшийся OPERATOR `EXTENSION_STATUS_ALLOWED → UPDATE_REQUIRED` имеет пока неизвестную серверную причину в четырёх входах compatibility resolver. Присутствие `0059` и нового маршрута в исходниках **не является доказательством устранения указанного отказа**.

**Задача C05-R5 остаётся `IN_PROGRESS` до независимого review, надлежащей очистки/retention собственного ресурса и штатных публикационных проверок.** C05-R4 на текущем `main` и черновой PR #37 (SHA `547d14ae…`) сохранены. C00 и предыдущий явный отказ платформы на dual-root patch export не затрагивались.
