# Ревью runtime-fixtures — 15 октября 2026

Проверен `main` **`109ce9df6145f680dd68687648de9cfb9f64f3b3`**. Сравнение с предыдущим ревью: `1691d7c0371a22d34126943248a937040e8e1dd1`, 62 изменённых файла. Удалённый `main` повторно сверён перед публикацией. Дата отчёта — Asia/Qyzylorda.

**Результат: три открытых P2 и один P3. Все шесть точных дефектов предыдущего отчёта исправлены на уровне SOURCE / независимых воспроизведений.** Три P2 ниже относятся к разным границам WB handoff: представлению размера в PostgreSQL, продолжению проверки после загрузки и созданию следующего запроса. Исправление одной из них не закрывает остальные.

Это ревью кода и локальные проверки в облачной копии. Продуктовый код, тесты, lockfile, `main`, рабочий сервер и его БД не менялись. В GitHub публикуется только этот Markdown отдельной веткой. Новое для отчёта замечание не обязательно является регрессией последнего merge: отсутствие wiring и преобразования bigint существовало раньше; новый `ensureRequest` проверен вместе с реальными потребителями.

## 1. [P2] Нормализовать bigint-размер артефакта при чтении из PostgreSQL

Места: [swagger-handoff.ts:374–389](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/packages/server/monitoring-control/src/swagger-handoff.ts#L374-L389), [authority.ts:485–489](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/tooling/api-watch/src/authority.ts#L485-L489), [SQL bigint](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/packages/server/db/drizzle/0039_s2_tg3_operator_swagger_handoff.sql#L26).

`swagger_source_artifacts.size_bytes` имеет тип `bigint`. Настоящий PostgreSQL runtime возвращает его строкой, а `mapArtifact()` распространяет `row` без преобразования размера. Объявленный TypeScript-тип `number` этого не меняет. `evaluateOperatorCandidate()` затем сравнивает `bytes.byteLength !== candidate.sizeBytes` и отклоняет корректный файл.

Независимая проверка использует настоящий Telegram handler, `createSwaggerHandoffService`, `validateWbBundleUpload`, файловое сохранение, полный синтетический bundle 13/13 и настоящий PostgreSQL store. Тот же файл и валидатор дают:

```json
{"backend":"memory","persistedSize":4494,"persistedType":"number","actualBytes":4494,"evaluation":"AUTHORITY_ACCEPTED","acceptedDocuments":13}
{"backend":"postgres","persistedSize":"4494","persistedType":"string","actualBytes":4494,"evaluation":"AUTHORITY_REJECTED","reason":"CANDIDATE_SIZE_MISMATCH"}
```

Успешная регистрация и статус `CANDIDATE_READY` в PostgreSQL не доказывают последующее принятие source authority. Отклонение происходит до разбора 13 YAML, поэтому оно не вызвано содержимым бандла.

**Последствие:** зарегистрированный корректный операторский источник нельзя принять через настоящий DB-backed evaluator. Проверки только in-memory эту границу пропускают.

**Исправление:** преобразовывать размер в проверенное безопасное целое в SQL-проекции или mapper, с проверкой диапазона/лимита. Сохранить строгие проверки размера и SHA; не заменять их нестрогим сравнением. Нужен native PG regression upload → readback → evaluate, включая неверный размер и digest.

## 2. [P2] Подключить загруженный WB-бандл к рабочему API Watch

Места: [возврат Telegram handler после upload](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/apps/telegram-operator/src/telegram.ts#L223-L240), [main wiring](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/apps/telegram-operator/src/main.ts#L76-L105), [report acquisition](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/tooling/api-watch/src/run.ts#L573-L595), [scheduled operator hold](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/tooling/api-watch/src/source-set.ts#L159-L181).

После `/swagger_upload` бот сохраняет candidate и отправляет `Swagger candidate ready`, затем завершает обработку. Ни handler, ни production `main`, ни обычный report runner не вызывают принятие этого candidate. Экспорт `createApiWatchRuntime().evaluateOperatorCandidate()` сам по себе не является потребителем: production-вызова этого метода в репозитории нет. `runApiWatchReport()` обрабатывает только outcomes нового automatic acquisition pass.

Проверен сквозной локальный сценарий: официальный fetch возвращает синтетический 403 → создаётся запрос → разрешённый оператор загружает валидный bundle через настоящий bot handler → scheduled pass → forced pass. Полный bundle принят в quarantine, но source authority не появляется:

```json
{"backend":"memory","botAcceptedValidBundle":true,"acceptedAfterUpload":0,"acceptedAfterScheduled":0,"acceptedAfterForced":0,"scheduledStatus":"NOT_OBSERVABLE","scheduledCode":"API_WATCH_REPORT_BLOCKED","scheduledNetworkFetches":0,"forcedStatus":"NOT_OBSERVABLE"}
{"backend":"postgres","botAcceptedValidBundle":true,"acceptedAfterUpload":0,"acceptedAfterScheduled":0,"acceptedAfterForced":0,"scheduledStatus":"NOT_OBSERVABLE","scheduledCode":"API_WATCH_REPORT_BLOCKED","scheduledNetworkFetches":0,"forcedStatus":"NOT_OBSERVABLE"}
```

Scheduled pass правильно не повторяет заблокированный внешний fetch, но не потребляет и уже загруженный файл. Forced pass снова получает 403. Положительный контроль в памяти — явный вызов существующего evaluator на тех же сохранённых bytes — успешно принимает все 13 документов. В PostgreSQL этот дополнительный вызов отдельно упирается в замечание №1; это самостоятельная причина, а не доказательство наличия wiring.

[Принятый handoff-контракт](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/docs/development/stream2/S2_WB_SINGLE_BUNDLE_OPERATOR_HANDOFF_2026-09-22.md#L126-L138) требует продолжения существующего pipeline после принятия bundle; сообщение о готовом candidate не завершает этот сценарий.

**Последствие:** ручная загрузка, предназначенная для восстановления WB-наблюдаемости, оставляет мониторинг заблокированным. Даже административный fallback с явно указанным ID не доводит действие до результата.

**Исправление:** связать успешную загрузку с существующей проверкой authority и обработкой всех 13 документов в pipeline, с устойчивым возобновлением после сбоя. Сохранить quarantine, provenance, проверки 13/13, авторизацию и явные состояния; не выдавать `CANDIDATE_READY` за завершённый semantic comparison. Проверить bot → PG → accepted authority → snapshots/inventory/report на тех же байтах, включая restart и отсутствие сопоставимой базы.

## 3. [P2] Дать оператору безопасно создать следующее поколение WB-запроса

Места: [memory ensureRequest](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/packages/server/monitoring-control/src/swagger-handoff.ts#L196-L220), [PostgreSQL ensureRequest](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/packages/server/monitoring-control/src/swagger-handoff.ts#L429-L454), [операторские команды](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/apps/telegram-operator/src/telegram.ts#L256-L280), [отказ нового upload в terminal request](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/packages/server/monitoring-control/src/swagger-handoff.ts#L855-L859).

`ensureRequest()` теперь безопасно сохраняет terminal history и не падает с duplicate ID. Однако при неизменной family/document/URL/bundle version он всегда возвращает исторический запрос, в том числе `CANDIDATE_READY`, `CANCELLED` или `EXPIRED`. Для следующего поколения нужен явный `createRequest()`. Такого операторского действия в production bot/API/CLI нет: прямые создания, которыми заканчиваются новые lifecycle tests, доступны тесту как низкоуровневый store API.

Сценарий проверен для каждого из трёх статусов в памяти и native PostgreSQL, всего шесть случаев. Для `CANDIDATE_READY` первая загрузка выполнена настоящим bot handler с валидным bundle; следующие bytes отличаются версией документа. Для отмены/истечения задана точная terminal boundary, без открытия старой записи:

```json
{"terminal":"CANDIDATE_READY|CANCELLED|EXPIRED","forcedRunStatus":"NOT_OBSERVABLE","pendingCount":0,"pendingText":"No pending Swagger source requests.","nextBundleResult":"REQUEST_FINALIZED","oldStatus":"unchanged"}
```

`/swagger_run` больше не падает — прежний точный дефект исправлен. Но `/swagger_pending` не предлагает следующий запрос, а новый bundle нельзя отправить в старый. Наличие метода `createRequest()` в store не даёт оператору доступного способа его вызвать.

**Последствие:** после первой завершённой попытки оператор не может принести обновлённую документацию или восстановиться после отмены/истечения, хотя источник по-прежнему требует operator handoff. Нужен отдельный программистский вызов вместо рабочего bot flow.

**Исправление:** предоставить разрешённому оператору явную команду/кнопку создания новой generation с проверкой family/URL/version и отсутствия конкурирующего открытого запроса. Не переоткрывать отменённую/истёкшую историю автоматически, не удалять прежний candidate и provenance. Сохранять идемпотентность обычных scheduled passes. Проверять повторную загрузку через публичную поверхность бота, а не только прямым вызовом store в тесте.

## 4. [P3] Cleanup браузерного теста маскирует раннюю ошибку при отсутствии HTTP-запросов

Место: [browser_start_entry.py:355–361](https://github.com/MaksimUnimax/runtime-fixtures/blob/109ce9df6145f680dd68687648de9cfb9f64f3b3/tests/regression/extension-core/browser_start_entry.py#L355-L361).

До первого HTTP-запроса `ThreadingHTTPServer._threads` в Python 3.12 содержит `_NoThreads`, а не iterable. Новый teardown перебирает `getattr(..., "_threads", ())`: fallback не используется, потому что атрибут существует. Возникает `TypeError`, добавляется `server_TypeError`, первичная ошибка маскируется `SYNTHETIC_TEST_SHUTDOWN_NOT_PROVEN`, удаление собственного fixture key откладывается.

Проверено стандартным `ThreadingHTTPServer` без подмены его registry: после закрытия сервера с нулём запросов iteration даёт `TypeError`; после одного настоящего loopback HTTP-запроса registry `_Threads` и та же проверка проходит. Ошибка также наблюдалась в реальном запуске `browser_start_entry.py`, остановленном окружением до первого bootstrap request.

**Исправление:** учитывать состояние отсутствия handler threads после штатного `server_close()`, сохраняя проверку живых потоков и исходную причину сбоя. Не объявлять неизвестное завершение успешным. Проверить teardown как после обычного запроса, так и при раннем отказе браузера.

Это дефект тестовой диагностики, не дополнительный P2 продукта.

## Перепроверка шести прежних P2

Предыдущий отчёт: [14 октября, main 1691d7c0](https://github.com/MaksimUnimax/runtime-fixtures/blob/3a774090554dcedafbd3338bf7d247ebab73b30c/review-files/code-review-2026-10-14-1691d7c0.md).

| Прежнее замечание | Статус на 109ce9df и наблюдаемый результат |
| --- | --- |
| Следующий report падает после terminal WB request | **FIXED для точного отказа.** Все шесть прежних memory/native-PG воспроизведений проходят: `CANDIDATE_READY`, `CANCELLED`, `EXPIRED` сохраняются, повторный report не падает. Замечание №3 касается следующего операторского действия. |
| DB finish failure завершает Node при пойманной caller ошибке | **FIXED.** Native PG trigger reproduction: процесс переживает отказ сохранения, caller получает исходную ошибку, отсутствующий результат не объявлен сохранённым. Runner-error positive control сохраняет FAILED. |
| Смена signed AI profile не отзывает execution context | **FIXED.** Свежий generated worker 0.2.27: profile revision 1→2, SHA меняется, grantEpoch 1→2, старый context отклонён; ordinary refresh сохраняет epoch. Профильные тесты дополнительно проверяют content/compatibility, соседний AI grant и поздний результат/retry/copy. |
| Finish→Start не снимает capacity 2000 | **FIXED для завершённых receipts.** Независимый 1999/2000-marker worker proof теперь допускает новую команду. Репозиторный тест проходит реальные Finish/Start/restart и 666 подтверждённых COPY-троек плюс два receipts, всего 2000 markers. Writer suite проверяет сохранение UNKNOWN, uncertain delivery и транзитивной ancestry. |
| Сто unsupported Telegram updates блокируют команду | **FIXED.** Реальные transport/service с синтетической очередью теперь продвигают raw offset и доставляют разрешённую команду. Контроль пустого mapped batch с transport nextOffset также проходит. |
| Retry budget расходуется на документы вместо прохода | **FIXED.** Полный pipeline/scheduler, логические минуты 0/15/75, 13 документов: **3 прохода / 39 загрузок**, в памяти и PostgreSQL; один документ — 3/3. Native тесты также проверяют HTTP-date и restart schedule/retry stores. |

Дополнительно прошли прежние storage proofs: три partial snapshot write failures оставляют 0 файлов; повтор после отказа регистрации сохраняет одну копию quarantine payload; native PG commit с потерянным acknowledgement восстанавливается без дополнительной копии. Transfer submit/sourceSeen race и подтверждение после потерянного ACK не регрессировали в выполненных сценариях.

Это закрытие проверенных механизмов, а не утверждение о развёртывании исправлений или освобождении диска рабочего сервера.

## Выполненные проверки

**Штатные Vitest: 1065 уникальных тестов PASS, 71 файл.**

- Основной выбранный набор: **952 / 63**, включая API Watch, bootstrap/admin AI/admin auth, Telegram, worker, transfer, feedback, beta и monitoring scheduler/storage.
- Native PostgreSQL: **67 / 6** — monitoring boundaries 19; P7.2 correction 10; beta admission 25; transfer 11; runtime recovery 1; expiry readback 1.
- `swagger-handoff.test.ts`: **31 / 1**, из рабочего каталога своего пакета.
- Packaged v2 signature preflight: **15 / 1**.

Повторные scheduler/storage тесты пакетного запуска не прибавлены второй раз. Внутренние проверки отдельных интеграционных тестов также не прибавлены к числу Vitest tests.

**Operations Python: 206 PASS.** Выполнен полный `unittest discover -s tooling/operations -p 'test_*.py'`, включая новые offsite malformed-policy, symlink backup retention и safe monitoring-retention stdout cases. Root-sensitive filesystem fixtures проверены в собственном конечном Docker-контейнере из exact Git archive, без сети, с memory 512 MiB / CPU 2 / pids 128 и без записи в рабочий репозиторий. Mode нормализован только в этой disposable копии к обычным checkout permissions; продуктовые guards и assertions сохранены.

**Bootstrap response observer Python: 7 PASS. Release safety Node: 112 PASS.** Детерминированные Chromium/Firefox store package contracts, PNG icons, внешний patch hash/differential, first-chat source evidence и button geometry также прошли.

**Typecheck: 9 пакетов PASS:** `@product/api`, `@product/worker`, `@product/api-watch`, `@product/telegram-operator`, `@product/bootstrap`, `@product/admin-ai`, `@product/admin-auth`, `@product/credential-transfer`, `@product/monitoring-control`.

**Extension source/generated проверки PASS:** profile revocation, ledger capacity/COPY, command writer 38 сценариев, Work lifecycle 15, parallel authority, prompt trees 25, recipient recovery 22, autonomous lifecycle 25, Start lifecycle/diagnostics и application **60 сценариев**. Это synthetic browser/provider harness и извлечённые generated модули; реальных marketplace/AI/Telegram запросов не было.

**Независимые Vitest proofs:** monitoring 9 PASS; прежний operator lifecycle 6 PASS; transfer 4 PASS; storage 3 PASS; native storage 2 PASS. Новые проблемы намеренно дают отрицательные assertions: bot continuation **2 FAIL**, renewal **6 FAIL**, artifact-size **1 PASS / 1 FAIL**. Падения на описанных багах не представлены как зелёный прогон. P3 отдельно подтверждён стандартным Python HTTP server с положительным контролем.

Изначальный агрегированный запуск был сделан с неподходящим cwd для одного package source-reader и без DATABASE_URL для добавленного native suite. Они повторены в правильном package cwd и собственной disposable БД; это исправления запуска тестов, исходные assertions не менялись. Два Start helper scripts также повторены с предусмотренными им source/runtime arguments после диагностики CLI. Эти ошибки запуска не включены в продуктовые findings.

## Пакет и ограничения проверки

Собрана development version **0.2.27**: `SELLER_AGENTS_I1_C1_v0.2.27_LOCAL_DEVELOPMENT.zip`, **2577484 bytes**, SHA256 **`8c435896cab8f75830154bbe85f3961bcf86eb2bcaa0c82288a3d585878d567e`**. `repeat_archive_match=true`, `source_extracted_bytes_match=true`. Это проверенный development package, не опубликованная магазинная версия.

Native PostgreSQL собственный, только `127.0.0.1:55450`; использованы изолированные `postgres` / `product_control_plane_test` и собственный schema scope интеграций. Сбросы данных выполнялись только внутри этих fixtures; live DATABASE_URL не использовался. Группы, изменяющие одну БД, выполнялись последовательно.

Реальный installed-synthetic browser Start был запущен с доступным `/usr/bin/chromium`, но административная политика окружения отклонила `Extensions.loadUnpacked`: **Loading of unpacked extensions is disabled by the administrator**. Политика не менялась и не обходилась; установленный сценарий не получает PASS. На этом раннем выходе также проявился P3. После подтверждённого завершения fixture process и закрытия собственного signer port disposable key удалён отдельной проверкой. Оставшиеся Chromium/crashpad записи процесса имеют статус zombie, живых browser/signing consumers не осталось.

Branded Chrome/Opera/Yandex/Firefox, live AI, реальный WB, SMTP/TG и production deployment в этом ревью не проверялись. Синтетическая очередь/подпись и пакетные проверки не заменяют эти подтверждения.

## Ресурсы, организация и магазинный статус

Перед проверками: около **32 GiB MemAvailable**, **28 GiB** свободно в workspace, **17 GiB** в `/tmp`, более 2 млн свободных workspace inode; чужих активных тестов не обнаружено. После проверок: workspace всё ещё **2.8/32 GiB**, `/tmp` около **114 MiB / 17 GiB**. Собственная PostgreSQL остановлена, её pgdata и промежуточный source archive удалены; собственный Docker-контейнер завершён и удалён. Логи/proofs сохранены в `/tmp/runtime-fixtures-review-20261015-109ce9df`.

Организационные состояния рабочего сервера, notices и `/root/octoport-control/controllers/organization/errors.json` здесь **NOT_RECHECKED**: сервер не подключён, локальный путь недоступен. Проверены доступные правила репозитория, история/чистота checkout и точная remote база. Чужие scopes, WIP, процессы и серверные настройки не редактировались. Новые очереди, controllers, hooks и фоновые исполнители не создавались.

**Публикация:** Chrome / Firefox / Opera — подготовка пакетов проверена на уровне SOURCE/PACKAGE; фактическая стадия кабинетов и первая подача **UNKNOWN**, dashboard не проверен. Точный store-candidate, его штатная установка/обновление, reviewer flow и подтверждение магазина остаются работой автора соответствующего выпуска; development ZIP не является таким подтверждением. Новое действие владельца из этого code review не требуется. Safari остаётся после релиза.

Актуальная занятость диска рабочего сервера и эффект очистки не измерялись. Прежний переданный владельцем `df` не заменён оценкой облачного workspace.

## Публикация отчёта

Ветка **`codex/code-review-2026-10-15-109ce9df`**, файл `review-files/code-review-2026-10-15-109ce9df.md`. Публикуется только отчёт, без продуктовых исправлений и без изменения `main`. После push проверяются remote SHA и побайтовое совпадение скачанного raw-файла с локальным Markdown.
