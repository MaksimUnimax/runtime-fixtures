# Октопорт маркет: совместная работа тестера и автора матрицы

Начинать каждый сеанс здесь. Репозиторий `MaksimUnimax/runtime-fixtures`, ветка `alisa`, общий центр `docs/alisa/quality/`. Чат и архивы не создают вторую очередь задач.

## Текущая контрольная точка — OWNER-SOURCE-R1, 8 ноября 2026

**Авторский статус: APPROVED_OWNER_SOURCE_AND_CURRENT_VERIFIER_TESTED / NOT_INSTALLED.**

[Фактическая приёмка](OWNER_SOURCE_R1_ACCEPTANCE_2026-11-08.md) · [Полный исходный пакет](../runtime/v0.11/owner_source_r1/README.md) · [Точное подключение](OWNER_SOURCE_R1_PLATFORM_HANDOFF_2026-11-08.md) · [Независимое ревью](testpacks/owner_source_r1/README.md).

После матричного OWNER-BINDING-R1 реализована отсутствовавшая сторона источника: сохранение/read/approve/revoke текущих параметров магазина, миграция, внутренний endpoint и DjangoOwnerSource. Он выдаёт прежний S03 snapshot и проверяет его по актуальным session/membership, customer security, store, access entitlement, credential и owner-data revisions. Hash и issuer не заменяют разрешения. Используются существующие ORM/auth и матричные Engine/Repository/Worker/OwnerInputs/ScenarioBindings; второго калькулятора или очереди нет.

Одобрение требует confirmed=true, expected_revision и действующего владельца. Старый повтор не возвращает отозванные данные в действующее состояние. Сохранены разные себестоимости/даты, точные периоды налога и расходов, ноль/пропуск/исключение, запрет месячного prorating. Ни r9/250, ни суммы старого аналитического эксперимента не стали defaults. Ключи маркетплейсов не расшифровываются; session token не сериализуется в граф.

### Проверка точного архива

**1907/1907 PASS**, завершено **8 ноября 04:35:05 UTC после чистой распаковки**: 1840 прежних матричных проверок, 52 новых source/authority и 15 точных импортированных fairness/deadline случаев. Импортированные и повторные прогоны не выдаются за новые авторские тесты. JSON-only extension gate также PASS.

В source-тестах используются реальные Django ORM/session/permission функции и отдельный PostgreSQL16, но аккаунты/суммы/marketplace replies искусственные. Бизнес-тесты выполнялись под runtime-role без superuser, сохранив append-only ограничения. Проверены конкурентные обновления, один эффект replay, две сценарные таблицы, текущий revoke/read/credential/version/env, restart bind и exact-cache. Test PostgreSQL остановлен и удалён. Provider HTTP0, working DB не использовалась; loopback разрешён только сетевым fixtures.

Найдена и исправлена ошибка преобразования source.Rejected в runtime.Rejected после отзыва. Промежуточные FAIL сохранены. При импорте нового shared HTTP четыре старых test-fixtures обновлены на bounded read1 без изменения финансовых assertions/контролей.

### Что ещё НЕ включено

Это проверенное доверенное **in-process ORM→Worker соединение**, не установленный RuntimePort/IPC. BFF/экран ввода, рабочая миграция, реальное утверждение параметров, независимый review и голосовая поставка — **NOT_RUN**. Внутренний service-auth endpoint нельзя публиковать наружу без штатного BFF/Origin/CSRF. Market worker не получает привилегированный доступ к платформенной БД. Feature flag нового приложения по умолчанию OFF.

Настоящие параметры владельца не заданы этим проходом. Общая команда продолжить разработку не назначает себестоимость/налог и не заменяет approved record. При отсутствии записи источник отвечает NOT_APPROVED до provider IO. C-UE01 требует SELLER+PERFORMANCE CONNECTED; AUTHENTICATED_UNLINKED не доказывает связь рекламного и продавецкого кабинетов.

## Полный актуальный пакет

Кандидат `/opt/alice-market/candidates/20261108-owner-source-r1`.

Архив `/root/alice-lab-evidence/owner-source-r1-20261108/ALISA_OWNER_SOURCE_R1_2026-11-08.zip`.

**673190 байт; 288 файлов; 287 manifest entries.** SHA256 `f01a083aca7f0142693c42764a2af84ec66c63550c8496e83ca19f0f7a2f1095`.

MANIFEST `703d9421800d904a0d412c22e0fe50085dd01844d891c72c4498727524863e67`.

Повтор: `python -B verify_owner_source.py --output /tmp/alisa-owner-source-check` при зависимостях requirements-owner-source.txt и возможности создать собственный disposable PostgreSQL. Verifier не устанавливает пакеты и не читает рабочие settings/ключи. Архив содержит полный source/dependency layout, миграцию, exact overlay и тесты, но не настоящие owner records/финансовые ответы или пользовательскую БД. Исторические live/permissions scripts не запускать как installer.

## Работающий сервис и параллельные изменения

[Отдельный аудит](AUDIT_FIXES_2026-11-08.md) установил **alisa-runtime-06f3c053e7719290**, PID281405. Итоговый readback этого автора подтвердил **81/81 файл**, прежний config hash и отсутствие изменений рабочей системы этим проходом. Параллельная установка не приписывается матричному автору. Последующие web/identity изменения сохраняются согласно аудиторскому readback; не откатывать их старой source-копией.

Текущий кандидат сохранил fairness очереди, общий HTTP deadline и AUTHENTICATED_UNLINKED из06f3. Repository объединён трёхсторонне с graph/quota extensions. Exact hashes и тесты внутри пакета. Платформенная база source закреплена на06f3; это не команда заменить текущий релиз её целиком. Перед новой работой проверить актуальные Git/locks/ExecStart/manifests; чужие locks не освобождать.

Установленная readiness платформы продолжает отделяться от нового кандидата; существование source-кода само по себе не подключает новый клиентский путь. [Инструкция частного теста Станции](STATION_START_2026-11-08.md) относится к уже опубликованному навыку, не к неустановленной C-UE01/owner-data функции.

## История и архитектурные решения

[OWNER-BINDING-R1](OWNER_BINDING_R1_ACCEPTANCE_2026-11-08.md) — матричный внешний snapshot,1840 author tests. [MATRIX-LIVE-R4](CUE01_MATRIX_LIVE_R4_ACCEPTANCE_2026-11-08.md) — последняя bounded живая квалификация с r9-примером:9источников/10HTTP,READY,2таблицы/6страниц,34 денежные строки совпали отдельным алгоритмом на тех же API. Это не новый owner-source live run, не кабинетная сверка и не независимый verdict.

Один общий runtime и quota ledger, разрешённые граф/формулы/источники, закреплённые адаптеры. Exact-only cache только для полного идентичного результата при текущих правах/сроках. Не переиспользовать несовпадающие частичные данные как новый READY; не превращать unknown в автоматический retry; пропуски не нули; исторические данные не текущий snapshot. Новый source не меняет эти правила.

## Каталог и независимые статусы

**82 реализовано /78 включено /4WB выключено.** Новых voice definitions/enablements0. Четыре WB campaign views всё ещё не имеют доказанной полноты. Internal source/binding/tests не увеличивают счётчик.

[Safety retest](inbox/20261105-TESTER-4d04edaa/RETEST_REPORT.md) исторически18PASS/2PARTIAL/1FAIL/3SKIP. DS03 получил отдельный [адресный независимый SOURCE PASS](inbox/20261108-AUDIT-DS03/RESULT.json); полный safety/live numerical этим не закрыт. N06/N08/N09-OZCP001 ранее VERIFIED на своей версии; прежние PARTIAL/SKIP сохраняются. Независимый review нового OWNER-SOURCE-R1 — NOT_RUN.

Новый независимый прогон — отдельный inbox/<UTC-дата>-TESTER-<8hex>/. Фиксировать exact package/hash, фактические запросы/ответы и раздельные времена. Неизмеренное null, непройденное NOT_RUN. Не назначать неустановленную функцию как доступный голосовой сценарий.

[BUGS](BUGS.json), [TEMPLATES](TEMPLATES.json), [RUNS](RUNS.json), [BOARD](BOARD.md), [WORKFLOW](WORKFLOW.md), [TESTER_PROMPT](TESTER_PROMPT.md), [счётчики](CATALOG_PROGRESS_CURRENT.json) и [мини-отчёт](MINI_REPORT_CONTRACT.md) остаются общим центром. Изолированное source-расширение не разрешает перехватывать действующую платформенную установку/auth/UI.

## Следующее действие и цель

Независимое ревью точного пакета, затем совместимое подключение приложения через существующие BFF/RuntimePort и отдельный допуск установки. После этого — реальный ввод/явное утверждение параметров владельцем и один ограниченный C-UE01 с текущими правами и отдельной числовой сверкой. **Производственный расчёт на настоящих owner inputs ещё не принят.** Старые примерные значения и тестовые подтверждения не заменяют эту цель.

[Предыдущий полный README](https://github.com/MaksimUnimax/runtime-fixtures/blob/cb6d01a433c17cc1f8ecd5ec5c9d307ab3d07276/docs/alisa/quality/README.md) сохраняет точную историю OWNER-BINDING-R1 и аудиторские уточнения.
