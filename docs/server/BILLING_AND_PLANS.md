# Plans, Pricing, Subscriptions and Billing

## Неплатёжная инфраструктура затем оплата затем браузерное расширение 10 ноября 2026

Действующий порядок: **неплатёжная основа/службы/эксплуатация → независимая неплатёжная приёмка 4 → платёжный контур, его приёмка и затронутая регрессия 5 → именно браузерное расширение 6 → полная интеграция 7 → business/owner/RC/release8**. Полная редакция и входы: [PLAN](../development/coordination/PLAN.md#nonpayment-payment-browser-order-20261110). Эта более поздняя последовательность имеет приоритет над прежними датированными раскладками ниже; история, требования и исходные сроки сохраняются.

Платёжная разработка и её независимая приёмка относятся к 5 после неплатёжной приёмки 4 и до браузерного расширения 6. P5/Fake/Stub сохраняется как принятое simulated evidence. Достаточность fake либо необходимость готового adapter/sandbox перед 6 — открытое условие; fake не sandbox. Provider, цены, BETA и реальные финансовые операции этим текстом не меняются.

Открытое условие 5→6 — fake provider достаточно либо нужен выбранный adapter/sandbox; не считать это решённым. Сначала проверять уже предоставленные решения/входы, не запрашивать их повторно. Exact script/commit Алисы нужен к 6, PSP/sandbox inputs — к соответствующей операции 5; текущую разрешённую Health работу эти поздние входы не блокируют. Модели, роли, WIP, active frozen задания и live/DB/security/payment полномочия не меняются.


Status: normative commercial-domain architecture  
Date: 2026-09-03

## 1. Objective

Allow commercial policy to change from the server/admin panel without extension releases while preserving historical correctness and preventing payment duplication or silent repricing.

## 2. Separate domain concepts

Do not collapse the following into one `tariff` row:

### Plan

Stable sellable product identity, e.g. `seller_basic`.

### Plan revision

Immutable published composition/description of the plan at a point in time.

### Entitlements

Machine-readable capabilities/limits attached to a plan revision.

### Price

Stable commercial price identity for a plan/market/channel.

### Price revision

Immutable amount/currency/billing-period terms effective for a defined period/cohort.

### Subscription

Account's ongoing access state, bound to exact commercial revisions.

### Payment

Canonical confirmed/attempted money movement record.

### Billing event

Immutable validated event from payment provider or internal reconciliation process.

## 3. Why price revisions are mandatory

Example:

- September: Basic = 190 RUB / 30 days;
- November: Basic = 290 RUB / 30 days.

The system must support both:

- grandfather existing subscribers at 190;
- explicitly migrate selected/all subscribers to 290 under a deliberate policy.

Therefore changing the public price creates a new revision. It does not overwrite `190` with `290` in historical state.

## 4. Plan administration requirements

Admin can:

- create draft plan;
- edit draft metadata;
- create/publish new plan revision;
- attach entitlement values;
- mark plan public/hidden;
- archive plan;
- inspect all historical revisions;
- create account-specific entitlement overrides;
- compare revisions before publish.

Deletion policy:

- draft with no references may be deleted;
- published/referenced commercial history is archived, not deleted.

## 5. Price administration requirements

Admin can:

- create price identity;
- create draft price revision;
- set amount in minor currency units;
- set currency;
- set billing interval;
- set effective date/window;
- publish;
- stop new sales on a revision;
- select public/default revision;
- define explicit migration policy later.

Price revisions cannot be edited after publication except non-semantic metadata specifically designated safe. Monetary/period terms always require a new revision.

## 6. Entitlement examples

```text
source.ozon = true
ozon.analytics = true
ozon.performance = false
ai.chatgpt = true
ai.alice = true
device.max_active = 2
feature.guided_commands = true
```

The extension does not know product price logic. It receives effective entitlements.

## 7. Entitlement resolution order

Conceptual resolution:

1. packaged client capability boundary (client-side, final security gate);
2. global server kill/maintenance policy;
3. subscription state eligibility;
4. plan revision entitlement;
5. explicit account override;
6. feature rollout rule;
7. AI/browser/profile health/compatibility policy where relevant.

The server should expose an internal explanation object for admin/support, e.g.:

```json
{
  "key": "ozon.performance",
  "effective": false,
  "reason": "PLAN_DENIED",
  "source": "seller_basic@3"
}
```

## 8. Subscription state machine

Baseline states:

### `TRIAL`

Temporary access under trial policy.

### `ACTIVE`

Paid/current access.

### `GRACE`

Renewal/payment issue exists but bounded access remains.

### `PAST_DUE`

Payment is overdue and policy may restrict access.

### `CANCELED`

Subscription will not renew or has been canceled according to policy; access may continue through current period if applicable.

### `EXPIRED`

No current commercial access.

### `SUSPENDED`

Administrative/risk/manual suspension independent of ordinary billing expiry.

All state transitions record source/reason/timestamp.

## 9. Trial design

Trial is optional product policy, not hard-coded.

If enabled it needs:

- duration;
- eligible plans;
- one-trial-per-account/user/device/risk policy as chosen;
- transition at expiry;
- entitlement mapping;
- abuse controls.

Do not implement trial assumptions before product policy is chosen; support the state/model so it can be configured.

## 10. Billing provider abstraction

<a id="infrastructure-first-20261109"></a>

## Инфраструктура и подготовка оплаты прежде новой логики расширения — 09.11.2026

Решение владельца 09.11.2026 меняет [приоритет разработки B33](../development/coordination/PLAN.md#infrastructure-first-20261109): provider-neutral billing и разрешённая тестовая квалификация могут готовиться до новой версии расширения. Исторический [ADR-0020](ADR/0020-p5-subscription-billing-persistence-foundation.md) и P5 относятся к Fake/StubBillingProvider, не к real payment go-live.

Выбор production provider остаётся отдельным входом; YooKassa/T-Bank не выбраны этой записью. Fake, sandbox и live не смешиваются. Валюта, цены, trial/refund policy, настройки оплаты и платность первой волны не меняются. BETA — отдельное основание доступа; реальное применение прав в браузере требует настоящего клиента. Этот текст не выполняет checkout, списания, возвраты, DB/security или production действия.


Internal interface conceptually supports:

```text
createCheckout()
verifyWebhook()
parseEvent()
fetchPaymentStatus()
cancelOrRefund()   # only if later product flow requires it
```

Domain code consumes normalized provider events, not provider-specific payload fields directly.

P5 uses provider-neutral deterministic simulation for internal domain and test
flows. Real provider selection and integration are deferred to payment
go-live; no concrete provider is selected during P5.

## 11. Checkout flow

1. authenticated account chooses an available price revision;
2. server validates plan/price availability and account eligibility;
3. server creates checkout intent with idempotency key;
4. billing adapter creates provider checkout/payment;
5. canonical pending payment record is stored;
6. user is redirected to provider;
7. provider webhook later proves payment state;
8. validated event updates canonical payment/subscription transactionally.

Do not activate solely from browser return URL.

## 12. Webhook rules

Every webhook processing path must:

1. capture provider event identity;
2. verify authenticity before commercial mutation;
3. enforce unique provider event ID/idempotency;
4. normalize event;
5. lock/load affected payment/subscription as needed;
6. apply one valid state transition;
7. persist billing event + domain change atomically where practical;
8. enqueue notifications/reconciliation after commit.

Duplicate event -> safe no-op/replay response, never duplicate extension of access.

## 13. Payment reconciliation

Webhook delivery can fail or be delayed. Durable reconciliation jobs must be able to query normalized provider state for unresolved payments.

Reconciliation must be idempotent and produce the same canonical subscription state as valid webhook processing.

## 14. Manual admin actions

Admin operations include:

- grant plan access;
- extend current period;
- suspend;
- restore;
- cancel according to policy;
- account entitlement override.

Every manual commercial mutation requires:

- permission;
- reason;
- actor;
- audit event;
- subscription transition/source record;
- no silent modification of existing payment records.

## 15. Changing tariff price

Admin UX should require a choice:

### Option A — New sales only

New price revision becomes default for new subscriptions. Existing subscriptions retain their bound price revision.

### Option B — Scheduled migration

Create an explicit migration rule/job with effective date and affected population.

The system should preview affected subscriptions and require explicit confirmation. Migration history is auditable.

Automatic silent mass repricing is forbidden.

## 16. Changing tariff composition

Likewise, do not mutate published entitlement composition invisibly.

Create new plan revision.

Policy can decide whether:

- new subscriptions get new revision only;
- existing subscriptions migrate at renewal;
- explicit cohort migration occurs.

## 17. Device limits as entitlement

`device.max_active` is an integer entitlement.

Approval is intent-only. At device exchange/activation, the capability-granting transaction atomically enforces the active-device limit:

- resolve current account entitlement;
- count active devices according to policy;
- deny with `DEVICE_LIMIT_REACHED` or allow user to revoke another device;
- admin override is possible if permitted/audited.

Plan changes can change device limit without changing device identity model.

## 18. Expiry/grace jobs

Subscription period deadlines require durable jobs but DB state remains authority.

Jobs must be safe if delayed or delivered twice.

At execution, a job re-reads current subscription/version before transitioning; it does not trust stale queued assumptions.

## 19. Refunds/chargebacks

Not required for first coding step, but data model/provider abstraction must not prevent later support.

If provider reports refund/chargeback:

- create/normalize new billing event;
- do not erase original payment;
- apply explicit commercial policy/state transition;
- preserve audit/history.

## 20. Currency and amounts

- integer minor units;
- explicit ISO-like currency code;
- never floating point for money;
- do not assume RUB in core billing model even if first public product is RUB-priced.

## 21. Admin billing dashboard

At minimum:

- account current subscription/state;
- plan and exact revisions;
- bound price revision;
- current period/grace dates;
- payment history;
- unresolved/reconciliation state;
- manual action history;
- billing event trace by safe IDs;
- entitlement explanation.

## 22. Required tests

- price revision publish immutability;
- grandfathering;
- explicit migration preview/execution when implemented;
- duplicate webhook;
- forged/invalid webhook;
- out-of-order provider events;
- reconciliation after lost webhook;
- admin grant/extend audit;
- device limit after plan change;
- subscription expiry job duplicate;
- canceled subscription period behavior;
- suspended account overrides active payment state according to policy;
- amount/currency exactness.
