# BASE-BATCH-02 / COMPLETENESS-R01 — завершённая offline-поставка

05.11.2026. Статус **OFFLINE_VALIDATED_ADDITIVE_CANDIDATE / REBASE_REQUIRED / NOT_INSTALLED**. Поручение — продолжать большой пакет низкоуровневой матрицы и требования постоянного тестера. Платформа второго исполнителя не изменялась.

## Откуда продолжено и почему не выполнялась установка

Прочитаны BASE_BATCH_02_PLAN и BASE_BATCH02_QUALIFICATION, а также TESTER intake `20261105-TESTER-9ad72c40` на SHA `25857755e8d193e0132a169f84397ea8f3b6c115`. До изменений опубликован план `BASE_BATCH02_CONTINUATION_GATES_2026-11-05.md`, commit `62cadc7766514ca1b97cf8b03b6bc0f41fc245b5`.

RDC list_devices показывает Alisa `89049fc7-4160-4636-9ad7-89c31f9bcb32` offline; адресный list_directory /opt/alice-market/releases подтвердил ту же причину. В конце разработки повторный штатный список всё ещё offline (last seen45m). Это **недоступность канала RDC, не установленная причина и не доказательство остановки навыка**. Other online host unymax20141 не является заменой Alisa: прочитан только /opt, проект туда не переносился. Ни на одном сервере в этой работе не менялись службы/config/keys/DB/права/квоты.

Полного воспроизводимого исходника этапа «114 новых тестов, 44 Python» со скриншота локально и в опубликованном runtime subtree не найдено. Сохранённый stage из Git остаётся `/opt/alice-market/releases/20261105-v010-base-batch02-r1`; получать его заново нужно после восстановления канала. Подтверждённые в прошлом пять source canary PASS, WB campaign coverage failure и accrual quota сохранены как прошлые доказательства, не повторялись новым HTTP. Написанные ранее десять рецептов не удалены и не объявлены переписанными.

Для независимого продолжения взят полный доступный immutable `ALISA_QA_AND_CATALOG_R01_2026-11-04.zip`, SHA256 `29225e1f72a30e36c5a3a5a1d77479704b9ea41ba3433c152b839302e72a3ec7`. До правок846/846 PASS. Он предшествует installed batch01/staged batch02: **новый полный runtime в архиве — compatibility testbed, не разрешение откатить/заменить актуальный сервер этим архивом**. Продолжение переносится как additive diff с обязательным merge текущей рабочей копии.

## Причина приоритета

TESTER P1 `QA-20261105-TESTER-9ad72c41`: expense rows=[] при непустых daily/CPO того же периода и credentials. Ошибка нашего контракта — считать единственный expense достаточным источником общего расхода. Внутреннюю причину пустого ответа Ozon не сообщает; она не придумана. Это важнее выдачи ещё одного красивого отчёта с заниженными расходами.

Дополнение C-UE01: реклама обязательна; CPO часть daily не складывается второй раз; COGS и налог необязательны лишь при явных omission labels, не неявном нуле. Периодные расходы/исходные заказанные единицы — не прибыль выбранной когорты. Эти требования не заменены прежним предположением «без себестоимости вообще нельзя показать ни одного частичного показателя».

## Реализовано

1. **JSON-only overlay ad_spend:** `overlays/ads_daily_v1.json` перенаправляет только общий рекламный расход на daily/json, строгие moneySpent, id+date, даты, finite/nonnegative Decimal с запятой, запрет дублей и неясной полной страницы. Empty/null/пропавшие поля не ноль. bonus/prepayment сохраняются отдельно на legacy-источнике, из daily не придумываются. Старый quota_operation сохранён, новая квота не создана. Новых HTTP-клиентов или Python-веток по имени метода/метрики нет.
2. **Общий qualification scope:** opt-in политика источника проверяет store/identity/access/source revisions, recipe fingerprint, exact period, срок evidence и требования рецепта. Проверка до credential read и grant. Пользовательские/LLM/provider утверждения не являются доверенной квалификацией. Допуск метода не доказывает полноту конкретного ответа; независимое подтверждение охвата остаётся отдельным обязательным входом.
3. **Объяснения ошибок:** data-driven failure_catalog, reason + next_action + cause_status, text==tts. Подключено в offline Engine.describe(FAILED) и прежние bare-code safe_submit. Существующие человеческие уточнения сохранены. Неизвестные URL/token/пути/exception text не отражаются ни текстом, ни error-полем. UNKNOWN не получает повтор; причина HTTP400 не выдумывается; quota/authorization/missing-source различаются.
4. **Общий gate составных отчётов:** report_contracts.py интерпретирует политики полноты, обязательных/необязательных входов, осей, валют, периодов, verified zero, evidence TTL и nonoverlap keys. Реклама обязательна; неизвестная блокирует пригодный результат. Необязательные данные перечисляются как omissions, не превращаются в0. CPO и контрольные сверки не попадают в слагаемые; отсутствие finance/ads-overlap или expense-coverage control блокирует расчёт. User exclusion налога подтверждается trusted verifier. Без verifier или при его отказе fail closed.

Gate возвращает **READY_FOR_CALCULATION**, не runtime READY/сохранённый финансовый отчёт. Ни полного вычислителя C-UE01, ни adapter этого gate к фактическому недоступному batch02 worker этот этап не объявляет готовым. Арифметика остаётся существующему общему query_program, а не отдельному unit-economics handler.

## Фактическая проверка

**957/957 =846 прежних +111 новых**, failures/errors/skips=0, TCP/DNS attempts=0, live API/LLM calls=0. Все **14 прежних test-файлов** побайтово неизменны. Новые: qualification30, report gate51, explanations18, overlay writer12. Architecture gate расширен на новые общие модули и PASS.

Отдельно **32/32** изолированных source integration tests. Настоящие temporary SQLite/Engine/Worker/HTTPTransport, fake HTTPS и artificial credentials. Подтверждены правильный spend по gold тестера, grant-boundary, отсутствие fallback к empty expense, отсутствие CPO double-add, отдельные legacy funding-метрики, частичные/пустые/неправильные данные, revoked/expired proof, UNKNOWN, exact cache и no-network reads. Нельзя называть эти32 живыми обращениями к Ozon.

**JSON-only:** в чистой копии изменены ровно registry.json, scalar_catalog.json, scalar_source_catalog.json; все **53 Python-файла копии неизменны**, включая32 верхнеуровневых runtime-файла и тесты/инструменты. Это не53 новых функций и не самостоятельная квалификация provider coverage. Старый опыт двух произвольных row-source рецептов также продолжает проходить.

Применение core patch к точной baseline с fuzz0 дало совпадающие четыре файла: architecture_gate.py, engine.py, http_transport.py, matrix_sources.py. Новые module/data/test files добавлены отдельно. Ничего из platform products/alisa не затронуто.

## Ошибки собственной проверки, не скрытые задним числом

Первый тест объяснения ожидал слово «ноль», тогда как фактическая правильная фраза «не подтверждает нулевые расходы». Уточнено ожидание точной фразы; смысловой запрет не ослаблен. Первый полный новый прогон выявил настоящий defect offline overlay writer: duplicate filename сравнивался строкой с Path keys и проходил. Исправлено сравнение, добавленный regression сохранён, первое FAILED evidence включено в архив. Эти сбои не относятся к маркетплейсам.

## Полный архив и воспроизводимость

**ALISA_BATCH02_COMPLETENESS_R01_2026-11-05.zip** — **359603 байта,99 файлов**.
SHA256 **7b4188798e19a7af037e31aefc08d60cf3d680a8faba75d28efd9dc9f1ec1ec0**.

Внутри полный compatibility runtime, все старые/новые tests,32-test isolated runner, JSON-overlay, error/report catalogs, исходный synthetic gold тестера, patch, README,23-case tester handoff и initial/final logs. Нет live config/credentials/SQLite/сырой финансовой выборки. После чистой распаковки сверены98 manifest entries; вновь957/957,32/32 и architecture PASS. Повторные прогоны не увеличивают число уникальных тестов.

Отдельные файлы: ALISA_BATCH02_COMPLETENESS_REPORT_2026-11-05.md и ALISA_BATCH02_COMPLETENESS_VERIFICATION_2026-11-05.json. В Git `runtime/v0.11/batch02_gates` сохранены общие модули, JSON-рецепт и core patch для ревью; loose files не составляют самостоятельный runnable runtime. Полный исполнимый тестовый комплект — закреплённый ZIP с указанным SHA.

## Тестеру и следующий шаг

23 дополнительных внешних сценария в docs/TESTER_HANDOFF.md: все **NOT_RUN**, ответы и времена ещё не измерялись. Начинать на интеграционном стенде только после exact build/catalog hashes. Исходные TESTER bug/run файлы не изменены; QA-20261105-TESTER-9ad72c41, QA-20261105-TESTER-70ac9201, OZCP-003 не закрыты по offline тестам.

**Следующий шаг:** восстановленный штатный RDC Alisa → фактический readback staged source/lock/manifest → merge этого additive diff без потери десяти рецептов → полный regression и source coverage/finance overlap evidence → bounded live canary через существующий ledger → установка и независимый Dialogs retest с ответом/временем. Пока RDC offline, утверждать выполненную установку или текущее здоровье сервиса нельзя. Рабочий batch01 и чужие platform-компоненты не менялись этим продолжением.
