# Ручной режим контроллера: сохранение API-инцидентов до приёмки исправления

Основание: прямое указание владельца 2026-09-28 10:28 +05 о непосредственном участии контроллера в коде до STOP.
База: 8c273711922f8646c22be6279b128d8dd20f8c67; отдельная ветка controller/manual-api-incidents-20260928.
Пути incident.ts и incident.test.ts закреплены за контроллером через C-MANUAL-CONTROLLER-INCIDENT-OWNERSHIP-20260928-0530; C продолжает acquire/Telegram/выпуск, B — БД, A — установленную матрицу.

## Дефект и изменение

Повторное получение уже изменившегося источника даёт NO_CHANGE и пустой новый diff. Раньше evaluateApiWatchIncidents закрывал открытые API_CHANGE_BLOCKING, API_CHANGE_REVIEW_REQUIRED, RUNTIME_OPERATION_STALE и RUNTIME_MAPPING_AMBIGUOUS без приёмки исправления. Даже COMPLETED отчёт другого семейства мог закрыть проблему.

Теперь отчёт о получении документов автоматически закрывает только WATCH_RUN_FAILED и SOURCE_AUTHORITY_BLOCKED; второй — только при принятом снимке того же семейства. Операционные инциденты и исходные ссылки на дефект сохраняются. Нет ложного RESOLVED уведомления от повторного снимка или NO_ACTION mapping.

Это ограниченное исправление ложного восстановления. Оно не внедряет весь approved-baseline/release pipeline и не добавляет произвольное ручное закрытие; отдельная проверенная приёмка исправления остаётся следующим этапом архитектуры. DB/schema/migrations не менялись.

## Доказательства

До исправления новый regression: 6 FAIL / 6 PASS, именно ложное закрытие; /root/octoport-control/logs/controller/manual-api-incidents-20260928/red.log.
После исправления: весь @product/api-watch — 176/176 PASS, 10 файлов; среди них12 incident tests. Проверены4 вида операционных инцидентов, повторный снимок, NO_ACTION, другое семейство, отсутствие повторного уведомления, сохранность корректного закрытия проблем получения источников.
Prettier, ESLint и TypeScript PASS. Проверки используют изолированные/local fixtures, без внешнего провайдера, Telegram и live DB.
Supervisor: octoport-test-c-aeb347cd50a44802b3d112a66a89e061.service; exit0, OOM0, peak608MiB, cleanup verified. Node24.20.0/pnpm10.34.5; отдельная offline frozen-lockfile установка зависимостей.
Логи: /root/octoport-control/logs/controller/manual-api-incidents-20260928/. Исправление не развёрнуто; C выполняет нормальную интеграцию и проверку точного кандидата.

## Продолжение

Ручной режим остаётся RUNNING. Действия владельца откладываются в CONTROLLER_MANUAL.json; общий STOP не объявляется. Контроллер после передачи этого кандидата выбирает следующую непересекающуюся готовую часть roadmap.
