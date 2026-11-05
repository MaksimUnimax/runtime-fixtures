# CONVERSATION-SAFETY-R01 — план до исправлений

05.11.2026. Поручение владельца: проверить независимое ревью и исправить подтверждённое. Основание — ALISA_INDEPENDENT_REVIEW_2026-11-05.html из Library, обновление 12:06 UTC+5 (07:06 UTC). Его платформенные замечания относятся к другому исполнителю; products/alisa, PR386, issuer/BFF/PG здесь не меняются.

## Точное исходное состояние и воспроизведение

08:52:54 UTC: active `/opt/alice-market/releases/20261105-v010-matrix-join-r1`, PID65567;45/45manifest matches; manifest27c03b86db8b0b7f7b3ba871e464971004c0fe3dba0f9e49c6abbc83dacef09d, config92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5. 0active jobs/0pending, SQLite ok. HEAD692a73452c84f8f3dcbe884d84bd1379323c322b.

В 08:55:59 UTC на этих исходниках с temporary SQLite и synthetic Transport воспроизведены:
- A→цены, B→metadata, отменаA: A=QUEUED/B=CANCELLED;
- общий exact HIT, страницы A/B:1,1,2,3 при одном исходном запросе;
- обе русские формы «с31октября[2026] по4ноября2026» дают PERIOD_REQUIRED, ISO даётQUEUED;
- 1e-400/1e-10000 разворачиваются до402/10002символов; 1e-999999 принят без форматирования;
- tiny decimal на успешном synthetic HTTP даёт UNKNOWN/WORKER_INTERNAL_UNKNOWN вместо детерминированного отказа.

Receipt: /root/alice-lab-evidence/conversation-safety-r1-20261105/before-reproduction.json. Marketplace calls0, liveDB не использована. Прочтение tests/test_dataset_pipeline.py сначала ENOENT: проверен фактический файл в корне runtime, он прочитан. Это ошибка пути, не отказ доступа.

## Решение до кода

1. Сохранить общий exact-cache/неизменяемый result. Выбранный job и cursor вынести в bounded отдельные записи tenant+conversation(+job). Новый разговор не наследует tenant pointer. Старый ingress без conversation имеет отдельный legacy путь.
2. Отмена снимает подписку текущей беседы. Если есть другой активный читатель того же незавершённого canonical job (включая alias и legacy subscriber), backend-job не отменяется. Если читатель единственный — обычная отмена QUEUED/RUNNING. Текущая беседа после отмены не получает результат чужого задания. Reply replay не двигает cursor второй раз.
3. Аддитивная миграция; старые tenant pointers не раздавать всем беседам. Восстановить только непросроченные связи из явных dialogue receipts, курсор начинать с0 (старый jobs.page не доказывает страницу конкретной беседы). Бизнес-результаты не копировать. Новые ссылки/курсоры имеют TTL/лимит и очищаются существующей retention; активные shared jobs не терять при очистке.
4. Decimal: ограничить finite/significand/scale и ожидаемую длину fixed-строки ДО format. Денежные входы и внутренние дробные результаты имеют отдельно описанные пределы; корректные ставки1e-10 и обычные суммы сохраняются без округления. MatrixError после известного ответа → FAILED с code; неопределённая сеть остаётся UNKNOWN. Первичная основа API Decimal: https://docs.python.org/3.12/library/decimal.html — precision контекста не ограничивает сам конструктор, as_tuple даёт exponent/digits для предформатной проверки.
5. Цельный русский интервал двух именованных месяцев разбирается до одиночных месяцев. Проверить оба/один/ни одного года, декабрь→январь, неверные даты, >365дней, будущие даты, compare, quotes/product names и Yandex-normalized ISO. Не разрешать неподдержанный период только за счёт нового parser.

## Приёмка и установка

Новые регрессии с исходным FAIL; полный1035 и отдельные57/70/JSON-only без ослабления прежних tests. Добавить A/B разных/общих jobs, alias/P2, restart, exact replay, отсутствие selected в новой беседе, чужойtenant, revoke, retention/migration, Decimal bounds/FAILED-vs-UNKNOWN и календарь. Штатный Unix gateway на временной БД должен пройти теми же маршрутами.

Кандидат создаётся отдельно от active; C-UE01/S03-кандидаты не включаются в hotfix. Перед установкой сверить own lock/flock/manifest/config и отсутствие активных заданий/pending; SQLite backup, аддитивная миграция, только alice-market restart. Новый retention-код подключить без смены существующего расписания и без удаления истории/ключей. После запуска — проверка actual path/hash/schema, безопасные no-provider контроли и отсутствие роста business-HTTP. Отдельный внешний retest и числовые PARTIAL не объявлять пройденными.

82/78/4 — исходный каталог; исправления состояния/границ не новые шаблоны. После исправлений следующая цель остаётся источник фактов/тарифовC-UE01→две таблицы через существующий worker. Риски полного месячного бюджета и отдельные платформенные дефекты сохраняются отдельными задачами.
