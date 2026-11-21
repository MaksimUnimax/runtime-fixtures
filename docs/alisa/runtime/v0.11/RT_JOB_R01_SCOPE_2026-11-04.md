# RT-JOB-R01 — собственная очередь автора ядра, до реализации

04.11.2026. Поручение владельца: этот исполнитель меняет только скрипт обработки и матрицу; параллельный исполнитель делает остальную платформу. База alisa c52ee0937e3301c663d2dd7061c5e2043bf3dc65. Приложенный пакет ALISA_IMPLEMENTATION_DOCS_v0.5_2026-11-04(1).zip SHA256 704e24651509a26189fa82cd7bfb56be91fd81c3472e6f0b4d56ea4e5ed4ef7d; manifest и validate_pack прошли. Рабочий scalar-matrix-r4 совпал по 31 SHA, active, собственных locks на старте нет. Повторный baseline 717/717, ноль внешних API.

## Граница двух исполнителей

Наши файлы — код ядра/матрицы, собственные runtime-документы/тесты. НЕ менять products/alisa, identity, BFF/web/admin, PostgreSQL, платформенный runtime_adapter, домены/TLS, OAuth, billing, customer UI, platform migration/STATUS. Рабочая матрица r4 сохраняется; новые изменения до интеграционной приёмки в отдельной копии и без изменения live-сокета/конфигурации.

API_AND_EVENTS §3, ROADMAP AL-S07 и SOURCE_LAYOUT требуют RuntimePort. Автор ядра поставляет runtime-сторону RT-JOB, автор платформы — клиентский adapter и authority/ticket service. Ни один не пишет напрямую в БД другого. Код не импортируется из runtime в platform: граница — согласованный версионированный IPC. На текущей alisa products/alisa не найден; это не утверждение, что у второго исполнителя нет другой рабочей ветки.

## Выбранный первый шаг

RT-JOB-R01 — узкая независимая runtime-поставка для AL-S07: принятие явного квалифицированного utterance в существующее ядро; статус/чтение/отмена ПО ЯВНОМУ job_ref; проверка tenant/actor/store scope/catalog/security revision перед принятием, исполнением и выдачей; идемпотентность и истечение. Никакой новой аналитической реализации или provider-specific ветки.

Источник требований: API_AND_EVENTS.md §3; ROADMAP AL-S07, AL-S09/10 (только зависимые инварианты); runtime_task_v1.schema.json; тесты AL-T06-01/03/04/05, AL-N07-01/02/03, AL-V04-14. Не объявлять целиком принятым AL-S07: платформа 04–06, UI и настоящая совместная приёмка принадлежат другому исполнителю.

## Решения и ограничения до кода

- Существующий legacy Unix gateway не подменяется. Новый порт отдельный, без production listener по умолчанию. Trusted peer и execution_ticket обязательны; JSON shape не авторизация. Без подключённого verifier/актуальной authority — отказ. Самодельный identity/OIDC не разрабатывается.
- v0.5 schema не содержит product_id, хотя AL-S07 требует alisa_market. Не добавлять неизвестное поле в strict schema: продукт закрепляется в проверяемой транспортной service identity вне task JSON. Явно передать это интегратору.
- UUID/числовые платформенные revisions не считать автоматически равными строковым runtime IDs/revisions. Сопоставление выполняет доверенная authority, не пользовательский payload.
- В accepted job сохранять минимальные nonsecret claims/revisions, а не ticket или финансовую копию для UI. Повторные read/status не пересчитывают отчёт и не меняют глобальный указатель/номер голосовой страницы.
- Отмена по ref не должна отменять другое, более новое задание. UNKNOWN остаётся неизвестным, не превращается в разрешение retry. Expired read возвращает RESULT_EXPIRED, не submit.
- Worker повторяет проверку разрешения перед следующим физическим вызовом и перед сохранением результата. Неизвестная authority/ошибка проверки — запрет, не grace-period.
- Готовность published templates/capability view, gap producer и catalog release lifecycle — следующие runtime-подзадачи для AL-S08/11/13. Не создавать UI/consumer или новый production policy от имени другого исполнителя.
- Runtime task schema копируется побайтово из v0.5. Не реализованный template-submit отклоняется явно; текущая поставка обязана объявлять поддержанные операции/варианты. Молчаливый перевод слотов в другую фразу запрещён.

## Приёмка нашего scope

Существующая очередь и worker + временная SQLite + искусственный transport. Настоящий Unix IPC с peer check. Позитив: одно принятое задание, результат по тому же ref, повтор без HTTP, restart. Негатив: shape-valid-but-unauthorized fixture, другой product/tenant/actor/store, stale revisions/catalog, expired ticket/result, changed replay, UNKNOWN, поздняя cancel к старому ref при новом pointer, revoke между страницами и перед выдачей, отсутствие ticket в БД. 717 baseline assertions не ослаблять. Свои тесты не называть независимой платформенной приёмкой.

Доставка: воспроизводимый пакет + pinned source hashes + отдельный интеграционный README для второго исполнителя. Никакой установки нового production listener до согласованной authority/adapter и совместной проверки. Отсутствие platform issuer не блокирует независимую разработку ядра и локальные тесты, но блокирует заявление end-to-end platform READY.
