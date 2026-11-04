# RT-JOB-R01.1 — runtime-поставка для AL-S07

04.11.2026. Статус **READY_FOR_INTEGRATION_REVIEW, runtime only, offline**. Новый production listener не установлен. AL-S07 как полный продуктовый шаг НЕ принят.

## Основание и сохранённое состояние

Полный пользовательский пакет v0.5: SHA256 704e24651509a26189fa82cd7bfb56be91fd81c3472e6f0b4d56ea4e5ed4ef7d. Manifest и validate_pack повторно PASS. Источники требований: API_AND_EVENTS §3, ROADMAP AL-S07, runtime_task_v1.schema.json, AL-T06-01/03/04/05 и AL-N07-01/02/03. Перечитаны RT_JOB_R01_SCOPE и Git HEAD f18a878fdeb6aaecf5b0d3eaf7053d28f3d50301. До реализации опубликован план продолжения, commit 028cf0141f6e9d71de2fb7f5ada327e7e9a8b06a.

После предыдущего обрыва в Git были scope и строгий validator, но полная законченная реализация/приёмка порта в сохранённых доступных каталогах не найдены. Поставка выполнена заново от проверенного исходного r4-пакета; не называется восстановленным старым PASS.

## Реализовано

- RuntimePort: capabilities, current_versions, submit utterance, status, read_result и cancel по явному UUID job_ref.
- Durable связь public ref → внутреннее задание/точный canonical alias; чтение не зависит от последнего голосового pointer и не меняет page/delivered.
- Приём вызывает существующие Engine/Repository/Worker и матрицу; новых расчётчиков Ozon/WB или копии аналитики в платформе нет.
- Идемпотентность scoped по tenant+actor+request_id, проверка изменённого тела; тот же logical_query_id не порождает второй расчёт; обновление короткого ticket не меняет смысл задания.
- Ошибка UNKNOWN не превращается в автоматическое разрешение retry. Истёкший read даёт RESULT_EXPIRED, не submit. Поздняя отмена старого ref не затрагивает другой более новый job.
- Отдельный bounded Unix IPC, SO_PEERCRED, явные allowed_uid/service_id и fixed product alisa_market. Эти значения не берутся из клиентского JSON. Нет listener на import, TCP fallback или режима отключения проверки peer.
- Реальная authority инжектируется платформой: verify(ticket,service_id) и resolve(pins,action). Без неё — AUTH_REQUIRED; её недоступность не даёт fallback. Собственный issuer/OIDC/signature scheme не реализуется.
- Актуальные права/mapping/revisions проверяются при приёме, перед физическим dispatch, перед публикацией и выдачей. Guard закреплён в существующем draft/plan; старый Engine без execution_policy не исполняет такие задания.
- Публичный UUID не угадывается как runtime tenant/store ID. Допустимые mapping и catalog assignment приходят из доверенной authority, scope не расширяется.

Три новых Python-модуля: runtime_port.py, runtime_port_ipc.py, runtime_port_contract.py. Адресные изменения ядра — только engine.py, repository.py, retention.py. Существующие матрицы источников, вычислительные каталоги, HTTPTransport и provider qualification не менялись. Изменение типа доступа не создаёт новую специальную ветку под финансовый показатель.

## Контракт и его честные границы

Schema runtime_task_v1 скопирована из v0.5 побайтово; SHA256 **08b4b6c708c5ae1d5387dbd593fde7ea40c9f671efdad8b9aacbcab9bd683d34**. Две source fixtures также сохранены. Код validator относительно раннего f18a878 дополняет канонизацию UUID и сортировку store_scope; schema не меняется. Валидный JSON по-прежнему не доказывает authorization.

Поддержанный query_input.kind: utterance; прежний лимит ядра 1200 символов; timezone Europe/Moscow. Template, произвольные timezone и remote revoke_scope явно возвращают CAPABILITY_UNAVAILABLE. Реальное изменение прав уже проверяется через authority перед исполнением/выдачей; сам платформенный issuer/revoke-service не создавался.

Read_result возвращает complete/pages/fetched_at/expiry по конкретному ref; внутренние raw rows/store IDs в новый ответ не копируются. Публичный HTTP status (например 410) отображает platform adapter, а не Unix IPC. Error envelope содержит безопасный code/message/trace_id/retryable=false.

Короткий admission ticket не хранится после проверки. Его естественное истечение после durable acceptance не отменяет уже разрешённую работу, но текущие security/grant/credential revisions обязательны. Новый read/status/cancel требует свежий ticket. В persisted job только nonsecret pins; ticket не попадает в SQLite/WAL, LLM или provider request.

## Хранение без накопления

Новые rt_job_refs/rt_job_receipts не дублируют финансовый отчёт. Они содержат хеши/ссылки/UUID/время и небольшие acceptance/cancel receipts. Срок replay 24 часа; очистка включена в уже существующий retention.sweep с bounded batch. Лимиты 100000 записей на таблицу, 5000 на tenant и существующий лимит используемых страниц БД.

Найден дополнительный случай: terminal alias может указывать на всё ещё активное canonical задание. Исправлено удаление metadata через ограниченную рекурсивную проверку alias-chain; активная работа не теряет public ref. При очистке старых jobs также учитываются живые RuntimePort refs. UNKNOWN сохраняет прежнюю блокировку точного повторного исполнения; полные финансовые payload очищаются по прежнему TTL.

## Что проверено фактически

**800/800 = 717 прежних + 83 новых**, failures/errors/skipped=0, TCP/DNS attempts=0, external API calls=0. 12 прежних test-файлов сохранены побайтово. Architecture gate PASS; прежний JSON-only тест добавления двух источников тоже проходит без изменения runtime Python.

Новые 83 проверки: схема/UUID/дубликаты/лишние поля; shape-valid unauthorized fixture; неправильный product/peer/actor/tenant; mapping/revision/catalog; expiry; отсутствие authority; scoped idempotency/конкурентные повторы/rollback; публичный ref и alias; P2 через прежний worker; restart; exact-cache; статус/чтение без изменения голосового указателя; точная отмена; потеря ответа; UNKNOWN; отзыв между provider-pages и между prepare/dispatch; запрет READY после отзыва/отмены; отсутствие ticket в SQLite/WAL; ограничения IPC; безопасные ошибки; истечение metadata и сохранность active alias.

SQLite, очередь, worker и Unix socket в тестах настоящие; authority и ответы провайдера — искусственные. Никаких новых реальных запросов к DeepSeek/Ozon/WB, чтения живых credentials или платформенного E2E в этой работе не выполнялось. Это авторская проверка, не независимая приёмка.

После чистой распаковки повторно проверены **67 manifest entries**, architecture gate и те же **800/800**. Core.patch применён к исходному r4 с fuzz=0; все три изменённых файла совпали. Повторный прогон не считается ещё 800 уникальными тестами.

## Артефакты

Полный воспроизводимый пакет с baseline, новым кодом, schema, всеми 800 тестами, fixtures, patch, документацией и manifest:

**ALISA_RUNTIME_PORT_RT_JOB_R01_2026-11-04.zip** — **240089 байт, 68 файлов**.
SHA256 **d5db0d7220048af0cea155e80a4af638ec4e60d21a5c07baf685bd14a40341d3**.

Отдельно: ALISA_RT_JOB_R01_INTEGRATION_HANDOFF_2026-11-04.md; ALISA_RT_JOB_R01_ROUNDTRIP_TESTS.txt; ALISA_RT_JOB_R01_VERIFICATION_2026-11-04.json. ZIP не содержит рабочую БД, credentials, финансовые ответы или установщик.

Граница публикации: полный исходник — в приложенном ZIP, не только в прежнем одиночном validator. Этот документ в Git НЕ означает, что все новые runtime-файлы уже опубликованы loose files в rt_job_r01/. Ранний f18a878 validator сам по себе не является готовым RuntimePort. Самостоятельный текущий комплект — ZIP с указанным hash.

## Параллельный исполнитель и рабочий сервер

**10:43:37 UTC** на Alisa: active scalar-matrix-r4, все **31/31** runtime SHA совпадают с действующим DEPLOY_EXPECTED_HASHES. В установленном коде, live SQLite, credentials, конфигурации и socket ничего не менялось. Кандидат этой поставки проверяется в отдельной копии. Собственный runtime-port lock относится только к этому участку, не к чужим platform путям.

products/alisa, identity, UI/BFF/admin, PostgreSQL, platform adapter, platform STATUS, DNS/TLS, OAuth и billing не изменены. Не перепринимать AL-S00–06 и не ставить AL-S07 ACCEPTED вместо второго исполнителя.

## Следующая совместная граница

Нужны от платформенного исполнителя: точная service identity/UID, настоящие verify/resolve, отображение tenant/store/revisions и catalog assignment, adapter. Один configured Engine/Worker должен владеть runtime SQLite; нельзя добавить новый listener к БД, которую одновременно исполняет старый worker без guard. Старое ядро без policy специально отклоняет защищённый job.

После этого — отдельный интеграционный стенд: Alice/platform submit → этот job_ref → реальный qualified report → чтение того же ref в ЛК без роста бизнес-HTTP. До такой проверки production listener/authority не включать. UI, issuer и платёжные/платформенные grants остаются у параллельного исполнителя.
