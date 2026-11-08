# Независимое ревью OWNER-SOURCE-R1

**Статус: NOT_RUN.** Авторские результаты не копировать в verdict. Пакет не установлен, реальные owner inputs не утверждены.

Точный архив Alisa:
`/root/alice-lab-evidence/owner-source-r1-20261108/ALISA_OWNER_SOURCE_R1_2026-11-08.zip`

SHA256 `f01a083aca7f0142693c42764a2af84ec66c63550c8496e83ca19f0f7a2f1095`; 673190 байт, 288 файлов. MANIFEST `703d9421800d904a0d412c22e0fe50085dd01844d891c72c4498727524863e67`, 287 entries.

Распаковать отдельно; проверить весь manifest. Повтор `python -B verify_owner_source.py --output /tmp/alisa-owner-source-independent` требует Python3.12, dependencies из requirements-owner-source.txt, PostgreSQL16 binaries и права создавать собственный временный cluster от postgres OS user. До запуска прочитать run_owner_source_checks.py: рабочие settings/DB/ключи не нужны. TCP тестового PostgreSQL отключён, Unix socket закрыт в собственном /tmp каталоге; cleanup обязателен. Не запускать исторические live/permissions/installer скрипты.

## Проверяемые границы

**Approval и БД.** Настоящие существующие session/membership/store ownership проверки, expected_revision, literal confirmed=true, duplicate JSON keys, конкурентные изменения и replay одной команды. Не допускается перенос данных чужого tenant/store, implicit approval или запись r9/default250. Квитанции повторов не содержат денежных строк; старый approve после revoke не восстанавливает факты. Проверить ограничения размера/числа записей и роль PostgreSQL без superuser, append-only права прежних grants/audit.

**Producer/current verifier.** Scope и issuer привязаны к среде/product, tenant/store/security/access/credential ревизиям и точному approved dataset. Session token и ciphertext не сериализуются. C-UE01 требует SELLER+PERFORMANCE CONNECTED; AUTHENTICATED_UNLINKED и попытка понизить required-credential policy не разрешают граф. Отсутствие одобрения, проверенных связей или текущих прав блокирует provider IO. Поддельный rehashed snapshot не становится утверждённым.

**Расчёт и отзыв.** Те же Worker/OwnerInputs/ScenarioBindings; разные SKU/даты, введённые tax/own costs, явный ноль/пропуск/исключение, отсутствие месячного prorating. Отзыв между стадиями и после READY, изменение версии/среды/credential, истечение сессии/доступа. Ошибки source переводятся в штатный runtime Rejected; нельзя возвращать raw исключение или старые суммы. Чтение и exact HIT не пересчитывают и не вызывают API. Восстановление source из текущей БД проверяет frozen input заново.

**Параллельные исправления.** Общий runtime не откатывается: fairness/HTTP deadline/AUTHENTICATED_UNLINKED из 06f3 сохранены. Проверить чистое трёхстороннее объединение Repository с graph/quota extensions, 15 точных upstream случаев и прежние Q01–Q12. Четыре адаптации HTTP fixtures к read1 не меняют денежные assertions или источник полноты. Старые SHA не выдавать за хеш нового merged Repository.

## Что не является доказанным этим пакетом

Все аккаунты и суммы тестов искусственные. PostgreSQL настоящий, но временный; marketplace replies подставлены. Пройден in-process trusted ORM→Worker путь, а не установленный RuntimePort/IPC. Нет production миграции, browser BFF/формы подтверждения, real owner approval, кабинетной сверки или Яндекс-голосовой приёмки. Включать service endpoint наружу без существующих BFF Origin/CSRF недопустимо. Market worker не должен получать DB-superuser доступ.

Новый независимый результат — отдельный `inbox/<UTC-дата>-TESTER-<8hex>/` с exact package/hash, реально выполненными командами, результатами и очисткой test cluster. Исторические FAIL/PARTIAL/SKIP не переписывать. Адресный SOURCE PASS DS03 из отдельного аудита не расширять до этого пакета или всей финансовой приёмки.
