# RT-JOB-R02.1: RuntimePort на актуальном ядре

Дата: 09.11.2026. Статус: SOURCE_CANDIDATE_NOT_INSTALLED. Это продолжение платформенных PR405/PR407, а не установка старого R01 поверх работающего сервиса.

## Исходная версия и владение

Пакет `rt_job_r02/` основан на неизменённом code-only снимке установленного `alisa-ozon-subscription-access-r1-20261109`. Исходный engine SHA256: `8bf14ccbc6760970c8cdb2560e8e57d68a7167d77daacc9bfb9a4f4f71520032`; архив исходных 115 файлов: `3343552e4a758edda38456bca0bca78f2e2fce812f74cec9e611f5b42e8d29b9`. Дополнительно закреплены пять публичных файлов каталога/валидатора. Реальная конфигурация, БД, ключи и пользовательские данные в снимок не входят.

`SOURCE_SNAPSHOT.json` сохраняет хеши 120 исходных файлов. `CURRENT_CORE_MANIFEST.json` закрепляет текущий кандидат. Из прежних модулей изменены только engine, repository, runtime, retention, universal_reads, dataset_pipeline, model_usage и shared_http. Прежние тесты ядра сохранены побайтно; изменение dataset validator разрешает перенос служебной metadata `runtime_guard`, не меняя расчёт и проекцию данных.

Работа выполнена в отдельной ветке и копии. Активные пути автора матрицы/обработчика, работающие службы, native OAuth и Станция не менялись. Перед установкой нужно сверить свежий runtime: новый выпуск другого автора требует согласованного переноса delta, а не замены его файлов этим snapshot.

## Поведение

RuntimePort использует тот же configured Engine, Worker и SQLite, что native ingress. Дополнительный Unix listener обслуживает только платформенный контракт. Второго worker, очереди или модели identity нет. Feature выключена без явной настройки; `--check` проверяет форму без чтения credential и сетевых вызовов.

Execution guard переносится через готовый scalar/program, P2 с исправлением ответа модели, таблицы, dataset и универсальные чтения. Ветвь отказа typed compiler сохраняет guard при переходе к universal read. Проверки актуального scope выполняются перед фактической отправкой, в позднем callback HTTP/CSV dispatch, при публикации и выдаче. При смене mapping между последними verify/resolve сохранённый результат не выдаётся. Ticket и исходный bearer не записываются в jobs/receipts.

Модель продолжает использовать действующие model_recovery/request_recovery, CSV, единый журнал calls и окно model_usage в семь дней. Предотвращённая до dispatch попытка не считается оплаченным вызовом. Прежние суточные и количественные ограничения R01 не возвращаются; сохраняется реальная ёмкость хранилища и ограничения размера протокола.

Каждый public ref регистрирует отдельного читателя `rt_…` в существующем reader_state. Submit/status/read не перемещают голосовые указатели и не меняют чужие page/delivered. Cancel A сохраняет B; отмена последнего читателя может остановить общее задание. Состояние отменённого ref остаётся CANCELLED, даже если общий отчёт готов для B. References и receipts включены в bounded retention с защитой активных alias-chain; недельная очистка model_usage сохранена.

## Закрытый authority consumer

`PlatformAuthorityClient` вызывает настоящий `/internal/runtime/authority` через отдельно настроенный Unix HTTP socket. Проверяются владельцы/режимы пути, отсутствие symlink, SO_PEERCRED, общий deadline, Content-Length, пределы headers/body и строгий JSON. Reply должен иметь действительные nonce, product/schema, HMAC и точную форму claims/scope. Redirect, DNS/TCP, unsigned fallback, локальный permissive mapping и автоматические повторы отсутствуют. Подписанные dependency failures сохраняют свой код.

Платформа должна отдельно обслуживать этот Unix socket своей принятой версией authority. Этот пакет не открывает ей TCP-порт и не активирует route. Credential выделен только этой паре сервисов и передаётся через systemd credentials; модельный или магазинный credential отклоняется конфигурацией.

## Явная настройка после совместной приёмки

Пример формы, а не готовые имена служб/магазинов:

```json
{
  "runtime_port": {
    "enabled": true,
    "socket": "/run/alisa-runtime/runtime-port.sock",
    "allowed_user": "platform-service",
    "service_id": "qualified-platform",
    "catalog_release_id": "qualified-current-catalog",
    "authority_socket": "/run/alisa-platform/authority.sock",
    "authority_user": "platform-service",
    "authority_credential": "runtime-authority"
  }
}
```

Оператор заранее создаёт доверенный каталог listener и отдельный credential. Имена пользователей должны соответствовать настоящим OS UID. Платформа настраивает весь ожидаемый `current_versions` из принятого пакета; запоминать произвольную первую версию нельзя. Bundle hash закрепляет текущие core modules, каталоги и read-policy data; task schema остаётся прежней pinned v1. Настройка listener читается при запуске; изменения требуют штатного перезапуска. Права продукта и mapping проверяются заново при каждом обращении.

Реальные public/native mappings не выводятся из совпавшего UUID, email или названия. Они требуют подтверждённых идентичностей и revisions существующих ключей. Новые магазинные ключи и приложение Ozon для этого переноса не нужны.

## Проверки и граница приёмки

До переноса неизменённая база прошла 1533 теста в `tests/`. Полная квалификация кандидата дополнительно включает root dataset suites, прежние контрактные сценарии RuntimePort и новые reader/guard/consumer/config tests. Итоговый JSON содержит число реально выполненных проверок, отсутствие skipped/external network attempts и хеш манифеста; исходники сверяются до и после.

Дополнительная PostgreSQL квалификация выполняет прежние 43 authority checks и 9 current-core roundtrip. Здесь используется production consumer, настоящий Django signer/authority RPC, Unix HTTP, listener, очередь SQLite и worker; provider/model остаются синтетическими. Один job_ref читается и WebSession, и Alice OAuth без нового расчёта. Проверяются отзыв доступа/ключа, mapping drift, logout другой действующей сессии, естественное истечение admission ticket и повтор того же request ID. Тестовая БД, роли и контейнер удаляются после прогона.

Независимое review, source CI и авторская квалификация фиксируются раздельно. Этот этап не доказывает переключение настоящего навыка, показ отчёта в UI кабинета, фактический звук Станции или live provider/Yandex acceptance. Эти проходы выполняются после согласованной установки принятого current-core source и подтверждённой mapping-конфигурации.
