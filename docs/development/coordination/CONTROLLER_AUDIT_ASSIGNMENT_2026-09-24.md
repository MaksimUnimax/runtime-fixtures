# Назначение контроллерской проверки 2026-09-24

Прямое поручение владельца: все A/B/C остановлены; проверить, исправить, дать отчёт и необходимые решения. Контроллер ведёт ограниченную проверку/исправление в отдельной копии. STOP остаётся до нового указания владельца.

База main: 3a0d1c94a84892e26863224b7ef462c016af2623. Снимок состояний и 6 грязных файлов с hashes: /root/octoport-control/incidents/controller-audit-20260924/snapshot.json. Активных серверных Codex не найдено.

Разрешённые границы: интеграционная сверка точных C a5fd724 и A0755f7c; B-авторские исправления dfdd6314/7f58a38/b9b8e718 без разрушительного merge/revert B08a21f9 и без дубля общего контракта d14e65f; canonical generated OpenAPI. Четыре C04 shared no-session файла проверяются и сохраняются как отдельный законченный контракт; notification/runtime child остаётся отдельной будущей интеграцией C. Два Firefox checkpoint файла A проверяются и доводятся до законченного исправления host patterns. Новых DB/migrations и live-операций это назначение не создаёт.

Пути: код и проверки точных перечисленных коммитов; apps/health-runner/src/{h2.ts,no-session-contracts.ts}; packages/server/health/src/{index.ts,no-session.ts}; tooling/build/extension_firefox.py; tests/regression/extension-core/firefox-package-contract.mjs; packages/contracts/openapi/openapi.json; профильные receipts и docs/development/coordination. Небольшая проверка/исправление правил координации допускается только для устранения обнаруженного повторяющегося deadlock, без ослабления guard/CI/STOP.

Кандидат передаётся через единственную границу C после точных проверок. Незакоммиченные файлы потоков не перезаписываются: сначала сохранённые checkpoints, проверка hashes и перенос принятого смысла; никакого reset/clean/force. Рабочие состояния/ветки/входящие обновляются только с конкретным review receipt. Внешняя публикация и её минимум проверяются по STORE_POLICY; production/расширение набора не выполняются.

## Уточнение границы: потребитель admin API

При проверке B b9b8e718 воспроизведено чтением строгой схемы: admin UI не посылает обязательный contractVersion; BFF не допускает добавленный POST releases/:version/publish. Назначаю ограниченное исправление apps/admin/app/admin-ui.tsx, apps/admin/lib/{admin-ui.test.ts,control-plane-route.ts,control-plane-route.test.ts}. Сохранить существующий v1 по умолчанию, предоставить явный выбор v2, разрешить только точный новый маршрут с допустимой версией. Сессии, роли и CSRF не менять. Проверки доказывают совместимость тела с API и точную границу proxy.

CI показал два устаревших exact-surface ожидания после добавления release HTTP: apps/api/src/admin-ops-routes.test.ts и apps/api/src/openapi.test.ts. В scope включено обновление перечня на один уже авторизованный POST release маршрут и соответствующей точной арифметики, без ослабления проверок или изменения других endpoints.

Та же exact API arithmetic найдена в tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts; включена в то же согласование surface.
