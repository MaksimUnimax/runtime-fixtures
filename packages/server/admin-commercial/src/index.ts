import {
  BrowserFamilySchema,
  ContractVersionSchema,
  PublishCompatibilityPolicyRevisionCommandSchema,
  PublishExtensionReleaseCommandSchema,
  type CompatibilityPublicationPort,
  type BrowserFamily,
  type CompatibilityMutationContext,
  type CompatibilityPolicyRevision,
  type ExtensionRelease,
} from "@product/compatibility";
import type {
  InspectedPlan,
  InspectedPrice,
} from "@product/commercial-catalog";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AccountEntitlementOverride,
  AccountEntitlementOverrideCommandResult,
  AccountEntitlementOverrideMutationPort,
  CommercialEntitlementResolution,
} from "@product/entitlements";
import type {
  CommandResult,
  EntitlementDefinition,
  PlanEntitlementCommandRepository,
  PlanRevisionDraft,
  PlanSummary,
  PublishedPlanRevision,
} from "@product/plans";
import { EntitlementKeySchema } from "@product/plans";
import type {
  PriceCommandRepository,
  PriceCommandResult,
  PriceRevisionDraft,
  PriceSaleAssignment,
  PriceSummary,
  PublishedPriceRevision,
} from "@product/pricing";
import { z } from "zod";

const Uuid = z.uuid();
const Machine = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const Reason = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      v.trim().length > 0 &&
      [...v].every(
        (c) => (c.codePointAt(0) ?? 0) > 31 && c !== "<" && c !== ">",
      ),
  )
  .transform((v) => v.trim());
const Timestamp = z.coerce.date();
const Limit = z.coerce.number().int().min(1).max(100).default(50);
function compareSemver(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
const Cursor = Uuid.optional();
const DefinitionCursor = EntitlementKeySchema.optional();
const Value = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }).strict(),
  z
    .object({ kind: z.literal("INTEGER"), value: z.number().int().safe() })
    .strict(),
]);

export const AdminCommercialPlanQuerySchema = z
  .object({
    planId: Uuid.optional(),
    code: Machine.optional(),
    status: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.planId && v.code)
      c.addIssue({
        code: "custom",
        message: "planId and code are mutually exclusive",
      });
  });
export const AdminCommercialPriceQuerySchema = z
  .object({
    priceId: Uuid.optional(),
    planId: Uuid.optional(),
    code: Machine.optional(),
    marketKey: Machine.optional(),
    channelKey: Machine.optional(),
    status: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict();
export const AdminCommercialDefinitionQuerySchema = z
  .object({
    entitlementKey: Machine.optional(),
    deprecated: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    limit: Limit,
    cursor: DefinitionCursor,
  })
  .strict();
export const AdminCommercialOverrideQuerySchema = z
  .object({ entitlementKey: Machine.optional(), limit: Limit, cursor: Cursor })
  .strict();
export const AdminCompatibilityQuerySchema = z
  .object({
    policyKey: Machine.optional(),
    scope: z.union([z.literal("GLOBAL"), BrowserFamilySchema]).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .strict();
export const PlanCreateBodySchema = z
  .object({ code: Machine, reason: Reason })
  .strict();
export const PlanDraftBodySchema = z
  .object({
    displayName: z.string().min(1).max(256),
    description: z.string().max(4000),
    reason: Reason,
  })
  .strict();
export const PlanUpdateBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    displayName: z.string().min(1).max(256).optional(),
    description: z.string().max(4000).optional(),
    reason: Reason,
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.description !== undefined);
export const PlanEntitlementSetBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    value: Value,
    reason: Reason,
  })
  .strict();
export const PlanEntitlementRemoveBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: Reason,
  })
  .strict();
export const PlanPublishBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: Reason,
  })
  .strict();
export const PlanStatusBodySchema = z
  .object({
    expectedStatus: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
    targetStatus: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
    reason: Reason,
  })
  .strict();
export const PriceCreateBodySchema = z
  .object({
    planId: Uuid,
    code: Machine,
    marketKey: Machine,
    channelKey: Machine,
    reason: Reason,
  })
  .strict();
const PriceTerms = {
  amountMinor: z.number().int().safe().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billingIntervalUnit: z.enum(["DAY", "MONTH", "YEAR"]),
  billingIntervalCount: z.number().int().min(1).max(1200),
  effectiveFrom: Timestamp,
  effectiveTo: Timestamp.nullable(),
};
export const PriceDraftBodySchema = z
  .object({ planRevisionId: Uuid, ...PriceTerms, reason: Reason })
  .strict()
  .refine((v) => v.effectiveTo === null || v.effectiveTo > v.effectiveFrom);
export const PriceUpdateBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    planRevisionId: Uuid.optional(),
    amountMinor: PriceTerms.amountMinor.optional(),
    currency: PriceTerms.currency.optional(),
    billingIntervalUnit: PriceTerms.billingIntervalUnit.optional(),
    billingIntervalCount: PriceTerms.billingIntervalCount.optional(),
    effectiveFrom: Timestamp.optional(),
    effectiveTo: Timestamp.nullable().optional(),
    reason: Reason,
  })
  .strict()
  .refine((v) =>
    Object.keys(v).some(
      (k) => k !== "expectedContentFingerprint" && k !== "reason",
    ),
  );
export const PricePublishBodySchema = z
  .object({
    expectedContentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: Reason,
  })
  .strict();
export const PriceStatusBodySchema = PlanStatusBodySchema;
export const PriceAssignmentBodySchema = z
  .object({
    expectedLatestAssignmentRevision: z.number().int().nonnegative().nullable(),
    selectedPriceRevisionId: Uuid.nullable(),
    effectiveFrom: Timestamp,
    reason: Reason,
  })
  .strict();
export const DefinitionCreateBodySchema = z
  .object({
    entitlementKey: Machine,
    valueType: z.enum(["BOOLEAN", "INTEGER"]),
    securityClassification: z.enum(["CAPABILITY", "LIMIT"]),
    description: z.string().max(512),
    reason: Reason,
  })
  .strict()
  .refine(
    (v) =>
      (v.valueType === "BOOLEAN" &&
        v.securityClassification === "CAPABILITY") ||
      (v.valueType === "INTEGER" && v.securityClassification === "LIMIT"),
  );
export const DefinitionDescriptionBodySchema = z
  .object({
    expectedDescription: z.string().max(512),
    newDescription: z.string().max(512),
    reason: Reason,
  })
  .strict();
export const DefinitionDeprecateBodySchema = z
  .object({ reason: Reason })
  .strict();
export const OverrideSetBodySchema = z
  .object({
    expectedLatestRevision: z.number().int().positive().safe().nullable(),
    value: Value,
    effectiveFrom: Timestamp,
    expiresAt: Timestamp.nullable(),
    reason: Reason,
  })
  .strict()
  .refine((v) => v.expiresAt === null || v.expiresAt > v.effectiveFrom);
export const OverrideClearBodySchema = z
  .object({
    expectedLatestRevision: z.number().int().positive().safe().nullable(),
    effectiveFrom: Timestamp,
    expiresAt: Timestamp.nullable(),
    reason: Reason,
  })
  .strict()
  .refine((v) => v.expiresAt === null || v.expiresAt > v.effectiveFrom);
export const CompatibilityPublishBodySchema = z
  .object({
    contractVersion: ContractVersionSchema,
    browserFamily: BrowserFamilySchema.nullable(),
    minimumExtensionVersion: z.string().min(1).max(64).nullable(),
    recommendedExtensionVersion: z.string().min(1).max(64).nullable(),
    minimumBrowserVersion: z.string().min(1).max(64).nullable(),
    maintenanceMode: z.boolean(),
    maintenanceCode: Machine.nullable(),
    blockedVersions: z.array(z.string().min(1).max(64)),
    reason: Reason,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.maintenanceMode !== (v.maintenanceCode !== null))
      c.addIssue({ code: "custom", message: "maintenance code invariant" });
    if (
      v.minimumExtensionVersion &&
      v.recommendedExtensionVersion &&
      compareSemver(v.recommendedExtensionVersion, v.minimumExtensionVersion) <
        0
    )
      c.addIssue({
        code: "custom",
        message: "recommended version precedes minimum",
      });
    if (v.browserFamily === null && v.minimumBrowserVersion !== null)
      c.addIssue({
        code: "custom",
        message: "global policy cannot set browser minimum",
      });
    if (new Set(v.blockedVersions).size !== v.blockedVersions.length)
      c.addIssue({ code: "custom", message: "duplicate blocked version" });
  });

export const ExtensionReleasePublishBodySchema = z
  .object({
    version: PublishExtensionReleaseCommandSchema.shape.version,
    releaseChannel: PublishExtensionReleaseCommandSchema.shape.releaseChannel,
    artifactSha256:
      PublishExtensionReleaseCommandSchema.shape.artifactSha256.unwrap(),
    supportedContracts:
      PublishExtensionReleaseCommandSchema.shape.supportedContracts,
    supportedBrowsers:
      PublishExtensionReleaseCommandSchema.shape.supportedBrowsers,
    reason: Reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.supportedContracts).size !== value.supportedContracts.length
    )
      ctx.addIssue({ code: "custom", message: "duplicate contract" });
    if (
      new Set(value.supportedBrowsers).size !== value.supportedBrowsers.length
    )
      ctx.addIssue({ code: "custom", message: "duplicate browser" });
  });

export const ConfigReleasePublishBodySchema = z
  .object({
    contractVersion: ContractVersionSchema,
    expectedLatestConfigVersion: z.number().int().positive(),
    compatibilityPolicyRevisionIds: z.array(Uuid).min(1),
    reason: Reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.compatibilityPolicyRevisionIds).size !==
      value.compatibilityPolicyRevisionIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "duplicate compatibility source",
      });
  });

export type AdminCommercialPage<T> = { items: T[]; nextCursor?: string };
export type AdminCommercialReadRepository = {
  listPlans(
    input: z.infer<typeof AdminCommercialPlanQuerySchema>,
  ): Promise<AdminCommercialPage<PlanSummary> | { kind: "INVALID_CURSOR" }>;
  getPlan(id: string): Promise<InspectedPlan | null>;
  listPrices(
    input: z.infer<typeof AdminCommercialPriceQuerySchema>,
  ): Promise<AdminCommercialPage<PriceSummary> | { kind: "INVALID_CURSOR" }>;
  getPrice(id: string): Promise<InspectedPrice | null>;
  listDefinitions(
    input: z.infer<typeof AdminCommercialDefinitionQuerySchema>,
  ): Promise<
    AdminCommercialPage<EntitlementDefinition> | { kind: "INVALID_CURSOR" }
  >;
  listOverrides(
    input: { accountId: string } & z.infer<
      typeof AdminCommercialOverrideQuerySchema
    >,
  ): Promise<
    | AdminCommercialPage<AccountEntitlementOverride>
    | { kind: "ACCOUNT_NOT_FOUND" | "INVALID_CURSOR" }
  >;
  resolveEffective(input: {
    accountId: string;
    entitlementKey: string;
    at: Date;
  }): Promise<
    | CommercialEntitlementResolution
    | { kind: "ACCOUNT_NOT_FOUND" | "NO_PLAN_BINDING" | "NOT_FOUND" }
  >;
  listCompatibility(
    input: z.infer<typeof AdminCompatibilityQuerySchema>,
  ): Promise<
    AdminCommercialPage<CompatibilityAdminRevision> | { kind: "INVALID_CURSOR" }
  >;
};
export type CompatibilityAdminRevision = CompatibilityPolicyRevision & {
  blockedVersions: string[];
  linkedConfigVersions: number[];
};
export type AdminCommercialService = AdminCommercialReadRepository & {
  publishConfigRelease(input: {
    contractVersion: "control_plane_v1" | "control_plane_v2";
    expectedLatestConfigVersion: number;
    compatibilityPolicyRevisionIds: string[];
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<{
    configVersion: number;
    contractVersion: "control_plane_v1" | "control_plane_v2";
    snapshotVersion: "bootstrap_snapshot_v1" | "bootstrap_snapshot_v2";
    envelopeVersion: "bootstrap_envelope_v1" | "bootstrap_envelope_v2";
    contentHashSha256: string;
    sourceFingerprintSha256: string;
    signingKeyId: string;
    publishedAt: Date;
    createdAt: Date;
  }>;
  createPlan(input: {
    code: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanSummary>>;
  createPlanRevision(input: {
    planId: string;
    displayName: string;
    description: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanRevisionDraft>>;
  updatePlanRevision(input: {
    planRevisionId: string;
    expectedContentFingerprint: string;
    displayName?: string;
    description?: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanRevisionDraft>>;
  setPlanEntitlement(input: {
    planRevisionId: string;
    entitlementKey: string;
    expectedContentFingerprint: string;
    value: unknown;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanRevisionDraft>>;
  removePlanEntitlement(input: {
    planRevisionId: string;
    entitlementKey: string;
    expectedContentFingerprint: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanRevisionDraft>>;
  publishPlanRevision(input: {
    planRevisionId: string;
    expectedContentFingerprint: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PublishedPlanRevision>>;
  changePlanStatus(input: {
    planId: string;
    expectedStatus: string;
    targetStatus: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<PlanSummary>>;
  createPrice(input: {
    planId: string;
    code: string;
    marketKey: string;
    channelKey: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<PriceCommandResult<PriceSummary>>;
  createPriceRevision(input: {
    priceId: string;
    planRevisionId: string;
    amountMinor: number;
    currency: string;
    billingIntervalUnit: string;
    billingIntervalCount: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<PriceCommandResult<PriceRevisionDraft>>;
  updatePriceRevision(input: {
    priceRevisionId: string;
    expectedContentFingerprint: string;
    actorId: string;
    correlationId: string;
    reason: string;
    planRevisionId?: string;
    amountMinor?: number;
    currency?: string;
    billingIntervalUnit?: string;
    billingIntervalCount?: number;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
  }): Promise<PriceCommandResult<PriceRevisionDraft>>;
  publishPriceRevision(input: {
    priceRevisionId: string;
    expectedContentFingerprint: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<PriceCommandResult<PublishedPriceRevision>>;
  changePriceStatus(input: {
    priceId: string;
    expectedStatus: string;
    targetStatus: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<PriceCommandResult<PriceSummary>>;
  assignPrice(input: {
    priceId: string;
    expectedLatestAssignmentRevision: number | null;
    selectedPriceRevisionId: string | null;
    effectiveFrom: Date;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<PriceCommandResult<PriceSaleAssignment>>;
  createDefinition(input: {
    entitlementKey: string;
    valueType: string;
    securityClassification: string;
    description: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<EntitlementDefinition>>;
  updateDefinition(input: {
    entitlementKey: string;
    expectedDescription: string;
    newDescription: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<EntitlementDefinition>>;
  deprecateDefinition(input: {
    entitlementKey: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<CommandResult<EntitlementDefinition>>;
  setOverride(input: {
    accountId: string;
    entitlementKey: string;
    expectedLatestRevision: number | null;
    value: unknown;
    effectiveFrom: Date;
    expiresAt: Date | null;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<AccountEntitlementOverrideCommandResult>;
  clearOverride(input: {
    accountId: string;
    entitlementKey: string;
    expectedLatestRevision: number | null;
    effectiveFrom: Date;
    expiresAt: Date | null;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<AccountEntitlementOverrideCommandResult>;
  publishCompatibility(input: {
    policyKey: string;
    contractVersion: z.infer<typeof ContractVersionSchema>;
    actorId: string;
    correlationId: string;
    browserFamily: BrowserFamily | null;
    minimumExtensionVersion: string | null;
    recommendedExtensionVersion: string | null;
    minimumBrowserVersion: string | null;
    maintenanceMode: boolean;
    maintenanceCode: string | null;
    blockedVersions: string[];
    reason: string;
  }): Promise<CompatibilityPolicyRevision>;
  publishExtensionRelease(input: {
    version: string;
    releaseChannel: string;
    artifactSha256: string;
    supportedContracts: z.infer<typeof ContractVersionSchema>[];
    supportedBrowsers: BrowserFamily[];
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<ExtensionRelease>;
};

type MutationPorts = {
  plans: PlanEntitlementCommandRepository;
  prices: PriceCommandRepository;
  overrides: AccountEntitlementOverrideMutationPort;
  compatibility: {
    publishExtensionRelease: CompatibilityPublicationPort["publishExtensionRelease"];
    publishCompatibilityPolicyRevision: (
      c: z.input<typeof PublishCompatibilityPolicyRevisionCommandSchema>,
      x: CompatibilityMutationContext,
    ) => Promise<CompatibilityPolicyRevision>;
    publishAdminConfigRelease: (
      c: Omit<z.infer<typeof ConfigReleasePublishBodySchema>, "reason">,
      x: CompatibilityMutationContext,
    ) => Promise<{
      configVersion: number;
      contractVersion: "control_plane_v1" | "control_plane_v2";
      snapshotVersion: "bootstrap_snapshot_v1" | "bootstrap_snapshot_v2";
      envelopeVersion: "bootstrap_envelope_v1" | "bootstrap_envelope_v2";
      contentHashSha256: string;
      sourceFingerprintSha256: string;
      signingKeyId: string;
      publishedAt: Date;
      createdAt: Date;
    }>;
  };
};
export function createAdminCommercialService(
  reads: AdminCommercialReadRepository,
  ports: MutationPorts,
): AdminCommercialService {
  const context = (x: {
    actorId: string;
    correlationId: string;
    reason: string;
  }) => ({
    actorType: "ADMIN" as const,
    actorId: x.actorId,
    correlationId: x.correlationId,
    reason: x.reason,
  });
  return {
    ...reads,
    publishConfigRelease: (x) => {
      const { actorId, correlationId, reason, ...manifest } = x;
      return ports.compatibility.publishAdminConfigRelease(manifest, {
        actorType: "ADMIN",
        actorId,
        correlationId,
        reason,
      });
    },
    createPlan: (x) => ports.plans.createPlan({ code: x.code }, context(x)),
    createPlanRevision: (x) =>
      ports.plans.createDraftPlanRevision(
        {
          planId: x.planId,
          displayName: x.displayName,
          description: x.description,
        },
        context(x),
      ),
    updatePlanRevision: (x) =>
      ports.plans.updateDraftPlanRevision(
        {
          planRevisionId: x.planRevisionId,
          expectedContentFingerprint: x.expectedContentFingerprint,
          displayName: x.displayName,
          description: x.description,
        },
        context(x),
      ),
    setPlanEntitlement: (x) =>
      ports.plans.setDraftPlanEntitlement(
        {
          planRevisionId: x.planRevisionId,
          entitlementKey: x.entitlementKey,
          expectedContentFingerprint: x.expectedContentFingerprint,
          value: Value.parse(x.value),
        },
        context(x),
      ),
    removePlanEntitlement: (x) =>
      ports.plans.removeDraftPlanEntitlement(
        {
          planRevisionId: x.planRevisionId,
          entitlementKey: x.entitlementKey,
          expectedContentFingerprint: x.expectedContentFingerprint,
        },
        context(x),
      ),
    publishPlanRevision: (x) =>
      ports.plans.publishPlanRevision(
        {
          planRevisionId: x.planRevisionId,
          expectedContentFingerprint: x.expectedContentFingerprint,
        },
        context(x),
      ),
    changePlanStatus: (x) =>
      ports.plans.changePlanStatus(
        {
          planId: x.planId,
          expectedStatus: x.expectedStatus as any,
          targetStatus: x.targetStatus as any,
        },
        context(x),
      ),
    createPrice: (x) =>
      ports.prices.createPrice(
        {
          planId: x.planId,
          code: x.code,
          marketKey: x.marketKey,
          channelKey: x.channelKey,
        },
        context(x),
      ),
    createPriceRevision: (x) =>
      ports.prices.createDraftPriceRevision(
        {
          priceId: x.priceId,
          planRevisionId: x.planRevisionId,
          amountMinor: x.amountMinor,
          currency: x.currency,
          billingIntervalUnit: x.billingIntervalUnit as any,
          billingIntervalCount: x.billingIntervalCount,
          effectiveFrom: x.effectiveFrom,
          effectiveTo: x.effectiveTo,
        },
        context(x),
      ),
    updatePriceRevision: (x) =>
      ports.prices.updateDraftPriceRevision(
        {
          priceRevisionId: x.priceRevisionId,
          expectedContentFingerprint: x.expectedContentFingerprint,
          planRevisionId: x.planRevisionId,
          amountMinor: x.amountMinor,
          currency: x.currency,
          billingIntervalUnit: x.billingIntervalUnit as any,
          billingIntervalCount: x.billingIntervalCount,
          effectiveFrom: x.effectiveFrom,
          effectiveTo: x.effectiveTo,
        },
        context(x),
      ),
    publishPriceRevision: (x) =>
      ports.prices.publishPriceRevision(
        {
          priceRevisionId: x.priceRevisionId,
          expectedContentFingerprint: x.expectedContentFingerprint,
        },
        context(x),
      ),
    changePriceStatus: (x) =>
      ports.prices.changePriceStatus(
        {
          priceId: x.priceId,
          expectedStatus: x.expectedStatus as any,
          targetStatus: x.targetStatus as any,
        },
        context(x),
      ),
    assignPrice: (x) =>
      ports.prices.schedulePriceSaleAssignment(
        {
          priceId: x.priceId,
          expectedLatestAssignmentRevision: x.expectedLatestAssignmentRevision,
          selectedPriceRevisionId: x.selectedPriceRevisionId,
          effectiveFrom: x.effectiveFrom,
          reason: x.reason,
        },
        context(x),
      ),
    createDefinition: (x) =>
      ports.plans.createEntitlementDefinition(
        {
          entitlementKey: x.entitlementKey,
          valueType: x.valueType as any,
          securityClassification: x.securityClassification as any,
          description: x.description,
        },
        context(x),
      ),
    updateDefinition: (x) =>
      ports.plans.updateEntitlementDefinitionDescription(
        {
          entitlementKey: x.entitlementKey,
          expectedDescription: x.expectedDescription,
          newDescription: x.newDescription,
        },
        context(x),
      ),
    deprecateDefinition: (x) =>
      ports.plans.deprecateEntitlementDefinition(
        { entitlementKey: x.entitlementKey },
        context(x),
      ),
    setOverride: (x) =>
      ports.overrides.setAccountEntitlementOverride(
        {
          accountId: x.accountId,
          entitlementKey: x.entitlementKey,
          expectedLatestRevision: x.expectedLatestRevision,
          value: Value.parse(x.value),
          effectiveFrom: x.effectiveFrom,
          expiresAt: x.expiresAt,
        },
        context(x),
      ),
    clearOverride: (x) =>
      ports.overrides.clearAccountEntitlementOverride(
        {
          accountId: x.accountId,
          entitlementKey: x.entitlementKey,
          expectedLatestRevision: x.expectedLatestRevision,
          effectiveFrom: x.effectiveFrom,
          expiresAt: x.expiresAt,
        },
        context(x),
      ),
    publishCompatibility: (x) =>
      ports.compatibility.publishCompatibilityPolicyRevision(
        {
          policyKey: x.policyKey,
          contractVersion: x.contractVersion,
          browserFamily: x.browserFamily,
          minimumExtensionVersion: x.minimumExtensionVersion,
          recommendedExtensionVersion: x.recommendedExtensionVersion,
          minimumBrowserVersion: x.minimumBrowserVersion,
          maintenanceMode: x.maintenanceMode,
          maintenanceCode: x.maintenanceCode,
          blockedVersions: x.blockedVersions,
          publishedAt: new Date(),
        },
        context(x),
      ),
    publishExtensionRelease: (x) =>
      ports.compatibility.publishExtensionRelease(
        {
          version: x.version,
          releaseChannel: x.releaseChannel,
          artifactSha256: x.artifactSha256,
          releasedAt: new Date(),
          supportedContracts: x.supportedContracts,
          supportedBrowsers: x.supportedBrowsers,
        },
        context(x),
      ),
  };
}
