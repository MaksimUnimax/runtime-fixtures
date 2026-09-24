# Контроллерская проверка 2026-09-24

## Решение и границы

Владелец остановил A/B/C для аудита. STOP сохраняется до нового прямого разрешения; эта квитанция закрывает запрос контроллерского разбора, а не запускает потоки. Состояния продукта, установленного браузера, live и магазина не смешивать.

Контроллер собрал ветку controller/audit-20260924 от main 3a0d1c94a84892e26863224b7ef462c016af2623: C a5fd724 + A0755f7c + B-авторские dfdd6314/7f58a38/b9b8e718, без повторного переноса d14e65f и без разрушительного B08a21f9. Сохранены owner STORE/Safari/resource правила. B06 retention и audit fixes проверены по исходникам и прежней отдельной PostgreSQL-квитанции; результаты новой CI относятся только к указанному точному SHA в серверном receipt.

Дополнительно исправлены: незавершённая нормализация Firefox loopback host patterns; обязательный contractVersion в админской форме с явным выбором v1/v2; точный BFF route для release publish; unused type import в извлечённом C04 contract. Canonical OpenAPI из B-патча включает актуальный v2; openapi:check PASS, искусственное изменение generated JSON не нужно.

## Сохранность незавершённой работы

До изменения сделан снимок голов, статусов, patch и SHA256 каждого из шести dirty файлов в /root/octoport-control/incidents/controller-audit-20260924/. A checkpoint 0ae433792cca34e94c9a8fe0ca5867b3d56ffe35 и C checkpoint 2a3a1e5ca7477d4d2a6342575ee605028750481a сохранены отдельными refs checkpoint/audit-20260924-a и -c. Четыре C shared-файла приняты как перенос общего контракта; исполнение C04 runtime/Telegram остаётся в child и не объявлено готовым. Все child worktrees и доказательства сохраняются.

B forward repair: текущий опубликованный work/b-backend 0baac2c4 имеет 08a21f9, который удалял уже принятые A/C файлы. Контроллер разрешает точный обратный commit этого revert и обычное слияние проверенного controller candidate, без reset/rebase/force и без нового изменения A/C по смыслу. Это восстановление границы, не разрешение B самостоятельно развивать чужие подсистемы. Нельзя снова целиком переносить старую ветку B в C или применять прежний B-owned patch поверх уже включённых исправлений.

## Что делать при последующем разрешённом возобновлении

### C: первая общая граница

1. Прочитать эту квитанцию и локальный notice CONTROLLER-AUDIT-20260924. Проверить STOP, текущие головы, чистоту, свежий origin/main и точные CI, перечисленные в серверном receipt.
2. На сохранённой чистой границе принять controller/audit-20260924 обычным merge. Если контроллер уже сделал merge в work/c-integration, не повторять и не cherry-pick. Публиковать точный C HEAD, дождаться всех пяти required workflows, выполнить ready-main обычным путём и интегрировать main. Доказательства другого дерева не подменяют проверку текущего C SHA.
3. Обновить A/B общей принятой базой. Exact C04 handoff: packages/server/health/src/no-session.ts, export из @product/health, совместимый re-export apps/health-runner/src/no-session-contracts.ts. Это готовая shared-граница для B; не держать B на ожидании всего C04 runtime.
4. Первый магазин приоритетнее независимого мониторинга C04/C05/C06. Свести production ZIP, backend reviewer path, публичные privacy/support/install, карточку и точные browser receipts. Минимальный готовый канал отправлять сразу, не ждать все браузеры. Safari отложен после релиза.

### A: минимальный магазинный пакет

После синхронизации принятой базы не повторять исправленный legacy import. Сделать явный store/release mode общего существующего builder, HTTPS control/portal, актуальный trust bundle и control_plane_v2; dev loopback/LOCAL DEVELOPMENT ZIP не отправлять в магазин. Использовать действующий C01 validator, без второй архитектуры релизов. Зафиксировать SHA исходников и готового ZIP, обычную установку/вход/полезный сценарий в настоящем браузере. Ближайший кандидат Opera; Yandex stable catalog/install/update проверяются отдельно от Yandex Beta development PASS. Firefox port fix не равен успешному installed auth. Логотип и нормальный owner login остаются отдельными owner gates; не повторять регистрацию издателя.

### B: нормальный путь release/config/link

Исправления retention, audit и ADMIN release HTTP уже в controller candidate. Не повторять patch/cherry-pick. После forward repair и синхронизации основной приоритет — недостающий нормальный авторизованный operator HTTP path для config-release/link/assignment под точный ZIP SHA и текущий v2. Сохранить строгую схему, ADMIN attribution, актуальную проверку полномочий внутри транзакции, conflict/duplicate checks, reason/audit и нормальную CSRF/session границу. Старый DB CLI child с null artifact SHA, SYSTEM attribution и прямой DB записью не принят; не запускать его live и не считать нормальным операторским путём. Затем B может брать C04 persistence по указанному shared-контракту без ожидания runtime child.

## Проверки и оставшиеся ограничения

Локально: A24 legacy/export/import 10 групп PASS; OpenAPI consistency PASS; docs links/coverage PASS; Firefox fixture подтверждает portless loopback, dedup, неизменные HTTPS origins, flatten imports и детерминированность архива. Это не installed/live proof. Точные новые GitHub results и final heads — /root/octoport-control/incidents/controller-audit-20260924/final-receipt.json. Прежний B receipt: B06_STORE1_CLEAN_REPAIR_EVIDENCE_2026-09-23.md; affected PostgreSQL 235 и retention 8 PASS относятся к отдельному старому clean tree 27d582d, не к новому кандидату.

## Ресурсы и публикация

Сервер: MemTotal 15988 MiB, MemAvailable при начале 13320 MiB, swap 0, memory PSI 0, свежих OOM за сутки нет; диск около 25.5 GiB и 3.7 млн inode свободны. Все 74 сохранённые supervised jobs завершены, cleanup_verified=true у всех; максимальный зарегистрированный peak около 2131 MiB. Новых браузеров/серверных стендов аудит не оставляет. Нынешний блокер — координация и релизная готовность; обоснования покупать больше 16 GB сейчас нет. После возобновления оценивать реальные перекрытия/RESOURCE_WAIT и предлагать ОЗУ при пользе, без общего single-process ограничения. Старые файлы/контейнеры/процессы не очищались.

Публичные HEAD проверки 2026-09-24 на момент аудита: api health/ready 200, app 200, octoport.ru 200; /privacy, /support, /install были 404. Содержание handoff находится в /root/octoport-control/logs/C/STORE0_PUBLIC_PAGES_HANDOFF_2026-09-23.md. После возобновления C назначил отдельную site/deploy границу от принятого main; до её проверки и отдельного разрешённого deploy эти URL остаются PREPARING. Публичный контакт поддержки подготовлен как `support@octoport.ru`; личный адрес владельца не публикуется. Карточки/ZIP ещё не считаются отправленными без фактического store receipt. Общий roadmap и Safari не блокируют раннюю подачу.

Owner actions now: **none**. Предыдущий запрос немедленного login/icon/support был преждевременным и исправлен итоговой квитанцией аудита. Минималистичная иконка с осьминогом заранее одобрена владельцем; A создаёт и использует её без нового согласования. Публичный рабочий адрес поддержки подготовлен командой как `support@octoport.ru`; личный адрес владельца публично не раскрывается. Обычный owner OTP/login запрашивается только после того, как A/C подготовили exact installed acceptance и конкретную проверку, требующую такого входа; коды, токены и содержимое почты в чат не передаются. Пакет, backend, reviewer route и public pages продолжаются без ожидания владельца.
