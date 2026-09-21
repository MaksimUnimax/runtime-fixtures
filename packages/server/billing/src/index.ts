import { createHash } from "node:crypto";
import {
  PurchasableOfferFailureCodeSchema,
  type PurchasableOffer,
  type PurchasableOfferResolver,
} from "@product/commercial-catalog";
import { PlanCodeSchema } from "@product/plans";
import { z } from "zod";

const UuidSchema = z.uuid();
const MachineKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const OpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !/^https?:/i.test(value));
const AmountMinorSchema = z.number().int().safe().min(0);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const IntervalUnitSchema = z.enum(["DAY", "MONTH", "YEAR"]);
const IntervalCountSchema = z.number().int().min(1).max(1200);
export type BillingIntervalUnit = z.infer<typeof IntervalUnitSchema>;

const CommercialLifecycleSchema = z.enum([
  "ACTIVE",
  "GRACE",
  "ENDED",
  "SUSPENDED",
]);
export type CommercialEntitlementLifecycle = z.infer<
  typeof CommercialLifecycleSchema
>;
const CommercialSourceSchema = z.enum([
  "BILLING_PROVIDER",
  "SYSTEM_RECONCILIATION",
  "ADMIN",
]);
export type CommercialEntitlementSource = z.infer<
  typeof CommercialSourceSchema
>;
const CommercialValueSchema = z.union([z.boolean(), z.number().int().safe()]);
const CommercialPermissionsSchema = z
  .record(z.string().min(1).max(128), CommercialValueSchema)
  .refine((value) => Object.keys(value).length <= 128, {
    message: "commercial permissions are bounded",
  });

/** Normalized provider-neutral entitlement event; raw provider payloads stop at the adapter. */
export const CommercialEntitlementEventSchema = z
  .object({
    provider: MachineKeySchema,
    eventId: OpaqueReferenceSchema,
    accountId: UuidSchema,
    planCode: PlanCodeSchema,
    lifecycle: CommercialLifecycleSchema,
    entitlementRevision: z.number().int().positive().safe(),
    effectiveFrom: z.date(),
    effectiveUntil: z.date().nullable(),
    source: CommercialSourceSchema,
    externalReference: OpaqueReferenceSchema.nullable(),
    providerEventVersion: z.number().int().positive().safe(),
    occurredAt: z.date(),
    permissions: CommercialPermissionsSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.effectiveUntil === null ||
      value.effectiveUntil > value.effectiveFrom,
    { message: "commercial entitlement effective window is invalid" },
  );
export type CommercialEntitlementEvent = z.infer<
  typeof CommercialEntitlementEventSchema
>;

export type CommercialEntitlementRecord = Readonly<{
  accountId: string;
  planCode: string;
  lifecycle: CommercialEntitlementLifecycle;
  entitlementRevision: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  source: CommercialEntitlementSource;
  externalReference: string | null;
  providerEventVersion: number;
  occurredAt: Date;
  permissions: Readonly<Record<string, boolean | number>>;
}>;

export type CommercialEntitlementEventApplyResult =
  | { kind: "APPLIED"; record: CommercialEntitlementRecord }
  | { kind: "DUPLICATE"; record: CommercialEntitlementRecord }
  | { kind: "STALE"; currentRevision: number }
  | { kind: "CONFLICT"; code: "EVENT_ID_REUSED" | "REVISION_CONFLICT" };

export type CommercialEntitlementProviderAdapter = {
  readonly providerKey: string;
  normalizeEvent(raw: unknown): Promise<
    | { kind: "OK"; event: CommercialEntitlementEvent }
    | {
        kind: "REJECTED";
        code: "MALFORMED_EVENT" | "PROVIDER_MISMATCH";
      }
  >;
};

export interface CommercialEntitlementEventRepository {
  applyEvent(
    event: CommercialEntitlementEvent,
  ): Promise<CommercialEntitlementEventApplyResult>;
  read(accountId: string): Promise<CommercialEntitlementRecord | null>;
}

function commercialEventCanonical(event: CommercialEntitlementEvent): string {
  return JSON.stringify({
    ...event,
    effectiveFrom: event.effectiveFrom.toISOString(),
    effectiveUntil: event.effectiveUntil?.toISOString() ?? null,
    occurredAt: event.occurredAt.toISOString(),
    permissions: Object.fromEntries(
      Object.entries(event.permissions).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

function recordFromEvent(
  event: CommercialEntitlementEvent,
): CommercialEntitlementRecord {
  return Object.freeze({
    accountId: event.accountId,
    planCode: event.planCode,
    lifecycle: event.lifecycle,
    entitlementRevision: event.entitlementRevision,
    effectiveFrom: new Date(event.effectiveFrom.getTime()),
    effectiveUntil: event.effectiveUntil
      ? new Date(event.effectiveUntil.getTime())
      : null,
    source: event.source,
    externalReference: event.externalReference,
    providerEventVersion: event.providerEventVersion,
    occurredAt: new Date(event.occurredAt.getTime()),
    permissions: Object.freeze({ ...event.permissions }),
  });
}

/** Deterministic fixture repository mirroring the required DB uniqueness/order rules. */
export class InMemoryCommercialEntitlementEventRepository
  implements CommercialEntitlementEventRepository
{
  private readonly events = new Map<string, string>();
  private readonly records = new Map<string, CommercialEntitlementRecord>();

  async applyEvent(
    rawEvent: CommercialEntitlementEvent,
  ): Promise<CommercialEntitlementEventApplyResult> {
    const event = CommercialEntitlementEventSchema.parse(rawEvent);
    const eventKey = `${event.provider}:${event.eventId}`;
    const canonical = commercialEventCanonical(event);
    const priorEvent = this.events.get(eventKey);
    if (priorEvent !== undefined) {
      if (priorEvent !== canonical)
        return { kind: "CONFLICT", code: "EVENT_ID_REUSED" };
      const current = this.records.get(event.accountId);
      if (!current) return { kind: "CONFLICT", code: "EVENT_ID_REUSED" };
      return { kind: "DUPLICATE", record: current };
    }

    const current = this.records.get(event.accountId);
    if (current && event.entitlementRevision < current.entitlementRevision)
      return { kind: "STALE", currentRevision: current.entitlementRevision };
    if (
      current &&
      event.entitlementRevision === current.entitlementRevision &&
      commercialEventCanonical({
        ...event,
        eventId: "current",
        provider: "current",
      }) !==
        commercialEventCanonical({
          ...event,
          eventId: "current",
          provider: "current",
          lifecycle: current.lifecycle,
          planCode: current.planCode,
          effectiveFrom: current.effectiveFrom,
          effectiveUntil: current.effectiveUntil,
          source: current.source,
          externalReference: current.externalReference,
          providerEventVersion: current.providerEventVersion,
          occurredAt: current.occurredAt,
          permissions: current.permissions,
        })
    )
      return { kind: "CONFLICT", code: "REVISION_CONFLICT" };

    this.events.set(eventKey, canonical);
    const record = recordFromEvent(event);
    this.records.set(event.accountId, record);
    return { kind: "APPLIED", record };
  }

  async read(accountId: string): Promise<CommercialEntitlementRecord | null> {
    const record = this.records.get(accountId);
    if (!record) return null;
    return recordFromEvent({
      provider: "snapshot",
      eventId: `snapshot-${record.entitlementRevision}`,
      accountId: record.accountId,
      planCode: record.planCode,
      lifecycle: record.lifecycle,
      entitlementRevision: record.entitlementRevision,
      effectiveFrom: record.effectiveFrom,
      effectiveUntil: record.effectiveUntil,
      source: record.source,
      externalReference: record.externalReference,
      providerEventVersion: record.providerEventVersion,
      occurredAt: record.occurredAt,
      permissions: record.permissions,
    });
  }
}

export async function processCommercialEntitlementEvent(
  adapter: CommercialEntitlementProviderAdapter,
  repository: CommercialEntitlementEventRepository,
  rawEvent: unknown,
): Promise<
  | { kind: "REJECTED"; code: "MALFORMED_EVENT" | "PROVIDER_MISMATCH" }
  | CommercialEntitlementEventApplyResult
> {
  const result = await adapter.normalizeEvent(rawEvent);
  if (result.kind === "REJECTED") return result;
  return repository.applyEvent(result.event);
}

export const CheckoutIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const CreateCheckoutCommandSchema = z
  .object({
    accountId: UuidSchema,
    priceRevisionId: UuidSchema,
    idempotencyKey: CheckoutIdempotencyKeySchema,
  })
  .strict();
export type CreateCheckoutCommand = z.infer<typeof CreateCheckoutCommandSchema>;

export const CheckoutContextSchema = z
  .object({
    actorType: z.literal("ACCOUNT_USER"),
    actorId: UuidSchema,
    correlationId: z.string().min(1).max(128),
  })
  .strict();
export type CheckoutContext = z.infer<typeof CheckoutContextSchema>;

export const CheckoutFailureCodeSchema = z.enum([
  "ACCOUNT_NOT_FOUND",
  "FORBIDDEN",
  "ACCOUNT_SUSPENDED",
  "CURRENT_SUBSCRIPTION_EXISTS",
  "CHECKOUT_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "CHECKOUT_PROVIDER_MISMATCH",
  "PROVIDER_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "CHECKOUT_CORRUPTED",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELED",
  "SERVICE_UNAVAILABLE",
  ...PurchasableOfferFailureCodeSchema.options,
]);
export type CheckoutFailureCode = z.infer<typeof CheckoutFailureCodeSchema>;

export const BillingProviderCheckoutInputSchema = z
  .object({
    providerRequestId: UuidSchema,
    amountMinor: AmountMinorSchema,
    currency: CurrencySchema,
    billingIntervalUnit: IntervalUnitSchema,
    billingIntervalCount: IntervalCountSchema,
  })
  .strict();
export type BillingProviderCheckoutInput = z.infer<
  typeof BillingProviderCheckoutInputSchema
>;

const ProviderCreatedSchema = z
  .object({
    kind: z.literal("CREATED"),
    providerCheckoutId: OpaqueReferenceSchema,
    providerPaymentId: OpaqueReferenceSchema,
    checkoutReference: OpaqueReferenceSchema,
  })
  .strict();
const ProviderRejectedSchema = z
  .object({ kind: z.literal("REJECTED"), code: z.literal("REJECTED") })
  .strict();
const ProviderUnavailableSchema = z
  .object({ kind: z.literal("UNAVAILABLE") })
  .strict();
export const ProviderCheckoutResultSchema = z.discriminatedUnion("kind", [
  ProviderCreatedSchema,
  ProviderRejectedSchema,
  ProviderUnavailableSchema,
]);
export type ProviderCheckoutResult = z.infer<
  typeof ProviderCheckoutResultSchema
>;

export interface BillingProviderPort {
  readonly providerKey: string;
  createCheckout(
    input: BillingProviderCheckoutInput,
  ): Promise<ProviderCheckoutResult>;
}

export const BillingPaymentStatusStateSchema = z.enum([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
]);
export type BillingPaymentStatusState = z.infer<
  typeof BillingPaymentStatusStateSchema
>;

export const BillingPaymentStatusFoundSchema = z
  .object({
    kind: z.literal("FOUND"),
    state: BillingPaymentStatusStateSchema,
    amountMinor: AmountMinorSchema,
    currency: CurrencySchema,
    statusAt: z.date(),
  })
  .strict();
export const BillingPaymentStatusResultSchema = z.discriminatedUnion("kind", [
  BillingPaymentStatusFoundSchema,
  z.object({ kind: z.literal("NOT_FOUND") }).strict(),
  z.object({ kind: z.literal("UNAVAILABLE") }).strict(),
]);
export type BillingPaymentStatusResult = z.infer<
  typeof BillingPaymentStatusResultSchema
>;

/** Status lookup is deliberately separate from checkout creation. */
export interface BillingPaymentStatusPort {
  readonly providerKey: string;
  fetchPaymentStatus(input: {
    providerPaymentId: string;
  }): Promise<BillingPaymentStatusResult>;
}

export const BillingReconciliationJobStateSchema = z.enum([
  "READY",
  "LEASED",
  "SETTLED",
  "BLOCKED",
]);
export type BillingReconciliationJobState = z.infer<
  typeof BillingReconciliationJobStateSchema
>;

export const BillingReconciliationRetryCodeSchema = z.enum([
  "PROVIDER_PENDING",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_NOT_FOUND",
  "CURRENT_SUBSCRIPTION_CONFLICT",
  "PAYMENT_STATE_CONFLICT",
  "PAYMENT_SUBSCRIPTION_CORRUPTED",
]);
export type BillingReconciliationRetryCode = z.infer<
  typeof BillingReconciliationRetryCodeSchema
>;

export const BILLING_RECONCILIATION_RETRY_DELAY_MS = 60_000;
export function reconciliationRetryAt(
  processedAt: Date,
  delayMs = BILLING_RECONCILIATION_RETRY_DELAY_MS,
): Date {
  if (!Number.isFinite(delayMs) || delayMs < 0)
    throw new Error("INVALID_RETRY_DELAY");
  const result = new Date(processedAt.getTime() + delayMs);
  if (Number.isNaN(result.getTime())) throw new Error("INVALID_DATE");
  return result;
}

const RECONCILIATION_IDENTITY_DOMAIN =
  "product-control-plane/billing-reconciliation/event-identity/v1";
const RECONCILIATION_PAYLOAD_DOMAIN =
  "product-control-plane/billing-reconciliation/payload/v1";

export function reconciliationPayloadSha256(input: {
  paymentId: string;
  provider: string;
  providerPaymentId: string;
  state: BillingPaymentStatusState;
  amountMinor: number;
  currency: string;
  statusAt: Date;
}): string {
  return sha256(
    `${RECONCILIATION_PAYLOAD_DOMAIN}\npaymentId=${input.paymentId}\nprovider=${input.provider}\nproviderPaymentId=${input.providerPaymentId}\nstate=${input.state}\namountMinor=${input.amountMinor}\ncurrency=${input.currency}\nstatusAt=${input.statusAt.toISOString()}`,
  );
}

export function reconciliationEventIdentity(input: {
  paymentId: string;
  attemptCount: number;
  state: BillingPaymentStatusState;
  statusAt: Date;
  normalizedPayloadSha256: string;
}): string {
  return `recon_v1_${sha256(`${RECONCILIATION_IDENTITY_DOMAIN}\npaymentId=${input.paymentId}\nattempt=${input.attemptCount}\nstate=${input.state}\nstatusAt=${input.statusAt.toISOString()}\npayloadSha256=${input.normalizedPayloadSha256}`)}`;
}

export type BillingReconciliationClaim = {
  paymentId: string;
  provider: string;
  providerPaymentId: string;
  accountId: string;
  priceRevisionId: string;
  amountMinor: number;
  currency: string;
  paymentState:
    | "PENDING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "REFUNDED"
    | "CHARGEBACK";
  createdAt: Date;
  attemptCount: number;
  leaseToken: string;
};

export type BillingReconciliationProcessResult =
  | { kind: "RESCHEDULED"; code: BillingReconciliationRetryCode }
  | {
      kind: "APPLIED" | "IGNORED" | "BLOCKED" | "FAILED";
      code?: string;
      billingEventId?: string | null;
      paymentId: string;
    }
  | { kind: "STALE_LEASE"; paymentId: string };

export interface BillingReconciliationRepository {
  claimDue(input: {
    now: Date;
    leaseMs: number;
    batchSize: number;
  }): Promise<BillingReconciliationClaim[]>;
  reschedule(input: {
    paymentId: string;
    leaseToken: string;
    nextAttemptAt: Date;
    code: BillingReconciliationRetryCode;
  }): Promise<BillingReconciliationProcessResult>;
  applyStatus(input: {
    claim: BillingReconciliationClaim;
    status: Extract<BillingPaymentStatusResult, { kind: "FOUND" }>;
    processedAt: Date;
    correlationId: string;
  }): Promise<BillingReconciliationProcessResult>;
  blockUnsupported(input: {
    claim: BillingReconciliationClaim;
    processedAt: Date;
    correlationId: string;
    code: string;
  }): Promise<BillingReconciliationProcessResult>;
}

export type BillingReconciliationServiceOptions = {
  repository: BillingReconciliationRepository;
  statusPort: BillingPaymentStatusPort;
  now?: () => Date;
  retryDelayMs?: number;
};

export function createBillingReconciliationService(
  options: BillingReconciliationServiceOptions,
) {
  const now = options.now ?? (() => new Date());
  const retryDelayMs =
    options.retryDelayMs ?? BILLING_RECONCILIATION_RETRY_DELAY_MS;
  const providerKey = MachineKeySchema.parse(options.statusPort.providerKey);
  async function processClaim(
    claim: BillingReconciliationClaim,
    correlationId: string,
  ): Promise<BillingReconciliationProcessResult> {
    if (claim.provider !== providerKey)
      return options.repository.blockUnsupported({
        claim,
        processedAt: now(),
        correlationId,
        code: "PROVIDER_MISMATCH",
      });
    let status: BillingPaymentStatusResult;
    try {
      status = BillingPaymentStatusResultSchema.parse(
        await options.statusPort.fetchPaymentStatus({
          providerPaymentId: claim.providerPaymentId,
        }),
      );
    } catch {
      status = { kind: "UNAVAILABLE" };
    }
    const observedAt = new Date(now().getTime());
    if (status.kind === "FOUND" && status.state === "PENDING")
      return options.repository.reschedule({
        paymentId: claim.paymentId,
        leaseToken: claim.leaseToken,
        nextAttemptAt: reconciliationRetryAt(observedAt, retryDelayMs),
        code: "PROVIDER_PENDING",
      });
    if (status.kind === "UNAVAILABLE")
      return options.repository.reschedule({
        paymentId: claim.paymentId,
        leaseToken: claim.leaseToken,
        nextAttemptAt: reconciliationRetryAt(observedAt, retryDelayMs),
        code: "PROVIDER_UNAVAILABLE",
      });
    if (status.kind === "NOT_FOUND")
      return options.repository.reschedule({
        paymentId: claim.paymentId,
        leaseToken: claim.leaseToken,
        nextAttemptAt: reconciliationRetryAt(observedAt, retryDelayMs),
        code: "PROVIDER_NOT_FOUND",
      });
    return options.repository.applyStatus({
      claim,
      status,
      processedAt: observedAt,
      correlationId,
    });
  }
  return { processClaim };
}

export const BillingEventTypeSchema = z.enum([
  "payment.succeeded",
  "payment.failed",
  "payment.canceled",
]);
export type BillingEventType = z.infer<typeof BillingEventTypeSchema>;

const BillingEventIdentitySchema = OpaqueReferenceSchema;

export const VerifiedBillingEventSchema = z
  .object({
    provider: MachineKeySchema,
    eventIdentity: BillingEventIdentitySchema,
    eventType: BillingEventTypeSchema,
    providerPaymentId: BillingEventIdentitySchema,
    amountMinor: AmountMinorSchema,
    currency: CurrencySchema,
    occurredAt: z.date(),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type VerifiedBillingEvent = z.infer<typeof VerifiedBillingEventSchema>;

export const BillingEventContextSchema = z
  .object({ correlationId: z.string().min(1).max(128) })
  .strict();
export type BillingEventContext = z.infer<typeof BillingEventContextSchema>;

export const BillingEventVerificationCodeSchema = z.enum([
  "MALFORMED_EVENT",
  "INVALID_EVENT_PROOF",
]);
export type BillingEventVerificationCode = z.infer<
  typeof BillingEventVerificationCodeSchema
>;

export type BillingEventVerificationResult =
  | { kind: "VERIFIED"; event: VerifiedBillingEvent }
  | { kind: "REJECTED"; code: BillingEventVerificationCode };

export interface BillingEventVerificationPort {
  readonly providerKey: string;
  verifyEvent(
    raw: unknown,
  ): Promise<BillingEventVerificationResult> | BillingEventVerificationResult;
}

export const BillingEventFailureCodeSchema = z.enum([
  "MALFORMED_EVENT",
  "INVALID_EVENT_PROOF",
  "EVENT_IDENTITY_CONFLICT",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_TERMS_MISMATCH",
  "PAYMENT_STATE_CONFLICT",
  "CHECKOUT_NOT_FOUND",
  "CHECKOUT_CORRUPTED",
  "EVENT_TIME_INVALID",
  "CURRENT_SUBSCRIPTION_CONFLICT",
  "PAYMENT_SUBSCRIPTION_CORRUPTED",
  "SERVICE_UNAVAILABLE",
]);
export type BillingEventFailureCode = z.infer<
  typeof BillingEventFailureCodeSchema
>;

export type BillingEventProcessingResult =
  | {
      kind: "APPLIED";
      replay: boolean;
      billingEventId: string;
      paymentId: string | null;
      subscriptionId: string | null;
      subscriptionTransitionId: string | null;
    }
  | {
      kind: "IGNORED";
      replay: boolean;
      billingEventId: string;
      paymentId: string | null;
      subscriptionId: string | null;
    }
  | {
      kind: "FAILED";
      replay: boolean;
      billingEventId: string;
      code: BillingEventFailureCode;
      paymentId: string | null;
      subscriptionId: string | null;
    }
  | { kind: "REJECTED"; code: BillingEventFailureCode; replay: false }
  | {
      kind: "RETRYABLE";
      code: "SERVICE_UNAVAILABLE";
      billingEventId?: string;
    };

export interface BillingEventApplicationRepository {
  applyVerifiedBillingEvent(input: {
    event: VerifiedBillingEvent;
    context: BillingEventContext;
    receivedAt: Date;
    verifiedAt: Date;
  }): Promise<BillingEventProcessingResult>;
}

export type BillingEventServiceOptions = {
  repository: BillingEventApplicationRepository;
  verifier: BillingEventVerificationPort;
  now?: () => Date;
};

export function createBillingEventService(options: BillingEventServiceOptions) {
  const now = options.now ?? (() => new Date());
  const providerKey = MachineKeySchema.parse(options.verifier.providerKey);

  async function processBillingEvent(
    rawEvent: unknown,
    rawContext: unknown,
  ): Promise<BillingEventProcessingResult> {
    const context = BillingEventContextSchema.safeParse(rawContext);
    if (!context.success)
      return { kind: "REJECTED", code: "MALFORMED_EVENT", replay: false };
    const capturedAt = new Date(now().getTime());
    let verification: BillingEventVerificationResult;
    try {
      verification = await options.verifier.verifyEvent(rawEvent);
    } catch {
      return { kind: "RETRYABLE", code: "SERVICE_UNAVAILABLE" };
    }
    if (verification.kind === "REJECTED")
      return { kind: "REJECTED", code: verification.code, replay: false };
    const parsed = VerifiedBillingEventSchema.safeParse(verification.event);
    if (!parsed.success || parsed.data.provider !== providerKey)
      return { kind: "REJECTED", code: "MALFORMED_EVENT", replay: false };
    try {
      return await options.repository.applyVerifiedBillingEvent({
        event: parsed.data,
        context: context.data,
        receivedAt: capturedAt,
        verifiedAt: capturedAt,
      });
    } catch {
      return { kind: "RETRYABLE", code: "SERVICE_UNAVAILABLE" };
    }
  }

  return { processBillingEvent, applyBillingEvent: processBillingEvent };
}

export const createBillingEventProcessor = createBillingEventService;

export function addUtcCalendarInterval(
  start: Date,
  unit: BillingIntervalUnit,
  count: number,
): Date {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("INVALID_INTERVAL");
  const value = new Date(start.getTime());
  if (Number.isNaN(value.getTime())) throw new Error("INVALID_DATE");
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  if (unit === "DAY") {
    value.setUTCDate(day + count);
    return value;
  }
  const monthOffset = unit === "MONTH" ? count : count * 12;
  const destinationMonth = month + monthOffset;
  const destinationYear = year + Math.floor(destinationMonth / 12);
  const normalizedMonth = ((destinationMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(destinationYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      destinationYear,
      normalizedMonth,
      Math.min(day, lastDay),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
}

export type CheckoutIntentState = "CREATING" | "READY" | "FAILED";
export type CheckoutIntent = {
  id: string;
  accountId: string;
  priceRevisionId: string;
  planRevisionId: string;
  provider: string;
  state: CheckoutIntentState;
  idempotencyKeyHash: string;
  requestFingerprintSha256: string;
  admittedAt: Date;
  amountMinor: number;
  currency: string;
  billingIntervalUnit: BillingIntervalUnit;
  billingIntervalCount: number;
  providerCheckoutId: string | null;
  providerPaymentId: string | null;
  checkoutReference: string | null;
  paymentId: string | null;
  paymentState?:
    | "PENDING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "REFUNDED"
    | "CHARGEBACK"
    | null;
  failureCode: CheckoutFailureCode | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type CheckoutAccountObservation = {
  accountExists: boolean;
  owner: boolean;
  accountStatus: "ACTIVE" | "SUSPENDED" | null;
  hasCurrentSubscription: boolean;
};

export type CheckoutInspection = {
  account: CheckoutAccountObservation;
  intent: CheckoutIntent | null;
};

export type CheckoutPrepareInput = {
  accountId: string;
  actorId: string;
  provider: string;
  idempotencyKeyHash: string;
  requestFingerprintSha256: string;
  admittedAt: Date;
  offer: Pick<
    PurchasableOffer,
    | "priceRevisionId"
    | "planRevisionId"
    | "amountMinor"
    | "currency"
    | "billingIntervalUnit"
    | "billingIntervalCount"
  >;
  context: CheckoutContext;
};

export type CheckoutPrepareResult =
  | { kind: "CREATED"; intent: CheckoutIntent }
  | { kind: "EXISTING"; intent: CheckoutIntent }
  | { kind: "REJECTED"; code: CheckoutFailureCode };

export type CheckoutFinalizeResult =
  | { kind: "READY"; intent: CheckoutIntent }
  | { kind: "FAILED"; intent: CheckoutIntent; code: CheckoutFailureCode }
  | { kind: "REJECTED"; code: CheckoutFailureCode }
  | { kind: "SERVICE_UNAVAILABLE" };

export interface CheckoutRepository {
  inspectCheckout(input: {
    accountId: string;
    actorId: string;
    idempotencyKeyHash: string;
  }): Promise<CheckoutInspection>;
  prepareCheckout(input: CheckoutPrepareInput): Promise<CheckoutPrepareResult>;
  finalizeCheckout(input: {
    intentId: string;
    provider: string;
    context: CheckoutContext;
    result: Exclude<ProviderCheckoutResult, { kind: "UNAVAILABLE" }>;
  }): Promise<CheckoutFinalizeResult>;
  failCheckout(input: {
    intentId: string;
    code: CheckoutFailureCode;
    provider: string;
    context: CheckoutContext;
  }): Promise<CheckoutFinalizeResult>;
}

export type CheckoutResult =
  | {
      kind: "READY";
      replay: boolean;
      checkoutIntentId: string;
      paymentId: string;
      planRevisionId: string;
      priceRevisionId: string;
      amountMinor: number;
      currency: string;
      billingIntervalUnit: BillingIntervalUnit;
      billingIntervalCount: number;
      provider: string;
      checkoutReference: string;
    }
  | { kind: "REJECTED"; code: CheckoutFailureCode; replay: boolean }
  | {
      kind: "RETRYABLE";
      code: "PROVIDER_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
      checkoutIntentId: string;
    };

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const IDEMPOTENCY_DOMAIN = "product-control-plane/checkout-idempotency/v1";
const FINGERPRINT_DOMAIN = "product-control-plane/checkout-request/v1";

export function hashCheckoutIdempotencyKey(idempotencyKey: string): string {
  return sha256(`${IDEMPOTENCY_DOMAIN}\n${idempotencyKey}`);
}

export function fingerprintCheckoutRequest(input: {
  accountId: string;
  priceRevisionId: string;
}): string {
  return sha256(
    `${FINGERPRINT_DOMAIN}\naccountId=${input.accountId}\npriceRevisionId=${input.priceRevisionId}`,
  );
}

function actionabilityFailure(
  observation: CheckoutAccountObservation,
): CheckoutFailureCode | null {
  if (!observation.accountExists) return "ACCOUNT_NOT_FOUND";
  if (!observation.owner) return "FORBIDDEN";
  if (observation.accountStatus === "SUSPENDED") return "ACCOUNT_SUSPENDED";
  if (observation.hasCurrentSubscription) return "CURRENT_SUBSCRIPTION_EXISTS";
  return null;
}

function terminalReadyFailure(
  intent: CheckoutIntent,
  observation: CheckoutAccountObservation,
): CheckoutFailureCode | null {
  if (intent.paymentState === undefined || intent.paymentState === "PENDING")
    return null;
  if (intent.paymentState === "FAILED") return "PAYMENT_FAILED";
  if (intent.paymentState === "CANCELED") return "PAYMENT_CANCELED";
  if (intent.paymentState === "SUCCEEDED")
    return observation.hasCurrentSubscription
      ? "CURRENT_SUBSCRIPTION_EXISTS"
      : "CHECKOUT_CORRUPTED";
  return "CHECKOUT_CORRUPTED";
}

function readyResult(intent: CheckoutIntent, replay: boolean): CheckoutResult {
  if (
    intent.state !== "READY" ||
    !intent.paymentId ||
    !intent.checkoutReference ||
    !intent.providerCheckoutId ||
    !intent.providerPaymentId
  )
    return { kind: "REJECTED", code: "CHECKOUT_CORRUPTED", replay };
  return {
    kind: "READY",
    replay,
    checkoutIntentId: intent.id,
    paymentId: intent.paymentId,
    planRevisionId: intent.planRevisionId,
    priceRevisionId: intent.priceRevisionId,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    billingIntervalUnit: intent.billingIntervalUnit,
    billingIntervalCount: intent.billingIntervalCount,
    provider: intent.provider,
    checkoutReference: intent.checkoutReference,
  };
}

export type CheckoutServiceOptions = {
  repository: CheckoutRepository;
  offerResolver: PurchasableOfferResolver;
  provider: BillingProviderPort;
  now?: () => Date;
};

export function createCheckoutService(options: CheckoutServiceOptions) {
  const now = options.now ?? (() => new Date());
  const providerKey = MachineKeySchema.parse(options.provider.providerKey);

  async function finishExisting(
    intent: CheckoutIntent,
    observation: CheckoutAccountObservation,
    requestFingerprint: string,
    context: CheckoutContext,
  ): Promise<CheckoutResult | null> {
    if (intent.requestFingerprintSha256 !== requestFingerprint) return null;
    if (intent.provider !== providerKey)
      return {
        kind: "REJECTED",
        code: "CHECKOUT_PROVIDER_MISMATCH",
        replay: true,
      };
    if (intent.state === "FAILED")
      return {
        kind: "REJECTED",
        code: intent.failureCode ?? "CHECKOUT_CORRUPTED",
        replay: true,
      };
    if (intent.state === "READY") {
      const terminalFailure = terminalReadyFailure(intent, observation);
      if (terminalFailure)
        return { kind: "REJECTED", code: terminalFailure, replay: true };
      const blocked = actionabilityFailure(observation);
      return blocked
        ? { kind: "REJECTED", code: blocked, replay: true }
        : readyResult(intent, true);
    }
    const blocked = actionabilityFailure(observation);
    if (blocked) {
      try {
        const failed = await options.repository.failCheckout({
          intentId: intent.id,
          code: blocked,
          provider: providerKey,
          context,
        });
        return finalizeToResult(failed, true, intent.id);
      } catch {
        return {
          kind: "RETRYABLE",
          code: "SERVICE_UNAVAILABLE",
          checkoutIntentId: intent.id,
        };
      }
    }
    return null;
  }

  function finalizeToResult(
    result: CheckoutFinalizeResult,
    replay: boolean,
    fallbackIntentId = "",
  ): CheckoutResult {
    if (result.kind === "READY") return readyResult(result.intent, replay);
    if (result.kind === "FAILED")
      return { kind: "REJECTED", code: result.code, replay };
    if (result.kind === "REJECTED")
      return { kind: "REJECTED", code: result.code, replay };
    return {
      kind: "RETRYABLE",
      code: "SERVICE_UNAVAILABLE",
      checkoutIntentId: fallbackIntentId,
    };
  }

  async function createCheckout(
    rawCommand: unknown,
    rawContext: unknown,
  ): Promise<CheckoutResult> {
    const command = CreateCheckoutCommandSchema.parse(rawCommand);
    const context = CheckoutContextSchema.parse(rawContext);
    const idempotencyKeyHash = hashCheckoutIdempotencyKey(
      command.idempotencyKey,
    );
    const requestFingerprint = fingerprintCheckoutRequest(command);
    let observation: CheckoutInspection;
    try {
      observation = await options.repository.inspectCheckout({
        accountId: command.accountId,
        actorId: context.actorId,
        idempotencyKeyHash,
      });
    } catch {
      return {
        kind: "RETRYABLE",
        code: "SERVICE_UNAVAILABLE",
        checkoutIntentId: "",
      };
    }
    const intent = observation.intent;
    if (intent) {
      if (intent.requestFingerprintSha256 !== requestFingerprint)
        return {
          kind: "REJECTED",
          code: "IDEMPOTENCY_KEY_REUSED",
          replay: true,
        };
      const existing = await finishExisting(
        intent,
        observation.account,
        requestFingerprint,
        context,
      );
      if (existing) return existing;
    }
    const blocked = actionabilityFailure(observation.account);
    if (blocked)
      return { kind: "REJECTED", code: blocked, replay: Boolean(intent) };

    let offer: PurchasableOffer;
    let admittedAt: Date | undefined;
    if (intent) {
      offer = {
        planRevisionId: intent.planRevisionId,
        priceRevisionId: intent.priceRevisionId,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        billingIntervalUnit: intent.billingIntervalUnit,
        billingIntervalCount: intent.billingIntervalCount,
      } as PurchasableOffer;
    } else {
      admittedAt = new Date(now().getTime());
      let resolution;
      try {
        resolution = await options.offerResolver.resolvePurchasableOffer({
          priceRevisionId: command.priceRevisionId,
          at: admittedAt,
        });
      } catch {
        return { kind: "REJECTED", code: "SERVICE_UNAVAILABLE", replay: false };
      }
      if (resolution.kind === "REJECTED")
        return { kind: "REJECTED", code: resolution.code, replay: false };
      offer = resolution.value;
    }

    let prepared: CheckoutPrepareResult;
    try {
      prepared = await options.repository.prepareCheckout({
        accountId: command.accountId,
        actorId: context.actorId,
        provider: providerKey,
        idempotencyKeyHash,
        requestFingerprintSha256: requestFingerprint,
        admittedAt: intent?.admittedAt ?? admittedAt!,
        offer,
        context,
      });
    } catch {
      return {
        kind: "RETRYABLE",
        code: "SERVICE_UNAVAILABLE",
        checkoutIntentId: intent?.id ?? "",
      };
    }
    if (prepared.kind === "REJECTED")
      return { kind: "REJECTED", code: prepared.code, replay: Boolean(intent) };
    if (prepared.kind === "EXISTING") {
      const resumed = await finishExisting(
        prepared.intent,
        observation.account,
        requestFingerprint,
        context,
      );
      if (resumed) return resumed;
    }
    const activeIntent = prepared.intent;
    let providerResult: ProviderCheckoutResult;
    try {
      providerResult = ProviderCheckoutResultSchema.parse(
        await options.provider.createCheckout({
          providerRequestId: activeIntent.id,
          amountMinor: activeIntent.amountMinor,
          currency: activeIntent.currency,
          billingIntervalUnit: activeIntent.billingIntervalUnit,
          billingIntervalCount: activeIntent.billingIntervalCount,
        }),
      );
    } catch {
      return {
        kind: "RETRYABLE",
        code: "PROVIDER_UNAVAILABLE",
        checkoutIntentId: activeIntent.id,
      };
    }
    if (providerResult.kind === "UNAVAILABLE")
      return {
        kind: "RETRYABLE",
        code: "PROVIDER_UNAVAILABLE",
        checkoutIntentId: activeIntent.id,
      };
    try {
      const finalized = await options.repository.finalizeCheckout({
        intentId: activeIntent.id,
        provider: providerKey,
        context,
        result: providerResult,
      });
      return finalizeToResult(
        finalized,
        prepared.kind === "EXISTING",
        activeIntent.id,
      );
    } catch {
      return {
        kind: "RETRYABLE",
        code: "SERVICE_UNAVAILABLE",
        checkoutIntentId: activeIntent.id,
      };
    }
  }

  return { createCheckout };
}

export const createCheckout = createCheckoutService;

export function validateProviderCheckoutResult(
  value: unknown,
): ProviderCheckoutResult {
  return ProviderCheckoutResultSchema.parse(value);
}
