# Очередь API · v0.5

API — часть проверяемого UI-результата, не отдельная очередь разработки. Новый OIDC и реальные экраны определены в [IDENTITY_AND_UNIFICATION](IDENTITY_AND_UNIFICATION.md).

## Вход и новый public funnel

94 доменных операции прежнего OpenAPI остаются активными проектами, 2 локальные login операции сохранены только как deprecated history. Их прежние поведенческие гарантии входят в тесты нового входа. 10 новых entrypoint записей вынесены в [api/entrypoints-v0.5.yaml](api/entrypoints-v0.5.yaml). Это реестр интерфейсов, не ложное заявление о полной готовности всех схем.

В AL-S01 обязательны строгие lead/confirm/funnel schemas + limits и реальные эффекты. В AL-S02 — OIDC discovery/provider контракт, login callbacks, logout/CSRF и тест второго клиента. В AL-S03 — staff OIDC+MFA и просмотр лидов. Прежние платформенные `/api/v1/auth/challenges` и `/api/v1/auth/verify` НЕ становятся вторым authority.

## Границы прежнего OpenAPI, которые нельзя скрыть

В v0.2 формальное описание содержало не все специальные browser/service routes. Это не исправляется выдуманным статусом «всё API готово». Сохраняем существующие 96 операций как проектные, а следующие маршруты/строгие схемы автор добавляет в **той же** функциональной поставке до её проверки. Они не относятся к будущему шагу и не могут блокировать его тестировщика после handoff.

| Шаг | Недостающая предметная поверхность | Что требуется до READY_FOR_QA |
|---|---|---|
| 03 | Библиотечный staff/MFA/recovery flow | Зафиксированные реальные маршруты и CSRF/session-boundary тесты |
| 04 | Bulk preview/status/resume | Полные схемы request/response, pinned список, idempotency и тест восстановления |
| 06 | OAuth Яндекса и privacy-подмножество account PATCH | Точный provider contract и негативные тесты; не заменять его абстрактным OpenAPI |
| 08 | Отзыв WRONG_SEMANTICS по своему job и безопасный экспорт gap | Строгие bounded схемы, tenant-проверки и sanitizer |
| 11 | Чтение административной карточки шаблона и её зависимостей | Read-only endpoint, права и версии |
| 13 | Фактический runtime activation/readback и rollback | Версионный внутренний контракт, не только запись assignment |
| 15 | Собственный data-export | Состав allowlist, отказ чужому клиенту, сроки и аудит |
| 16 | Product-only поля stats | Явная недоступность непоставленного billing, а не вымышленные нули |
| 20 | Provider webhook/inbox | Контракт выбранного провайдера, проверка объекта и durable ACK |

Это конкретные технические подзадачи существующих поставок, не отдельные абстрактные этапы. До их реализации нельзя заявлять полноту API соответствующего шага. Сам backend/формы в данном исправлении не написаны.


## Основные операции

| Шаг | Operation | Route | Статус |
|---|---|---|---|
| AL-S02 | createLoginChallenge | `POST /api/v1/auth/challenges` | SUPERSEDED_BY_OIDC |
| AL-S02 | verifyLogin | `POST /api/v1/auth/verify` | SUPERSEDED_BY_OIDC |
| AL-S02 | logout | `POST /api/v1/auth/logout` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | listSessions | `GET /api/v1/sessions` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | revokeSession | `DELETE /api/v1/sessions/{session_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S02 | getAccount | `GET /api/v1/account` | ACTIVE_PROJECT_CONTRACT |
| AL-S06 | updateAccount | `PATCH /api/v1/account` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | startEmailChange | `POST /api/v1/account/email-change` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | verifyEmailChange | `POST /api/v1/account/email-change/verify` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | requestDeletion | `POST /api/v1/account/deletion` | ACTIVE_PROJECT_CONTRACT |
| AL-S15 | getDeletion | `GET /api/v1/account/deletion` | ACTIVE_PROJECT_CONTRACT |
| AL-S02 | listDocuments | `GET /api/v1/documents` | ACTIVE_PROJECT_CONTRACT |
| AL-S02 | recordConsent | `POST /api/v1/consents` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | listStores | `GET /api/v1/stores` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | createStore | `POST /api/v1/stores` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | getStore | `GET /api/v1/stores/{store_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | updateStore | `PATCH /api/v1/stores/{store_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | deleteStore | `DELETE /api/v1/stores/{store_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | replaceCredentials | `PUT /api/v1/stores/{store_id}/credentials` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | checkStore | `POST /api/v1/stores/{store_id}/checks` | ACTIVE_PROJECT_CONTRACT |
| AL-S05 | getCapabilities | `GET /api/v1/stores/{store_id}/capabilities` | ACTIVE_PROJECT_CONTRACT |
| AL-S06 | getAliceLink | `GET /api/v1/alice-link` | ACTIVE_PROJECT_CONTRACT |
| AL-S06 | unlinkAlice | `DELETE /api/v1/alice-link` | ACTIVE_PROJECT_CONTRACT |
| AL-S04 | getEntitlement | `GET /api/v1/entitlement` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | listOffers | `GET /api/v1/offers` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | createOrder | `POST /api/v1/orders` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | listOrders | `GET /api/v1/orders` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | getOrder | `GET /api/v1/orders/{order_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | createCheckout | `POST /api/v1/orders/{order_id}/checkout` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | listPayments | `GET /api/v1/payments` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | getPayment | `GET /api/v1/payments/{payment_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | listRefunds | `GET /api/v1/payments/{payment_id}/refunds` | ACTIVE_PROJECT_CONTRACT |
| AL-S07 | submitQuery | `POST /api/v1/queries` | ACTIVE_PROJECT_CONTRACT |
| AL-S07 | listQueries | `GET /api/v1/queries` | ACTIVE_PROJECT_CONTRACT |
| AL-S07 | getQuery | `GET /api/v1/queries/{query_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S07 | getQuery_result | `GET /api/v1/queries/{query_id}/result` | ACTIVE_PROJECT_CONTRACT |
| AL-S07 | cancelQuery | `POST /api/v1/queries/{query_id}/cancel` | ACTIVE_PROJECT_CONTRACT |
| AL-S11 | listTemplates | `GET /api/v1/templates` | ACTIVE_PROJECT_CONTRACT |
| AL-S11 | getTemplate | `GET /api/v1/templates/{template_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | createSupport | `POST /api/v1/support` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | listSupport | `GET /api/v1/support` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | getSupport | `GET /api/v1/support/{case_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | listSupportMessages | `GET /api/v1/support/{case_id}/messages` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | replySupport | `POST /api/v1/support/{case_id}/messages` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | initSupportAttachment | `POST /api/v1/support/{case_id}/attachments` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | getSupportAttachment | `GET /api/v1/support/{case_id}/attachments/{attachment_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | listStaff | `GET /staff/api/v1/members` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | createStaff | `POST /staff/api/v1/members` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | changeStaff | `PATCH /staff/api/v1/members/{member_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | listTenants | `GET /staff/api/v1/tenants` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | getTenant | `GET /staff/api/v1/tenants/{tenant_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | blockTenant | `POST /staff/api/v1/tenants/{tenant_id}/block` | ACTIVE_PROJECT_CONTRACT |
| AL-S04 | previewGrant | `POST /staff/api/v1/access-grants/preview` | ACTIVE_PROJECT_CONTRACT |
| AL-S04 | confirmGrant | `POST /staff/api/v1/access-grants` | ACTIVE_PROJECT_CONTRACT |
| AL-S04 | revokeGrant | `POST /staff/api/v1/access-grants/revoke` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | createOffer | `POST /staff/api/v1/offers` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | publishOffer | `POST /staff/api/v1/offers/{offer_id}/publish` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | staffListPayments | `GET /staff/api/v1/payments` | ACTIVE_PROJECT_CONTRACT |
| AL-S20 | reconcileBilling | `POST /staff/api/v1/billing/reconciliations` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | previewRefund | `POST /staff/api/v1/refunds/preview` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | confirmRefund | `POST /staff/api/v1/refunds` | ACTIVE_PROJECT_CONTRACT |
| AL-S08 | listGapEvents | `GET /staff/api/v1/insights/events` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | listClusters | `GET /staff/api/v1/insights/clusters` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | getCluster | `GET /staff/api/v1/insights/clusters/{cluster_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | triageCluster | `PATCH /staff/api/v1/insights/clusters/{cluster_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | mergeClusters | `POST /staff/api/v1/insights/clusters/merge` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | splitCluster | `POST /staff/api/v1/insights/clusters/{cluster_id}/split` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | getThresholds | `GET /staff/api/v1/insights/thresholds` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | updateThresholds | `PATCH /staff/api/v1/insights/thresholds` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | listCandidates | `GET /staff/api/v1/insights/candidates` | ACTIVE_PROJECT_CONTRACT |
| AL-S12 | updateCandidate | `PATCH /staff/api/v1/insights/candidates/{candidate_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | createTemplateDraft | `POST /staff/api/v1/catalog/drafts` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | updateTemplateDraft | `PATCH /staff/api/v1/catalog/drafts/{draft_id}` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | validateTemplate | `POST /staff/api/v1/catalog/drafts/{draft_id}/validate` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | createCatalogPackage | `POST /staff/api/v1/catalog/releases` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | approveCatalog | `POST /staff/api/v1/catalog/releases/{release_id}/approve` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | assignCatalog | `POST /staff/api/v1/catalog/assignments` | ACTIVE_PROJECT_CONTRACT |
| AL-S13 | suspendCatalogSource | `POST /staff/api/v1/catalog/suspensions` | ACTIVE_PROJECT_CONTRACT |
| AL-S16 | getStats | `GET /staff/api/v1/stats` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | staffListSupport | `GET /staff/api/v1/support` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | staffReplySupport | `POST /staff/api/v1/support/{case_id}/messages` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | listNotifications | `GET /staff/api/v1/notifications` | ACTIVE_PROJECT_CONTRACT |
| AL-S16 | getHealth | `GET /staff/api/v1/operations/health` | ACTIVE_PROJECT_CONTRACT |
| AL-S16 | listIncidents | `GET /staff/api/v1/operations/incidents` | ACTIVE_PROJECT_CONTRACT |
| AL-S16 | reconcileUnknown | `POST /staff/api/v1/operations/reconciliations` | ACTIVE_PROJECT_CONTRACT |
| AL-S19 | setAdmission | `POST /staff/api/v1/operations/admission` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | listAudit | `GET /staff/api/v1/audit` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | uploadSupportAttachment | `PUT /api/v1/support/{case_id}/attachments/{attachment_id}/content` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | userReadSupportAttachment | `GET /api/v1/support/{case_id}/attachments/{attachment_id}/content` | ACTIVE_PROJECT_CONTRACT |
| AL-S14 | staffReadSupportAttachment | `GET /staff/api/v1/support/{case_id}/attachments/{attachment_id}/content` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | userListFiscalReceipts | `GET /api/v1/payments/{payment_id}/receipts` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | userReadFiscalReceipt | `GET /api/v1/payments/{payment_id}/receipts/{receipt_id}/document` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | staffListFiscalReceipts | `GET /staff/api/v1/payments/{payment_id}/receipts` | ACTIVE_PROJECT_CONTRACT |
| AL-S22 | staffReadFiscalReceipt | `GET /staff/api/v1/payments/{payment_id}/receipts/{receipt_id}/document` | ACTIVE_PROJECT_CONTRACT |
| AL-S02 | userCsrfBootstrap | `GET /api/v1/auth/csrf` | ACTIVE_PROJECT_CONTRACT |
| AL-S03 | staffCsrfBootstrap | `GET /staff/api/v1/auth/csrf` | ACTIVE_PROJECT_CONTRACT |


## Технические маршруты AL-S00

Не добавляются как продуктовые API: health/readiness и stage-only /__engineering/probes. Их fixed schema/auth/TTL задаются FOUNDATION_00 и реализуются только для технической проверки. Future auth/publish/payment endpoints не имитируются. AL-S00 закрепляет формат versioned contracts и их проверку, а полный бизнес-контракт появляется у своего потребителя.
