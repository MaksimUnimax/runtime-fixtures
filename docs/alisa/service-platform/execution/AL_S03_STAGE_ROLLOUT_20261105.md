# AL-S03 · точный план установки на stage

**READY_FOR_OWNER_STAGE_APPROVAL / EXACT_SOURCE_PACKAGE_INDEPENDENTLY_ACCEPTED / NOT_EXECUTED.**

План включает отдельную админку, native MFA и серверные staff-права. Подготовка не означает разрешение менять stage. Exact package скачан и проверен; [независимый source/package verdict и проверка плана](AL_S03_DESIGN_INTEGRATED_INDEPENDENT_REVIEW_20261105.json) завершены. До выполнения нужен отдельный допуск владельца на перечисленные ниже изменения. S02 live-допуск не включал staff migration и admin security configuration.

## Точный кандидат и доказательства

| Привязка | Значение |
|---|---|
| Source | `3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae` |
| Tree | `c89ea16dd4773855d83335d0ed151680725d69d9` |
| Runtime package | `alisa-3e91b1aa5d405d0e.tar.gz`; SHA256 `b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21` |
| Platform CI | [41997577651](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/41997577651) |
| Provider CI | [41997577615](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/41997577615) |
| Documentation CI | [41997577716](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/41997577716) |
| Предыдущий принятый source/package | [Исторический независимый verdict d5e338](AL_S03_INDEPENDENT_SOURCE_PACKAGE_REVIEW_20261105.json); автоматически не переносится |
| Platform rollback SQL | [AL_S03_STAGE_CLOSE_STAFF_20261105.sql](AL_S03_STAGE_CLOSE_STAFF_20261105.sql), SHA256 `d084c24e10df3448431fb55bf9c40a018fe7b91ae2e6374375439b7ecb5efe96` |
| Identity rollback SQL | [AL_S03_STAGE_DISABLE_ADMIN_CLIENT_20261105.sql](AL_S03_STAGE_DISABLE_ADMIN_CLIENT_20261105.sql), SHA256 `cc059d09e8deecef1652844b8aa4523d473340e6d870380fb7ac97a96e7c1558` |
| SQL-квалификация | [65/65 в отдельной private-network PostgreSQL БД](AL_S03_ROLLBACK_SQL_QUALIFICATION_20261105.json); не установленный rollback |

## Фактическая база и границы

[Read-only сверка08:43:57UTC](AL_S03_STAGE_PREFLIGHT_20261105.json) обнаружила уже установленный другим потоком дизайн. Восстановление теперь означает возврат к этому совместимому S02-коду с новым дизайном, а не к старым страницам.

| Указатель | До S03 | Во время S03 | При возврате |
|---|---|---|---|
| `web-current` | `alisa-e82003211bdcd687` | Сохранить | Сохранить |
| `site-current` (API/lead-mail/account-cleanup) | `alisa-6ae348354b3db0d3` | `alisa-3e91b1aa5d405d0e` | Исходный S02 |
| `identity-current` (IdP/mail) | `alisa-e82003211bdcd687` | `alisa-3e91b1aa5d405d0e` | Исходный e820 |
| `admin-current` | `alisa-e82003211bdcd687` | `alisa-3e91b1aa5d405d0e` | Исходный e820 |
| shared `current` | `alisa-77d0f8ee2643ef65` | Сохранить | Сохранить |

Все четыре health были READY/200. `web-current` содержит новый дизайн и не переключается. Новый кандидат объединяет текущую design base `bece2206…` с S03; web source совпадает с e820. Предыдущие web140/adminS00/identityS02 значения в исторических отчётах больше не являются актуальной базой возврата. Версию процесса подтверждают health и manifest: `infra/launch.py` устанавливает release из manifest независимо от старого значения в env.

Разрешение запрашивается только на собственные Alisa stage API, identity и admin, их env/указатели, один собственный admin drop-in и admin vhost. Среда остаётся CLOSED, контакты только `example.invalid`, SMTP только уже принятый приватный `127.0.0.1:18225` без relay. Существующий web, shared current, lab/default vhosts, Октопорт OAuth/БД/другие продукты, матрица и production не входят. Глобальный firewall, DNS, hosts и существующие сетевые правила не меняются. S02 egress-приёмка не объявляется новой проверкой S03 admin.

## БД и закрытая конфигурация

Platform — только `alisa_stage_platform` с прежними раздельными runtime/migration roles. Единственный новый migration plan — `staff.0001_initial`: `staff_staffmember`, `staff_staffsession`, `staff_staffauthflow`, `staff_staffcommandreceipt`, `staff_staffauditevent`, индексы/constraints и REVOKE UPDATE/DELETE/TRUNCATE audit для собственной runtime role. `ALISA_STAFF_ENABLED=0` не отменяет регистрацию app и migration. Identity — `alisa_stage_identity`; относительно текущего e820 новых миграций нет. Не создавать БД/roles и не переигрывать старые migrations. Любой иной остаток прекращает зависимое apply.

Новые секреты создаются криптографическим генератором и сохраняются с закрытыми правами до переключения. Старые identity Fernet/signing/Django keys, customer cookies/JWE/service tokens и client secrets сохраняются. Отчёты содержат только имена настроек, безопасные hashes и результаты, без значений/письма/OTP/QR/recovery/token payload.

| Компонент | Новые настройки |
|---|---|
| Platform env | `ALISA_STAFF_ENABLED`, `ALISA_STAFF_OIDC_CLIENT_ID=alisa_admin_stage`, новый `ALISA_STAFF_SERVICE_TOKEN`, отличный от S01/S02 authority tokens |
| Identity env | `ALISA_STAFF_ENABLED`, тот же client ID, `ALISA_STAFF_OIDC_REDIRECT_URI=https://alisa-admin-stage.octoport.ru/auth/callback`; прежние identity keys остаются |
| Admin env | `ALISA_ENV=stage`, `ALISA_PLATFORM_URL=http://127.0.0.1:18102`, `ALISA_ADMIN_BASE_URL=https://alisa-admin-stage.octoport.ru`, `ALISA_IDENTITY_ISSUER=https://id-stage.octoport.ru`, staff flag/client ID, отдельный URL-safe client secret32–128, отдельный 32-byte JWE key (`ALISA_STAFF_SESSION_KEY`, base64url43), staff service token |
| Migration env | Существующие собственные DDL credentials; staff flag0. Новые runtime secrets туда не добавлять |

Admin не получает DB credentials, web/probe keys или identity private material. Ключи admin cookie/client и staff service authority не переиспользуют клиентские web значения.

Создаётся только новый confidential Code client `alisa_admin_stage` с точным callback, S256, scopes `openid email profile`. Для `identity_clients --apply` сделать новую закрытую копию прежнего S02 `bootstrap.env`, чьё наличие и оба прежних client secret подтверждены read-only; исходный S02 bootstrap не менять. Новая копия содержит прежние web/probe values и новые staff values, работает в конечном bootstrap процессе, не в демоне IdP. Команда проверяет прежние redirect/secret и прекращается при mismatch; после неё проверить, что два старых Client не изменились. Штатный bootstrap не восстанавливает уже пустые grant/response fields: для повторного включения используется отдельная процедура ниже.

## Выполнение после допуска

1. Заново сверить actual HEAD/source/package hashes, собственные env/unit/vhost fingerprints, БД/roles и migration heads, health/pointers, ресурсы, WIP и отсутствие чужого активного rollout. При drift сначала выяснить новые изменения и обновить точный план; не перезаписывать чужие активные пути. Не повторять установку при неизвестном исходе: сначала readback. Последняя оценка: диск3989MiB свободен, MemAvailable6291MiB; сохранить минимум3072MiB диска,200000inode и1024MiB RAM сверх пиков/неиспользованных параллельных бюджетов. До install рассчитать upload+unpacked+venv+private snapshots; при недостатке прекратить только зависимое действие, ничего исторического не чистить.
2. Сохранить приватные snapshots собственных env, pointers, unit/drop-ins и только изменяемого admin vhost, schema heads и consistent dumps двух собственных БД. Права закрыты; существующие data/keys/backups не удаляются. DB restore не используется для обычного rollback. Снять безопасный baseline web/lab/OAuth/default и прежних Client/Person/Subject/Customer/Tenant/profile/consent invariants без их значений в публичном отчёте.
3. Получить exact CI bytes, проверить tar SHA256 и полный manifest. Выполнить только offline install через `infra.release.install(stage, artifact, expected_sha256)` или `bin/alisa deploy --env stage --artifact … --sha256 …`. Команда устанавливает bytes, но не активирует. Если release уже есть, проверить immutable manifest и исход; не устанавливать поверх. Не применять generic `release.switch`, `bin/alisa rollback` или foundation verify: они затрагивают shared current/все компоненты. Конечный maintenance процесс ограничен штатной systemd cgroup, временем и ресурсами по фактическому расчёту; секреты не передаются argv/свойствами unit.
4. Подготовить component env с staff flags0, сохранив прежние accounts/identity flags1, probe0, CLOSED и SMTP. На exact release выполнить `bin/alisa migrate --env stage --release alisa-3e91b1aa5d405d0e --plan`: ожидать только platform `staff.0001_initial`, identity plan пуст. Затем тот же `--apply`; повторный plan пуст. Проверить пять таблиц, собственную runtime audit privilege restriction и неизменность прежних heads/foreign CONNECT/DDL deny.
5. До первого callback изменить только admin server block в `/etc/nginx/sites-available/alisa-platform-stage.conf`: существующий safe log format method+$uri+status без query/referrer, лимит16k, точные Host/X-Forwarded-Proto. Не переписывать весь example config. Проверить nginx syntax, затем reload. На время подготовки admin ingress закрыт; обратное открытие только после готовности S03. Другие server blocks сохраняются побайтно.
6. Добавить только собственный `/etc/systemd/system/alisa-admin@stage.service.d/s03-release.conf`: WorkingDirectory и сброшенный/новый ExecStart на `admin-current`. Существующий `s01-design.conf` не редактировать. Атомарно переключить `site-current`, `identity-current`, `admin-current` на exact S03; shared current и web-current не менять. После собственного drop-in выполнить daemon-reload и restart только platform/identity/admin; старые процессы должны завершиться. При flags0 все staff start/API endpoints отказывают. Существующие mail/cleanup timers сохраняются: их pointers уже ведут к совместимой схеме.
7. Закрытым конечным bootstrap создать новый client, проверить прежние клиенты. Включить identity и platform staff flags, restart этих двух компонентов, затем admin flag/restart и открыть admin ingress последним. Проверить реальные версии/READY. Публичный вход не назначает staff.
8. Через реальный HTTPS и native email-code/MFA подтвердить synthetic owner identity и её pairwise subject именно для admin client. Только после проверки signed issuer/client/subject/MFA и соответствующей native Subject-записи подготовить собственный root-owned JSON0600 в закрытом S03 backup: issuer, client_id, subject, name. Публичный отчёт хранит лишь результаты этих проверок. Передать JSON через stdin закрытому конечному `manage.py shell --command` процессу, работающему с platform runtime env. В argv находится только статический код ниже; не передавать `--subject`/значения CLI и не печатать входной JSON. Используется существующий штатный Django `call_command`, а не новый публичный endpoint или изменённый runtime package:

```python
import io, json, sys
from django.conf import settings
from django.core.management import call_command
value = json.load(sys.stdin)
if set(value) != {'issuer', 'client_id', 'subject', 'name'}:
    raise SystemExit('Invalid closed bootstrap input')
if (value['issuer'] != 'https://id-stage.octoport.ru'
        or value['client_id'] != 'alisa_admin_stage'
        or settings.ALISA_ENV != 'stage'
        or settings.STAFF_CLIENT_ID != value['client_id']):
    raise SystemExit('Wrong closed bootstrap scope')
call_command('bootstrap_staff_owner', apply=True,
             subject=value['subject'], name=value['name'],
             stdout=io.StringIO(), stderr=io.StringIO())
print('OWNER_BOOTSTRAP_COMPLETED')
```

Статический `--command` читает file descriptor0; shell перенаправляет `< /var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e/verified-owner.json`. Файл парсится как данные, не source/eval; input/значения не попадают в argv, stdout или journal. Только первый OWNER: штатная команда сама запрещает повторную замену/добавление владельца при наличии staff rows. Проверить одну новую own OWNER row без публикации subject. Далее роли назначаются действующим OWNER по штатной команде. После этого провести перечисленные ниже smoke, restart, возврат и повторное включение, затем независимый installed review.

## Что проверить на фактическом stage

- Новый owner/reader проходят штатный enrollment и step-up, настоящий TOTP/recovery → библиотечный Code/S256 → отдельный admin BFF → API/PG. Сохранённый MFA label, настроенный фактор без свежего события, чужие/старые claims и customer cookie не дают staff-доступ. Обычный клиент со своей MFA остаётся без роли.
- В админке видны реальные synthetic клиенты S02 и заявки отдельно, поиск и карточка. Block/unblock влияет только на свой newly-created synthetic customer в Алисе; global Person/другой RP сохраняются. Limited ADMIN с users.read не выполняет block через прямой backend запрос. Отзыв staff закрывает два независимо вошедших контекста; last OWNER защищён.
- Повтор UUID с прежним payload имеет один эффект/revision; другой payload конфликтует; отозванные актуальные права не оживают при replay. Audit не содержит email/token/OTP/QR/raw query и runtime не может UPDATE/DELETE/TRUNCATE. Срок и product-scoped cleanup проверяются на собственных fixtures.
- Перезапустить собственные platform/identity/admin, подтвердить именно candidate versions, сохранность identity/customer/staff/receipt и безопасный отказ ранее отозванных сессий. Проверить существующие timers/mail и query-free ingress/service logs, CSRF/Origin/issuer/client/cookie separation.
- На неизменённом web-current повторить customer login/profile/выход, те же person/customer/tenant и профиль без дублей. Проверить новый дизайн login/signup/code/MFA/error/admin, размеры320/390/1440, QR на белой подложке; в screenshots не включать секреты/OTP/recovery. Web/lab/OAuth/default baseline сохраняется.

## Контролируемый возврат к совместимому старому коду

Отключение flags само по себе не стирает активные staff payload. Старый S02 cleanup staff-таблицы не обслуживает, а старый IdP не знает S03 MFA policy. Поэтому следующий порядок обязателен **пока ещё исполняется S03**:

1. Закрыть admin ingress в собственном vhost; установить staff flags0 в admin/platform/identity и restart/drain этих трёх служб. Проверить завершение старых процессов и отказ новых staff start/API endpoints. Убедиться, что уже начатые запросы не могут позже создать новый session/code. Только после этого выполнять SQL.
2. Проверить exact hash platform SQL. Выполнить его только в `alisa_stage_platform` от `alisa_stage_platform_runtime` через `psql --set ON_ERROR_STOP=1 --file …`; DSN/пароль из защищённого окружения, не argv. Скрипт отзывает все собственные `alisa_market` StaffSession, consume всех собственных StaffAuthFlow, стирает их encrypted payload и append safe audit. Перед COMMIT он обязан подтвердить нули. Повтор безопасен, первый revoked_at сохраняется; чужой product и customer/user sessions не меняются.
3. Проверить exact hash identity SQL; выполнить тем же способом только в `alisa_stage_identity` от `alisa_stage_identity_runtime`. Он оставляет ровно один `alisa_admin_stage`, отключает его grant/response fields и удаляет только его native Token rows; id/secret/redirect, Subject/Person и старые web/probe clients остаются. Ожидаются `admin_client_rows=1`, `enabled_admin_clients=0`, `remaining_admin_tokens=0`. Отсутствующий client — ошибка, а не успех. Для сбоя до создания client разрешён отдельный ранний выход только после read-only доказательства его отсутствия и нуля token rows; такой исход не считать проверенным полным rollback.
4. После SQL2 ещё раз restart/drain identity с flags0, чтобы не оставить запрос, успевший прочитать прежние разрешённые поля Client. Проверить отсутствие code/token выдачи dedicated admin client через native endpoints и повторить SQL2/postcondition readback; момент подтверждённого drain является нижней границей ожидания TTL. Сверить postconditions и customer/foreign/client invariants; staff bearer отказывает, web/probe продолжают работать. При любой ошибке SQL/проверки не переходить к старому коду: оставить staff закрытым и выяснить исход. Авторизационные codes в protocol cache не удаляются SQL2; выдержать больше фактического native code TTL после последней возможной выдачи (в pinned package60секунд, при сверке проверить отсутствие override).
5. Только затем вернуть site-current к S02, identity-current/admin-current к сохранённому e820. Снять лишь свой s03 admin drop-in, сохранив прежний s01-design; восстановить прежние component env без новых staff flags, но сохранить новые keys в закрытом S03 snapshot. Выполнить daemon-reload и restart только этих трёх служб. Web-current/shared current не менять. Открыть admin ingress уже на прежнюю закрытую оболочку. Проверить фактические версии и клиентский путь.

Ни down migrations, ни DB restore, ни удаление Person/Subject/Customer/Tenant/StaffMember/audit/command receipts не выполняются. Additive staff schema и runtime audit privileges остаются. Identity MFA enrollment и все новые keys сохраняются, чтобы повторное включение не создало дублей и не потеряло зашифрованные данные.

## Повторное включение той же S03

Снова закрыть admin ingress; выставить flags0 и вернуть exact S03 pointers/drop-in. Проверить hashes/config/schema и запуск S03 с закрытыми endpoints. Выдержать подтверждённый code TTL от предыдущей выдачи. В закрытом native ORM transaction сверить сохранённые admin client id/type/secret/redirect/Subjects и восстановить **только** `grant_types=authorization_code`, `response_types=code`; не запускать неявную rotation. Проверить неизменность старых web/probe clients и отсутствие старых admin tokens. Включить identity/platform, затем admin, открыть ingress последним и потребовать свежий native MFA login. Старые staff token/flow и отозванные роли должны по-прежнему отказывать. Проверить те же identity/customer/tenant/profile/staff/receipt IDs и отсутствие второго OWNER/эффекта.

Результат записывается как фактические installed smoke/restart/rollback receipts с привязкой к exact source/package и считанным версиям. Независимый installed verdict принимается отдельно. Зелёный CI, выданный допуск и READY не закрывают AL-S03.
