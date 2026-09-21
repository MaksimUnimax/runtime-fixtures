import { z } from "zod";

/**
 * Provider-neutral commercial installation limit. The unlimited form is
 * explicit; a finite plan must carry a positive safe integer. FREE_BETA is
 * intentionally not represented by this type.
 */
export const SellerAgentsDeviceLimitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNLIMITED") }).strict(),
  z
    .object({
      kind: z.literal("FINITE"),
      value: z.number().int().positive().safe(),
    })
    .strict(),
]);
export type SellerAgentsDeviceLimit = z.infer<
  typeof SellerAgentsDeviceLimitSchema
>;

export const SellerAgentsDeviceAdmissionDecisionSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("ADMIT"),
        reason: z.enum(["ALREADY_ADMITTED", "WITHIN_LIMIT", "UNLIMITED_PLAN"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("DENY"),
        reason: z.literal("DEVICE_LIMIT_REACHED"),
      })
      .strict(),
  ],
);
export type SellerAgentsDeviceAdmissionDecision = z.infer<
  typeof SellerAgentsDeviceAdmissionDecisionSchema
>;

/**
 * Pure policy decision used at new device admission. Existing device
 * sessions are not re-counted, and no command, delivery, heartbeat or lease
 * can call this policy.
 */
export function decideSellerAgentsDeviceAdmission(input: {
  limit: SellerAgentsDeviceLimit;
  activeDeviceCount: number;
  alreadyAdmitted: boolean;
}): SellerAgentsDeviceAdmissionDecision {
  if (
    !Number.isSafeInteger(input.activeDeviceCount) ||
    input.activeDeviceCount < 0
  )
    throw new Error("active device count must be a non-negative safe integer");
  if (input.alreadyAdmitted)
    return { kind: "ADMIT", reason: "ALREADY_ADMITTED" };
  if (input.limit.kind === "UNLIMITED")
    return { kind: "ADMIT", reason: "UNLIMITED_PLAN" };
  return input.activeDeviceCount < input.limit.value
    ? { kind: "ADMIT", reason: "WITHIN_LIMIT" }
    : { kind: "DENY", reason: "DEVICE_LIMIT_REACHED" };
}

/**
 * A lower future limit does not revoke existing devices. It only prevents a
 * new admission while the active count is at or above that limit.
 */
export function sellerAgentsDeviceAdmissionAllowed(
  limit: SellerAgentsDeviceLimit,
  activeDeviceCount: number,
): boolean {
  return (
    decideSellerAgentsDeviceAdmission({
      limit,
      activeDeviceCount,
      alreadyAdmitted: false,
    }).kind === "ADMIT"
  );
}
