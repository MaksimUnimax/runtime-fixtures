import {
  EntitlementKeySchema,
  PlanMutationContextSchema,
  TypedEntitlementValueSchema,
  type EntitlementSecurityClassification,
  type EntitlementValueType,
  type PlanMutationContext,
  type TypedEntitlementValue,
} from "@product/plans";
import { z } from "zod";

export const DEVICE_MAX_ACTIVE_ENTITLEMENT_KEY = "device.max_active" as const;

const UuidSchema = z.uuid();
const EvaluationDateSchema = z
  .date()
  .refine((value) => !Number.isNaN(value.getTime()), "invalid date");
const ExpectedLatestRevisionSchema = z.union([
  z.null(),
  z.number().int().positive().safe(),
]);

export const SetAccountEntitlementOverrideCommandSchema = z
  .object({
    accountId: UuidSchema,
    entitlementKey: EntitlementKeySchema,
    expectedLatestRevision: ExpectedLatestRevisionSchema,
    value: TypedEntitlementValueSchema,
    effectiveFrom: EvaluationDateSchema,
    expiresAt: EvaluationDateSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAt === null || value.expiresAt > value.effectiveFrom,
    "expiresAt must be later than effectiveFrom",
  );
export type SetAccountEntitlementOverrideCommand = z.infer<
  typeof SetAccountEntitlementOverrideCommandSchema
>;

export const ClearAccountEntitlementOverrideCommandSchema = z
  .object({
    accountId: UuidSchema,
    entitlementKey: EntitlementKeySchema,
    expectedLatestRevision: ExpectedLatestRevisionSchema,
    effectiveFrom: EvaluationDateSchema,
    expiresAt: EvaluationDateSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAt === null || value.expiresAt > value.effectiveFrom,
    "expiresAt must be later than effectiveFrom",
  );
export type ClearAccountEntitlementOverrideCommand = z.infer<
  typeof ClearAccountEntitlementOverrideCommandSchema
>;

export const AccountEntitlementOverrideOperationSchema = z.enum([
  "SET",
  "CLEAR",
]);
export type AccountEntitlementOverrideOperation = z.infer<
  typeof AccountEntitlementOverrideOperationSchema
>;
export const AccountEntitlementOverrideStateSchema = z.enum([
  "ACTIVE_SET",
  "ACTIVE_CLEAR",
  "EXPIRED",
]);
export type AccountEntitlementOverrideState = z.infer<
  typeof AccountEntitlementOverrideStateSchema
>;

export const AccountEntitlementOverrideFailureCodeSchema = z.enum([
  "ACCOUNT_NOT_FOUND",
  "ENTITLEMENT_DEFINITION_NOT_FOUND",
  "ENTITLEMENT_DEPRECATED",
  "ENTITLEMENT_TYPE_MISMATCH",
  "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE",
  "PLAN_REVISION_NOT_FOUND",
  "PLAN_REVISION_NOT_PUBLISHED",
]);
export type AccountEntitlementOverrideFailureCode = z.infer<
  typeof AccountEntitlementOverrideFailureCodeSchema
>;

export const CommercialEntitlementSourceSchema = z.enum([
  "ACCOUNT_OVERRIDE",
  "PLAN_REVISION",
  "NONE",
]);
export type CommercialEntitlementSource = z.infer<
  typeof CommercialEntitlementSourceSchema
>;

export const CommercialEntitlementReasonSchema = z.enum([
  "ACCOUNT_OVERRIDE_SET",
  "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN",
  "ACCOUNT_OVERRIDE_EXPIRED_TO_PLAN",
  "PLAN_VALUE",
  "UNSET",
]);
export type CommercialEntitlementReason = z.infer<
  typeof CommercialEntitlementReasonSchema
>;

export type AccountEntitlementOverride = {
  id: string;
  accountId: string;
  entitlementKey: string;
  revision: number;
  operation: AccountEntitlementOverrideOperation;
  value: TypedEntitlementValue | null;
  effectiveFrom: Date;
  expiresAt: Date | null;
  reason: string;
  createdAt: Date;
};

export type AccountEntitlementOverrideCommandResult =
  | {
      kind: "OK";
      changed: boolean;
      value: AccountEntitlementOverride;
    }
  | { kind: "REJECTED"; code: AccountEntitlementOverrideFailureCode };

export type CommercialEntitlementDefinition = {
  valueType: EntitlementValueType;
  securityClassification: EntitlementSecurityClassification;
  deprecatedAt: Date | null;
};
export const CommercialEntitlementDefinitionSchema = z
  .object({
    valueType: z.enum(["BOOLEAN", "INTEGER"]),
    securityClassification: z.enum(["CAPABILITY", "LIMIT"]),
    deprecatedAt: z.date().nullable(),
  })
  .strict();

export type SelectedCommercialOverride = {
  overrideId: string;
  overrideRevision: number;
  operation: AccountEntitlementOverrideOperation;
  effectiveFrom: Date;
  expiresAt: Date | null;
  state: AccountEntitlementOverrideState;
};
export const SelectedCommercialOverrideSchema = z
  .object({
    overrideId: UuidSchema,
    overrideRevision: z.number().int().positive().safe(),
    operation: AccountEntitlementOverrideOperationSchema,
    effectiveFrom: EvaluationDateSchema,
    expiresAt: EvaluationDateSchema.nullable(),
    state: AccountEntitlementOverrideStateSchema,
  })
  .strict();

export type CommercialEntitlementResolution = {
  entitlementKey: string;
  definition: CommercialEntitlementDefinition;
  plan: {
    planId: string;
    planCode: string;
    planRevisionId: string;
    planRevisionNumber: number;
    baseValue: TypedEntitlementValue | null;
  };
  selectedOverride: SelectedCommercialOverride | null;
  effectiveValue: TypedEntitlementValue | null;
  source: CommercialEntitlementSource;
  reason: CommercialEntitlementReason;
};
export const CommercialEntitlementResolutionSchema = z
  .object({
    entitlementKey: EntitlementKeySchema,
    definition: CommercialEntitlementDefinitionSchema,
    plan: z
      .object({
        planId: UuidSchema,
        planCode: z.string().min(1),
        planRevisionId: UuidSchema,
        planRevisionNumber: z.number().int().positive().safe(),
        baseValue: TypedEntitlementValueSchema.nullable(),
      })
      .strict(),
    selectedOverride: SelectedCommercialOverrideSchema.nullable(),
    effectiveValue: TypedEntitlementValueSchema.nullable(),
    source: CommercialEntitlementSourceSchema,
    reason: CommercialEntitlementReasonSchema,
  })
  .strict();

export type CommercialEntitlementResolutionResult =
  | { kind: "OK"; value: CommercialEntitlementResolution }
  | { kind: "REJECTED"; code: AccountEntitlementOverrideFailureCode };

export type CommercialEntitlementsResolutionResult =
  | { kind: "OK"; value: CommercialEntitlementResolution[] }
  | { kind: "REJECTED"; code: AccountEntitlementOverrideFailureCode };

export const ResolveCommercialEntitlementInputSchema = z
  .object({
    accountId: UuidSchema,
    planRevisionId: UuidSchema,
    entitlementKey: EntitlementKeySchema,
    at: EvaluationDateSchema,
  })
  .strict();
export type ResolveCommercialEntitlementInput = z.infer<
  typeof ResolveCommercialEntitlementInputSchema
>;

export const ResolveCommercialEntitlementsInputSchema = z
  .object({
    accountId: UuidSchema,
    planRevisionId: UuidSchema,
    at: EvaluationDateSchema,
  })
  .strict();
export type ResolveCommercialEntitlementsInput = z.infer<
  typeof ResolveCommercialEntitlementsInputSchema
>;

export interface AccountEntitlementOverrideMutationPort {
  setAccountEntitlementOverride(
    command: SetAccountEntitlementOverrideCommand,
    context: PlanMutationContext,
  ): Promise<AccountEntitlementOverrideCommandResult>;
  clearAccountEntitlementOverride(
    command: ClearAccountEntitlementOverrideCommand,
    context: PlanMutationContext,
  ): Promise<AccountEntitlementOverrideCommandResult>;
}

export interface CommercialEntitlementResolver {
  resolveCommercialEntitlement(
    input: ResolveCommercialEntitlementInput,
  ): Promise<CommercialEntitlementResolutionResult>;
  resolveCommercialEntitlements(
    input: ResolveCommercialEntitlementsInput,
  ): Promise<CommercialEntitlementsResolutionResult>;
}

export interface AccountPlanRevisionBinding {
  planRevisionId: string;
  source: string;
}

export interface AccountPlanRevisionBindingPort {
  resolve(accountId: string): Promise<AccountPlanRevisionBinding | null>;
}

export const DeviceMaxActiveAdapterFailureCodeSchema = z.enum([
  "PLAN_BINDING_UNAVAILABLE",
  "DEVICE_MAX_ACTIVE_UNSET",
  "DEVICE_MAX_ACTIVE_TYPE_INVALID",
  "DEVICE_MAX_ACTIVE_VALUE_INVALID",
]);
export type DeviceMaxActiveAdapterFailureCode = z.infer<
  typeof DeviceMaxActiveAdapterFailureCodeSchema
>;

export class BoundCommercialDeviceLimitResolver {
  constructor(
    private readonly binding: AccountPlanRevisionBindingPort,
    private readonly resolver: CommercialEntitlementResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(
    accountId: string,
  ): Promise<{ maxActive: number; source: string }> {
    const bound = await this.binding.resolve(accountId);
    if (!bound)
      throw new DeviceMaxActiveAdapterError("PLAN_BINDING_UNAVAILABLE");
    const result = await this.resolver.resolveCommercialEntitlement({
      accountId,
      planRevisionId: bound.planRevisionId,
      entitlementKey: DEVICE_MAX_ACTIVE_ENTITLEMENT_KEY,
      at: this.now(),
    });
    if (result.kind === "REJECTED") {
      if (result.code === "ENTITLEMENT_DEFINITION_NOT_FOUND")
        throw new DeviceMaxActiveAdapterError("DEVICE_MAX_ACTIVE_UNSET");
      throw new DeviceMaxActiveAdapterError("DEVICE_MAX_ACTIVE_UNSET");
    }
    const value = result.value.effectiveValue;
    if (!value)
      throw new DeviceMaxActiveAdapterError("DEVICE_MAX_ACTIVE_UNSET");
    if (value.kind !== "INTEGER")
      throw new DeviceMaxActiveAdapterError("DEVICE_MAX_ACTIVE_TYPE_INVALID");
    if (!Number.isSafeInteger(value.value) || value.value < 0)
      throw new DeviceMaxActiveAdapterError("DEVICE_MAX_ACTIVE_VALUE_INVALID");
    return { maxActive: value.value, source: "COMMERCIAL_PLAN_REVISION" };
  }
}

export class DeviceMaxActiveAdapterError extends Error {
  constructor(public readonly code: DeviceMaxActiveAdapterFailureCode) {
    super(code);
    this.name = "DeviceMaxActiveAdapterError";
  }
}

export function validatePlanValue(
  valueType: EntitlementValueType,
  value: TypedEntitlementValue,
): boolean {
  return value.kind === valueType;
}

export function validatePlanMutationContext(
  context: unknown,
): PlanMutationContext {
  return PlanMutationContextSchema.parse(context);
}

export * from "./seller-agents-device-admission.js";
