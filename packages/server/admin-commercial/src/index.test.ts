import { describe, expect, it } from "vitest";
import {
  AdminCommercialDefinitionQuerySchema,
  AdminCommercialOverrideQuerySchema,
  AdminCommercialPlanQuerySchema,
  AdminCommercialPriceQuerySchema,
  AdminCompatibilityQuerySchema,
  CompatibilityPublishBodySchema,
  ExtensionReleasePublishBodySchema,
  createAdminCommercialService,
  DefinitionCreateBodySchema,
  DefinitionDescriptionBodySchema,
  DefinitionDeprecateBodySchema,
  OverrideClearBodySchema,
  OverrideSetBodySchema,
  PlanCreateBodySchema,
  PlanDraftBodySchema,
  PlanEntitlementRemoveBodySchema,
  PlanEntitlementSetBodySchema,
  PlanPublishBodySchema,
  PlanStatusBodySchema,
  PlanUpdateBodySchema,
  PriceAssignmentBodySchema,
  PriceCreateBodySchema,
  PriceDraftBodySchema,
  PricePublishBodySchema,
  PriceStatusBodySchema,
  PriceUpdateBodySchema,
} from "./index.js";

const id = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
const fingerprint = "a".repeat(64);
const reason = "operator test";
const from = "2026-09-08T00:00:00.000Z";
const to = "2026-09-09T00:00:00.000Z";
const planDraft = { displayName: "Starter", description: "A plan", reason };
const priceDraft = {
  planRevisionId: id,
  amountMinor: 100,
  currency: "RUB",
  billingIntervalUnit: "MONTH" as const,
  billingIntervalCount: 1,
  effectiveFrom: from,
  effectiveTo: null,
  reason,
};
const compatibility = {
  contractVersion: "control_plane_v1" as const,
  browserFamily: "chrome" as const,
  minimumExtensionVersion: "1.0.0",
  recommendedExtensionVersion: "1.1.0",
  minimumBrowserVersion: "120",
  maintenanceMode: false,
  maintenanceCode: null,
  blockedVersions: ["0.9.0"],
  reason,
};

const rejects = (work: () => unknown) => expect(work).toThrow();

describe("P6.4 admin-commercial validation contracts", () => {
  it("plan query supplies the documented default limit", () =>
    expect(AdminCommercialPlanQuerySchema.parse({})).toMatchObject({
      limit: 50,
    }));
  it("plan query accepts an exact plan id filter", () =>
    expect(AdminCommercialPlanQuerySchema.parse({ planId: id }).planId).toBe(
      id,
    ));
  it("plan query accepts a code filter", () =>
    expect(
      AdminCommercialPlanQuerySchema.parse({ code: "starter.v1" }).code,
    ).toBe("starter.v1"));
  it("plan query accepts every persisted status", () =>
    expect(
      ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"].map(
        (status) => AdminCommercialPlanQuerySchema.parse({ status }).status,
      ),
    ).toEqual(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]));
  it("plan query rejects mutually exclusive exact filters", () =>
    rejects(() =>
      AdminCommercialPlanQuerySchema.parse({ planId: id, code: "starter" }),
    ));
  it("plan query rejects an unknown field", () =>
    rejects(() => AdminCommercialPlanQuerySchema.parse({ unexpected: true })));
  it("plan query accepts a UUID cursor", () =>
    expect(AdminCommercialPlanQuerySchema.parse({ cursor: id }).cursor).toBe(
      id,
    ));
  it("plan query rejects a non-uuid cursor", () =>
    rejects(() => AdminCommercialPlanQuerySchema.parse({ cursor: "bad" })));
  it("plan query rejects a limit above the public maximum", () =>
    rejects(() => AdminCommercialPlanQuerySchema.parse({ limit: 101 })));
  it("plan query rejects a limit below the public minimum", () =>
    rejects(() => AdminCommercialPlanQuerySchema.parse({ limit: 0 })));
  it("price query retains all identity filters", () =>
    expect(
      AdminCommercialPriceQuerySchema.parse({
        priceId: id,
        planId: id2,
        code: "monthly",
        marketKey: "ru",
        channelKey: "web",
        status: "DRAFT",
        cursor: id2,
        limit: 7,
      }),
    ).toMatchObject({
      priceId: id,
      planId: id2,
      code: "monthly",
      marketKey: "ru",
      channelKey: "web",
      status: "DRAFT",
      cursor: id2,
      limit: 7,
    }));
  it("price query rejects an unknown field", () =>
    rejects(() => AdminCommercialPriceQuerySchema.parse({ plan: "starter" })));
  it("price query rejects a non-uuid cursor", () =>
    rejects(() => AdminCommercialPriceQuerySchema.parse({ cursor: "bad" })));
  it("price query rejects an invalid status", () =>
    rejects(() =>
      AdminCommercialPriceQuerySchema.parse({ status: "PUBLISHED" }),
    ));
  it("definition query transforms deprecated=false", () =>
    expect(
      AdminCommercialDefinitionQuerySchema.parse({ deprecated: "false" })
        .deprecated,
    ).toBe(false));
  it("definition query transforms deprecated=true", () =>
    expect(
      AdminCommercialDefinitionQuerySchema.parse({ deprecated: "true" })
        .deprecated,
    ).toBe(true));
  it("definition query accepts a machine key", () =>
    expect(
      AdminCommercialDefinitionQuerySchema.parse({
        entitlementKey: "device.max_active",
      }).entitlementKey,
    ).toBe("device.max_active"));
  it("definition query accepts an entitlement-key cursor", () =>
    expect(
      AdminCommercialDefinitionQuerySchema.parse({
        cursor: "device.max_active",
      }).cursor,
    ).toBe("device.max_active"));
  it("definition query rejects a key with spaces", () =>
    rejects(() =>
      AdminCommercialDefinitionQuerySchema.parse({ entitlementKey: "Bad Key" }),
    ));
  it("definition query rejects a malformed entitlement-key cursor", () =>
    rejects(() =>
      AdminCommercialDefinitionQuerySchema.parse({ cursor: "Bad Key" }),
    ));
  it("override query accepts account-scoped key and UUID cursor", () =>
    expect(
      AdminCommercialOverrideQuerySchema.parse({
        entitlementKey: "feature.export",
        cursor: id,
      }),
    ).toMatchObject({ entitlementKey: "feature.export", cursor: id }));
  it("override query rejects a non-uuid cursor", () =>
    rejects(() => AdminCommercialOverrideQuerySchema.parse({ cursor: "bad" })));
  it("compatibility query accepts global scope", () =>
    expect(AdminCompatibilityQuerySchema.parse({ scope: "GLOBAL" }).scope).toBe(
      "GLOBAL",
    ));
  it("compatibility query accepts supported browser scopes", () =>
    expect(
      ["chrome", "opera", "yandex_chromium", "firefox", "safari"].map(
        (scope) => AdminCompatibilityQuerySchema.parse({ scope }).scope,
      ),
    ).toEqual(["chrome", "opera", "yandex_chromium", "firefox", "safari"]));
  it("compatibility query rejects an unknown scope", () =>
    rejects(() => AdminCompatibilityQuerySchema.parse({ scope: "edge" })));
  it("compatibility query accepts a UUID cursor", () =>
    expect(AdminCompatibilityQuerySchema.parse({ cursor: id }).cursor).toBe(
      id,
    ));
  it("compatibility query rejects a non-uuid cursor", () =>
    rejects(() => AdminCompatibilityQuerySchema.parse({ cursor: "bad" })));

  it("plan create preserves the code and reason", () =>
    expect(PlanCreateBodySchema.parse({ code: "starter.v1", reason })).toEqual({
      code: "starter.v1",
      reason,
    }));
  it("plan create rejects missing reason", () =>
    rejects(() => PlanCreateBodySchema.parse({ code: "starter" })));
  it("plan create rejects an uppercase code", () =>
    rejects(() => PlanCreateBodySchema.parse({ code: "Starter", reason })));
  it("plan create rejects an extra field", () =>
    rejects(() =>
      PlanCreateBodySchema.parse({ code: "starter", reason, extra: true }),
    ));
  it("plan draft preserves required metadata", () =>
    expect(PlanDraftBodySchema.parse(planDraft)).toEqual(planDraft));
  it("plan draft rejects an empty display name", () =>
    rejects(() =>
      PlanDraftBodySchema.parse({ ...planDraft, displayName: "" }),
    ));
  it("plan draft rejects an overlong description", () =>
    rejects(() =>
      PlanDraftBodySchema.parse({
        ...planDraft,
        description: "x".repeat(4001),
      }),
    ));
  it("plan update accepts a display-name change", () =>
    expect(
      PlanUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        displayName: "New",
        reason,
      }).displayName,
    ).toBe("New"));
  it("plan update accepts a description change", () =>
    expect(
      PlanUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        description: "New",
        reason,
      }).description,
    ).toBe("New"));
  it("plan update rejects a no-op field set", () =>
    rejects(() =>
      PlanUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        reason,
      }),
    ));
  it("plan update rejects an uppercase fingerprint", () =>
    rejects(() =>
      PlanUpdateBodySchema.parse({
        expectedContentFingerprint: "A".repeat(64),
        description: "x",
        reason,
      }),
    ));
  it("plan entitlement accepts a boolean value", () =>
    expect(
      PlanEntitlementSetBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        value: { kind: "BOOLEAN", value: true },
        reason,
      }).value,
    ).toEqual({ kind: "BOOLEAN", value: true }));
  it("plan entitlement accepts a safe integer value", () =>
    expect(
      PlanEntitlementSetBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        value: { kind: "INTEGER", value: 3 },
        reason,
      }).value,
    ).toEqual({ kind: "INTEGER", value: 3 }));
  it("plan entitlement rejects a mixed discriminated value", () =>
    rejects(() =>
      PlanEntitlementSetBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        value: { kind: "BOOLEAN", value: 1 },
        reason,
      }),
    ));
  it("plan entitlement remove requires a fingerprint", () =>
    expect(
      PlanEntitlementRemoveBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        reason,
      }).reason,
    ).toBe(reason));
  it("plan publish requires a fingerprint", () =>
    expect(
      PlanPublishBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        reason,
      }).expectedContentFingerprint,
    ).toBe(fingerprint));
  it("plan status accepts a valid transition pair", () =>
    expect(
      PlanStatusBodySchema.parse({
        expectedStatus: "DRAFT",
        targetStatus: "ACTIVE",
        reason,
      }).targetStatus,
    ).toBe("ACTIVE"));
  it("plan status rejects an unknown state", () =>
    rejects(() =>
      PlanStatusBodySchema.parse({
        expectedStatus: "PUBLISHED",
        targetStatus: "ACTIVE",
        reason,
      }),
    ));

  it("price create preserves exact commercial identity", () =>
    expect(
      PriceCreateBodySchema.parse({
        planId: id,
        code: "monthly",
        marketKey: "ru",
        channelKey: "web",
        reason,
      }),
    ).toMatchObject({
      planId: id,
      code: "monthly",
      marketKey: "ru",
      channelKey: "web",
    }));
  it("price create rejects a non-uuid plan", () =>
    rejects(() =>
      PriceCreateBodySchema.parse({
        planId: "bad",
        code: "monthly",
        marketKey: "ru",
        channelKey: "web",
        reason,
      }),
    ));
  it("price draft coerces ISO timestamps to Date values", () =>
    expect(PriceDraftBodySchema.parse(priceDraft).effectiveFrom).toBeInstanceOf(
      Date,
    ));
  it("price draft accepts a bounded amount", () =>
    expect(PriceDraftBodySchema.parse(priceDraft).amountMinor).toBe(100));
  it("price draft accepts each billing unit", () =>
    expect(
      ["DAY", "MONTH", "YEAR"].map(
        (billingIntervalUnit) =>
          PriceDraftBodySchema.parse({ ...priceDraft, billingIntervalUnit })
            .billingIntervalUnit,
      ),
    ).toEqual(["DAY", "MONTH", "YEAR"]));
  it("price draft rejects a negative amount", () =>
    rejects(() =>
      PriceDraftBodySchema.parse({ ...priceDraft, amountMinor: -1 }),
    ));
  it("price draft rejects a reversed effective window", () =>
    rejects(() =>
      PriceDraftBodySchema.parse({ ...priceDraft, effectiveTo: from }),
    ));
  it("price draft rejects an invalid timestamp", () =>
    rejects(() =>
      PriceDraftBodySchema.parse({
        ...priceDraft,
        effectiveFrom: "not-a-date",
      }),
    ));
  it("price draft rejects a lowercase currency", () =>
    rejects(() =>
      PriceDraftBodySchema.parse({ ...priceDraft, currency: "rub" }),
    ));
  it("price draft rejects an excessive interval count", () =>
    rejects(() =>
      PriceDraftBodySchema.parse({ ...priceDraft, billingIntervalCount: 1201 }),
    ));
  it("price update accepts a changed amount", () =>
    expect(
      PriceUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        amountMinor: 200,
        reason,
      }).amountMinor,
    ).toBe(200));
  it("price update accepts a changed plan revision", () =>
    expect(
      PriceUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        planRevisionId: id2,
        reason,
      }).planRevisionId,
    ).toBe(id2));
  it("price update rejects an empty update", () =>
    rejects(() =>
      PriceUpdateBodySchema.parse({
        expectedContentFingerprint: fingerprint,
        reason,
      }),
    ));
  it("price publish rejects a malformed fingerprint", () =>
    rejects(() =>
      PricePublishBodySchema.parse({
        expectedContentFingerprint: "bad",
        reason,
      }),
    ));
  it("price status accepts HIDDEN", () =>
    expect(
      PriceStatusBodySchema.parse({
        expectedStatus: "ACTIVE",
        targetStatus: "HIDDEN",
        reason,
      }).targetStatus,
    ).toBe("HIDDEN"));
  it("assignment accepts a selected revision", () =>
    expect(
      PriceAssignmentBodySchema.parse({
        expectedLatestAssignmentRevision: 1,
        selectedPriceRevisionId: id,
        effectiveFrom: from,
        reason,
      }).selectedPriceRevisionId,
    ).toBe(id));
  it("assignment accepts a null selection to close a sale", () =>
    expect(
      PriceAssignmentBodySchema.parse({
        expectedLatestAssignmentRevision: 1,
        selectedPriceRevisionId: null,
        effectiveFrom: from,
        reason,
      }).selectedPriceRevisionId,
    ).toBeNull());
  it("assignment accepts a first-write null expected revision", () =>
    expect(
      PriceAssignmentBodySchema.parse({
        expectedLatestAssignmentRevision: null,
        selectedPriceRevisionId: id,
        effectiveFrom: from,
        reason,
      }).expectedLatestAssignmentRevision,
    ).toBeNull());
  it("assignment rejects a negative expected revision", () =>
    rejects(() =>
      PriceAssignmentBodySchema.parse({
        expectedLatestAssignmentRevision: -1,
        selectedPriceRevisionId: id,
        effectiveFrom: from,
        reason,
      }),
    ));

  it("definition create accepts a BOOLEAN capability", () =>
    expect(
      DefinitionCreateBodySchema.parse({
        entitlementKey: "feature.export",
        valueType: "BOOLEAN",
        securityClassification: "CAPABILITY",
        description: "Export",
        reason,
      }).valueType,
    ).toBe("BOOLEAN"));
  it("definition create accepts an INTEGER limit", () =>
    expect(
      DefinitionCreateBodySchema.parse({
        entitlementKey: "device.max_active",
        valueType: "INTEGER",
        securityClassification: "LIMIT",
        description: "Devices",
        reason,
      }).securityClassification,
    ).toBe("LIMIT"));
  it("definition create rejects mismatched type classification", () =>
    rejects(() =>
      DefinitionCreateBodySchema.parse({
        entitlementKey: "device.max_active",
        valueType: "BOOLEAN",
        securityClassification: "LIMIT",
        description: "Bad",
        reason,
      }),
    ));
  it("definition create rejects a malformed key", () =>
    rejects(() =>
      DefinitionCreateBodySchema.parse({
        entitlementKey: "Bad Key",
        valueType: "BOOLEAN",
        securityClassification: "CAPABILITY",
        description: "Bad",
        reason,
      }),
    ));
  it("definition create rejects an overlong description", () =>
    rejects(() =>
      DefinitionCreateBodySchema.parse({
        entitlementKey: "feature.export",
        valueType: "BOOLEAN",
        securityClassification: "CAPABILITY",
        description: "x".repeat(513),
        reason,
      }),
    ));
  it("definition description update preserves both descriptions", () =>
    expect(
      DefinitionDescriptionBodySchema.parse({
        expectedDescription: "old",
        newDescription: "new",
        reason,
      }),
    ).toMatchObject({ expectedDescription: "old", newDescription: "new" }));
  it("definition description rejects an overlong expected value", () =>
    rejects(() =>
      DefinitionDescriptionBodySchema.parse({
        expectedDescription: "x".repeat(513),
        newDescription: "new",
        reason,
      }),
    ));
  it("definition deprecate accepts only its reason", () =>
    expect(DefinitionDeprecateBodySchema.parse({ reason })).toEqual({
      reason,
    }));
  it("definition deprecate rejects extra fields", () =>
    rejects(() =>
      DefinitionDeprecateBodySchema.parse({ reason, deprecated: true }),
    ));

  it("override set accepts a BOOLEAN value", () =>
    expect(
      OverrideSetBodySchema.parse({
        expectedLatestRevision: null,
        value: { kind: "BOOLEAN", value: false },
        effectiveFrom: from,
        expiresAt: null,
        reason,
      }).value,
    ).toEqual({ kind: "BOOLEAN", value: false }));
  it("override set accepts an INTEGER value", () =>
    expect(
      OverrideSetBodySchema.parse({
        expectedLatestRevision: 1,
        value: { kind: "INTEGER", value: 4 },
        effectiveFrom: from,
        expiresAt: to,
        reason,
      }).expiresAt,
    ).toBeInstanceOf(Date));
  it("override clear accepts a nullable expected revision", () =>
    expect(
      OverrideClearBodySchema.parse({
        expectedLatestRevision: null,
        effectiveFrom: from,
        expiresAt: null,
        reason,
      }).expectedLatestRevision,
    ).toBeNull());
  it("override set rejects an expired window", () =>
    rejects(() =>
      OverrideSetBodySchema.parse({
        expectedLatestRevision: null,
        value: { kind: "BOOLEAN", value: true },
        effectiveFrom: to,
        expiresAt: from,
        reason,
      }),
    ));
  it("override set rejects an unsafe integer", () =>
    rejects(() =>
      OverrideSetBodySchema.parse({
        expectedLatestRevision: null,
        value: { kind: "INTEGER", value: Number.MAX_SAFE_INTEGER + 1 },
        effectiveFrom: from,
        expiresAt: null,
        reason,
      }),
    ));
  it("override clear rejects a zero revision", () =>
    rejects(() =>
      OverrideClearBodySchema.parse({
        expectedLatestRevision: 0,
        effectiveFrom: from,
        expiresAt: null,
        reason,
      }),
    ));

  it("compatibility accepts a global policy", () =>
    expect(
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        browserFamily: null,
        minimumBrowserVersion: null,
      }).browserFamily,
    ).toBeNull());
  it("compatibility preserves blocked-version values", () =>
    expect(
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        blockedVersions: ["0.8.0", "0.9.0"],
      }).blockedVersions,
    ).toEqual(["0.8.0", "0.9.0"]));
  it("compatibility requires maintenance code when enabled", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        maintenanceMode: true,
        maintenanceCode: null,
      }),
    ));
  it("compatibility rejects maintenance code when disabled", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        maintenanceMode: false,
        maintenanceCode: "planned",
      }),
    ));
  it("compatibility rejects a recommended version below minimum", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        recommendedExtensionVersion: "0.9.0",
      }),
    ));
  it("compatibility rejects a browser minimum on global scope", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        browserFamily: null,
      }),
    ));
  it("compatibility rejects duplicate blocked versions", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        blockedVersions: ["0.9.0", "0.9.0"],
      }),
    ));
  it("compatibility rejects a signing-key field", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        signingKeyId: id,
      }),
    ));
  it("compatibility rejects an unknown rollout field", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({ ...compatibility, rollout: true }),
    ));
  it("compatibility rejects an invalid browser version type", () =>
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        minimumBrowserVersion: 120,
      }),
    ));
  it("compatibility requires an explicit known contract version", () => {
    rejects(() => {
      const missing: Record<string, unknown> = { ...compatibility };
      delete missing.contractVersion;
      CompatibilityPublishBodySchema.parse(missing);
    });
    rejects(() =>
      CompatibilityPublishBodySchema.parse({
        ...compatibility,
        contractVersion: "control_plane_v3",
      }),
    );
  });
  it("extension release requires store-safe exact artifact bytes", () => {
    const body = {
      version: "0.2.4",
      releaseChannel: "stable",
      artifactSha256: "a".repeat(64),
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["opera"],
      reason,
    };
    expect(ExtensionReleasePublishBodySchema.parse(body)).toEqual(body);
    rejects(() =>
      ExtensionReleasePublishBodySchema.parse({
        ...body,
        artifactSha256: undefined,
      }),
    );
    rejects(() =>
      ExtensionReleasePublishBodySchema.parse({
        ...body,
        supportedContracts: ["control_plane_v3"],
      }),
    );
    rejects(() =>
      ExtensionReleasePublishBodySchema.parse({
        ...body,
        supportedBrowsers: ["unknown"],
      }),
    );
    rejects(() =>
      ExtensionReleasePublishBodySchema.parse({ ...body, releaseId: id }),
    );
  });
  it("admin service passes compatibility version and ADMIN release context", async () => {
    const compatibilityCalls: unknown[] = [];
    const releaseCalls: unknown[] = [];
    const configCalls: unknown[] = [];
    const service = createAdminCommercialService({} as never, {
      plans: {} as never,
      prices: {} as never,
      overrides: {} as never,
      compatibility: {
        publishCompatibilityPolicyRevision: async (command, context) => {
          compatibilityCalls.push({ command, context });
          return {} as never;
        },
        publishExtensionRelease: async (command, context) => {
          releaseCalls.push({ command, context });
          return {} as never;
        },
        publishAdminConfigRelease: async (command, context) => {
          configCalls.push({ command, context });
          return {
            configVersion: 9,
            contractVersion: command.contractVersion,
            snapshotVersion:
              command.contractVersion === "control_plane_v2"
                ? "bootstrap_snapshot_v2"
                : "bootstrap_snapshot_v1",
            envelopeVersion:
              command.contractVersion === "control_plane_v2"
                ? "bootstrap_envelope_v2"
                : "bootstrap_envelope_v1",
            contentHashSha256: "c".repeat(64),
            sourceFingerprintSha256: "d".repeat(64),
            signingKeyId: "test-ed25519",
            publishedAt: new Date(),
            createdAt: new Date(),
          };
        },
      },
    });
    for (const contractVersion of [
      "control_plane_v1",
      "control_plane_v2",
    ] as const)
      await service.publishCompatibility({
        policyKey: "store1.opera.v2",
        contractVersion,
        actorId: id,
        correlationId: "request",
        browserFamily: "opera",
        minimumExtensionVersion: "0.2.4",
        recommendedExtensionVersion: "0.2.4",
        minimumBrowserVersion: "136",
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        reason,
      });
    for (const [index, contractVersion] of [
      "control_plane_v1",
      "control_plane_v2",
    ].entries()) {
      const call = compatibilityCalls[index] as {
        command: { contractVersion: string };
      };
      expect(call.command.contractVersion).toBe(contractVersion);
    }
    const before = Date.now();
    await service.publishExtensionRelease({
      version: "0.2.4",
      releaseChannel: "stable",
      artifactSha256: "b".repeat(64),
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["opera"],
      actorId: id,
      correlationId: "release-request",
      reason,
    });
    const releaseCall = releaseCalls[0] as {
      context: {
        actorType: string;
        actorId: string;
        correlationId: string;
        reason: string;
      };
      command: {
        artifactSha256: string;
        supportedContracts: string[];
        supportedBrowsers: string[];
        releasedAt: Date;
      };
    };
    expect(releaseCall.context).toMatchObject({
      actorType: "ADMIN",
      actorId: id,
      correlationId: "release-request",
      reason,
    });
    expect(releaseCall.command).toMatchObject({
      artifactSha256: "b".repeat(64),
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["opera"],
    });
    expect(releaseCall.command.releasedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(releaseCall.command.releasedAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    await service.publishConfigRelease({
      contractVersion: "control_plane_v2",
      expectedLatestConfigVersion: 7,
      compatibilityPolicyRevisionIds: [id2],
      actorId: id,
      correlationId: "config-request",
      reason,
    });
    expect(configCalls).toHaveLength(1);
    expect(configCalls[0]).toEqual({
      command: {
        contractVersion: "control_plane_v2",
        expectedLatestConfigVersion: 7,
        compatibilityPolicyRevisionIds: [id2],
      },
      context: {
        actorType: "ADMIN",
        actorId: id,
        correlationId: "config-request",
        reason,
      },
    });
  });
});
