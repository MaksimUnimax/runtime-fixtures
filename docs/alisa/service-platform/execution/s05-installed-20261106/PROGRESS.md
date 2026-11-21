# S05 rollout · 6 ноября

**INSTALLED_READY_FOR_OWNER_TEST, readback 04:04 UTC.** Раздел: https://alisa.octoport.ru/app/stores. [Установленный отчёт и ручная проверка](../AL_S05_INSTALLED_REPORT_20261106.md), [независимый read-only review](../AL_S05_INSTALLED_INDEPENDENT_REVIEW_20261106.json). Реальные подключения площадок ещё не приняты.

Web/site теперь `alisa-6098b31384ae23a4`; admin/Identity `alisa-73180172646b7012` и shared current `alisa-482ed11832b666af` сохранены. Другой поток обновлял admin/Identity во время подготовки: свежие snapshots и guard не дали перезаписать его версии.

## Фактические включение и проверка

- Platform package установлен без изменения принятого payload: 4 451 файл / 42 ссылки. Venv platform-only по прежнему lock, без pip/pyc, через read-only bootstrap старого venv. [Installer R3: PASS 15](receipts/platform-install-r3.json).
- Новый exact core `/opt/alice-market/releases/20261106-store-check-6098-r1`: 74 файла, manifest SHA256 `170fc0c331b588615451c7073862f4a93b2a55729808a2d1dca642936a8af439`. На точном составе [1 035 offline PASS](receipts/integrated-core-qualification.json), без skip и внешних вызовов; unit invocation `25e18beeac7e4d2c8322fb9715666429`, 49.385 сек.
- [Core R5: PASS 25](receipts/core-activation-r5.json), invocation `ead05feae4f649aca709648c0351a02d`, 1.749 сек. Включены core release и приватный checker/socket, старые core source и gateway metadata сохранены. Platform caller UID993 получает только traverse parent и новый socket group982, не широкую alice-lab группу.
- [Platform R8: PASS 41](receipts/platform-activation-r8.json), invocation `a7b7ef3c7eeb441fbde0b78abc846612`, 9.068 сек. Только additive `stores.0001_initial`, четыре stores settings с отдельным private vault keyring, два web/site pointers и два restarts. Прежние migration rows, staff authority и остальные env сохранены. Audit UPDATE/DELETE/TRUNCATE запрещены runtime role.
- [Фактический IPC probe: PASS 6](receipts/installed-ipc-probe.json). Разрешённый platform UID993 проверен против server UID996/GID982, недоверенный UID0 закрывается до dispatch; platform не может перечислять parent или открыть старый gateway. Проверка без ключей и provider calls.
- [Авторский own-customer smoke](receipts/owned-customer-smoke.json): `NEEDS_NATIVE_CUSTOMER_LOGIN`. Прежняя сессия истекла; обычный вход требует нового действия. Email/OTP/пароль не отправлялись, обхода входа и записей магазинов нет. Create/rename/disable/delete и SSR после входа остаются ручной проверкой, без замены её CI результатами.
- [Финальный snapshot](receipts/final-installed-readback.json): четыре health READY; шесть product services active/running, публичный stores URL отдаёт 307 на login без cookie. Public GET API без cookie — 422, данных не раскрывает. Собственные четыре конечных units inactive/empty cgroups; пять существующих rollout locks свободны. Свободно 3 393 146 880 байт, 535 018 inode, MemAvailable 6 127 720 KiB, memory pressure avg10/60/300 = 0.

Seller binding flag не включён: успешный seller-info ещё не доказывает пару Client-Id/key. Performance token не доказывает тот же Seller кабинет. Старые marketplace keys не импортированы; внешних provider calls автора — 0. Foundation `RUNTIME_NOT_CONNECTED` не является заявлением о voice/report готовности и не заменяет отдельный checker IPC.

## Исправленные остановки и сохранённая история

Installer R1 остановился на истёкшем signed URL до загрузки; R2 — на физическом дисковом резерве. Оба FAILED сохранены. R3 снизил реальный footprint, резерв 3 072 MiB / 200 000 inode не уменьшался.

Дополнительное место получено только объединением одинаковых зависимостей новой неактивной версии с проверенными неактивными копиями: [143 links / 449 guards PASS](receipts/inactive-new-dependencies.json), 67 444 736 байт. Активные inode исключены, архивы и версии не удалялись. Metadata archive остаётся приватным; изменения nlink/ctime/target mtime и остаточная scan-to-link race описаны в receipt/source review.

Core R1 остановился на SQLite WAL coordination в read-only mount; отдельный конечный runner получил доступ к каталогу WAL при mode=ro/query_only соединении. Это не изменение прав продуктового worker. R2 остановился при смене чужой версии. R3 дождался service active слишком рано, остановился на ещё не созданном gateway и восстановил старый core, удалив свои unit files; новая собственная group982 оставлена и строго проверена перед повторным использованием. R4 не исполнялся: review исправил слишком широкий KeyError catch. R5 прошёл после ожидания обоих sockets.

Platform R1–R6 не исполнялись; R7 остановился до backups/DB/config/pointers на неверной проверке строкового systemd LoadCredential. R8 читает типизированный список a(ss), сохраняет пустой credential list и прошёл. Скрипты и промежуточные HOLD/FAILED review сохранены для воспроизводимости.

Private env, vault key, browser state, signed URLs и schema backup в этот каталог Git не копировались. Product/runtime/workflow source остаётся точным квалифицированным `6098b31384ae23a43fb869abd3e67f165bc644fa`. Следующий зависимый результат — обычный вход владельца, ручной сценарий магазина и отдельная квалификация Ozon binding; он не объявлен PASS заранее.
