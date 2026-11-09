# Identity и последующее объединение · контракт v0.5

**Основание:** принятое для переработки предложение «самостоятельно сейчас, объединение позже»; источник сохранён в `sources/SEPARATE_NOW_UNIFIED_LATER_2026-11-04.md`. Это проект новой платформы, а не подтверждение внедрения.

## 1. Сейчас

Работают независимо нынешний Octoport и новая Алиса. Алиса имеет собственные сайт, ЛК, admin, продуктовую БД, ключи, деньги, каталог, поддержку и выпуск. Новая identity-служба обслуживает сначала только Алису и не читает Octoport users/beta/subscriptions. Сбой или задержка разработки Octoport не блокирует Алису.

Сайт/ЛК: `https://alisa.octoport.ru`, `/app`. Админка: `https://alisa-admin.octoport.ru`. Identity issuer: **`https://id.octoport.ru`**, без автоматической смены имени при будущем объединении. Staging повторяет эту схему на alisa-stage / alisa-admin-stage / id-stage, с другим issuer, ключами, client IDs, БД и cookies.

## 2. Вход в браузере

Кабинет и admin — отдельные OIDC clients. Используется библиотечный Authorization Code + PKCE S256, state/nonce, проверка подписи, issuer, audience, срока, точного callback. Email-код и MFA обслуживает identity. Product BFF обменивает code на сервере и создаёт собственную host-only HttpOnly Secure session; bearer tokens не хранятся в localStorage. Redirect URI передаётся строго из зарегистрированного списка, return_to — локальный allowlist.

Разрешённые проектные callbacks:
- prod user: `https://alisa.octoport.ru/auth/callback`;
- prod staff: `https://alisa-admin.octoport.ru/auth/callback`;
- stage user: `https://alisa-stage.octoport.ru/auth/callback`;
- stage staff: `https://alisa-admin-stage.octoport.ru/auth/callback`.

Каждый URI относится только к своему client и окружению; wildcard не допускается. До проверки metadata точные token/authorize/JWKS paths берутся из discovery выбранной библиотеки, не угадываются. Root issuer должен совпасть с опубликованным discovery; это проверка шага 02. Второй тестовый client может иметь изолированный route `/oidc-probe/callback` на stage; он не получает продуктовые grants или доступ к БД.

Доступ к backend не выдаётся по одному ID token. Audience, product permission, tenant membership и актуальная security revision проверяются сервером. Для staff недостаточно обычной сессии identity: нужен доказанный фактор MFA/step-up и локальная staff assignment.

Сессии имеют разные имена и собственные signing/encryption keys; `Domain=.octoport.ru` запрещён. Для OIDC callback transient state cookie должна поддержать top-level redirect (обычно SameSite=Lax); не применять Strict вслепую так, чтобы терять state. Политика CSRF/Origin обязательна, включая соседние поддомены. Логи callback не записывают query string с code/state. Logout текущего приложения и «выйти везде» — разные действия с проверенной политикой отзыва.

## 3. Источники истины

Identity: `person_id`, подтверждённые контакты, факторы, identity sessions, signing keys и глобальный security status.
Продукт Алиса: локальный `user_id`, `tenant_id`, membership, связь с `(issuer, sub)`, свои роли, магазины, grants, платежи и события.

`person != local_user != tenant != Yandex grant != marketplace account`. Email изменяем; `(issuer, sub)` является внешним субъектом. При pairwise subject нельзя считать sub одинаковым в user/staff/втором client; соответствие решается доверенным identity-сервисом/проверенной таблицей, не совпадением email.

Продуктовые операции несут `product_id=alisa_market`. Другой продукт — `octoport_extension`; права/подарки/оплаты не перетекают. Блокировка клиента Алисы не является глобальной блокировкой личности. Глобальный security revoke — отдельная защищённая команда, а не побочный эффект support-действия.

## 4. Яндекс — отдельная авторизация

OIDC ЛК не заменяет OAuth разрешение навыку. Текущий `alice-lab.octoport.ru` и его code/token/refresh mappings сохраняются до отдельной проверенной миграции. Для нового тестового навыка платформенные `/oauth/*` и `/integrations/alice/webhook` на stage вводятся в шаге 06. Изменение issuer ЛК не должно заставлять уже связанную Станцию перерегистрироваться.

Сохранность проверяется на конкретных старых токенах и клиентах без их раскрытия. Если часть связок несовместима, нужен отдельный понятный re-link без потери tenant/магазинов/оплаты; отсутствие такого доказательства не маскируется PASS. HTTP redirect на токеновом API не является миграцией.

## 5. Будущее подключение Октопорта

OIDC adapter отображает новый субъект на существующий local user/account. Пользователь доказывает контроль обеих учётных записей, включая прежнюю MFA. Совпадение email — только подсказка, никогда merge. Подтверждение одноразовое, с точными двумя ID, сроком, CSRF/nonce, idempotency и audit. Не сливать разные организации одного человека.

Общий ЛК — единая оболочка с профильной навигацией и двумя product APIs. Общая админка — единая карточка человека и продуктовые scope. Платёжные journals не копируются и не повторяют grants. Пример инварианта: 40 дней Алисы + неоплаченный Octoport остаются ровно тем же состоянием.

Ключи расширения не передаются серверу Алисы автоматически. Общая карточка магазина — представление, а новое подключение/разрешение продукта — отдельное действие.

## 6. Сохранение самостоятельности

Будущий единый вход станет общей зависимостью новых login обоих продуктов; его HA/backup/revocation проверяются при подключении второго. Это не делает уже существующий backend Octoport зависимостью Алисы сейчас. Даже после общего интерфейса product APIs и release pipelines можно оставить раздельными.

Общая UI-библиотека pinned. Монорепозиторий не означает один deploy. При объединении по одному origin path не является границей безопасности; до security review приложения остаются на разных origins. Next.js Multi-Zones — возможность постепенного маршрутизирования, не готовый SSO.
