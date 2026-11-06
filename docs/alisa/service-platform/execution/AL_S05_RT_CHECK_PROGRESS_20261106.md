# S05 · продолжение проверки ключей

**Итог 06.11, 04:04 UTC: INSTALLED_READY_FOR_OWNER_TEST.** Раздел магазинов включён на основном сайте, web/API 6098; admin/Identity 731 сохранены. Точный интегрированный core — 1 035 offline checks; установленный core/platform — 25/41 PASS и IPC — 6 PASS. Authenticated customer smoke остановился на необходимости обычного входа, реальные кабинеты площадок не подтверждены. [Актуальный установленный отчёт](AL_S05_INSTALLED_REPORT_20261106.md). Дальнейший текст — история подготовки, а не текущий статус активации.

**SOURCE_PACKAGE_QUALIFIED_CURRENT_CORE_PATCH_READY_NOT_ACTIVATED.** Продолжение по команде владельца «Ты завис, продолжай». База ветки feat/alisa-stores-v05 — f3b612f84297bd68dbffe06af485cd0f1ea04fe6, предыдущий принятый platform package efa6 сохранён. Новый scope: только runtime-side RT-CHECK module/package/tests, узкий shared HTTP extraction patch и безопасный PROVIDER_PLAN_REQUIRED result для HTTP402 в platform/client UI. Реальные core Engine/SQLite/matrix/gateway, Identity/staff/домены и чужие active paths не меняются.

Scratch-копия была удалена обслуживанием среды. Восстановлена из GitHub; pinned RT-JOB-R01 архив восстановлен из существующего Library файла и проверен по SHA256 d5db0d7220048af0cea155e80a4af638ec4e60d21a5c07baf685bd14a40341d3. Оригинал сохранён. Он используется только как baseline fixture, не как замена текущего работающего ядра.

## Реализовано

[Runtime-side source](../../runtime/v0.11/rt_check_r01/README.md): strict peer-bound Unix handler, одноразовый subprocess на запрос с secret только stdin, максимум два запроса, kill/reap по deadline, no redirects/proxies, TLS verification. Новый HTTP primitive используется checker и pinned patch старого транспорта; analytical guards/recipes/decoder не обходятся и не дублируются. На рабочем core patch не применён.

WB получает identity только из authenticated seller-info sid. Для Seller найден read-only seller-info и известные auth/role errors, но связь header Client-Id с canonical seller_id требует отдельной квалификации: promotion по умолчанию запрещён. У Performance token exchange не доказывает принадлежность Seller кабинету; promotion запрещён. Это не фиктивные CONNECTED.

Независимый research reviewer s05_transport_review проверил первичные WB/Ozon источники. Сохраняется неоднозначность Seller binding и отсутствие Performance crosswalk. Не используются компания/ИНН/ОГРН, имя или непроверенный JWT как доказательство кабинета. HTTP402 получает отдельный код, без оплаты или покупки со стороны сервиса.

## Проверка и блокеры

Локально настоящие loopback TLS проверки прошли; полный qualifier дал 16 PASS и 5 ERROR при попытке создать AF_UNIX socket: среда вернула PermissionError/EPERM. Это не объявлено PASS и не обойдено снятием peer check. Native Unix и полный pinned baseline направлены в существующий изолированный GitHub CI. Assertions/таймауты не ослабляются; исходный локальный FAILED receipt сохранён.

Первый запрос 06.11.2026 вернул Alisa Offline; это сохранённая причина первоначальной задержки. При повторной проверке устройство стало Online. Свежий readback: site/current c8666516683e7b2b, identity-current 482ed11832b666af, alice-market current WorkingDirectory 20261105-v010-number-reason-r1. Службы active; нового store-check.sock нет. Каталог /run/alice-market принадлежит runtime UID996 и имеет 0750, platform UID993 не включён в широкую alice-lab группу. HTTP transport SHA256 c5bef1600d8f70449c908c8abd974d358d18cb74243df4d5683c7c228000ba2f отличается от R01; старый patch не применяется. Свободно 3829035008 bytes и 582986 inodes, MemAvailable 6217644 KiB. Никакие host files пока не изменены. Пользователь уже разрешил основной домен; повторное разрешение на тот же scope не запрашивается.

Следующий шаг: exact SOURCE review, CI/пакет; после восстановления устройства — свежий source/pointer/resource readback, согласованное rebasing shared HTTP patch к фактическому core, peer/service permissions, квалификация Seller binding и разрешённые real-key checks через собственный кабинет. Общая live/installed готовность S05 не заявлена.

Независимый source review R1 сохранён с замечаниями. Исправление R2: WB403 остаётся CHECK_UNAVAILABLE без выдуманного scope; обе стороны отвергают group/world-writable socket parent; добавлены проверки отсутствия dispatch/secret при этих правах. Seller проверяет minimum response shape; default promotion остаётся выключенным. Первый CI на 2c57 уже прошёл runtime qualification, pinned 800-test replay, source/UI, native S03/S04/S05, browser и BFF; до завершения остальных шагов общий PASS не заявлен.

Финал подготовки 06.11: exact 6098, CI 42148492021 / 42148492013 SUCCESS; SOURCE review R3 принят. Runtime — 24 PASS в CI и на Alisa; platform S05 PostgreSQL — 40 PASS; prepared current-core patch прошёл 1 035 авторских offline-проверок в отдельной копии. См. [актуальную передачу](AL_S05_RT_CHECK_CURRENT_HANDOFF_20261106.md). Это не активация S05 и не реальные подключённые площадки.
