# Приёмка базы параллельной разработки — 2026-09-23

Решение: **GO_FOR_PARALLEL_DEVELOPMENT**. Готовность к продуктовому выпуску: **BLOCKED**, до выполнения критериев [PLAN.md](PLAN.md).

Проверенный кандидат до добавления этого документа: `f43e30b8aab49244d6c7a8f219f1c879d6e763b0`. Последующий коммит приёмки изменяет только документацию. Точный опубликованный HEAD и предыдущая main связываются записью `/root/octoport-control/main-ready.json` и проверкой удалённой main после push.

| Проверка | Проверенный SHA | Результат |
| --- | --- | --- |
| [Server CI](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/35820301612) | `d911ece078aadeb72ee23d96ad951a529c85d9df` | SUCCESS: lint, format, types, 2121 unit-тест, 1622 integration-теста в 52 файлах, миграции, OpenAPI, bridge guard, build, 195 E2E |
| [Extension CI](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/35819590621) | `69064b835e0a62b20ed44784be73cfbb1e57c3b1` | SUCCESS: все 5 jobs, включая common app Chromium и WB browser baseline |
| [Coordination and release safety](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/35821237310) | `f43e30b8aab49244d6c7a8f219f1c879d6e763b0` | SUCCESS: управление потоками и отказ небезопасного legacy выпуска |

Эквивалентность проверяется по Git diff, а не по близости SHA: после Server CI менялись только coordination docs/tests; после Extension CI — coordination docs/tools, server workflow и API-watch test fixtures, без изменения исходников/сборки расширения и общих зависимостей. После последнего coordination CI меняется только документация приёмки. Новый push main может запустить повторный CI; до его завершения нельзя приписывать ему результат предыдущего запуска.

Локально дополнительно проверены ссылки/покрытие требований документации, чистота diff, сохранение исходных SQL и продуктового migration prefix. Подробности и найденные дефекты — в [BASELINE_2026-09-23.md](BASELINE_2026-09-23.md).

Сохранены история старой main, продуктовая линия, R5 checkpoint и monitoring/Stream-2. Незакоммиченные R5 изменения сохранены отдельным NOT_ACCEPTED checkpoint. Прежние рабочие копии не переключались; для новой разработки используются только три назначенные копии из [README.md](README.md).

A/B/C начинают в READY, с задач A01/B01/C00. Таймер контроля начинается при фактическом start диалога. Каждый поток может запускать собственный Codex только на gpt-6-luna через Luna-only runner; глобальные профили и старые интерактивные сессии не менялись.

Эта приёмка не закрывает R5 Opera, полный browser acceptance, MV3 resume, legacy monitoring DB reconciliation, live SMTP, реальное recovery и полноценный release validator. Их владельцы и критерии включены в PLAN.md. Production и live БД не изменялись; сайт/SEO вне этой работы.
