# Модель данных и переходы состояний


Проект v0.5. Таблицы ниже — целевая модель новой платформы, не описание уже существующей SQLite. Миграции пишутся внутри функциональных шагов и проверяются на PostgreSQL; production SQL этим комплектом не исполняется.

## 1. Общие правила

UUID для внутренних объектов; UTC timestamp; отдельные IANA business/billing timezone; деньги в minor integer + ISO currency, расчёты Decimal. Обязательный `tenant_id` в клиентских объектах. Staff scope относится к alisa_market; глобальные security-полномочия выделены отдельно. Оплата и staff не принадлежат person автоматически. `created_at`, revision и provenance обязательны там, где состояние меняется.

Все FK между клиентскими таблицами включают tenant или эквивалентное проверяемое ограничение. Прикладные querysets и фоновые workers всегда tenant-scoped. RLS возможен дополнительным слоем, не заменяет проверки. Индексы строятся по реальным lookup/retention/queue условиям, не на raw text.

## 2. Сущности

| Объект | Ключевые поля/ограничения | Изменение/удаление |
|---|---|---|
| product_users | local user_id, identity_link_id, status, product_id=alisa_market | identity contact меняется в IdP, не локальным дублирующим логином |
| persons / verified_contacts | стабильный person_id, контакты, факторы, global security revision | владелец — отдельный identity authority, продукт не редактирует его БД |
| identity_links | issuer, subject, client_id, local_user_id; уникальность subject в проверенном контексте | pairwise subject не склеивается по email; подтверждённая связь и аудит |
| leads / funnel_events | защищённый контакт отдельно от safe campaign/event_id, environment, product_id | заявка не создаёт tenant/grant; отдельное согласие и retention |
| tenants | id, status, business_timezone, security_revision | status ACTIVE/BLOCKED/DELETING/DELETED |
| memberships | user_id, tenant_id, role; unique active owner в MVP | никакого auto-merge по email |
| identity.login_challenges | id, purpose, bound identity hash, expires_at, attempts, consumed_at | одноразовое потребление под lock; код не plaintext |
| sessions | id_hash, user, tenant, origin_class, revoked_at, expires_at | staff/user разделены; raw session token не хранится в аудитах |
| consent_receipts | subject, document_id/version/hash, action, timestamp | неизменяемые квитанции, не просто checkbox=true |
| staff_members / role_bindings | named user, permission_set, revision, MFA state | последний OWNER защищён транзакционно |
| alice_links | user,tenant,OAuth grant ref,status,revision | unlink не удаляет tenant/grants |
| oauth_codes/tokens | client,exact redirect,scopes,expiry,revocation | согласно проверенной библиотеке/legacy контракту; секреты отдельно |
| stores | tenant,id,provider,name,voice_alias,verified_identity,status | имя не identity; отключение увеличивает revision |
| credential_revisions | tenant,store,type,revision,secret_ref,key_version,status | secret ciphertext в vault, не в API-проекции |
| capabilities | store,credential_revision,operation,status,qualified_at,expiry | привязка к проверенной ревизии и источнику |
| plans / offers | plan ID, duration_months, price_minor,currency,version,terms,validity | опубликованная цена immutable; новая цена — новая версия |
| orders | tenant,id,offer snapshot,status,quote_expiry | unique fulfillment; оплаченный snapshot не изменяется |
| payment_attempts | tenant,order,provider_key,merchant,environment,state,provider_id | UNIQUE provider_key+merchant+env; UNKNOWN сохраняется |
| payment_facts | provider_id+merchant+env,amount,currency,status,verified_at | подтверждённые факты не удаляются для «исправления» |
| fulfillments | tenant,order,payment,grant; UNIQUE(order_id) | второй succeeded становится duplicate-payment incident |
| access_grants | tenant,source_type/source_id,start,end,unit,anchor,policy,status | UNIQUE(source_type,source_id,effect_kind); immutable original grant |
| access_adjustments | grant,action,affected future interval,reason,actor,request_id | append-only; нельзя переписать использованную историю |
| entitlement_projection | tenant,current basis,planned periods,next boundary,revision | rebuildable из ledger; не ручной paid flag |
| refunds | payment,amount,request_id,provider_key,status,access_effect | сумма pending reservations+succeeded ≤ подтверждённая сумма |
| receipt_records | payment/refund,operation,status,provider_ref,safe_document_link | fiscal state отдельно от payment state |
| billing_inbox / outbox | internal ID,provider object/type,env,received/processed,attempts | payload allowlist; effect dedup в транзакции |
| runtime_job_refs | tenant,job_id,logical_query_id,state,result_expiry,catalog_version | safe metadata; без копии финансового JSON |
| query_episodes | tenant pseudonym,logical_query_id,last_revision,route,outcome,reason | UNIQUE(logical_query_id); latest revision only |
| gap_events | producer,event_id,episode_revision,safe text,versions | UNIQUE(producer,event_id); bounded fields |
| clusters | id,signature,axis,dims,status,revision,policy_version | merge/split через provenance, без потери источников |
| cluster_memberships | episode,cluster,valid revision | эпизод не считается дважды после merge |
| demand_contributions | cluster,tenant_pseudo,analysis_day | UNIQUE(cluster,tenant_pseudo,analysis_day,policy_version) |
| candidate_tasks | cluster,trigger window,policy_version,status,assignee | один активный candidate на semantic cluster; закрытие не создаёт auto-loop |
| template_drafts | ID,semantic refs,slots,source deps,revision,status | code/URL не из пользовательского ввода |
| catalog_releases | id,schema,engine requirement,hash,proofs,author,approver | immutable; публикация не редактирует архив |
| catalog_assignments | scope,release_id,revision,enabled | атомарная смена с expected revision |
| support_cases | tenant,query_ref,kind,status,safe body | без отчётов по умолчанию; attachments отдельный TTL |
| notifications | tenant,type,bound object/revision,dedup key,state | unique logical notice; SMTP UNKNOWN не означает delivery |
| audit_events | actor,action,target,reason,previous/new safe projection,time | append-only, исключены raw secrets/финансы клиента |
| deletion_tombstones | tenant/object,revisions,effective_at | доступны restore-процессу до открытия ingress |
| worker_tasks / leases | task ID,state,lease_owner,lease_until,fencing token | lease не разрешает повтор внешней UNKNOWN-операции |

## 3. Состояния

**Account:** ACTIVE → BLOCKED или DELETING → DELETED. Разблокировка требует причины и права. Удаление не снимается restore автоматически.

**Order:** CREATED → AWAITING_PAYMENT → FULFILLED. CANCELED допустим до подтверждённого исполнения; поздний подтверждённый payment обрабатывается отдельно, не игнорируется по локальному timeout. У order есть сумма/условия, но нет «доступа по кнопке успех».

**Payment attempt:** CREATED → REQUESTING → PENDING / SUCCEEDED / CANCELED / UNKNOWN. Сетевой timeout/500 после send → UNKNOWN, если факт не установлен. Только аутентифицированный provider-read переводит UNKNOWN к известному состоянию. Старые notification не понижают финальный state.

**Grant:** SCHEDULED → ACTIVE → EXPIRED. REVOKED/ADJUSTED описываются дополнительной записью, а не удалением оригинала. PAYMENT/GIFT/COMPENSATION/TRIAL — источник, не lifecycle. TRIAL по умолчанию не включён.

**Job (нормализованная проекция):** ACCEPTED → QUEUED → RUNNING ↔ WAITING_SOURCE → READY → EXPIRED. CANCEL_REQUESTED → CANCELED; возможны FAILED, UNKNOWN, REVOKED. Точные legacy коды отображаются адаптером с сохранением смысла, не заменяются похожим enum. Нет перехода UNKNOWN→QUEUED по таймеру. Доставка имеет отдельное состояние: NOT_DELIVERED/DELIVERED/DELIVERY_UNKNOWN.

**Episode:** ACCEPTED → NEEDS_CLARIFICATION / PLANNED → READY / UNSUPPORTED / FAILED / CANCELED / REVOKED. P1_MISS может сопровождать READY; нужен route, final_outcome и reason, а не один флаг failure.

**Cluster/candidate:** NEW → TRIAGED → CANDIDATE → SPECIFIED → IN_DEVELOPMENT → VALIDATING → RELEASED → MONITORING → CLOSED. Альтернативы DUPLICATE / WAITING_FOR_PROVIDER / DECLINED / NEEDS_MORE_EVIDENCE. Повтор открытия — объяснимое действие, не бесконечная генерация новых тикетов.

**Catalog:** DRAFT → VALIDATED → APPROVED → PUBLISHED; SUSPENDED/RETIRED отдельно. APPROVED не равно активирован runtime. Runtime readback хранит фактическую assignment revision.

## 4. Транзакции и границы внешнего HTTP

T1a В identity: lock challenge → проверить срок/попытки → одноразовое consume → identity session. T1b В BFF: проверить OIDC callback и выполнить server-side code exchange → локальная транзакция unique identity link/user/tenant/session/audit. Это две системы, не воображаемая распределённая ACID-транзакция. Сбой callback не создаёт второй tenant; незавершённый продуктовый provisioning повторяется идемпотентно после нового безопасного входа.

T1c Lead: pending → verified с одноразовым подтверждением. Safe flow связывается с продуктовой регистрацией только после проверки права на контакт; источники воронки не становятся авторизацией.

T2 Подтверждение платежа: durable inbox → внешний authenticated GET → короткая транзакция lock payment/order/tenant ledger → upsert verified fact → unique fulfillment → grant → outbox. При двойном succeeded сохраняются оба payment facts; второй требует решения и не выдаёт второй срок молча.

T3 Gift/renewal: lock ledger tenant, сверить expected revision, найти конец непрерывного доступа, рассчитать календарные границы, insert grant+audit+outbox, commit. Внешнего HTTP внутри нет.

T4 Refund: сначала reserve refund amount и неизменный request/provider key, commit; затем HTTP; подтверждение отдельно меняет refund fact и выбранный access adjustment. Неудостоверенное списание денег не компенсируется произвольным удалением grant.

T5 Gap: durable безопасный outbox с episode revision; consumer insert event и upsert episode/вклад в одной транзакции. Если storage неисправен настолько, что нельзя учесть потери, completeness=UNKNOWN для интервала после последнего подтверждённого heartbeat, а не выдуманный точный счётчик.

T6 Publish: validate immutable package → approval specific hash → assignment CAS → runtime apply/readback. Уже начатый job не переинтерпретируется; failed readback не запускает отчёт заново.

## 5. Миграции и совместимость

Каждая функция включает additive migrations и rollback/compatibility тест затронутых consumers. Нет общей задачи «написать всю БД» до начала полезного UI. Снятие старых полей — только после прекращения старых readers. Constraints должны реально проверяться в PostgreSQL, а не только в serializer/SQLite unit fixture.

Исторические billing facts и согласия не удаляются для правки статистики. Проекции допускают rebuild по доказанному набору фактов. Restore применяет tombstones и отзывающие revisions до приёма сессий и внешних запросов.

## 6. Подготовка к объединению

Новые продуктовые таблицы и события имеют `product_id=alisa_market`. Ключи идемпотентности включают среду, продукт и владельца. Параллельных writers одного денежного журнала нет. `product_user_links` и будущие workspace/account links хранят отображение существующих IDs, не переименовывают их. Удаление локального продукта и глобального person — разные операции; восстановление учитывает оба журнала отзыва. Подробности: [IDENTITY_AND_UNIFICATION](IDENTITY_AND_UNIFICATION.md).
