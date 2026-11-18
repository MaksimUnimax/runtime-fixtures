# Harness API — результат развёртывания 18 ноября 2026

## Состояние

**Опубликовано и включено:** https://alisa.octoport.ru/harness/

Четыре прежних адреса на openscript.ru — `/harness`, `/harness/`, `/harness-dev`, `/harness-dev/` — возвращают 303 на этот фиксированный URL. Запросы записи к старым prefix endpoints прекращены с 410, без пересылки или повторного выполнения. Старые containers, файлы, профили браузеров и Web история сохранены; в API историю они не импортировались.

| Компонент | Зафиксированное состояние |
| --- | --- |
| Source commit приложения | `5431873d9d167bdb5c372e9c00b91079a50eec7b` |
| Ветка | `feature/harness-deepseek-api-20261118` |
| Путь в репозитории | `integrations/harness-api` |
| Active release | `/opt/octoport-harness-api/releases/api-20261118-5431873d9d16` |
| Текущая ссылка | `/opt/octoport-harness-api/current` |
| Engine | `octoport-harness-engine.service`, active/running, enabled |
| Gateway | `octoport-harness-gateway.service`, active/running, enabled |
| Harness | Настоящий установленный `@deepseek-ai/dsh` **0.2.2-rc.1** |
| Default provider/model | `octoport-templates` / `alisa-matrix` |
| Каталог | **90** шаблонов установленной Алисы |
| Catalog hash | `b9352169fed63d5bd74414e6539f05f6a996f5a9e2a07303a8f6786e42c4732e` |

Все **46 исходных файлов** active release проверены по SHA256 в `SOURCE.json`; независимая проверка подтвердила совпадение. Данный документ добавлен отдельным documentation commit после установки; исполняемый source commit указан выше.

## Рабочий путь запроса

Существующий аккаунт Octoport → чат Harness → прежний DeepSeek selector Алисы → зарегистрированный шаблон → разрешённый API магазина → штатный обработчик и расчёт → текст Harness → браузерное озвучивание.

Первый модельный этап сохранён как фильтр выбора шаблонов. К нему не добавляется отдельный агентный LLM-вызов. Финальный DeepSeek не вызывается: результат формируется детерминированными обработчиками, а запрещённые финальные модельные операции блокируются транспортом отдельного gateway process.

Каталог, qualifications, store permissions, selector serialization, native compiler, runtime authority и parameter RPC используются из существующих серверных источников. Фактическая production policy проверена: `layout=catalog_prefix_v2`, `isolation=tenant_v1`.

Поддерживаются scalar, event, dataset, information, parameter, parameterized и economics paths. Расчётные дополнения закрывают те зарегистрированные вычисления, которые раньше выполняла финальная модель. Общие проценты вычисляются из исходных величин. Разные валюты и несовместимые определения сумм не складываются. Большой dataset показывает первые 100 строк и ссылку на полный результат с повторной проверкой владельца и прав.

## Вход и рабочий ключ

Вход выполняется через штатный аккаунт Алисы на том же HTTPS origin. Gateway проверяет `__Host-alisa_session` через исходный platform account code. Actor и tenant не принимаются из запроса клиента. История принадлежит сочетанию customer/tenant; доступ к магазинам подтверждается действующей authority.

`/harness/login` направляет на существующий `/login` и устанавливает краткоживущий Secure/HttpOnly/SameSite=Lax marker только для возврата. После обычного callback `/app` открывает `/harness/`; без marker native `/app` сохраняет прежний маршрут. Marker не авторизует запросы.

Рабочий DeepSeek key читается по умолчанию из исходного `/var/lib/alice-lab/secrets/deepseek.key` через systemd `LoadCredential`. Официальный Harness provider получает тот же серверный key; основной provider остаётся матрицей. Пользователь не вводит и не выбирает ключ. Его значение не включено в этот отчёт, репозиторий, frontend или историю сообщений.

Служебный bridge credential находится в root-owned файле 0600; оба state directories имеют 0700. UI выполняет только same-origin API-запросы. Внешние записи требуют точного Origin; внутренний execution endpoint остаётся на loopback.

## Реальный DeepSeek и кэш

За время проверки выполнены **два реальных selector API-вызова** существующим ключом. Marketplace ответы и account scope в этой проверке были строго синтетическими; production user session и account DB не использовались.

| Вызов | Prompt tokens | Completion tokens | Cache hit tokens | Cache miss tokens |
| --- | ---: | ---: | ---: | ---: |
| Первый | 14 814 | 125 | 0 | 14 814 |
| Повтор с прогретым prefix | 14 814 | 114 | 14 592 | 222 |

Во втором вызове **98,5% входных токенов** обслужены кэшем. Это измеренная доля cache hit этого запроса, а не обещание такого процента экономии для любого вопроса или всего счёта.

В обоих случаях selector выбрал `B01.ordered_units`, родной Ozon decoder обработал сырой fixture response, direct renderer вернул тестовое количество **17**. Это тестовые цифры, не данные магазина владельца. Измерено: selector calls = 1, final model calls = 0; повтор admission не вызвал новый dispatch.

Остальные тесты не выполняли оплачиваемых модельных вызовов. Missing/inconsistent usage остаётся неизвестным (`usage: null`), не подменяется нулевым расходом и не уничтожает готовый ответ.

## Проверки

| Уровень | Итог и предел доказательства |
| --- | --- |
| Backend | **26/26 PASS**, включая native RuntimePort/Worker/decoder, session/tenant isolation, Origin, повтор, отзыв доступа, уточнения, восстановление чтения после restart, I/O thread context, usage uncertainty |
| Renderer | **21/21 PASS** на установленном core: зарегистрированные расчёты, 3 000 строк, joins/coverage, unknown vs zero, currencies, взвешенный общий ДРР |
| Platform patch / installer | **15/15 PASS**, original source preservation, native query guards, ORM filter before limit, подготовка и rollback conditions |
| Реальный Harness engine | **13/13 PASS, 0 skipped**, exact rc.1, owner/history/job persistence, точный ответ каждого receipt, symlink entrypoint, clean shutdown |
| Синтетический браузер | **10 сценариев PASS**: anonymous screen, double submit, XSS/table/report links, history reload, desktop/mobile viewport, lost send receipt, interrupted job, navigation race, logout race, JS errors |
| Живой браузер | Anonymous UI загрузился с настоящим API401; кнопка открыла `/login`; Secure/HttpOnly return marker и `/app` →303 в чат проверены; JS errors = 0 |
| Live HTTPS с другого сервера | `/harness/`200, api/me401, foreign Origin403, private execution paths404, login303, fixed return303, все старые ссылки303 |
| Live службы | Engine и gateway active/running, enabled, health200; default key configured; 90 templates; на финальной проверке active_jobs=0 |
| Source verification | 46/46 hashes совпали, включая повторную независимую проверку опубликованного release |

Итого **75 Python/Node тестов** и **10 синтетических браузерных сценариев**, плюс описанные live HTTP/browser/API checks. Viewport 390px проверяет адаптивность, но не является проверкой физического телефона владельца.

Во время первоначального service bootstrap обнаружено, что Node разрешает `current` symlink в `import.meta.url`, тогда как argv содержит ссылочный путь. Исправлено сравнением реальных путей; отдельный процессный тест проверяет запуск через symlink, путь с пробелами, health200 и SIGTERM exit0. В production установлен исправленный commit.

**Не выполнялись:** вход под настоящим пользовательским аккаунтом, получение OTP/письма, использование сохранённой пользовательской сессии, запрос к настоящему marketplace от имени владельца, проверка микрофона и звука на его физическом устройстве. Эти уровни не объявляются пройденными. Обычный пользовательский вход и подключённые к нему магазины используются при работе опубликованного чата; обхода входа не добавлено.

## Сосуществование с Алисой

Отдельная очередь Harness требует genuine WEB Query metadata receipts для исходных parameter/economics RPC. Native platform теперь использует минимальный overlay `/opt/alisa-platform/stage/releases/alisa-harness-query-20261118-v1`.

Guard исключает marker `harness_runtime_v1` из native list/read/recover/clarify/cancel до runtime dispatch. Сохраняются исходные owner, principal, TTL, proof и store checks; схема БД не менялась. QueryService SHA256: `ff7596001a538306133b5d26053c6e8e056a0278de6ea6fe039f2b62bc571f0e`.

Проверены active состояния `alice-market.service`, `alisa-platform@stage.service`, `alisa-runtime-authority-stage.service`, `alisa-web@stage.service`. Core voice, authority и web releases не переключались. Platform `/health/ready` вернул READY с новым release; его поле `runtime=RUNTIME_NOT_CONNECTED` совпадало с исходным состоянием до работ и не используется как доказательство выполнения business request.

## Эксплуатация и откат

Подробный порядок находится в [deploy/OPERATIONS.md](deploy/OPERATIONS.md), guard — в [deploy/PLATFORM_QUERY_OVERLAY.md](deploy/PLATFORM_QUERY_OVERLAY.md).

На Alisa сохранены:

- `/root/octoport-harness-deploy-20261118/` — nginx before/candidate, activation state и final check;
- `/root/alisa-harness-query-20261118-v1-plan/` — source hashes, drop-in, activation record и guarded rollback;
- предыдущий application release `api-20261118-deff25e583b2`.

На server80 сохранён `/root/octoport-harness-api-redirect-20261118/` с original nginx, новой конфигурацией и хешами. Обе nginx configuration проверки прошли до reload.

Откат UI/engine/gateway сохраняет native guard, пока есть unexpired Harness receipts; иначе появился бы путь к повторному native исполнению. Состояние и receipts не удаляются. Неизвестный исход после рестарта автоматически не переисполняется. Смена ключа, configuration snapshot или pinned core требует обновления соответствующей привязки и перезапуска services вне активного запроса.
