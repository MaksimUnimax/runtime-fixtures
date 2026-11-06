# S05 · продолжение проверки ключей

**SOURCE_IMPLEMENTED_QUALIFICATION_PENDING_NOT_INSTALLED.** Продолжение по команде владельца «Ты завис, продолжай». База ветки feat/alisa-stores-v05 — f3b612f84297bd68dbffe06af485cd0f1ea04fe6, предыдущий принятый platform package efa6 сохранён. Новый scope: только runtime-side RT-CHECK module/package/tests, узкий shared HTTP extraction patch и безопасный PROVIDER_PLAN_REQUIRED result для HTTP402 в platform/client UI. Реальные core Engine/SQLite/matrix/gateway, Identity/staff/домены и чужие active paths не меняются.

Scratch-копия была удалена обслуживанием среды. Восстановлена из GitHub; pinned RT-JOB-R01 архив восстановлен из существующего Library файла и проверен по SHA256 d5db0d7220048af0cea155e80a4af638ec4e60d21a5c07baf685bd14a40341d3. Оригинал сохранён. Он используется только как baseline fixture, не как замена текущего работающего ядра.

## Реализовано

[Runtime-side source](../../runtime/v0.11/rt_check_r01/README.md): strict peer-bound Unix handler, одноразовый subprocess на запрос с secret только stdin, максимум два запроса, kill/reap по deadline, no redirects/proxies, TLS verification. Новый HTTP primitive используется checker и pinned patch старого транспорта; analytical guards/recipes/decoder не обходятся и не дублируются. На рабочем core patch не применён.

WB получает identity только из authenticated seller-info sid. Для Seller найден read-only seller-info и известные auth/role errors, но связь header Client-Id с canonical seller_id требует отдельной квалификации: promotion по умолчанию запрещён. У Performance token exchange не доказывает принадлежность Seller кабинету; promotion запрещён. Это не фиктивные CONNECTED.

Независимый research reviewer s05_transport_review проверил первичные WB/Ozon источники. Сохраняется неоднозначность Seller binding и отсутствие Performance crosswalk. Не используются компания/ИНН/ОГРН, имя или непроверенный JWT как доказательство кабинета. HTTP402 получает отдельный код, без оплаты или покупки со стороны сервиса.

## Проверка и блокеры

Локально настоящие loopback TLS проверки прошли; полный qualifier дал 16 PASS и 5 ERROR при попытке создать AF_UNIX socket: среда вернула PermissionError/EPERM. Это не объявлено PASS и не обойдено снятием peer check. Native Unix и полный pinned baseline направлены в существующий изолированный GitHub CI. Assertions/таймауты не ослабляются; исходный локальный FAILED receipt сохранён.

На 06.11.2026 Remote Desktop Commander сообщает Alisa Offline, последний контакт около трёх часов назад; Easyscript и другой зарегистрированный сервер тоже offline. Не удалось получить свежий host/core snapshot или выполнить установку. Нужен запуск/восстановление Desktop Commander Remote на Alisa. Пользователь ранее уже разрешил работу на основном домене; повторное разрешение на тот же scope не запрашивается. Зависимая установка ждёт связи, подготовка и квалификация исходника продолжаются.

Следующий шаг: exact SOURCE review, CI/пакет; после восстановления устройства — свежий source/pointer/resource readback, согласованное rebasing shared HTTP patch к фактическому core, peer/service permissions, квалификация Seller binding и разрешённые real-key checks через собственный кабинет. Общая live/installed готовность S05 не заявлена.
