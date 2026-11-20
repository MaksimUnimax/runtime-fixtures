# Установка и восстановление Harness API

Целевая машина — Alisa. Публичный origin `https://alisa.octoport.ru`, маршрут `/harness/`.
Все команды выполняются серверным администратором. Значения credentials не входят в release.

## Проверяемые источники

Развёртывать отдельный каталог `/opt/octoport-harness-api/releases/<release>`, содержащий эти исходники и `SOURCE.json` с Git commit и SHA256 файлов. `current` меняется атомарной заменой symlink. Перед переключением сверить manifest; старый каталог сохранить.

Используются Node 24 и точный Harness `0.2.2-rc.1`. Для воспроизводимого восстановления скопировать `runtime-package.json` и `runtime-package-lock.json` в отдельный `/opt/octoport-harness-api/runtime` как `package.json` и `package-lock.json`; выполнить там `npm ci --ignore-scripts --no-audit --no-fund`. Нельзя заменять lock обновлением до произвольных latest dependencies.

Исходное ядро Алисы фиксируется в unit на проверенный release. Native platform isolation подготавливается через `install_platform_overlay.py`; порядок проверки и отката описан в `PLATFORM_QUERY_OVERLAY.md`. Authority, веб и voice service при этом не переключаются.

## Службы

Сохранить существующие unit files и symlink, если они есть. Создать отдельный случайный credential `/etc/octoport-harness/bridge.key` длиной не менее 32 символов с владельцем root и правами 0600, каталог 0700. Не печатать credential и не включать его в manifests.

Создать `/etc/octoport-harness/developer-principals.json` с владельцем root и правами 0600. Начальное значение без разработчиков: `{"schema":"octoport-developer-principals/v1","principals":[]}`. Проверенные пары actor/tenant добавляются только в приватный файл по схеме `MULTIUSER.md`. Gateway получает его как `LoadCredential=developer_principals`; изменение файла применяется после перезапуска gateway. Не печатать реальные идентификаторы в отчёт выпуска.

В `octoport-harness-gateway.service.in` заменить:

| Placeholder | Значение |
| --- | --- |
| `@@PLATFORM@@` | Полный путь к проверенному native platform overlay |
| `@@PLATFORM_NAME@@` | Имя этого каталога |
| `@@CORE@@` | Полный путь к проверенному исходному ядру Алисы |

Установить два unit files в `/etc/systemd/system/`, выполнить `systemd-analyze verify`, `systemctl daemon-reload`. Сначала запустить engine и gateway без изменения публичного nginx. Проверить `/health` на loopback 18132 и 18131. Gateway должен загрузить каталог, а engine — сообщить точную версию Harness и наличие default key. Значение ключа не возвращается.

Gateway использует те же platform EnvironmentFiles, а также обязательные `ALISA_OWNER_PARAMETERS_ENABLED=1` и `ALISA_OWNER_PARAMETER_COLLECTION_ENABLED=1`. Systemd загружает существующие DeepSeek, Ozon, WB и configuration credentials через `LoadCredential`; права исходных файлов не изменяются. Состояние принадлежит `alisa-platform-stage` в отдельных каталогах `/var/lib/octoport-harness-engine` и `/var/lib/octoport-harness-gateway` с правами 0700.

После проверки loopback активировать подготовленный native QueryService overlay. До и после проверить `/health/live` и `/health/ready` platform на 18102, effective `WorkingDirectory`, активность native voice, web и authority. Изменяется только platform process; миграций нет.

## Публичный маршрут

Сохранить резервную копию `/etc/nginx/sites-available/alisa-platform-stage.conf`. В первый TLS server с `server_name alisa.octoport.ru` включить `nginx-harness.conf` как `/etc/nginx/octoport-harness-location.conf`. Выполнить `nginx -t` до reload.

Проверить через HTTPS:

- `/harness/` и assets с `?v=api-r2` — 200;
- `/harness/api/me` без сессии и с несуществующей сессией — 401;
- POST с чужим Origin — 403;
- `/harness/login` — 303 в существующий `/login` с фиксированным marker cookie;
- `/app` с marker — 303 в `/harness/`, без marker сохраняет обычное поведение;
- внутренний execution endpoint не доступен через публичный `/harness/`;
- `/login` и обычный сайт Алисы продолжают работать.

Только после этих проверок перенаправлять прежние `/harness` и `/harness-dev` на openscript.ru на новый фиксированный HTTPS URL. Старые containers, releases, browser profiles и histories сохранять. Старая Web история не импортируется в новый API runtime.

## Проверки кода

```bash
python3 -m unittest discover -s backend/tests -v
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m unittest discover -s deploy/tests -v
HARNESS_NODE_MODULES=/opt/octoport-harness-api/runtime/node_modules node --test engine/tests/*.test.mjs
```

Для Python tests указать `ALISA_CORE_ROOT` на проверенное ядро. Engine suite должен проходить на установленном Harness без skipped. `tests/ui.cjs` требует Playwright и Chromium; использует только синтетический API. Не подключать к этому тесту действующие browser profiles.

`backend/runtime_smoke.py --core-root <core>` выполняет isolated fixture test. Флаг `--live-selector --credentials-directory <directory>` делает один реальный оплачиваемый вызов selector; marketplace остаётся строго synthetic. Отчёт обязан различать эти уровни доказательств. Тест не создаёт login session и не использует реальные магазины.

## Откат

При неудачном первом запуске остановить только новые `octoport-harness-gateway.service` и `octoport-harness-engine.service`; не менять native voice/authority. Восстановить сохранённый nginx file, проверить `nginx -t`, затем reload. Восстановить предыдущие units/current, если они существовали. Состояние и receipts не удалять.

После любого принятого Harness запроса сохранить native QueryService guard при откате UI, engine и gateway. Возврат к исходному platform release без guard разрешён только после остановки Harness gateway и read-only подтверждения, что нет Query с `continuation__has_key='harness_runtime_v1'` и `expires_at > timezone.now()`. Иначе marker receipts снова появятся в native истории и смогут попасть в native read/recover. Пока такие записи живы, оставить guard в выбранном rollback release; дождаться обычного TTL/retention, не удалять и не переписывать receipts. После нулевого результата проверки (либо до любого принятого Harness трафика) native platform override можно откатить по plan с проверкой SHA256, удалив только добавленный Harness drop-in.

При обновлении не перезапускать сервисы во время активного запроса. После неожиданного рестарта сомнительный исход не исполняется автоматически ещё раз. Готовая история и авторизованные отчёты доступны после нового входа; новую реплику пользователь отправляет явно.

При смене рабочего DeepSeek key, конфигурации или matrix release обновить серверный source и перезапустить соответствующие Harness services: `LoadCredential` создаёт snapshot на старте. Не переносить key в frontend или Git.

## Обновление плагинов и UI

Модули устанавливаются в `engine/plugins/installed/` внутри неизменяемого release; каталоги и код не должны быть group/world writable. Проверить SHA256 entry каждого manifest. Обновление не должно менять пользовательские preferences в engine state. Диспетчер всегда включён; matrix по умолчанию включён; dev-meter доступен только private allowlist.

Проверить загрузку native theme/mark, отсутствие voice controls, короткий ответ с подробностями, отдельные настройки аккаунта/чата и скрытие счётчика для обычных пользователей. Для счётчика проверить реальные token receipts, исходную цену и FX quote, unknown вместо ложного нуля на отсутствующей квитанции и отсутствие повторного списания при polling/reload.

После сохранения private developer-команд rollback engine должен сохранять capability/enablement projection и скрытие служебной истории. Pre-plugin engine из первого выпуска этих проверок не имеет и не является безопасной целью полного отката после приёма новых private запросов. При необходимости откатить интерфейс сохранять новую авторизацию/проекции либо подготовить проверенный исправляющий release; сами histories не удалять.
