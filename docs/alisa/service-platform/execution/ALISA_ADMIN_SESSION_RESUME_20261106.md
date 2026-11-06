# Алиса: продолжение действующего входа и повторный код · 6 ноября 2026

Установлено 6 ноября в 03:16:11 UTC (08:16:11 UTC+5). Админка: https://alisa-admin.octoport.ru/admin. Admin и identity работают на `alisa-73180172646b7012`; web/platform сохранены на `alisa-c8666516683e7b2b`. Подробная [квитанция](ALISA_ADMIN_SESSION_RESUME_ACCEPTANCE_20261106.json).

Реальный вход владельца после этой установки остаётся ручной проверкой. Полный положительный путь ниже проверен на одноразовой синтетической учётке через настоящий native verifier и собранный браузерный интерфейс.

## Причина и границы доказательства

После принятого MFA страница /login и POST /auth/start всегда начинали новый OIDC flow, даже при действующем staff cookie. Это снова приводило к вводу кода. Native allauth запрещает повтор уже использованного значения и раньше показывал общее «Неверный код».

Metadata-only проверка до исправления показала прежнюю привязку TOTP от 01:51:08 UTC, native last_used 02:34:35 UTC и OWNER session, созданную в 02:34:18 UTC с MFA в 02:34:16 UTC. NTP synchronized. Нового аутентификатора оператор не добавлял. Эти метаданные доказывают успешную native проверку, но не устанавливают причину ошибки конкретного значения на скриншоте. Повторное использование — возможная причина; новая подсказка показывается только при наличии настоящего native consumed-value marker.

Предыдущий прогон проверял initial enrollment/recovery continuation, но пропустил повторное открытие /login с уже действующим входом. В этот прогон добавлены оба состояния и уже подключённое приложение.

## Поведение после изменения

- /, /login и POST /auth/start открывают /admin при backend-valid staff session; новый flow, cookie, session и продление сроков не создаются.
- Host/Origin/query/body guards выполняются до reuse. Duplicate/forged/revoked/expired/stale-MFA/revision mismatch не дают доступ.
- При недоступности backend показывается временная ошибка; новый MFA flow не запускается.
- Native authentication/reauthentication сначала выполняют прежний native clean_code. Только incorrect_code с уже существующим native used-value marker получает подсказку дождаться следующего кода. Marker не меняется, ожидаемый код не генерируется, фактор не читается диагностикой.
- Отклонённое значение очищается из input. На экране MFA есть прямая ссылка «Открыть админку».
- Сохраняются ранее исправленные один native challenge при подключении и выход со страницы резервных кодов в админку.

Обязательная native MFA, 300 секунд её свежести, абсолютный максимум staff session 1 час, rate limits, replay protection, revisions и OWNER permissions сохранены. Роли, issuer, clients, keys, факторы и пользовательские sessions оператор не менял.

## Точный пакет и совместимость

Source: `73180172646b7012f1df8026ee8e3b43e8829ce0`. [PR397](https://github.com/MaksimUnimax/runtime-fixtures/pull/397). Composite merge сохраняет установленный S04 `c8666516683e7b2bedc2c1a7d939e9e3c4489d38` и identity `1432dcc21a07b90b07428ef2585af5cd196a80aa`.

Tar SHA256: `db04b26d521a141cff933b54003700e73152b94d5df4dcc3e2463c44cf4ec2e5`. [CI42153553914](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42153553914) SUCCESS; identity-probe и documentation CI SUCCESS. Artifact IDs: package13473244349, qualification13474220213.

| Квалификация пакета | Пройдено |
|---|---:|
| PostgreSQL + packaged browser | 96/96 |
| HTTPS BFF / cabinet / staff browser | 179/179 |
| Open email registration | 130/130 |
| Runtime policy | 17/17 |
| Native MFA / staff core | 118/118 |
| S04 access ledger / bulk | 36/36 |

Проверены уже подключённый native TOTP: email → один реальный TOTP → callback → OWNER dashboard; warm cookie через root/login/login?error/start; отсутствие новых flow/session/mail и продления MFA; неверные cookies; expired/revoked/stale/revision states; backend503; native replay message, generic wrong code, recovery и rate-limit. Initial enrollment → recovery → continue сохранён. Положительные native проверки не подменялись mock.

Contracts/locks/migrations равны установленному c866; platform component bytes равны c866. Identity delta относительно1432 ограничена четырьмя проверенными файлами формы/подсказки/контекста. Новых миграций нет.

## Фактическая установка и проверка

После независимого source и operation review изменены только admin-current и identity-current. Обычный immutable installer использован с022 только для runtime installation; backup/receipts077. Оба service users до переключения прочитали payload и импортировали зависимости. Полный установленный manifest проверен.

36/36 installation checks PASS. Четыре службы READY. Web/platform/private SMTP PID и все bytes конфигурации /etc/alisa-platform сохранены. На ошибке готовности предусмотрен возврат только двух code pointers; БД и факторы не восстанавливаются.

Readback 03:16:46 UTC PASS: реальная canonical HTTPS / → /admin, anonymous /admin → /login, /login200 с формой, identity/product200; все no-store. Под runtime identity загружены новые native forms, пустой rejected input, исходный single-challenge activation class и прежний issuer. Template hashes и точные versions записаны в квитанции.

Независимый installed-evidence review: PASS_INSTALLED_EVIDENCE. Подтверждены component versions, реальные anonymous HTTPS redirects,4 identity file hashes, сохранённый tar SHA256,36/36 installation checks и6 qualification reports. Положительный login/reuse подтверждён synthetic квалификацией; личный вход владельца этим не подменяется.

Для disk reserve убраны только3 ZIP-обёртки, полностью совпадающие с сохранёнными tar+checksum;235 byte-identical wheels в16 inactive releases объединены hardlinks с сохранением путей/manifest bytes и before metadata. Активные releases/inodes исключены. Уникальные архивы, версии и пользовательские данные не удалялись. После сохранения нового tar осталось3236MiB, выше резерва3072MiB. Все квитанции сохранены.

## Ручная проверка владельца

Открыть https://alisa-admin.octoport.ru/admin. Действующий вход ведёт в кабинет. Если сервер требует свежий вход: один код из письма, затем один текущий код из прежней записи приложения. При точной подсказке «код уже использован» дождаться смены значения. Новая QR-привязка не требуется.

Оператор не использовал секреты, QR, коды, recovery codes или session tokens владельца и не создавал его фактор/сессию. Доступ владельца в этой установленной версии пока не заявляется как лично проверенный.
