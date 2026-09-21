import { describe, expect, it } from "vitest";
import {
  resolveSellerAgentsEffectiveAccess,
  sellerAgentsCommercialCapabilityPermissions,
  sellerAgentsCommercialModeFromEnvironment,
} from "./seller-agents-commercial-policy.js";

const at = new Date("2026-09-21T12:00:00.000Z");
const commercial = {
  accountId: "00000000-0000-4000-8000-000000000001",
  planCode: "synthetic-owner-approved-test-plan",
  lifecycle: "ACTIVE" as const,
  entitlementRevision: 7,
  effectiveFrom: new Date("2026-09-21T00:00:00.000Z"),
  effectiveUntil: null,
  source: "BILLING_PROVIDER" as const,
  externalReference: "ref-7",
  lastVerifiedProviderEventVersion: 7,
  permissions: {
    "source.ozon": true,
    "ai.chatgpt": true,
    "device.max_active": 2,
  },
};

describe("Seller Agents commercial access boundary", () => {
  it("M1-01 keeps free beta unchanged while commercial mode is disabled", () => {
    const result = resolveSellerAgentsEffectiveAccess({
      mode: "DISABLED",
      betaEligible: true,
      commercial,
      at,
    });
    expect(result.accessBasis).toBe("BETA");
    expect(result.commercialEntitlementRevision).toBeNull();
    expect(result.permissions["source.ozon"]).toBe(true);
    expect(result.permissions["source.wildberries"]).toBe(true);
  });

  it("M1-02 maps an active commercial entitlement", () => {
    const result = resolveSellerAgentsEffectiveAccess({
      mode: "ENABLED",
      betaEligible: false,
      commercial,
      at,
    });
    expect(result).toMatchObject({
      accessBasis: "COMMERCIAL",
      commercialEntitlementRevision: 7,
    });
    expect(result.permissions).toMatchObject({
      "source.ozon": true,
      "ai.chatgpt": true,
    });
  });

  it("M1-03 does not grant the second marketplace", () => {
    const result = sellerAgentsCommercialCapabilityPermissions(
      commercial.permissions,
    );
    expect(result["source.ozon"]).toBe(true);
    expect(result).not.toHaveProperty("source.wildberries");
  });

  it("M1-04 maps both marketplaces exactly when both are entitled", () => {
    const result = sellerAgentsCommercialCapabilityPermissions({
      "source.ozon": true,
      "source.wildberries": true,
      "ai.alice": true,
    });
    expect(result).toEqual({
      "source.ozon": true,
      "source.wildberries": true,
      "ai.alice": true,
    });
  });

  it("M1-05 ignores unknown and limit keys in capability projection", () => {
    const result = sellerAgentsCommercialCapabilityPermissions({
      "source.ozon": true,
      "device.max_active": 99,
      "provider.admin": true,
    });
    expect(result).toEqual({ "source.ozon": true });
  });

  it("M1-06 denies expired, ended and suspended commercial access", () => {
    for (const lifecycle of ["ENDED", "SUSPENDED"] as const) {
      expect(
        resolveSellerAgentsEffectiveAccess({
          mode: "ENABLED",
          betaEligible: false,
          commercial: { ...commercial, lifecycle },
          at,
        }).accessBasis,
      ).toBe("NONE");
    }
    expect(
      resolveSellerAgentsEffectiveAccess({
        mode: "ENABLED",
        betaEligible: false,
        commercial: {
          ...commercial,
          effectiveUntil: new Date("2026-09-21T11:59:59.000Z"),
        },
        at,
      }).accessBasis,
    ).toBe("NONE");
  });

  it("M1-14 never represents free beta as a paid entitlement", () => {
    const result = resolveSellerAgentsEffectiveAccess({
      mode: "DISABLED",
      betaEligible: true,
      commercial: null,
      at,
    });
    expect(result.accessBasis).toBe("BETA");
    expect(result.commercialEntitlementRevision).toBeNull();
  });

  it("uses disabled as the environment default", () => {
    expect(sellerAgentsCommercialModeFromEnvironment({})).toBe("DISABLED");
    expect(
      sellerAgentsCommercialModeFromEnvironment({
        SELLER_AGENTS_COMMERCIAL_MODE: "ENABLED",
      }),
    ).toBe("ENABLED");
  });
});
