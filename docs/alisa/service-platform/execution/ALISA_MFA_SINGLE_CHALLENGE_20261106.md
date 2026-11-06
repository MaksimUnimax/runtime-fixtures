# Алиса: один код приложения и продолжение в админку · 6 ноября 2026

**Исправление установлено. Приложение владельца уже подключено; повторная настройка не нужна. Личный вход владельца после исправления ещё ожидает ручной проверки.**

Админка: https://alisa-admin.octoport.ru/login. Вход остаётся на https://id.octoport.ru.

## Причина и исправление

Нативная activation проверяла TOTP для подключения, но не записывала reauthentication. Поэтому следующий штатный экран резервных кодов требовал второй TOTP. Затем он не предлагал продолжить исходный вход. Отдельно общая подсказка ошибочно обещала письмо на MFA/recovery страницах: на этом шаге почтовый код не запрашивался.

Теперь один пользовательский ввод засчитывается после штатной activation и native used-code validation, затем native post_authentication записывает свежую проверку до сохранения session. Это разрешено только для того же живого проверенного admin request, того же пользователя и свежей native email authentication. Секрет/фактор не создаётся оператором; нативные verifier, replay protection, user/client/callback/PKCE, TTL и one-use proof сохранены.

После резервных кодов есть кнопка **«Коды сохранены — перейти в админку»**. Она продолжает исходный authorization только с его живым proof; отсутствующий, изменённый, чужой или истёкший pending ведёт на фиксированный обычный admin login. Кнопка видна и для старых сеансов без pending. Штатные guards показа/скачивания/генерации резервных кодов сохранены. MFA/recovery pages — no-store; email и app инструкции разделены.

## Проверенный источник и установка

Source `1432dcc21a07b90b07428ef2585af5cd196a80aa`, [PR396](https://github.com/MaksimUnimax/runtime-fixtures/pull/396). Tar SHA256 `745f884f721ed448090cb683da0a4b74853e9e74eb03954452d2d78cbdde6226`. [Закрытый порядок](https://github.com/MaksimUnimax/runtime-fixtures/blob/1432dcc21a07b90b07428ef2585af5cd196a80aa/docs/alisa/service-platform/execution/ALISA_MFA_SINGLE_CHALLENGE_RUNBOOK_20261106.md).

Изменён и перезапущен только identity: `alisa-1432dcc21a07b90b`. Более новые web/admin/platform `alisa-c8666516683e7b2b`, их PID, pointers и все конфигурации сохранены. Без миграций, смены доменов/issuer/client/keys, принудительного logout или сброса MFA. Алиса/lab и старый Октопорт не изменялись.

CI точной сборки:62/62 source,96/96 PostgreSQL/browser,150/150 HTTPS/BFF/cabinet/staff,130/130 registration,17/17 runtime subset,113/113 staff/native/canonical/enrollment HTTP. Проверен полный новый HTTP round trip: fresh email → один enrollment POST → recovery без второго challenge → исходный OAuth code/token → admin в packaged browser. Включены wrong code, native replay marker, rollback с тем же QR и успешным свежим кодом, CSRF, user/target mismatch, stale pending/proof, отсутствие pending и role boundaries. Native verifier clock не менялся и authentication-record labels тестами для положительного входа не подставлялись.

[Platform CI](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42149275871), [identity probe](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42149275689), [docs](https://github.com/MaksimUnimax/runtime-fixtures/actions/runs/42149275790). Ранний browser candidate остановился на неверно экранированном regex отрицательного redirect; установлен только окончательный успешный artifact. Независимый review также закрыл QR/session rollback и legacy fallback cases.

На установленной системе Django загрузил новые overrides с hashes manifest и правильный native subclass. Recovery rendering с искусственным безопасным контекстом подтверждает кнопку даже без pending; MFA/recovery больше не обещают письмо. Все четыре readiness READY, обычные HTTPS-адреса доступны. Независимые source, операционный и installed-evidence reviews PASS.

У настоящего владельца по metadata-only проверке сохранены TOTP1, recovery1 и OWNER revision3. Реальные TOTP secrets/recovery codes не читались, не использовались и не заменялись; его staff-сессии оператор не создавал. Native owner sessions на момент readback0. Authenticated новый путь проверен в disposable CI; installed проверка состоит из source/template/readiness/role evidence и безопасного rendering, а не входа за владельца. [Полная квитанция](ALISA_MFA_SINGLE_CHALLENGE_ACCEPTANCE_20261106.json).

## Следующий шаг владельца

Открыть https://alisa-admin.octoport.ru/login и пройти вход с уже подключённым приложением. Перенастраивать или удалять приложение не нужно. Если остаётся экран резервных кодов — обновить его и нажать «Коды сохранены — перейти в админку». Истёкшая проверка требует свежего входа; старое ожидание письма на MFA шаге было ошибочной подсказкой.
