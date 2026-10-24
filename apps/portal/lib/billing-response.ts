const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
) => {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key))
  );
};

export function isDeferredBillingMarker(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["purchaseStatus", "reason"]) &&
    value.purchaseStatus === "UNAVAILABLE" &&
    value.reason === "PAYMENT_GO_LIVE_DEFERRED"
  );
}
