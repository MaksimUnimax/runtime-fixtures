# Безопасность, эксплуатация и выпуск


Основа: blueprint §§18–20. Приведённые сроки/пределы новых модулей — проектные параметры, не юридическое заключение и не измеренный SLA.

## 1. Модель угроз

| Угроза | Обязательный контроль | Доказательство |
|---|---|---|
| Чужой tenant через ID/имя/job/URL | server-side scope, composite FK, worker context | AL-T01-03,03-03,06-03 |
| Захват staff/соседний поддомен | host-only sessions, MFA, CSRF/Origin, отдельные permissions | AL-T02-02/03/04 |
| Утечка marketplace ключа | encrypted vault, limited transport identity, no echo/log/export | AL-T03-02/05,10-03 |
| Модель выдаёт себе права/URL/код | bounded input, fixed source allowlist, independent context | AL-T06-03,12-02 |
| Spoof оплаты или duplicate | authenticated provider read, env check, unique fulfillment | AL-T14-02/03/04 |
| UNKNOWN повторён как новая операция | durable pre-send record, reconciliation, нет force replay | AL-T08-03,13-05,16-04 |
| Переполнение/спам demand | bounded events, tenant/day cap, explicit completeness | AL-T10-05,11-03 |
| XSS/CSV/лог-инъекция в фразе | escaping, schema limits, safe export, no dynamic eval | AL-T10-03,17-05,18-03 |
| Неправильный денежный смысл | независимый gold, axis/units/version, review | AL-T06-01,07-05,12-02 |
| Restore вернул удалённые права | отдельные tombstones, revocation-before-ingress | AL-T19-04,21-01 |

## 2. Данные и сроки

| Данные | Срок/политика |
|---|---|
| Результат/контекст ядра | сохранить текущие 900s; snapshot300s; уточнение900s |
| Runtime replay receipts/квоты | существующие 24h/25h; UNKNOWN tombstone отдельно |
| Private provider probes | прежний bounded24h; не публиковать |
| Raw вопрос | только краткоживущий контекст; durable raw-архив выключен |
| Safe gap examples | предложено90d; D07 до реальных пользователей |
| Query metadata / обычные platform logs | предложено30d, размер ограничен |
| Safe cluster aggregates / staff audit | предложено12m; юридическая политика может уточнить |
| Billing facts, refunds, fiscal receipts, consent | срок утверждает конкретная legal/accounting policy |
| Platform backups | предложено30d, encrypted; ключи восстановления отдельно |
| Marketplace credentials | до удаления подключения; ciphertext в закрытой границе |

Одна очищенная таблица не доказывает удаление из outbox, error traces, attachment store, replicas и backups. Retention тест проверяет все владельцы копий. Backup имеет отдельное окно очистки; мгновенное криптографическое стирание из всех копий не обещается. Переполненная БД не разрешает стереть активные jobs или UNKNOWN ради зелёного health.

## 3. Доступы и восстановление секретов

Минимальные Linux/systemd/DB service roles. Нет root-учётки веб-приложения. Platform staff не имеет интерфейсного доступа к plaintext vault. Encryption key version в ciphertext metadata, ключи вне DB/репозитория; их защищённая восстановимость входит в drill. Раздельные dev/stage/prod credentials; production не принимает test merchant.

Ограничения body, JSON-depth, файла, очереди и внешнего HTTP; fixed HTTPS allowlist, запрет SSRF/redirect к неразрешённому host. Пользовательский текст и provider response — недоверенные данные, не инструкции. CSP/headers, HTTPS/HSTS и cookie параметры проверяются на реальном origin перед пилотом.

## 4. Наблюдаемость

Безопасные structured logs: trace_id, service/build, event type, stable reason, duration, counts, provider family, result state, scope-safe reference. Не логировать Authorization, raw OAuth request, keys, полные вопросы и финансовые ответы. Метрики без high-cardinality сырых tenant/query labels. Staff lookup через проверяемые безопасные IDs.

Operator dashboard: webhook latency/errors, queue oldest age, UNKNOWN count, cleanup last success/backlog, outbox lag/dropped/unknown completeness, provider rate limits, LLM budget actual vs estimated, payment-success-without-fulfillment, receipt fail, vault/key rotation status, backup age и last restore proof.

Alerts: явные threshold/version/окно и trace link. Доставка в Telegram только безопасной квитанции; пользовательский текст/ключи/финансы туда не копируются. Падение каналов notifications не изображается отсутствием инцидентов.

## 5. Производительность

Инженерная стартовая цель v0.1: P95 quick-handler<1s, внутренний deadline≤2.5s с запасом на документированные4.5s Яндекса. Полная аналитика измеряется отдельно по классам, не имеет обещания «всегда5s». Test profile фиксирует tenant count, queue mix, response sizes, storage caps, CPU/RAM и duration.

Heavy execution limits — общие безопасные пределы, не скрытые тарифы за магазины. Weighted/fair scheduler проверяется на нескольких tenant. Общий provider account может делить квоту по безопасному fingerprint, но не раскрывает связь между клиентами. Admin export/payment polling/email не забирают fast-webhook workers.

## 6. Выпуск и миграция

Immutable manifest содержит platform commit/artifact, DB migration set, runtime build/contract, catalog release/hash, policy version и environment. Платформа и ядро выпускаются независимо при совместимом контракте. Не совмещать первую смену billing и новую матрицу в одном неподтверждённом production наборе.

Порядок: isolated staging → source/DB/contract/UI proof → external sandbox/Dialogs proof → backup+restore drill → controlled test/owner migration → физическая Станция → ограниченный free pilot → отдельно legal/payment production gate. Проверять ресурсы Alisa до установки; не использовать Easyscript/Business Bridge как свободный ресурс.

Migration manifest: старые/new identity/store IDs, точный OAuth контракт, секретные refs без значений, источник/получатель, hashes, dry-run, lock/write ownership, duplicate prevention, rollback routing. Original services не выключаются до proof; old SQLite не восстанавливается поверх новых работ. Перенос токенов по неизвестной схеме запрещён; поддержанная повторная связка лучше ложной прозрачной миграции.

## 7. Recovery runbook

1. Ограничить ingress/новые необратимые действия; сохранить safe evidence, не выполнять blanket retry.
2. Восстановить точную совместимую DB/schema и key access в изолированной среде.
3. Применить все актуальные revocations/deletion tombstones до открытия пользовательского входа.
4. Сверить деньги с провайдером; восстановить fulfillment идемпотентно; UNKNOWN не перезапускать.
5. Проверить TTL по текущему времени, очередь, catalog/runtime compatibility и поддержку предыдущей версии.
6. Открыть контролируемому клиенту, проверить исходы, затем расширить. Измерить RPO/RTO, зафиксировать несовпадения.

Цели RPO≤15m/RTO≤4h требуют реального восстановления. Если актуальный журнал удаления или ключи отсутствуют, не открывать доступ «чтобы проверить позже». Откат кода не означает отмену уже совершённого платежа.

## 8. Юридические/внешние условия

Цена, продавец, юрисдикция, клиентские условия, возвраты, касса/НДС, основания хранения текста и передачи внешней модели, локализация и сроки финансовых данных определяются до соответствующего живого запуска. Этот комплект не даёт правового заключения и не подставляет случайные налоговые значения. Free pilot тоже обрабатывает настоящие клиентские данные и требует privacy/hosting допуска; отсутствие денег не отменяет безопасность.

## 9. Identity, поддомены и воронка v0.5

У всех hosts собственные host-only cookies; нет общего Domain и wildcard CORS. Stage tokens/clients/данные не принимаются prod. Staff MFA доказывается проверенным auth flow, а роль проверяется backend. Callback и identity logs не сохраняют query с code/state/token. Nginx public access log для воронки хранит path без raw args.

CSP, CSRF, return_to и redirect allowlists не ослабляются ради cross-domain авторизации. State cookie должна сохраняться при легитимном OIDC redirect; настройка SameSite проверяется на реальном браузере. Общий origin двух продуктов допускается только при выравнивании доверия и отдельной приёмке.

Локальная блокировка/удаление Алисы не отнимает другой продукт. Глобальный security revoke ограничивает новые входы и по проверенной политике отзыва — сессии; задаётся измеримая задержка, не обещается магическое мгновенное удаление remote cookie.

Данные воронки минимизированы, lead contact хранится отдельно. Consent на маркетинг не требуется для уже оплаченной услуги. При отсутствии допустимой атрибуции показатель UNKNOWN, не угадывание. Неподходящие запросы не копируются в рекламную аналитику.

DNS/сертификат/порты не дают доступ к клиентам. До внешнего пилота real data только по допуску; не превращать открытую stage-систему в production. Проверки ENV-00 и текущая ёмкость сервера в [DOMAIN_SETUP](DOMAIN_SETUP.md).
