export type NotificationDeliveryRequest = Readonly<{
  intentId: string;
  idempotencyKey: string;
  routeKey: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type NotificationDeliveryReceipt = Readonly<{
  providerAdapterKey: string;
  providerDeliveryId: string;
}>;

export type NotificationDeliveryPort = {
  deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryReceipt>;
};

export type NotificationDeliveryFailureCode =
  | "TRANSIENT_PROVIDER_FAILURE"
  | "RATE_LIMIT"
  | "CONFIGURATION_ERROR"
  | "PERMANENT_PROVIDER_REJECTION"
  | "DISABLED_ROUTE";

export class NotificationDeliveryError extends Error {
  public readonly code: NotificationDeliveryFailureCode;
  public readonly retryAfterMs: number | undefined;

  constructor(code: NotificationDeliveryFailureCode, retryAfterMs?: number) {
    super(code);
    this.name = "NotificationDeliveryError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Deterministic local provider used by tests; it never sends externally. */
export class DeterministicNotificationTestSink
  implements NotificationDeliveryPort
{
  readonly deliveries = new Map<string, NotificationDeliveryReceipt>();
  private sequence = 0;

  async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryReceipt> {
    const existing = this.deliveries.get(request.idempotencyKey);
    if (existing) return existing;
    const receipt = {
      providerAdapterKey: "deterministic-test-sink",
      providerDeliveryId: `test-delivery-${++this.sequence}`,
    } as const;
    this.deliveries.set(request.idempotencyKey, receipt);
    return receipt;
  }
}

/** Safe production default until an owner configures a real provider. */
export class DisabledNotificationSink implements NotificationDeliveryPort {
  async deliver(): Promise<NotificationDeliveryReceipt> {
    throw new NotificationDeliveryError("DISABLED_ROUTE");
  }
}
