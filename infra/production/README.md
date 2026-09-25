# infra/production

Production beta эксплуатация: TLS, email, secret injection, backups/restore, admission initially closed.

Текущая доменная authority: [Octoport ingress plan](../../docs/server/DOMAIN_INGRESS_PLAN_2026-09-16.md).

## DOMAIN-D2: Octoport ingress pre-deployment

D2 подготавливает только безопасный HTTPS ingress для доменов, DNS которых уже указывает на `78.17.68.165`:

- `octoport.ru`;
- `www.octoport.ru`;
- `app.octoport.ru`;
- `api.octoport.ru`.

`admin.octoport.ru` не является отдельным application origin. Будущая админка остаётся same-origin по адресу `https://app.octoport.ru/admin/`.

D2 намеренно **не** разворачивает portal/API/admin и не проксирует на несуществующие application-процессы. До реального deployment:

- `octoport.ru` отвечает явным `503`;
- `app.octoport.ru` отвечает явным `503`;
- `api.octoport.ru` отвечает явным JSON `503`;
- `www.octoport.ru` делает постоянный redirect на `https://octoport.ru`;
- HTTP на включённых Octoport-hostnames переводится на HTTPS после выпуска сертификата;
- `docs.selleragents.ru` не меняется.

Файлы:

- `nginx/octoport-bootstrap.conf` — временный HTTP vhost для ACME webroot challenge;
- `nginx/octoport-predeploy.conf` — финальный D2 HTTPS ingress до deployment приложений;
- `scripts/deploy-octoport-ingress.sh` — bounded deploy с DNS/IP preflight, backup, Certbot, `nginx -t`, reload и rollback при ошибке;
- `scripts/verify-octoport-ingress.sh` — проверка DNS, SAN сертификата, реально выдаваемого сертификата, redirect/status behavior, сохранности старого docs-host и `certbot.timer`.

Запуск выполняется только на целевом сервере из проверенного checkout этой ветки:

```bash
bash infra/production/scripts/deploy-octoport-ingress.sh
```

Если на сервере нет уже зарегистрированного Certbot account, перед запуском требуется передать email только через окружение:

```bash
CERTBOT_EMAIL='owner@example.com' bash infra/production/scripts/deploy-octoport-ingress.sh
```

Email в Git не сохраняется.

После deployment отдельная проверка:

```bash
bash infra/production/scripts/verify-octoport-ingress.sh
```

D2 не является production launch. Реальные upstream для portal/admin/API добавляются отдельным этапом после их production deployment и acceptance.

## SITE-S1: static public-site deployment candidate

SITE-S1 публикует только уже принятую статическую поверхность из `apps/site/public/` на `https://octoport.ru/`.

Подготовленная схема:

- каждый Git HEAD публикуется в отдельный неизменяемый каталог `/var/www/octoport-site/releases/<sha>`;
- `/var/www/octoport-site/current` атомарно переключается symlink-ом на выбранный release;
- `nginx/octoport-site.conf` заменяет только apex `503` реальным статическим root;
- `www.octoport.ru` остаётся redirect-only;
- `app.octoport.ru` и `api.octoport.ru` продолжают отвечать intentional `503` до их отдельных deployment-этапов;
- `admin.octoport.ru` не включается как application vhost;
- `docs.selleragents.ru` остаётся отдельным действующим сервисом;
- существующий сертификат Octoport переиспользуется, новый Certbot issuance SITE-S1 не выполняет.

Deploy:

```bash
bash infra/production/scripts/deploy-octoport-site.sh
```

Отдельная проверка:

```bash
bash infra/production/scripts/verify-octoport-site.sh
```

Deploy script делает backup текущих Octoport nginx-конфигов и target текущего release, проверяет byte parity staged release, выполняет `nginx -t`, reload и live verification. При ошибке он сохраняет диагностику и восстанавливает предыдущие nginx/current состояния. Release-каталоги автоматически не удаляются.

Подготовка SITE-S1 в Git не означает, что публичный сайт уже переключён. Серверное выполнение и внешняя визуальная/HTTP приёмка фиксируются отдельно.

Границы репозитория: [архитектура](../../docs/architecture/OVERVIEW.md), [размещение](../../docs/architecture/REPOSITORY.md), [текущий статус](../../docs/STATUS.md).

## C04/C05 ops runtime preparation

The Telegram monitoring operator and independent PostgreSQL backup path are prepared as source-only operations tooling. Preparation is not deployment authorization.

Operational invariants:

- build immutable ops releases with `scripts/prepare-octoport-ops-release.sh` from a clean accepted checkout into a non-home release root;
- Telegram runs as a dedicated non-root identity from the immutable release, reads protected systemd EnvironmentFiles, and fails closed when required runtime configuration is absent;
- installer scripts install/render units only; they do **not** enable or start Telegram or backup services;
- the backup timer is daily with persistent catch-up and randomized delay, but remains disabled until an explicit deployment action;
- backup destination must be an actual mount different from the PostgreSQL data mount by both mount source and device id;
- host `pg_dump` and `pg_restore` are mandatory prerequisites; installers fail closed if they are missing and do not install OS packages;
- backup publication is staged atomically, custom-format archive readability is checked with `pg_restore --list`, SHA-256/size are recorded, and retention considers only backups whose manifest, hash and archive listing revalidate;
- secrets stay outside Git and release metadata. No token, DATABASE_URL password, OTP, cookies or marketplace payload may be recorded in release receipts.

Required deployment inputs that are intentionally not invented by source preparation:

- dedicated non-root service user/group;
- protected Telegram environment file and owner-selected operator/chat ids;
- a release root accessible under `ProtectHome=yes` (not `/root`, `/home` or `/run/user`);
- PostgreSQL client tools on the host;
- a genuinely independent/off-host or separately mounted backup destination plus its protected backup env file;
- measured resource ceilings before any finite `MemoryMax`/`CPUQuota`/`TasksMax` values are introduced.

Any enable/start, live Telegram delivery, live database backup schedule, restore acceptance or production RPO/RTO claim remains a separate authorized operation and evidence class.
