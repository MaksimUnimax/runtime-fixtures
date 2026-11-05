# Алиса: обычные адреса админки и входа · 5 ноября 2026

**Установлено и проверено. Личный вход владельца с MFA ещё ожидается.**

| Назначение | Рабочая ссылка |
| --- | --- |
| Сайт и обычный кабинет | https://alisa.octoport.ru/ |
| Админка | https://alisa-admin.octoport.ru/login |
| Общая страница входа | https://id.octoport.ru/accounts/login/ |

Прямое указание владельца: дать ссылку и сразу перенести админку с тестового домена на нормальный. Перенесены оба видимых адреса — admin и identity. Используется прежнее приложение и прежние БД во внутреннем stage namespace; отдельная новая production DB не создавалась. Внешние адреса теперь без stage. Все четыре компонента работают на `alisa-482ed11832b666af`.

## Сохранность аккаунтов и прав

Сохранены8 существующих web identity links и2 staff-записи. Не изменились Person, pairwise Subject, подтверждённые контакты, согласия, Customer, Tenant, Membership, Client IDs/секреты, signing/data keys, роли и permissions. Единственный OWNER по-прежнему связан с той же известной подтверждённой настоящей учёткой владельца. При смене issuer его revision увеличена2→3; прежние сессии отозваны, payload очищен. В append-only audit добавлены2 события смены issuer.

Факторы не расшифровывались, не создавались и не изменялись: проверены идентификаторы/тип/xmin строк без data. Снимки совпали до открытия нового ingress. Обязательная нативная StaffMFAPolicy и понятная форма подключения приложения сохранены. У владельца на момент финального readback факторов0, новых staff-сессий0: **WAITING_FOR_USER_FACTOR_SETUP**, а не завершённый личный вход.

Закрытый переход меняет только фиксированные issuer/callback существующей authority. Строгий stage-only флаг не расширяет dev/prod, не принимает оба issuer одновременно и не выбирает authority по Host. CLI проверяет точный состав привязок, counts, owner/revision и целевые коллизии; повтор идентичного завершённого перехода — no-op. Атомарный marker в прежнем confidential Client отличает завершение от частичного состояния. Person/Subject или новый OWNER не создаются.

## Фактическая установка и проверки

Source `482ed11832b666af17f879ae710fd43d2c321ce7`, [PR394](https://github.com/MaksimUnimax/runtime-fixtures/pull/394). Tar SHA256 `9c7b0d5ad216da453f1ed3b8f053b0f5d16f7c0551d5cc9e97f26e3729c1faf7`; [закрытый порядок переноса](https://github.com/MaksimUnimax/runtime-fixtures/blob/482ed11832b666af17f879ae710fd43d2c321ce7/docs/alisa/service-platform/execution/ALISA_CANONICAL_AUTH_RUNBOOK_20261105.md). Миграций и смены ключей нет.

Перед записью ingress всех шести адресов был закрыт: прямые HTTPS503 с уникальным marker, без следования redirects. Собственные writers остановлены. Обе guarded транзакции выполнены; старые native access/refresh tokens, code cache и identity sessions удалены, старые flows/product sessions инвалидированы, pending mail codes погашены без replay. Terminal unknown/rejected diagnostics сохранены. После сверки инвариантов и readiness перезапущены только четыре компонента портала; прежние таймеры восстановлены. Алиса/lab, SMTP sandbox, старый Октопорт и Business Bridge не затронуты.

CI точного источника:62/62 source,96/96 PostgreSQL/browser,147/147 HTTPS/BFF/cabinet/staff,130/130 registration,17/17 runtime policy subset,92/92 staff/native/canonical-cutover. [Platform CI](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42032145588), [identity probe](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42032145546), [docs CI](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42032145957).

На установленной системе: нативный вход прежнего контролируемого synthetic аккаунта до перехода3/3; после перехода18/18. Новый issuer вернул тот же customer/tenant; старый web cookie отклонён, проверочная новая сессия завершена выходом. HTTPS админки200, её authorization redirect использует id.octoport.ru и обычный admin callback. Wrong Origin отклонён; canonical discovery endpoints принадлежат новому issuer.

Старый admin callback отправляет на свежий обычный login без code/state; POST409. Старый identity protocol/discovery/token endpoint возвращает410; прежняя ссылка настройки приложения требует чистого входа на новом домене. Safe access logs не содержат query. Сертификат с уже имеющимися SAN использован без перевыпуска.

Первый запуск установки остановился до изменения authority на проверке готовности Nginx после reload; исходные конфигурации и готовность старых компонентов автоматически восстановлены, private binding plan ещё не создавался. В r2 добавлено ограниченное ожидание прямого marker на всех шести адресах; проверка прошла на втором опросе. Первый FAILED receipt сохранён. Отдельный первый browser attempt не нашёл настроенный browser cache и не начал сценарий; повтор с существующим cache прошёл. Это не ошибки входа пользователя.

Независимые exact-source, операционный и installed-evidence reviews PASS. Ревьюер дополнительно проверил анонимный HTTPS/discovery/retirement;18 сценариев лично не переисполнял и реальный MFA владельца не выполнял. [Полная обезличенная квитанция](ALISA_CANONICAL_AUTH_ACCEPTANCE_20261105.json).

## Следующий шаг владельца

Открыть https://alisa-admin.octoport.ru/login и пройти свежий вход по почте. Затем подключить приложение-аутентификатор на своём телефоне: отсканировать новый QR и ввести текущие6 цифр в нижнее поле. Длинный ключ подключения не является проверочным кодом. Ключ и код в чат передавать не требуется. Прежние вкладки настройки после переноса требуют свежего входа.
