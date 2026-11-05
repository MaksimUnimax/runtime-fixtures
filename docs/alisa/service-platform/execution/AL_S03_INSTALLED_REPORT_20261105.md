# AL-S03 · выполненная установка и текущий остаток

> Последующая текущая S03 staff boundary admin3e91 + API/web/Identity07290 независимо принята; см. [актуальный отчёт](AL_S03_CURRENT_REPORT_20261105.md). Ниже сохранён исторический3e91 отчёт без переноса его PASS на другие версии.

**RECORDED_3E91_STAGE_SCOPE_ACCEPTED / CURRENT_MIXED_DEPLOYMENT_NOT_ACCEPTED.**

После явного «да» владельца выполнен [согласованный план](https://github.com/MaksimUnimax/runtime-fixtures/blob/83ba6c99a57897037286b2773ccf633f7b2f3c28/docs/alisa/service-platform/execution/AL_S03_STAGE_ROLLOUT_20261105.md), SHA256 `7efbcf47e2ea5f8c0ec1245a9108037c482b506fbae11975841f28615344572d`. Установлена S03, применена единственная staff migration, включена отдельная админка и пройдены native MFA, реальные команды, перезапуск, возврат к прежнему коду и повторное включение.

Независимый проверяющий **принял зафиксированную область сборки3e91**, с раскрытым прерыванием последнего шага возврата. Пока шла заключительная проверка, другой поток обновил сайт/API/identity доdd2. Эта новая комбинация **не принята** по прежним S03 receipts; текущий AL-S03 stage не объявляется полностью закрытым.

[Все исходные безопасные receipts, snapshots SHA и история остановок](AL_S03_INSTALLED_EVIDENCE_20261105.json) · [Независимый installed verdict](AL_S03_INSTALLED_INDEPENDENT_REVIEW_20261105.json) · [Фактические конечные процедуры](s03-stage-20261105/README.md).

## Точная выполненная сборка

| Привязка | Значение |
|---|---|
| Source | `3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae` |
| Tree | `c89ea16dd4773855d83335d0ed151680725d69d9` |
| Package | `alisa-3e91b1aa5d405d0e.tar.gz` |
| SHA256 | `b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21` |
| Фактический installed manifest | Все4406hashes и42links совпали; runtime source не менялся |
| Migration | Только platform `staff.0001_initial`, пять таблиц; повторный plan пуст, identity heads прежние |
| Authority | Отдельные admin client/cookie/JWE/service token; новые ключи сохранены; admin без DB credentials |

Первый OWNER создан только после настоящего email-code/MFA, library Code/S256, проверки подписанного issuer/audience/nonce/acr/amr/auth_time и связи native Subject с verified Person и admin client. Штатный `call_command` получил проверенные данные через защищённый stdin; значения не передавались argv/журналу. Повторный OWNER bootstrap не выполнялся.

## Фактические проверки

| Область | Результат |
|---|---|
| Заключительный smoke R4 | 36/36 PASS: клиенты/заявки/карточка, local block/unblock, одинаковый UUID с одним эффектом, конфликт другого payload, limited ADMIN/direct backend deny, отзыв двух браузеров, last OWNER, audit/cleanup, restart/logout |
| Возврат | 27проверок пройдены: flags/ingress/drain, exact SQL1/SQL2, payload erase, старый native bearer401, code TTL60секунд с ожиданием61.199, фактические прежние версии, прежний профиль, возврат той же S03 и client capabilities |
| Отдельное завершение reentry | 12/12 PASS: свежий native TOTP, фактический новый staff session с mfa_type=totp, старые token401/flow400, те же IDs/keys/profile/clients и один OWNER |
| Финальная read-only QA R2 до внешнего переключения | 44/44 PASS: exact installed files, закрытые права, раздельные authority, encrypted factor, audit privacy, чужой CONNECT deny, сохранение web/shared/vhosts, READY, services/timers и завершение своих cgroups |

Самостоятельный rollback receipt сохранён со статусом **FAILED**: после27успешных шагов браузер попал в краткий503 во время nginx reload. Позднейший reentry PASS — отдельное доказательство завершённого входа; исходный receipt не переписан в PASS. В R4 унаследованный label `real_https_totp_admin_bff_api_pg` фактически использует recovery code; настоящий TOTP отдельно подтверждён R3 и reentry. Счётчики разных phases перекрываются, их сумма не объявляется количеством уникальных сценариев.

## Остановки процедуры и исправления

- Истекла временная ссылка на archive. До этого сохранены только private snapshots. Ссылка обновлена для тех же CI bytes, ZIP/tar hashes проверены; БД и runtime повторно не разворачивались.
- Проверочный SQL с literal `%` и пустым params вызвал ошибку psycopg. Причина воспроизведена; запрос исправлен, уже применённая migration повторно не запускалась.
- Закрытый umask установщика дал0700 на code/venv и runtime CHDIR отказ. Исправлены rX права только нового release без секретов; /etc/private data остались0600/0700. Полный manifest проверен после исправления.
- Перехват bootstrap callback внутри redirect chain не срабатывал. Тест стал читать302 Location самого IdP, redeem фактический code с PKCE/secret и проверять native signed claims; прежние users/factors сохранены.
- CSS test ожидал фон на body, хотя принятый дизайн задаёт его на root. R4 проверил root canvas, main panel и320/390/1440px; продуктовый CSS не изменялся.
- libpq connect failure не предоставил SQLSTATE, хотя сервер явно отказал CONNECT. Финальная проверка требует фактический permission/CONNECT denial и отдельный ACL=false, а не произвольную сетевую ошибку.
- Удалены только9своих новых unmanifested bytecode файлов; hashes исходников не изменялись.

## Текущая комбинация после параллельного обновления

Сверка `2026-11-05T10:16:46Z`:

| Компонент / pointer | Фактический release |
|---|---|
| Admin / admin-current | `alisa-3e91b1aa5d405d0e`, READY |
| Web / web-current | `alisa-dd2b59b99b00b7e4`, READY |
| API / site-current | `alisa-dd2b59b99b00b7e4`, READY |
| Identity / identity-current | `alisa-dd2b59b99b00b7e4`, READY |
| shared current | `alisa-77d0f8ee2643ef65` |

Причина установлена по публичной истории: `dd2b59b9` — TLS/SASL PLAIN mail fix поверх `23f05f2e`/`55c8e6b6` нового потока приглашённой реальной почты, основанного на нашем `83ba6c99`. Его CI42002923215/42002923200/42002923265 завершились успешно. Независимый delta review подтвердил прежние blobs staff policy/storage/admin BFF/platform staff/migration; изменения касаются mail delivery/recipient allowlist и связанной проверки customer email. Это source-level совместимость, не новая installed приёмка.

Свежая сверка подтвердила: прежние S03 env settings/keys сохранены, root0600, private dirs0700, пять staff tables, append-only audit, один активный OWNER, старые web/probe clients сохранены. Настройки новой реальной почты не раскрывались и в S03 не принимались. Параллельные указатели/данные не откатывались и не перезаписывались.

## Что остаётся

1. Зафиксировать согласованную текущую комбинацию компонентов и соответствующий ей план возврата вместе с потоком нового mail release. Старый план возврата3e91 не применять поверх чужого обновления.
2. Восстановить ресурсный резерв разрешённой очисткой: сейчас2939MiB свободно при минимуме3072MiB, дефицит133MiB ещё до бюджета нового теста. Перед нашей установкой было3984MiB, после неё3666MiB; новые параллельные releases не удалялись. Новые тяжёлые проверки не запускались после обнаружения дефицита.
3. После этого пройти свежую staff-boundary квалификацию текущего сочетания с native TOTP и согласованным rollback/reentry; получить новый независимый current installed verdict.

Production, новая реальная почта, объединение identity/БД с Октопортом, merge в main и возможности S04+ не входят в этот результат. Следующий продуктовый шаг после закрытия актуальной S03-приёмки — AL-S04, выдача срока доступа клиенту.
