import {
  AdapterKeySchema,
  SurfaceKeySchema,
  VariantKeySchema,
} from "@product/adapter-registry";
import {
  BrowserFamilies,
  SemVerV1Schema,
  StableMachineIdentifierV1Schema,
  type BrowserFamily,
} from "@product/shared";
import { z } from "zod";

export const HealthStateSchema = z.enum([
  "HEALTHY",
  "DRIFT",
  "DEGRADED",
  "BROKEN",
  "UNKNOWN",
  "MAINTENANCE",
]);
export type HealthState = z.infer<typeof HealthStateSchema>;

export const HealthClassificationBasisSchema = z.enum([
  "HEALTHY_PRIMARY",
  "HEALTHY_ALLOWED_OPTIONAL_ABSENCE",
  "DRIFT_APPROVED_FALLBACK",
  "DEGRADED_NON_CORE_FAILURE",
  "DEGRADED_MATERIAL_FALLBACK",
  "BROKEN_REQUIRED_CORE_FAILURE",
  "UNKNOWN_PRE_IDENTITY_ENVIRONMENT",
  "UNKNOWN_AUTH_OR_SECURITY_BLOCKER",
  "MAINTENANCE_OPERATOR",
  "INCOHERENT_ENVIRONMENT_OBSERVATION",
]);
export type HealthClassificationBasis = z.infer<
  typeof HealthClassificationBasisSchema
>;

export const HealthLevelSchema = z.enum(["H0", "H1", "H2", "H3", "H4", "H5"]);
export type HealthLevel = z.infer<typeof HealthLevelSchema>;

export const HealthBrowserFamilySchema = z.enum(BrowserFamilies);
export type HealthBrowserFamily = BrowserFamily;

const ChromiumVersionV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/);

export const HealthScopeSchema = z
  .object({
    adapterFamilyId: z.uuid(),
    adapterFamilyKey: AdapterKeySchema,
    surfaceId: z.uuid(),
    surfaceKey: SurfaceKeySchema,
    variant: z
      .object({ id: z.uuid(), machineKey: VariantKeySchema })
      .strict()
      .nullable(),
    browserFamily: HealthBrowserFamilySchema,
    browserVersion: ChromiumVersionV1Schema,
    extensionVersion: SemVerV1Schema,
    adapterEngineVersion: SemVerV1Schema,
    profile: z
      .object({ id: z.uuid(), revision: z.number().int().positive() })
      .strict(),
    healthSuite: z
      .object({
        machineKey: StableMachineIdentifierV1Schema,
        revision: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type HealthScope = z.infer<typeof HealthScopeSchema>;

export const BaselineContourKeySchema = z.enum([
  "C01_PAGE_IDENTITY",
  "C02_CONVERSATION_ROOT",
  "C03_COMPOSER_ROOT",
  "C04_COMPOSER_INPUT",
  "C05_SEND_CONTROL",
  "C06_BUSY_STOP_STATE",
  "C07_ASSISTANT_MESSAGE",
  "C08_MESSAGE_COMPLETION",
  "C09_COMMAND_CODE_BLOCK_SURFACE",
  "C10_NATIVE_COPY_CONTROL",
  "C11_CONVERSATION_IDENTITY",
  "C12_DELIVERY_INSERTION_PATH",
  "C13_BLOCKING_STATE",
]);
export type BaselineContourKey = z.infer<typeof BaselineContourKeySchema>;

export const ContourFailureSeveritySchema = z.enum([
  "CORE",
  "IMPORTANT_NON_CORE",
]);
export type ContourFailureSeverity = z.infer<
  typeof ContourFailureSeveritySchema
>;

const PackagedStrategyIds = [
  "PAGE_HOST_MARKER",
  "SURFACE_MARKER",
  "CONVERSATION_ANCHOR",
  "ACTIVE_CONVERSATION_REGION",
  "COMPOSER_CONTAINER",
  "ACTIVE_COMPOSER_REGION",
  "EDITABLE_INPUT",
  "ACCESSIBILITY_TEXTBOX",
  "SEMANTIC_SEND_CONTROL",
  "COMPOSER_ACTION_CONTROL",
  "BUSY_INDICATOR",
  "RESPONSE_STATE_MARKER",
  "ASSISTANT_MESSAGE_REGION",
  "MESSAGE_ASSOCIATION_MARKER",
  "COMPLETION_MARKER",
  "RESPONSE_IDLE_STATE",
  "COMMAND_SURFACE",
  "CODE_BLOCK_DISCOVERY",
  "NATIVE_COPY_CONTROL",
  "COPY_ANCHOR_ASSOCIATION",
  "CONVERSATION_IDENTIFIER",
  "CONVERSATION_URL_IDENTITY",
  "DELIVERY_TARGET",
  "BLOCKING_MARKER",
  "SESSION_PRECONDITION",
] as const;
export const PackagedStrategyIdSchema = z.enum(PackagedStrategyIds);
export type PackagedStrategyId = z.infer<typeof PackagedStrategyIdSchema>;

const StructuralAssertionIds = [
  "PAGE_PRESENT",
  "SURFACE_MATCH",
  "VISIBLE",
  "UNIQUE_ACTIVE_TARGET",
  "EDITABLE",
  "ACTIONABLE",
  "MESSAGE_ASSOCIATED",
  "COMPLETION_MARKER_PRESENT",
  "COMMAND_SHAPE_PRESENT",
  "COPY_CORRELATED",
  "CONVERSATION_ID_PRESENT",
  "DELIVERY_TARGET_SCOPED",
  "BLOCKER_CLASSIFIED",
] as const;
export const StructuralAssertionIdSchema = z.enum(StructuralAssertionIds);
export type StructuralAssertionId = z.infer<typeof StructuralAssertionIdSchema>;

const BehavioralAssertionIds = [
  "INSERT_READBACK",
  "SEND_TRANSITION",
  "BUSY_TRANSITION",
  "RESPONSE_ASSOCIATED",
  "COMPLETION_TRANSITION",
  "COMMAND_DISCOVERY",
  "COPY_ANCHOR_CORRELATION",
  "CONVERSATION_ID_STABLE",
  "DELIVERY_SCOPE",
  "ENVIRONMENT_PRECONDITION",
] as const;
export const BehavioralAssertionIdSchema = z.enum(BehavioralAssertionIds);
export type BehavioralAssertionId = z.infer<typeof BehavioralAssertionIdSchema>;

const ExpectedTransitionIds = [
  "SEND_TO_BUSY",
  "BUSY_TO_IDLE",
  "PROMPT_TO_ASSISTANT",
  "ASSISTANT_TO_COMPLETE",
  "RUN_TO_DELIVERY",
  "BLOCKING_DETECTED",
] as const;
export const ExpectedTransitionIdSchema = z.enum(ExpectedTransitionIds);
export type ExpectedTransitionId = z.infer<typeof ExpectedTransitionIdSchema>;

const SafeEvidenceRuleIds = [
  "NO_EVIDENCE",
  "SAFE_ELEMENT_METADATA",
  "BOUNDED_DOM_FRAGMENT",
  "SAFE_SCREENSHOT_REFERENCE",
  "STATE_TRANSITION_TRACE",
] as const;
export const SafeEvidenceRuleIdSchema = z.enum(SafeEvidenceRuleIds);
export type SafeEvidenceRuleId = z.infer<typeof SafeEvidenceRuleIdSchema>;

const KnownVariantIdentifierSchema = StableMachineIdentifierV1Schema;

const ContourAbsencePolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("FORBIDDEN") }).strict(),
  z.object({ mode: z.literal("ALLOWED_FOR_SCOPE") }).strict(),
  z
    .object({
      mode: z.literal("ALLOWED_FOR_VARIANTS"),
      variantIds: z
        .array(KnownVariantIdentifierSchema)
        .min(1)
        .max(16)
        .refine((values) => new Set(values).size === values.length, {
          message: "duplicate allowed absence variant",
        }),
    })
    .strict(),
]);
export type ContourAbsencePolicy = z.infer<typeof ContourAbsencePolicySchema>;

export const HealthContourDefinitionSchema = z
  .object({
    key: BaselineContourKeySchema,
    purpose: z.string().min(1).max(512),
    required: z.boolean(),
    requiredForVariantIds: z
      .array(KnownVariantIdentifierSchema)
      .max(16)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate required variant",
      }),
    failureSeverity: ContourFailureSeveritySchema,
    absencePolicy: ContourAbsencePolicySchema,
    primaryStrategyId: PackagedStrategyIdSchema,
    fallbackStrategyIds: z
      .array(PackagedStrategyIdSchema)
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate fallback strategy",
      }),
    structuralAssertionIds: z
      .array(StructuralAssertionIdSchema)
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate structural assertion",
      }),
    behavioralAssertionIds: z
      .array(BehavioralAssertionIdSchema)
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate behavioral assertion",
      }),
    expectedTransitionIds: z
      .array(ExpectedTransitionIdSchema)
      .min(1)
      .max(6)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate expected transition",
      }),
    safeEvidenceRuleIds: z
      .array(SafeEvidenceRuleIdSchema)
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate evidence rule",
      }),
    timeoutMs: z.number().int().min(250).max(30_000),
    knownAcceptableVariantIds: z
      .array(KnownVariantIdentifierSchema)
      .max(16)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate acceptable variant",
      }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fallbackStrategyIds.includes(value.primaryStrategyId)) {
      context.addIssue({
        code: "custom",
        path: ["fallbackStrategyIds"],
        message: "primary strategy cannot be repeated as fallback",
      });
    }
    if (value.required && value.absencePolicy.mode !== "FORBIDDEN") {
      context.addIssue({
        code: "custom",
        path: ["absencePolicy"],
        message: "required contour cannot permit absence",
      });
    }
    if (!value.required && value.absencePolicy.mode === "FORBIDDEN") {
      context.addIssue({
        code: "custom",
        path: ["absencePolicy"],
        message: "optional contour must declare an absence allowance",
      });
    }
  });
export type HealthContourDefinition = z.infer<
  typeof HealthContourDefinitionSchema
>;

export const HealthSuiteKindSchema = z.literal("BASELINE_CONTRACT_FIXTURE");

export const HealthSuiteDefinitionSchema = z
  .object({
    machineKey: StableMachineIdentifierV1Schema,
    revision: z.number().int().positive(),
    suiteKind: HealthSuiteKindSchema,
    displayName: z.string().min(1).max(256),
    description: z.string().min(1).max(1024),
    scope: HealthScopeSchema,
    contours: z
      .array(HealthContourDefinitionSchema)
      .min(1)
      .max(BaselineContourKeySchema.options.length)
      .refine(
        (values) =>
          new Set(values.map((value) => value.key)).size === values.length,
        { message: "duplicate contour key" },
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.scope.healthSuite.machineKey !== value.machineKey ||
      value.scope.healthSuite.revision !== value.revision
    ) {
      context.addIssue({
        code: "custom",
        path: ["scope", "healthSuite"],
        message: "scope suite identity does not match definition identity",
      });
    }
  });
export type HealthSuiteDefinition = z.infer<typeof HealthSuiteDefinitionSchema>;

export const HealthObservationOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "NOT_ATTEMPTED",
  "UNCERTAIN",
]);
export type HealthObservationOutcome = z.infer<
  typeof HealthObservationOutcomeSchema
>;

export const HealthAssertionOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "NOT_RUN",
  "UNCERTAIN",
]);
export type HealthAssertionOutcome = z.infer<
  typeof HealthAssertionOutcomeSchema
>;

export const HealthObservationStatusSchema = z.enum([
  "PRESENT",
  "ABSENT",
  "NOT_OBSERVED",
]);
export type HealthObservationStatus = z.infer<
  typeof HealthObservationStatusSchema
>;

export const EnvironmentUncertaintyReasonSchema = z.enum([
  "LOGIN_EXPIRED",
  "VERIFICATION_CHECKPOINT",
  "CAPTCHA_SECURITY_CHECKPOINT",
  "ACCOUNT_BLOCKED",
  "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
  "CONTROLLED_BROWSER_UNAVAILABLE",
]);
export type EnvironmentUncertaintyReason = z.infer<
  typeof EnvironmentUncertaintyReasonSchema
>;

export const SafeEvidenceReferenceSchema = z
  .object({
    evidenceId: z.uuid(),
    ruleId: SafeEvidenceRuleIdSchema,
    classification: z.enum(["METADATA", "BOUNDED_FRAGMENT", "SCREENSHOT"]),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    sizeBytes: z.number().int().min(0).max(10_000_000).nullable(),
  })
  .strict();
export type SafeEvidenceReference = z.infer<typeof SafeEvidenceReferenceSchema>;

export const FallbackQualitySchema = z.enum([
  "NOT_APPLICABLE",
  "APPROVED_EQUIVALENT",
  "MATERIALLY_DEGRADED",
]);
export type FallbackQuality = z.infer<typeof FallbackQualitySchema>;

export const HealthContourResultSchema = z
  .object({
    contourKey: BaselineContourKeySchema,
    required: z.boolean(),
    failureSeverity: ContourFailureSeveritySchema,
    observationStatus: HealthObservationStatusSchema,
    primaryStrategyId: PackagedStrategyIdSchema,
    primaryStrategyOutcome: HealthObservationOutcomeSchema,
    fallbackStrategyOutcomes: z
      .array(
        z
          .object({
            strategyId: PackagedStrategyIdSchema,
            outcome: HealthObservationOutcomeSchema,
          })
          .strict(),
      )
      .max(8)
      .refine(
        (values) =>
          new Set(values.map((value) => value.strategyId)).size ===
          values.length,
        { message: "duplicate fallback result" },
      ),
    selectedStrategyId: PackagedStrategyIdSchema.nullable(),
    structuralOutcome: HealthAssertionOutcomeSchema,
    behavioralOutcome: HealthAssertionOutcomeSchema,
    fallbackQuality: FallbackQualitySchema,
    environmentStatus: z.enum(["VALID", "UNCERTAIN"]),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
    evidence: z.array(SafeEvidenceReferenceSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.environmentStatus === "VALID" &&
      value.uncertaintyReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyReason"],
        message: "valid environment cannot have an uncertainty reason",
      });
    }
    if (
      value.environmentStatus === "UNCERTAIN" &&
      value.uncertaintyReason === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyReason"],
        message: "uncertain environment requires a reason",
      });
    }
    if (value.observationStatus !== "PRESENT") {
      if (
        value.primaryStrategyOutcome !== "NOT_ATTEMPTED" ||
        value.fallbackStrategyOutcomes.length > 0 ||
        value.selectedStrategyId !== null ||
        value.structuralOutcome !== "NOT_RUN" ||
        value.behavioralOutcome !== "NOT_RUN" ||
        value.fallbackQuality !== "NOT_APPLICABLE"
      ) {
        context.addIssue({
          code: "custom",
          path: ["observationStatus"],
          message:
            "absent or unobserved contour cannot contain execution results",
        });
      }
    }
    if (value.fallbackQuality !== "NOT_APPLICABLE") {
      const selectedFallback = value.fallbackStrategyOutcomes.some(
        (attempt) => attempt.strategyId === value.selectedStrategyId,
      );
      if (!selectedFallback) {
        context.addIssue({
          code: "custom",
          path: ["fallbackQuality"],
          message: "fallback quality requires a selected fallback strategy",
        });
      }
    }
    if (
      value.selectedStrategyId !== null &&
      value.selectedStrategyId !== value.primaryStrategyId &&
      !value.fallbackStrategyOutcomes.some(
        (attempt) => attempt.strategyId === value.selectedStrategyId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedStrategyId"],
        message: "selected strategy must be primary or an observed fallback",
      });
    }
  });
export type HealthContourResult = z.infer<typeof HealthContourResultSchema>;

export const HealthClassificationInputSchema = z
  .object({
    suite: HealthSuiteDefinitionSchema,
    results: z.array(HealthContourResultSchema),
    operatorMaintenance: z.boolean(),
  })
  .strict();
export type HealthClassificationInput = z.infer<
  typeof HealthClassificationInputSchema
>;

export const HealthProductFindingSchema = z
  .object({
    contourKey: BaselineContourKeySchema,
    finding: z.enum(["BROKEN", "DEGRADED", "DRIFT"]),
  })
  .strict();
export type HealthProductFinding = z.infer<typeof HealthProductFindingSchema>;

export const HealthClassificationResultSchema = z
  .object({
    state: HealthStateSchema,
    basis: HealthClassificationBasisSchema,
    findingContourKeys: z
      .array(BaselineContourKeySchema)
      .max(BaselineContourKeySchema.options.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate finding contour key",
      }),
    productFindings: z
      .array(HealthProductFindingSchema)
      .max(BaselineContourKeySchema.options.length)
      .refine(
        (values) =>
          new Set(values.map((value) => value.contourKey)).size ===
          values.length,
        { message: "duplicate product finding" },
      ),
    environmentUncertaintyReasons: z
      .array(EnvironmentUncertaintyReasonSchema)
      .max(EnvironmentUncertaintyReasonSchema.options.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate environment uncertainty reason",
      }),
    operatorMaintenance: z.boolean(),
  })
  .strict();
export type HealthClassificationResult = z.infer<
  typeof HealthClassificationResultSchema
>;
