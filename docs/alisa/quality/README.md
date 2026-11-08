# Октопорт маркет: совместная работа тестера и автора матрицы

Начинать каждый сеанс здесь. Репозиторий `MaksimUnimax/runtime-fixtures`, ветка `alisa`, общий центр `docs/alisa/quality/`. Чат и архивы не создают вторую очередь задач.

## Текущая точка — OWNER-CONSOLE-R1, 8 ноября 2026

**OWNER_FORM_ACTIVE / AUTHOR_TESTED / REAL_OWNER_CONFIRMATION_PENDING.**

[Фактическая приёмка, артефакты и действия владельца](OWNER_CONSOLE_R1_ACCEPTANCE_2026-11-08.md) · [План поставки](OWNER_CONSOLE_R1_RELEASE_PLAN_2026-11-08.md) · [План реализации](OWNER_CONSOLE_R1_PLAN_2026-11-08.md).

Форма **«Себестоимость и расходы» установлена**: https://alisa.octoport.ru/app/owner-inputs . В карточках https://alisa.octoport.ru/app/stores добавлена ссылка. Используются прежние login и session cookie; без сессии — redirect /login. Автор не заполнял и не утверждал реальные параметры владельца.

Вводятся числовой marketplace SKU, себестоимость с датами действия, налог и собственные расходы за точный период. Неизвестное, явный ноль и явное исключение налога различаются. Нет r9/default250, автоматической ставки или месячного prorating. Сохранение требует явной галочки и текущей revision; формируется новая подтверждённая версия. Само сохранение расчёт не запускает.

При потерянном ответе используется исходный command ID и status/deadline, не автоматическая новая правка. В localStorage только идентификатор/магазин/revision/action/deadline, без денежных черновиков и секретов. Web Lock и expected_revision защищают вкладки; отказ storage блокирует POST. Duplicate JSON keys и неизвестные действия BFF запрещены. Сохранённые неподдерживаемые поля не отбрасываются молча.

### Проверки

**1940 server checks PASS** = 1840 matrix +85 source/recovery/RPC +15 upstream. Отдельно **39 model/strictJSON** и **18 Chromium+Next BFF** PASS, typecheck/build PASS. Не складывать слои в выдуманное число финансовых сценариев. Данные тестов искусственные; реальный owner login/save не выполнялся. Disposable PostgreSQL остановлен/удалён, provider HTTP0.

Защищённый current-authority RPC реализован и проверен настоящим loopback HTTP: подписанный scoped ticket, текущая проверка БД, отдельный service-key, MAC ответа/request_id, bounded shared HTTP, без browser token или DB credentials в runtime. Но **production OWNER_RUNTIME_ENABLED=0**, job-admission/RuntimePort/voice C-UE01 ещё не включены. Readiness платформы честно RUNTIME_NOT_CONNECTED. Доступность формы не равна готовности нового голосового отчёта.

### Фактическая установка

Web и platform/site: **alisa-e5a51856a45d8c03**,4484 manifest objects verified; manifest SHA256 `b3561265cec07473874f6c544bed712996d1890e0a3f2f035258472a7e9a7d2b`. Переключены только web-current/site-current и включён OWNER_DATA_ENABLED. Применена только additive owner_data.0001_initial; обе новые таблицы при активации пусты. До миграции — частная согласованная backup; она и env не публикуются. PostgreSQL runtime-role осталась без superuser, прежний запрет UPDATE access grants сохранён.

Identity остаётся da73, admin06f3, аналитическое ядро **alisa-runtime-06f3c053e7719290**. Их PIDs/указатели и market runtime config сохранены относительно preflight. Пароль/email-коды/MFA/привязки не менялись. Перезапущены только web/platform.

HTTPS smoke05:45:35UTC: главная/login200; stores и owner-inputs без сессии307→login; ownerAPI401 без сессии и403 при чужом Origin; публичный internal RPC404. Реальный вход владельца этим не доказан. Свободно3119,41MiB при резерве3072MiB.

Старый da73 представляет частичный web/identity release: все присутствующие хеши и обязательные исполняемые компоненты проверены, но недостающие inactive/build inputs не названы полной целостностью архива. Новый release построен на полной проверенной06f3 базе с overlay нового web/platform кода. Старые действующие компоненты не заменялись вручную.

## Исходники и воспроизведение

Локальный source SHA **e5a51856a45d8c03cbf042c5d8af1356edbf9473**, база ed7a679c. **CLI push не авторизован; этот source commit пока не заявляется опубликованным в GitHub.** Exact SOURCE.bundle/patch сохранены в overlay; требуется интегрировать их в штатную платформенную ветку, не потеряв текущие правки. Документация опубликована отдельно штатным connector.

Overlay на Alisa: `/root/alice-lab-evidence/owner-console-r1-20261108/alisa-e5a51856a45d8c03-owner-overlay.tar.gz`,15184593байт,SHA256 `b344f512817162c68237a0d29795be87e2ace0d65216275a2b0fdb5f4d9633a9`.

Матричный кандидат `/opt/alice-market/candidates/20261108-owner-console-r1`. Архив кандидата/безопасных квитанций `ALISA_OWNER_CONSOLE_R1_2026-11-08.zip`,701959байт,SHA256 `76a07e7aa0713af5c0990b4b76f352f932ea6cbf0f8c6a569a79e6c22ca306f9`,в том же evidence-каталоге. Candidate MANIFEST293entries,SHA256 `35491864d8817db963c26e01cc9d99aebb209a6311867e5b2944a744fa2e2f74`. Нет working env, реальных owner facts/секретов/backup.

Не повторять завершённую activation. Перед дальнейшей работой сверить Git, locks, ExecStart, новые web/site flags и manifests; не откатывать06f3 fairness/deadline, текущий login или установленную форму старыми полными пакетами.

## История, каталог и независимые статусы

[OWNER-SOURCE-R1](OWNER_SOURCE_R1_ACCEPTANCE_2026-11-08.md) — producer/current verifier,1907 тестов; [OWNER-BINDING-R1](OWNER_BINDING_R1_ACCEPTANCE_2026-11-08.md) — внешний matrix snapshot; [MATRIX-LIVE-R4](CUE01_MATRIX_LIVE_R4_ACCEPTANCE_2026-11-08.md) — последняя реальная bounded квалификация с r9-примером. Старый READY R4 не является новым результатом на реальных owner inputs.

Одна аналитическая очередь/Worker и общий quota ledger. Exact-only cache требует полного идентичного результата и актуальных прав/срока. Нельзя подставлять неизвестные значения нулями, смешивать частичные старые captures, скрывать UNKNOWN автоматическим повтором или считать частичный результат READY.

**82 реализовано /78 включено /4WB выключено.** Новых голосовых включений0. Независимый review OWNER_CONSOLE и реальный owner save — NOT_RUN. DS03 имеет отдельный targeted SOURCE PASS из аудита, но полный safety/live numeric и прежние PARTIAL/SKIP не закрыты. [Аудиторская установка06f3](AUDIT_FIXES_2026-11-08.md) и [частные испытания Станции](STATION_START_2026-11-08.md) не превращаются в приёмку новой C-UE01.

[BUGS](BUGS.json), [TEMPLATES](TEMPLATES.json), [RUNS](RUNS.json), [BOARD](BOARD.md), [WORKFLOW](WORKFLOW.md), [счётчики](CATALOG_PROGRESS_CURRENT.json) остаются общим центром. Новый независимый прогон — отдельный inbox с точной версией/hash и фактическими исходами; не переписывать историю.

## Что требуется от владельца

В итоговом отчёте каждого прохода необходимые действия владельца располагать **непосредственно перед «Следующим шагом»**, с конкретной ссылкой и ожидаемым результатом. Не отправлять владельца на неустановленную функцию.

Сейчас: открыть https://alisa.octoport.ru/app/stores , проверить выбранный магазин; открыть https://alisa.octoport.ru/app/owner-inputs , ввести реальные SKU/себестоимости/даты и нужные period-expenses либо явные пропуски; отметить подтверждение и сохранить. Ожидается «Параметры подтверждены. Версия N». При потере ответа — «Проверить сохранение». Сообщить название магазина, период и номер версии, без ключей/паролей/кодов.

## Следующий шаг

Интегрировать сохранённый exact source bundle в штатную ветку, завершить production job-admission/current-authority wiring и независимое ревью; после реального подтверждения параметров выполнить ограниченный C-UE01 и числовую сверку. Новый голосовой отчёт пока не включать и не объявлять готовым по одним тестовым данным.

[Предыдущий README](https://github.com/MaksimUnimax/runtime-fixtures/blob/cfcf8fd91e4a8878b7420f6ebdd95d607b4e8592/docs/alisa/quality/README.md) сохраняет точную историю OWNER-SOURCE-R1.
