# RT-JOB-R01 — продолжение после обрыва, до реализации

04.11.2026. Входы перечитаны: полный пакет документации v0.5 SHA256 704e24651509a26189fa82cd7bfb56be91fd81c3472e6f0b4d56ea4e5ed4ef7d; manifest/validate_pack PASS; текущий Git HEAD f18a878fdeb6aaecf5b0d3eaf7053d28f3d50301. Новый прогон установленного исходного архива: 717/717, TCP/DNS=0. На Alisa 10:20 UTC работает scalar-matrix-r4. Собственный lock .runtime-port-v1-owner.lock имеет owner matrix-runtime-rt-job-20261104. В Git сохранён строгий валидатор, но остальные законченные файлы RuntimePort/приёмка не найдены. Неполный предыдущий запуск не объявляется готовой поставкой.

## Неизменяемая граница

Только ядро/матрица/runtime IPC, собственные документы и тесты. products/alisa, identity, UI/BFF, PostgreSQL, platform adapter, platform STATUS, TLS/DNS, OAuth/credentials и установленный runtime не менять. Второй исполнитель остаётся владельцем платформы. AL-S07 целиком НЕ принимается этой поставкой: зависимости 04–06, кабинет и совместный платформенный E2E открыты.

## Срез по сохранённому RT_JOB_R01_SCOPE

submit utterance → существующее ядро/очередь; status/read_result/cancel только по UUID job_ref. Не использовать глобальный pointer голосового диалога. read_result не вызывает LLM/провайдер и не пересчитывает EXPIRED. Cancel старого ref не отменяет более новый запрос. Отдельные platform-visible refs сохраняют точную связь при внутреннем ALIASED/exact-cache. Операционные receipt/refs минимальны, ограничены сроком и ёмкостью; никаких копий финансовых результатов или plaintext execution_ticket.

Валидный JSON не авторизация. Продукт alisa_market привязывается к разрешённому Unix peer вне strict task JSON. Инжектируемая authority платформы проверяет ticket и возвращает подтверждённые claims, затем актуальное отображение UUID/revisions в runtime Scope. Runtime не создаёт собственный issuer/signing scheme. Без verifier/authority — отказ. Ошибка authority — DEPENDENCY_UNAVAILABLE, не grace-period.

При принятии pins включают actor/security/access/store/credential/catalog revisions. Перед фактическим dispatch и выдачей они проверяются снова. Истечение короткого приёмочного ticket после durable acceptance не равно отзыву доступа: worker использует актуальную authority по сохранённым nonsecret claims; новый read требует свежий ticket. Нельзя расширить scope принятых магазинов или сменить actor при повторе.

Идемпотентность scoped по tenant+actor+request_id, с canonical fingerprint query+logical id+claims/revisions (без обновляемого ticket/not_after/trace). Повтор того же запроса после обновления ticket не создаёт job; изменённый смысл даёт IDEMPOTENCY_CONFLICT. Отличать логический public ref от canonical internal id; внутренние aliases разрешены только в том же pinned security scope.

Для R01 поддерживается исходный utterance до лимита ядра 1200 символов, Europe/Moscow; более широкая форма schema не обещает capability. Template-submit, произвольная timezone и remote revoke_scope требуют следующих подзадач и возвращают CAPABILITY_UNAVAILABLE. Существующие матрица, формулы, transport, секреты и квалификация не заменяются.

## Исполняемые проверки

Baseline717 без ослабления. Новые: durable accept/restart; чужой tenant/actor/job; ticket expiry/подмена/verifier отсутствует; изменённые revisions/store/catalog; cancel точного старого ref; результат по ref при другом pointer; repeated read и expiry без API; changed replay; UNKNOWN не превращается в retry; отзыв между страницами и перед выдачей; действующий Unix peer check, размер/strict envelope; очистка refs/receipts и отсутствие ticket в SQLite. Отдельно byte-identical task schema/fixtures v0.5.

Итог должен включать самостоятельный ZIP со всем новым кодом/тестами (не только валидатор), manifest, проверку после чистой распаковки, границы интерфейса для второго исполнителя и адресный checkpoint на сервере. Production listener и общие конфиги не включаются до подключённой authority/adapter и совместной приёмки.
