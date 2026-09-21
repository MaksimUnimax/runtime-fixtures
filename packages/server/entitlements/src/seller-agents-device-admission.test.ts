import { describe, expect, it } from "vitest";
import {
  SellerAgentsDeviceLimitSchema,
  decideSellerAgentsDeviceAdmission,
  sellerAgentsDeviceAdmissionAllowed,
} from "./seller-agents-device-admission.js";

describe("M1-B Seller Agents device admission foundation", () => {
  it("accepts the explicit unlimited future plan form", () => {
    expect(SellerAgentsDeviceLimitSchema.parse({ kind: "UNLIMITED" })).toEqual({
      kind: "UNLIMITED",
    });
  });

  it("accepts only positive safe finite limits", () => {
    expect(
      SellerAgentsDeviceLimitSchema.parse({ kind: "FINITE", value: 2 }),
    ).toEqual({ kind: "FINITE", value: 2 });
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        SellerAgentsDeviceLimitSchema.parse({ kind: "FINITE", value }),
      ).toThrow();
  });

  it("admits an already admitted device without counting another slot", () => {
    expect(
      decideSellerAgentsDeviceAdmission({
        limit: { kind: "FINITE", value: 1 },
        activeDeviceCount: 1,
        alreadyAdmitted: true,
      }),
    ).toEqual({ kind: "ADMIT", reason: "ALREADY_ADMITTED" });
  });

  it("admits a new device strictly below a finite limit", () => {
    expect(
      decideSellerAgentsDeviceAdmission({
        limit: { kind: "FINITE", value: 2 },
        activeDeviceCount: 1,
        alreadyAdmitted: false,
      }),
    ).toEqual({ kind: "ADMIT", reason: "WITHIN_LIMIT" });
  });

  it("denies the device at and above the finite limit", () => {
    for (const activeDeviceCount of [2, 3])
      expect(
        decideSellerAgentsDeviceAdmission({
          limit: { kind: "FINITE", value: 2 },
          activeDeviceCount,
          alreadyAdmitted: false,
        }),
      ).toEqual({ kind: "DENY", reason: "DEVICE_LIMIT_REACHED" });
  });

  it("admits new devices for the explicit unlimited plan", () => {
    expect(
      decideSellerAgentsDeviceAdmission({
        limit: { kind: "UNLIMITED" },
        activeDeviceCount: 1000,
        alreadyAdmitted: false,
      }),
    ).toEqual({ kind: "ADMIT", reason: "UNLIMITED_PLAN" });
  });

  it("rejects invalid server-side active counts", () => {
    for (const activeDeviceCount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        decideSellerAgentsDeviceAdmission({
          limit: { kind: "UNLIMITED" },
          activeDeviceCount,
          alreadyAdmitted: false,
        }),
      ).toThrow();
  });

  it("does not revoke existing devices when a future limit is lowered", () => {
    expect(
      decideSellerAgentsDeviceAdmission({
        limit: { kind: "FINITE", value: 1 },
        activeDeviceCount: 3,
        alreadyAdmitted: true,
      }),
    ).toEqual({ kind: "ADMIT", reason: "ALREADY_ADMITTED" });
    expect(
      sellerAgentsDeviceAdmissionAllowed({ kind: "FINITE", value: 1 }, 3),
    ).toBe(false);
  });

  it("keeps device admission independent of work dimensions", () => {
    const limit = { kind: "FINITE" as const, value: 2 };
    const admission = decideSellerAgentsDeviceAdmission({
      limit,
      activeDeviceCount: 1,
      alreadyAdmitted: false,
    });
    expect(admission).toEqual({ kind: "ADMIT", reason: "WITHIN_LIMIT" });
    // Dialogues, stores, marketplaces, commands and reports have no input to
    // this function and therefore cannot consume a device slot.
  });
});
