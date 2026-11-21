# Алиса: Swagger Watch

Scope, 08.11.2026: прямое поручение владельца — получение и мониторинг Swagger по аналогии с health Октопорта, без мониторинга ИИ. Это ранняя инфраструктурная часть AL-S16, необходимая для текущего AL-S05; весь AL-S16 этим не закрывается.

Автор этого изменения владеет только `products/alisa/services/swagger-watch/`, отдельным workflow сборки и своим execution report. Матрица, runtime recipes, работающие website/API/Identity/admin и существующий Easyscript health не редактируются. Повторно используются загрузчик, registry, semantic inventory и diff из `tooling/api-watch`; общая реализация не копируется и не меняется.

Сервис получает только официальные публичные OpenAPI: Ozon Seller, Ozon Performance и 13 WB YAML. Нет токенов площадок, БД клиентов, Telegram-токенов, аккаунтов ИИ или LLM runner. Новые документы сохраняются по SHA256 и сравниваются с предыдущими. Это обновление локальной документации; код площадок/матрица/развёртывание автоматически не меняются.

Недоступность сайта документации сохраняет прежний снимок и показывает блокировку. Файл, переданный владельцем, остаётся отдельным кандидатом до явного review; его импорт не считается успешной автоматической загрузкой. HTTP/обычный браузер на обоих серверах не преодолевают текущую защиту Ozon, поэтому обещать полностью автоматический доступ при 403/redirect loop нельзя.

Реализация и установленная проверка описываются в execution report; README не является объявлением готовности.

Единственная административная точка входа — `/opt/alisa-swagger-watch/current/entry.sh`. Она сериализует **все** изменения (`run`, `import`, `accept-reviewed`) через один native flock; занятый lock возвращает exit 75. Прямой `node cli.mjs` для изменения запрещён и отвергается без маркера launcher. `status`/`serve` только читают, не блокируют длительную загрузку и заново вычисляют возраст данных. Административный UID уже может менять свои файлы; маркер — защита от случайного запуска без launcher, не новый механизм аутентификации.

Примеры от имени `alisa-swagger-watch` (клиентского HTTP upload/approval нет):

```sh
/opt/alisa-swagger-watch/current/entry.sh status
/opt/alisa-swagger-watch/current/entry.sh run
/opt/alisa-swagger-watch/current/entry.sh import OZON_PERFORMANCE /path/to/public-swagger.json
/opt/alisa-swagger-watch/current/entry.sh accept-reviewed OZON_PERFORMANCE EXACT_REVIEWED_SHA256
```

Последняя команда допускается только после review именно указанного digest. Она отмечает документ `OWNER_SUPPLIED_REVIEWED` и не устанавливает дату успешной автоматической загрузки. Импорт/approval нельзя запускать из systemd watcher или путём HTTP-запроса.
