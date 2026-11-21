# Неподдержанные вопросы, спрос и жизненный цикл шаблонов


Обязательная функция владельца U04/U05. Основа: blueprint §§10.3–12. Это не хранение всех разговоров и не самообучающееся изменение production моделью.

## 1. Что регистрируется

P1_MISS и final outcome — разные поля. При P2 success всё равно остаётся потребность улучшить быстрый путь. Если P1 найден, но API даёт 429, это provider error, не недостающий шаблон. Жалоба «ответ не тот» создаёт WRONG_SEMANTICS даже у READY.

Закрытые причины v1: P1_MISS_P2_SUCCESS; SEMANTIC_UNSUPPORTED; OPERATOR_UNSUPPORTED; NEEDS_CLARIFICATION; AMBIGUOUS_STORE_OR_PERIOD; DATA_UNAVAILABLE; PROVIDER_PLAN_REQUIRED; AUTH_OR_SCOPE; SERVICE_ACCESS_REQUIRED; RATE_LIMIT_OR_PROVIDER_ERROR; PARSER_OR_RUNTIME_BUG; SECURITY_OR_ABUSE; WRONG_SEMANTICS. Следующая причина требует schema version/consumer compatibility, а не свободной строки от LLM.

## 2. Эпизод и счётчики

`logical_query_id` объединяет исходный вопрос и его уточнения. Webhook replay, команды «результат», повтор выдачи и внутренняя пагинация не создают новый demand episode. Явный новый расчёт — новая задача; повтор одной потребности учитывается в raw count, но capped demand не более одного tenant/cluster/day.

`event_id` уникален на доставляемое событие; `episode_revision` растёт при изменении финальной классификации. Consumer сохраняет каждое принятое событие по allowlist и обновляет итог только более новой revision. Для спроса используется одна актуальная классификация эпизода. Когда поздний итог меняет тип, агрегат корректируется воспроизводимо; старое сообщение не откатывает итог.

Псевдоним клиента — HMAC tenant с отдельным ключом продукта и key_version. Одна версия сохраняет стабильность окна 30 дней; ротация выполняется с контролируемой миграцией/сопоставлением внутри защищённой области, не создаёт новые «независимые клиенты». В Git таких соответствий нет.

## 3. Очистка до хранения

Удалять/типизировать: email, телефоны, ключи, ФИО при распознавании, реальные названия магазинов, SKU/артикулы, posting IDs и чувствительные суммы. Сохранять смысл: ORDER/EVENT/ACCRUAL/SNAPSHOT axis, включение/исключение, grouping, сравнение, число top N, тип периода и marketplace. Пример: «Средняя цена реализации по дням за <МЕСЯЦ>, кроме <ТОВАР>».

Детерминированная очистка и ограниченный allowlist слотов предшествуют durable outbox. Автоматическая маскировка не гарантирует анонимность; records защищены как данные клиента. Неуверенный sanitizer не отправляет сырой текст на внешнюю LLM-кластеризацию: сохраняются metadata-only и REDACTION_UNCERTAIN. Секретная строка не должна остаться в exception, HTML, tracing, CSV или test artifact.

Raw question хранится только в текущем краткоживущем runtime-контексте. Долгоживущие gap examples имеют отдельную цель обработки и предлагаемый TTL90d, metadata30d, aggregates12m. Эти предложения подлежат D07 и не отменяют 900/300s результатов.

## 4. Доставка и честная полнота

Producer outbox → bounded worker → platform inbox → episode/classification → projections. Consumer effect и обработанный event фиксируются одной транзакцией. Не отправлять всю бизнес-выборку ради аналитики админки. Сбой consumer не должен задержать голосовой ответ.

При ёмкости в пределах нормы — без выборочного sampling для допустимых авторизованных промахов. Переполнение создаёт alarm и metadata-only резерв, когда он возможен. Если точный учёт уже невозможен, помечается интервал неполноты от последнего подтверждённого heartbeat; не обещать точное число потерянных событий. Атаки/анонимные запросы — bounded aggregate/security path, не бесконечный текстовый архив.

## 5. Группировка

Детерминированная signature: platform, semantic intent/axis, normalized operators, grouping, inclusion/exclusion shape, context-resolution class и версии нормализатора. Значения month/store/product не делают каждую фразу новым кластером. Order и buyout либо «с товаром» и «кроме товара» не сливаются по похожести слов.

PostgreSQL search и ручной merge/split достаточны для первой версии. LLM может предложить grouping позже на безопасных текстах; она не меняет authoritative signature или production. Merge создаёт lineage и пересчитывает distinct episodes/tenant-days; пересекающиеся члены дедуплицируются. Split сохраняет ссылку на исходное решение и ответственное лицо.

## 6. Настраиваемый порог

Предлагаемый NORMAL: не менее 20 capped demand contributions и 5 distinct tenant в окне 30 суток. PAID: не менее 5 capped contributions от 3 paid-at-event tenant за 14 суток. Analysis-day в предложенном Europe/Moscow; event timestamps UTC. Окна и timezone версионируются; изменения не переписывают старое доказательство срабатывания.

Raw эпизоды и capped contributions показываются отдельно. Пример: 100 эпизодов одного клиента за один день дают raw=100, contribution=1, distinct=1. Один клиент за 20 дней не пройдёт distinct>=5. Internal tests и классифицированный abuse не участвуют.

Порог создаёт один активный candidate для семантической потребности и trigger policy/window. Новый event добавляется к существующему candidate, не создаёт тикет ещё раз. После CLOSED/DECLINED повторное открытие требует policy/triage причины; новый спрос не отменяет security запрет. Денежная или security ошибка эскалируется сразу.

## 7. Работа администратора

Экраны: inbox причин; список clusters; карточка потребности; merge/split preview; configurable thresholds; candidate board; ссылки на templates/releases; post-release наблюдение. Карточка содержит безопасные примеры, raw/capped/tenant/paid counts, окна, completeness, P2 outcomes, platform/axis/dims, data availability, вид изменения, owner и reason history.

Разрешения insights.read, insights.triage, insights.configure, catalog.edit, catalog.approve, catalog.publish разделены. Обычный paid USER не видит чужие формулировки; собственная идея показывает лишь её статус. Экспорт ограничен, аудируется и защищён от CSV-инъекций.

## 8. Из потребности в шаблон

NEW → TRIAGED → CANDIDATE → SPECIFIED → IN_DEVELOPMENT → VALIDATING → RELEASED → MONITORING → CLOSED. Для SPECIFIED обязательны: описание ответа, ось/единицы/валюта, source qualification, допустимые scopes, known negatives, независимый numerical gold. Нельзя компенсировать отсутствие API новым промптом.

Классы изменения: SYNONYM / FORMULA_FROM_EXISTING / SOURCE_BINDING / GENERAL_OPERATOR / BUG / PROVIDER_WAIT. Только первый класс не должен создавать лишний source. Новая формула связывает известные метрики. Новый источник того же класса добавляется матрицей после qualification. Новый оператор — общий код с ADR и тестом, не специальный обработчик одной фразы.

Каталог хранит semantic metric, speech slots, source recipe и computation plan отдельно. User-каталог только published, с capability-filter. Admin draft может быть подготовлен через предметную форму/import; произвольный онлайн-редактор исполняемого JSON не нужен.

## 9. Публикация

Release manifest: release_id, schema_version, engine_contract_version, semantic/source/speech version set, content hash, proof IDs, compatible engine hash/range, author, approver, qualified scopes. Approval закрепляет hash; его смена аннулирует approval. Новые jobs получают версию assignment; текущие сохраняют старую.

Порядок: validate → независимый semantic/numeric gold → regression → recorded-response qualification → разрешённый live-canary там, где нужен → тест Dialogs → staff approval → test-tenant assignment → runtime readback → наблюдение → расширение. Старые byte-identical доказательства переиспользуются только в их заявленном уровне.

Откат не повторяет jobs. Критическое отключение источника имеет приоритет над продолжением pinned плана; некритическая новая формула применяется лишь новым заданиям. Пользовательская фраза/LLM не получает publish-права.

## 10. После выпуска

Сравниваются те же semantic clusters: final success, доля P2, WRONG_SEMANTICS, стоимость и latency при сохранённом определении знаменателя. Корреляция уменьшения промахов не заменяет тест точности. Клиент, явно подписавшийся на свою идею, получает одно уведомление; маркетинговая рассылка всем не включается автоматически.
