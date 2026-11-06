# S03 · приёмка актуального сочетания компонентов

**EXECUTED / CURRENT_S03_STAFF_SCOPE_ACCEPTED.** [Фактические результаты](AL_S03_CURRENT_REPORT_20261105.md) · [независимая приёмка](AL_S03_CURRENT_INDEPENDENT_REVIEW_20261105.json). Владелец поручил восстановить резерв и проверить новое сочетание после отчёта77244b2f. Это staff-boundary проверка, без приёмки новой почты и без переустановки чужого release.

| Компонент | Exact source / runtime |
|---|---|
| Admin | `3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae` / `alisa-3e91b1aa5d405d0e` |
| Web/API/Identity | `07290e7c17f556bfe8e144fd766ee0163c0b88db` / `alisa-07290e7c17f556bf` |
| Shared current | `alisa-77d0f8ee2643ef65`, сохраняется |
| Временный fallback только admin | Прежняя закрытая оболочка `alisa-e82003211bdcd687` |

Admin tar SHA256 `b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21`, manifest4406/42. Current07290 tar SHA256 `19044804a17f803c0b92d6da55f722db81d92e9ec24e54cab2dc26d0000b5c7b`, ZIP `1896175689c75a1f3ca87a2897ce480c468bad7e8a8e18cd1e43560868cf7946`, manifest `bc4b3945650ec6b867a8ef7aafe53eb9b9958b0908cdf6a3d78bb5dcaf574158`, 4408/42. CI42014260386/42014260392/42014260293 SUCCESS; artifact13408716940 locally downloaded and hashed. Installed manifest is pinned to those CI bytes.

Prior DD2 smoke24 and rollback48 passed as recorded. Its final QA stopped on a derived infra bytecode file; concurrent deployment moved API/Identity to07290. No earlier PASS is transferred to07290. The five existing rollout locks remain held across smoke, return, final readback and independent review by finite native unit `alisa-s03-qualified-window-20261105f002.service` (1200sec,64MiB,swap0). Individual steps run in bounded units under that lock holder; it is released after review.

## Допуск и guards

- До теста повторно сверить pointers/config hashes и manifest обоих releases, свободные locks, давление памяти, disk/inode, отсутствие активного чужого rollout. Собственная конечная systemd group: cap1536MiB, swap0, RuntimeMax600sec, KillMode control-group, TimeoutStop5, TasksMax1024. Не запускать повтор при неизвестном исходе.
- Резерв восстановлен двумя inactive-only dedup: первый +453MiB, второй +302MiB; свободно3456MiB перед07290 smoke. Manifest всех восьми неактивных сборок проверен до/после; все archive/version paths сохранены, активные inode не затронуты. Изменение mtime неактивных копий на canonical явно записано. Для browser допуска оставить3072MiB и100MiB роста,200000inode и1024MiB RAM сверх cap/параллельных бюджетов.
- Использовать только существующих собственных synthetic owner/reader `example.invalid`, проверенные native Subject/Person и прежние MFA factors из закрытых fixtures. Новый OWNER/identity/customer не создаётся. Не вводить реальный адрес и не запускать mail batch. Если customer session уже близка к TTL, допустим один штатный повторный вход только существующего собственного example.invalid: код ожидается от уже работающего timer в приватном sink, без запуска общего mail batch. Затем native MFA; неожиданная signup/чужой contact — остановка без отправки формы.
- До/после получить безопасный fingerprint non-synthetic mail rows: IDs/attempts/sent/error/lease без recipient/body. Подтвердить отсутствие их enqueue/submit/state изменений и отсутствие POST signup либо POST login с любым адресом вне двух собственных synthetic fixtures. Значения contacts/OTP/recovery/cookies/client secrets в receipts не выводятся.
- Все snapshots в root-owned0700 directory, файлы0600. Проверить, что staff members ровно два и относятся к собственным fixtures; неизвестный staff/изменение topology/config прекращает зависимые действия.

## Проверка текущей staff boundary

1. Сохранить private exact component env/vhost/drop-in/pointers/client snapshot, heads schema и безопасный mail fingerprint. Полные DB dumps и реальные контакты не копировать. 07290 source/mail fields не изменять.
2. Пройти native signed admin proof с существующим recovery factor; проверить issuer/client/nonce/state/PKCE/acr/amr/Subject и person. Затем свежий native TOTP через actual admin BFF → 07290 platform/PG. Проверить cookie и фактический session.mfa_type. Сравнить реальные customer/tenant/profile IDs с прежними fixtures.
3. Через OWNER повторно назначить только собственного reader с users.read. Проверить current native login, backend write deny и два независимо вошедших контекста; отозвать reader и проверить оба отказа. Все команды имеют новые UUID и касаются только собственных synthetic records.

## Staff-feature rollback с сохранением 07290

1. Сохранить текущий owner browser state, действующий token и настоящую pending staff flow; закрыть собственные browser connections перед nginx reload.
2. Закрыть только admin ingress. Поменять только `ALISA_STAFF_ENABLED` на0 в admin/platform/identity, сохраняя остальные текущие env bytes/values в snapshot. Restart/drain этих трёх служб; web/site/identity **pointers остаются 07290**. Проверить отказы staff API/start/native authorize.
3. Выполнить прежний exact platform-close SQL `d084c24e…`, затем identity-suspend SQL `cc059d09…` с собственными runtime roles/ON_ERROR_STOP. Проверить все own payload/active-session/flow zeros, admin grants/response empty и token0. Restart/drain identity; повторить postconditions и выдержать больше actual native60sec TTL. Native bearer должен отказать; no-real-mail guard проверяется до restore.
4. Переключить **только** admin-current наe820; собственный drop-in продолжает указывать на admin-current. Остальные pointers/config/mail fields сохранены. Подтвердить fallback health, отсутствие admin start route, неизменные customer API/profile и блокировку admin client. Это возврат staff-возможности, не откат 07290 почты/API.

## Возврат той же админки

1. При закрытом admin ingress вернуть только admin-current на3e91. В native ORM transaction проверить сохранённые admin id/type/secret hash/redirect/Subject mappings и token0; восстановить только authorization_code/code. Никакой rotation/нового bootstrap.
2. До включения сверить flags0/client0 и no-real-mail guard. Восстановить **точные текущие** component env snapshots (с новыми mail fields), сначала identity/platform, затем admin. Не применять старый pre-mail env.
3. Проверить fresh public HTTPS readiness после nginx reload; создать новый browser process/context с сохранённым IdP state. Пройти новый настоящий TOTP, убедиться в старых token401/pending-flow400 и тех же IDs/profile/owner. Все web/site/identity pointers должны остаться07290, sharedcurrent прежний, все current env и vhost bytes сохранены.
4. Повторить manifest/privacy/runtime/audit guards, mail fingerprints и окончательный readback. Независимый reviewer оценивает только S03 staff scope на этом exact сочетании; 07290 SMTP/real-recipient flow/production/shared identity не принимаются этим тестом.

При изменении не-staff env полей, неизвестных member/session, версии компонента, mail fingerprint, failed postcondition или утрате ресурса остановить зависимую операцию и разрешить фактический исход; не возвращать устаревшую конфигурацию поверх нового почтового потока. Исходные failed receipts сохраняются отдельно.
