import { createHash } from "node:crypto";
import {
  BillingEventTypeSchema,
  BillingProviderCheckoutInputSchema,
  type BillingProviderPort,
  type BillingProviderCheckoutInput,
  type ProviderCheckoutResult,
  type BillingPaymentStatusPort,
  type BillingPaymentStatusResult,
  BillingPaymentStatusResultSchema,
  sha256,
  VerifiedBillingEventSchema,
  type BillingEventVerificationPort,
  type BillingEventVerificationResult,
  type VerifiedBillingEvent,
  CommercialEntitlementEventSchema,
  type CommercialEntitlementEvent,
  type CommercialEntitlementProviderAdapter,
} from "@product/billing";

export type BillingSimulatorScenario =
  | "SUCCESS"
  | "REJECTED"
  | "UNAVAILABLE"
  | "UNAVAILABLE_THEN_SUCCESS";

export type BillingSimulatorOptions = {
  scenario?: BillingSimulatorScenario;
  statusScenario?: "NORMAL" | "UNAVAILABLE";
};

export type SimulatorPaymentStatusSnapshot = Extract<
  BillingPaymentStatusResult,
  { kind: "FOUND" }
>;

export const SIMULATOR_EVENT_DOMAIN =
  "product-control-plane/billing-simulator/event/v1";
export const SIMULATOR_PROOF_DOMAIN =
  "product-control-plane/billing-simulator/proof/v1";

export type SimulatorBillingEventInput = Omit<
  VerifiedBillingEvent,
  "occurredAt" | "payloadSha256"
> & { occurredAt: Date | string };

export type SimulatorBillingEventEnvelope = {
  version: 1;
  domain: typeof SIMULATOR_EVENT_DOMAIN;
  event: Omit<VerifiedBillingEvent, "occurredAt"> & { occurredAt: string };
  proof: string;
};

function parseSimulatorEnvelope(
  raw: unknown,
): SimulatorBillingEventEnvelope | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1 ||
    value.domain !== SIMULATOR_EVENT_DOMAIN ||
    typeof value.proof !== "string" ||
    typeof value.event !== "object" ||
    value.event === null
  )
    return null;
  const event = value.event as Record<string, unknown>;
  const keys = [
    "provider",
    "eventIdentity",
    "eventType",
    "providerPaymentId",
    "amountMinor",
    "currency",
    "occurredAt",
    "payloadSha256",
  ];
  if (
    Object.keys(value).length !== 4 ||
    Object.keys(event).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(event, key)) ||
    typeof event.provider !== "string" ||
    typeof event.eventIdentity !== "string" ||
    typeof event.eventType !== "string" ||
    typeof event.providerPaymentId !== "string" ||
    typeof event.amountMinor !== "number" ||
    typeof event.currency !== "string" ||
    typeof event.occurredAt !== "string" ||
    typeof event.payloadSha256 !== "string"
  )
    return null;
  return {
    version: 1,
    domain: SIMULATOR_EVENT_DOMAIN,
    event: event as SimulatorBillingEventEnvelope["event"],
    proof: value.proof,
  };
}

function canonicalEventFields(event: VerifiedBillingEvent): string {
  return [
    "version=1",
    `domain=${SIMULATOR_EVENT_DOMAIN}`,
    `eventIdentity=${event.eventIdentity}`,
    `eventType=${event.eventType}`,
    `providerPaymentId=${event.providerPaymentId}`,
    `amountMinor=${event.amountMinor}`,
    `currency=${event.currency}`,
    `occurredAt=${event.occurredAt.toISOString()}`,
  ].join("\n");
}

export function simulatorEventPayloadSha256(
  event: VerifiedBillingEvent,
): string {
  return sha256(
    `${SIMULATOR_EVENT_DOMAIN}/payload\n${canonicalEventFields(event)}`,
  );
}

export function simulatorEventProof(event: VerifiedBillingEvent): string {
  return sha256(
    `${SIMULATOR_PROOF_DOMAIN}\n${canonicalEventFields(event)}\npayloadSha256=${event.payloadSha256}`,
  );
}

export function buildSimulatorBillingEventEnvelope(
  input: SimulatorBillingEventInput,
): SimulatorBillingEventEnvelope {
  const occurredAt = new Date(input.occurredAt);
  const base = {
    provider: input.provider,
    eventIdentity: input.eventIdentity,
    eventType: input.eventType,
    providerPaymentId: input.providerPaymentId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt,
    payloadSha256: "0".repeat(64),
  };
  const checked = VerifiedBillingEventSchema.parse({
    ...base,
    payloadSha256: simulatorEventPayloadSha256(base),
  });
  return {
    version: 1,
    domain: SIMULATOR_EVENT_DOMAIN,
    event: { ...checked, occurredAt: checked.occurredAt.toISOString() },
    proof: simulatorEventProof(checked),
  };
}

export const buildSimulatorEventEnvelope = buildSimulatorBillingEventEnvelope;

function id(prefix: string, requestId: string): string {
  const digest = createHash("sha256")
    .update(
      `product-control-plane/billing-simulator/v1/${prefix}\n${requestId}`,
    )
    .digest("hex");
  return `sim_${prefix}_${digest}`;
}

export class DeterministicBillingSimulator
  implements
    BillingProviderPort,
    BillingEventVerificationPort,
    BillingPaymentStatusPort
{
  readonly providerKey = "simulator";
  private readonly scenario: BillingSimulatorScenario;
  private readonly attempted = new Set<string>();
  private readonly statuses = new Map<string, SimulatorPaymentStatusSnapshot>();
  private readonly statusScenario: "NORMAL" | "UNAVAILABLE";

  constructor(options: BillingSimulatorOptions = {}) {
    this.scenario = options.scenario ?? "SUCCESS";
    this.statusScenario = options.statusScenario ?? "NORMAL";
  }

  setPaymentStatus(
    providerPaymentId: string,
    snapshot: SimulatorPaymentStatusSnapshot,
  ): void {
    const checked = BillingPaymentStatusResultSchema.parse(snapshot);
    if (checked.kind !== "FOUND")
      throw new Error("SIMULATOR_STATUS_MUST_BE_FOUND");
    this.statuses.set(providerPaymentId, {
      ...checked,
      statusAt: new Date(checked.statusAt.getTime()),
    });
  }

  configurePaymentStatus(
    providerPaymentId: string,
    snapshot: SimulatorPaymentStatusSnapshot,
  ): void {
    this.setPaymentStatus(providerPaymentId, snapshot);
  }

  clearPaymentStatus(providerPaymentId: string): void {
    this.statuses.delete(providerPaymentId);
  }

  async fetchPaymentStatus(input: {
    providerPaymentId: string;
  }): Promise<BillingPaymentStatusResult> {
    if (this.statusScenario === "UNAVAILABLE") return { kind: "UNAVAILABLE" };
    const snapshot = this.statuses.get(input.providerPaymentId);
    return snapshot
      ? { ...snapshot, statusAt: new Date(snapshot.statusAt.getTime()) }
      : { kind: "NOT_FOUND" };
  }

  async createCheckout(
    rawInput: BillingProviderCheckoutInput,
  ): Promise<ProviderCheckoutResult> {
    const input = BillingProviderCheckoutInputSchema.parse(rawInput);
    if (this.scenario === "UNAVAILABLE") return { kind: "UNAVAILABLE" };
    if (
      this.scenario === "UNAVAILABLE_THEN_SUCCESS" &&
      !this.attempted.has(input.providerRequestId)
    ) {
      this.attempted.add(input.providerRequestId);
      return { kind: "UNAVAILABLE" };
    }
    if (this.scenario === "REJECTED")
      return { kind: "REJECTED", code: "REJECTED" };
    return {
      kind: "CREATED",
      providerCheckoutId: id("checkout", input.providerRequestId),
      providerPaymentId: id("payment", input.providerRequestId),
      checkoutReference: id("ref", input.providerRequestId),
    };
  }

  verifyEvent(raw: unknown): BillingEventVerificationResult {
    const envelope = parseSimulatorEnvelope(raw);
    if (!envelope) return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    const parsedDate = new Date(envelope.event.occurredAt);
    if (Number.isNaN(parsedDate.getTime()))
      return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    const candidate = {
      ...envelope.event,
      eventType: BillingEventTypeSchema.safeParse(envelope.event.eventType)
        .success
        ? envelope.event.eventType
        : envelope.event.eventType,
      occurredAt: parsedDate,
    };
    const event = VerifiedBillingEventSchema.safeParse(candidate);
    if (!event.success) return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    if (
      simulatorEventPayloadSha256(event.data) !== event.data.payloadSha256 ||
      simulatorEventProof(event.data) !== envelope.proof
    )
      return { kind: "REJECTED", code: "INVALID_EVENT_PROOF" };
    if (event.data.provider !== this.providerKey)
      return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    return { kind: "VERIFIED", event: event.data };
  }

  buildEventEnvelope(input: Omit<SimulatorBillingEventInput, "provider">) {
    return buildSimulatorBillingEventEnvelope({
      ...input,
      provider: this.providerKey,
    });
  }
}

export const createBillingSimulator = (options: BillingSimulatorOptions = {}) =>
  new DeterministicBillingSimulator(options);

/** Deterministic normalized-event adapter for M1 policy tests; no provider calls. */
export class DeterministicCommercialEntitlementAdapter
  implements CommercialEntitlementProviderAdapter
{
  readonly providerKey = "simulator";

  async normalizeEvent(raw: unknown): Promise<
    | { kind: "OK"; event: CommercialEntitlementEvent }
    | {
        kind: "REJECTED";
        code: "MALFORMED_EVENT" | "PROVIDER_MISMATCH";
      }
  > {
    const parsed = CommercialEntitlementEventSchema.safeParse(raw);
    if (!parsed.success) return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    if (parsed.data.provider !== this.providerKey)
      return { kind: "REJECTED", code: "PROVIDER_MISMATCH" };
    return { kind: "OK", event: parsed.data };
  }
}
