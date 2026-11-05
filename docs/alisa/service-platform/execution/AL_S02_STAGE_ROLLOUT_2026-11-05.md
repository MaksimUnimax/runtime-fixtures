# AL-S02 · точный план stage rollout

**PREPARED_PENDING_OWNER_APPROVAL.** План не исполнялся. Disposable smoke точного пакета прошёл; независимая SOURCE/PACKAGE проверка принята. Допуск S01 не разрешает операции этого плана.

| Привязка | Значение |
|---|---|
| Source | `6ae348354b3db0d3cdcdac03c7fcc7dd3ca0eb36` |
| Пакет | `alisa-6ae348354b3db0d3.tar.gz` |
| SHA256 | `4848fc3e0975d4b3fb347e7b0f5634c44ad81d01a31690263a3bf31cfb83136c` |
| CI | [41972534700](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/41972534700), job127063839214, SUCCESS |
| Независимый вердикт | [ACCEPTED_FOR_DECLARED_SOURCE_PACKAGE_SCOPE](AL_S02_FINAL_SOURCE_PACKAGE_REVIEW_20261105.json) |
| Package binding | [Точная квитанция](AL_S02_EXACT_PACKAGE_20261105.json) |
| Текущий сайт/API | alisa-8d680f775c8ccdf2, принятый S01 |
| Identity/admin shared current | alisa-77d0f8ee2643ef65, принятый S00 |

## Область запрашиваемого допуска

Только alisa-stage.octoport.ru, id-stage.octoport.ru и собственные stage platform/identity БД. CLOSED, исключительно example.invalid и уже принятый приватный SMTP 127.0.0.1:18225 без relay. Admin, lab/default vhosts, текущий OAuth Октопорта, матрица, обработчик, чужие БД/credentials и production исключены. Реальная контролируемая почта требует отдельного допуска до реальных клиентов.

Перед изменением ещё раз сверить точные действующие версии/указатели, одного автора, WIP, locks и отсутствие активного rollout. Совпавший установленный пакет повторно не устанавливать. Неопределённый исход сначала разрешить readback; действующий чужой rollout не перебивать.

## Собственные БД

Platform: применить только `leads.0002_submission_created_at` (nullable created_at для совместимости старого S01) и `accounts.0001_initial` (8 добавочных таблиц Customer, Tenant, Membership, IdentityLink, AuthFlow, WebSession, ConsentRecord, LeadLink и их индексы/constraints). Старые записи сохраняются; отсутствие timestamp у прежней Submission не создаёт прав/атрибуции.

Identity: 17 ещё не применённых миграций библиотеки и своей accounts, 10 новых таблиц. Действующие auth/contenttypes/accounts.0001 не переигрывать. Показать plan из точного пакета и сверить с текущей django_migrations перед apply. Непредусмотренный остаток — остановка зависимого apply.

- `account.0001_initial`
- `account.0002_email_max_length`
- `account.0003_alter_emailaddress_create_unique_verified_email`
- `account.0004_alter_emailaddress_drop_unique_email`
- `account.0005_emailaddress_idx_upper_email`
- `account.0006_emailaddress_lower`
- `account.0007_emailaddress_idx_email`
- `account.0008_emailaddress_unique_primary_email_fixup`
- `account.0009_emailaddress_unique_primary_email`
- `accounts.0002_identitymail_protocolcache_identityconsent_subject`
- `allauth_idp_oidc.0001_initial`
- `allauth_idp_oidc.0002_client_default_scopes`
- `allauth_idp_oidc.0003_client_allow_uri_wildcards`
- `mfa.0001_initial`
- `mfa.0002_authenticator_timestamps`
- `mfa.0003_authenticator_type_uniq`
- `sessions.0001_initial`

Новые identity таблицы: `account_emailaddress`, `account_emailconfirmation`, `accounts_identityconsent`, `accounts_identitymail`, `accounts_subject`, `allauth_idp_oidc_client`, `allauth_idp_oidc_token`, `django_session`, `identity_protocol_cache`, `mfa_authenticator`. Только прежние собственные migration roles выполняют DDL; runtime roles остаются без чужого CONNECT и DDL. Новые БД/roles не создаются. Обратные миграции/DB restore не применяются.

## Конфигурация и активация

Сохранить предыдущий код, приватную конфигурацию и собственные unit/vhost snapshots с закрытыми правами. Секреты/сырые письма не помещать в Git/отчёты. Новые ключи сохраняются и после возврата, иначе новые зашифрованные записи нельзя будет прочитать при повторном включении.

Установить только проверенные неизменяемые bytes offline. Существующий `current` не двигать: admin и прочие S00 units остаются на нём. Web/API и S01 mail уже используют `site-current`; переключить только этот указатель на S02. Создать отдельный `identity-current` и собственный drop-in только identity@stage. Generic switch/deploy/rollback, который меняет все четыре компонента, для этой частичной установки не использовать.

В отдельных web/platform env включить `ALISA_ACCOUNTS_ENABLED=1`, fixed issuer https://id-stage.octoport.ru и заранее названный client alisa_market_stage. Новый auth-service token должен отличаться от S01 intake token. Только web получает confidential client secret и JWE session key. Только identity получает Fernet/MultiFernet data key и RSA signing keys; его прежний Django secret сохраняется. Ничего из identity DB/key material не добавлять web/platform и наоборот. В identity.env и собственном identity-migration.env установить `ALISA_IDENTITY_ENABLED=1`, тот же fixed issuer и только необходимые identity data/signing keys. Migration env сохраняет прежнюю собственную DDL роль; runtime env не получает её пароль. Platform migration env остаётся отдельным от runtime. Ключи создаются криптографическим генератором, приватные файлы закрыты от остальных пользователей; отчёт содержит только имена настроек и результаты проверок, без значений.

Явным identity bootstrap создать только два confidential Code clients: alisa_market_stage → https://alisa-stage.octoport.ru/auth/callback; alisa_compatibility_stage → https://alisa-stage.octoport.ru/oidc-probe/callback. Секреты — случайные URL-safe32–128; IDs ASCII allowlist. Existing mismatch запрещает неявную rotation. Сами secrets второго клиента нужны только закрытому проверяющему bootstrap/smoke, не демону identity или UI.

Подключить только собственный конечный identity mail-batch/timer (identity-current, identity.env) и account-cleanup/timer (site-current, platform.env). Исходный foundation cleanup остаётся активным, engineering probe/worker выключены. Существующий S01 mail timer/sandbox сохраняются.

В собственных site/identity nginx server blocks: максимум тела16k, Host и X-Forwarded-Proto, access log только method + $uri + status без query, UTM и referrer. Чужие blocks не переписывать. В пакете document policy same-origin только для /login, /app и identity forms; строгие Origin/CSRF проверки остаются включены, cross-origin Referer не передаётся.

## Порядок действий после допуска

1. Read-only preflight: версии и symlinks, собственные unit/drop-in/env/vhost fingerprints, heads собственных миграций, ресурсный запас, свободные locks и отсутствие второго автора/rollout. Снять безопасный baseline lab/OAuth/default и не менять его. Сохранить собственную конфигурацию и предыдущие указатели в закрытом backup, без вывода секретов.
2. Получить bytes из package artifact13390527169, проверить SHA256 tar и manifest всех файлов. Если release уже установлен, проверить его immutable manifest и исход, не устанавливать повторно. Установить offline через `infra.release.install(stage, artifact, expected_sha256)` / штатный `bin/alisa deploy --env stage --artifact … --sha256 …`: эта команда только устанавливает bytes, не активирует. Не выполнять `release.switch`, generic rollback или `bin/alisa verify --scope foundation`.
3. Подготовить только перечисленные component/migration env, ключи и два клиента. На установленном release выполнить `bin/alisa migrate --env stage --release alisa-6ae348354b3db0d3 --plan`; сверить точный остаток 2+17. Затем тот же `--apply`. Явный `identity_clients --apply` запускается только на собственной identity БД с отдельным закрытым bootstrap env; все несовпадения существующего client прекращают bootstrap. Сверить повторный migration plan пустой и runtime DDL/cross-DB deny.
4. Установить два собственных service/timer из пакета, новый identity drop-in с WorkingDirectory/ExecStart на identity-current. Сначала проверить nginx config, затем изменить только два собственных vhost, сохранив чужой baseline. Атомарно переключить site-current и создать identity-current на проверенный release; shared current не менять. После установки только собственных unit/drop-in файлов выполнить `systemctl daemon-reload`. Перезапустить только alisa-platform@stage, alisa-web@stage, alisa-identity@stage. Включить сохранение после reboot и запустить ровно два новых timer: `systemctl enable --now alisa-identity-mail@stage.timer alisa-account-cleanup@stage.timer`. S01 mail продолжает site-current.
5. Пройти установленную проверку ниже, безопасный возврат и повторное включение, затем получить независимый installed verdict. Любой сбой зависимой границы прекращает активацию; результат/состояние считывается до единственного обоснованного повтора.

## Установленная проверка и возврат

Проверить версии и migration heads; путь главная → email-code → OIDC Code/S256 → BFF → platform PG → /app; private sandbox письмо; согласия, один Person/User/Tenant; профиль/пустое состояние/доступ/выход; повтор, TTL600/5 попыток, concurrent code verify и safe receipt. Подмены state/issuer/audience/nonce/signature/expiry/PKCE, чужой return_to/session/tenant/handoff должны отказать. Второй RP идентифицируется, но не получает данные/права Алисы. Проверить SMTP outage/recovery, оба сервиса после restart, ограниченную очистку, приватность ingress/service logs, отсутствие изменений lab/OAuth и зависимости от старого Октопорта. Для проверки последнего использовать временное ограничение исходящей сети только собственных web/platform/identity units: разрешить loopback для собственной PG/API/SMTP и собственный issuer IP185.244.51.141 (код использует только HTTPS443), запретить остальные удалённые направления. Собственные runtime DB роли по-прежнему не имеют CONNECT к чужим БД. Не менять global firewall, lab/default units/vhosts или DNS/hosts. Сначала подтвердить рабочий механизм per-unit ограничения на этом host и его deny witness к зарезервированному внешнему адресу; при недоступном механизме сценарий остаётся BLOCKED, не PASS. Затем повторить вход в таком режиме и убрать только свой тестовый drop-in, выполнить `systemctl daemon-reload` и собственный restart, сверив восстановление исходной конфигурации. Ограничение к собственному IP само по себе не доказывает запрет всех путей на этом IP: фиксированный issuer и allowlisted authority paths дополнительно проверяются кодом и отрицательными запросами; соединения с чужими local endpoints не разрешать добавлением обходов.

После synthetic записи выполнить контролируемый возврат к S01 web/API и S00 identity, затем включить ту же S02 повторно. Остановить только новые собственные timers на время возврата, восстановить старые env/drop-in/указатели, выполнить `systemctl daemon-reload` и собственный restart, затем перечитать реальные версии. При повторном S02 включении восстановить его собственный drop-in, повторить daemon-reload и включить только два новых timer. Таблицы, Person/Customer/Tenant и согласия не удалять; новые данные и ключи сохраняются. После повторного включения подтвердить те же IDs и отсутствие второго эффекта. Не накатывать старую БД поверх новых данных.

Независимый итоговый installed verdict должен относиться к этим source/package SHA256 и фактически считанным версиям. Передача разрешения, RUNNING, health или source PASS не считаются установленной приёмкой.

Следующее допустимое окно: после полной source/package квалификации, независимого вердикта и явного допуска владельца на этот заполненный план. Действующий HTTPS S00 принят; новый CA dry-run не требуется для установки S02.
