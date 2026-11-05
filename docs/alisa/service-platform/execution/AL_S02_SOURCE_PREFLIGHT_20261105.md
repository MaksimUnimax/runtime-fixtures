# AL-S02 · исходный checkpoint после приёмки S01

Статус: PREPARATION_STARTED, реализация и установленная приёмка S02 ещё не выполнены. Автор — существующий исполнитель платформы. Матрица и обработчик остаются у другого исполнителя.

## Проверенные входы

- S00 и точный S01 stage приняты: [итог S01](AL_S01_INDEPENDENT_INSTALLED_ACCEPTANCE_20261105.json). Runtime сайта/API `8d680f775c8ccdf2a9520fa93c4909dd0aaaa986`; identity/admin пока принятый S00.
- S01 source+evidence head `8b900e332457c42263165d8508bd7f4f57cd2687`, tree `2c61c42235d6df4ccf3c2384312f820ca55d741e`. Локальный `997dd0e684575e73b91d830083a2a0fc8bd3c37d` имеет ту же tree. WIP чист, незавершённого merge нет. Проверены существующие worktrees и открытые PR: дублирующего AL-S02 нет; PR383/384 сохранены.
- `Person.id` уже UUID в отдельном identity; подтверждённые контакты, OIDC и сессии пока не реализованы. Текущая platform не имеет accounts/user/tenant; `/app` ещё закрыт. Нельзя выдавать shell или health за регистрацию.
- Существующий SMTP stage допускает только example.invalid. Приём S01 не доказывает доставку на настоящую контролируемую почту для будущих клиентов S02.

## Ближайший конкретный результат

Проверить в изолированном исходном эксперименте первый предусмотренный roadmap кандидат `django-allauth[idp-oidc]` версии 65.21.1. На 05.11.2026 официальный changelog указывает этот выпуск и исправления rate limits/WebAuthn. Это кандидат к закреплению, зависимость ещё не добавлена и совместимость с текущим lock не заявляется.

Эксперимент должен доказать совместимость UUID Person, email-code/MFA, Authorization Code + обязательный PKCE S256, фиксированный issuer/discovery, subject двух независимых клиентов без email-merge, одноразовый code, проверку state/nonce/issuer/audience/signature/expiry, logout и rotation ключей. Опубликованные возможности библиотеки не заменяют исполненных отрицательных проверок. Endpoint paths брать из discovery реально выбранной закреплённой версии.

Затем реализовать единый путь главная → `/auth/start` → identity → `/auth/callback` → собственный `/app`, вместе с локальными user/tenant/membership, серверным хранением токенов и host-only HttpOnly Secure session. Пустое состояние кабинета, профиль/статус доступа/выход входят в тот же шаг. Flow ID непрозрачен, UTM/email/code/state не попадают в журналы или произвольные OAuth параметры. Другому синтетическому клиенту не выдаются данные или права Алисы.

Сценарии: AL-T01-01–05, AL-N02-01, AL-V04-05–09; повторить затронутый S01. Если первый кандидат не обеспечивает обязательные свойства, оформить точный ADR об одном зрелом альтернативном provider; собственный криптопротокол и второй issuer не вводить.

## Граница установки

Сейчас разрешены изучение, исходники и изолированные disposable проверки. Допуск S01 исключал живой identity: его БД, clients, signing/session keys, issuer/security-настройки, nginx identity и реальная доставка почты не меняются. Перед установленной S02 подготовить конкретный новый пакет, перечень миграций/настроек и безопасный возврат; отдельно согласовать этот точный live/DB/security/mail план. До готовности такого пакета повторное общее разрешение не запрашивается.

## Первичные источники кандидата

- [Identity provider](https://docs.allauth.org/en/latest/idp/openid-connect/introduction.html)
- [Выпуски и исправления](https://docs.allauth.org/en/dev/release-notes/recent.html)
- [Конфигурация/rotation](https://docs.allauth.org/en/latest/idp/openid-connect/configuration.html)
- [OIDC clients](https://docs.allauth.org/en/latest/idp/openid-connect/clients.html)
- [Adapter/subject](https://docs.allauth.org/en/latest/idp/openid-connect/adapter.html)

Следующий шаг: изолированная проверка совместимости кандидата и фиксация её фактических результатов; не устанавливать S02 на живой стенд по допуску S01.
