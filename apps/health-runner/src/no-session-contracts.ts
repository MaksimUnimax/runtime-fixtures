import { z } from "zod";
import { HealthStateSchema, type HealthState } from "@product/health";
import { BrowserRuntimeMetadataSchema } from "./h2.js";

export const NoSessionProviderIdSchema = z.enum([
  "chatgpt",
  "alice",
  "deepseek",
  "grok",
  "claude",
  "gemini",
  "qwen",
  "kimi",
]);
export type NoSessionProviderId = z.infer<typeof NoSessionProviderIdSchema>;

export const NoSessionSurfaceIdSchema = z.enum([
  "CHATGPT_STANDARD",
  "CHATGPT_WORK",
  "ALICE",
  "DEEPSEEK",
  "GROK",
  "CLAUDE",
  "GEMINI",
  "QWEN",
  "KIMI",
]);
export type NoSessionSurfaceId = z.infer<typeof NoSessionSurfaceIdSchema>;

export const NoSessionNavigationStateSchema = z.enum([
  "NOT_ATTEMPTED",
  "LOADED",
  "FAILED",
]);
export type NoSessionNavigationState = z.infer<
  typeof NoSessionNavigationStateSchema
>;

export const NoSessionIdentityStateSchema = z.enum([
  "PROVEN",
  "NOT_PROVEN",
  "MISMATCH",
]);
export type NoSessionIdentityState = z.infer<
  typeof NoSessionIdentityStateSchema
>;

export const NoSessionReachabilitySchema = z.enum([
  "REACHABLE",
  "NOT_REACHABLE",
  "NOT_PROVABLE",
]);
export type NoSessionReachability = z.infer<typeof NoSessionReachabilitySchema>;

export const NoSessionContourStateSchema = z.enum([
  "OBSERVED",
  "ABSENT",
  "NOT_EXPECTED",
  "NOT_PROVABLE",
]);
export type NoSessionContourState = z.infer<typeof NoSessionContourStateSchema>;

export const NoSessionAuthStateSchema = z.enum([
  "NOT_REQUIRED",
  "AUTH_REQUIRED",
  "LOGIN_REQUIRED",
  "NOT_PROVABLE",
]);
export type NoSessionAuthState = z.infer<typeof NoSessionAuthStateSchema>;

export const NoSessionBlockerSchema = z.enum([
  "NONE",
  "SECURITY_CHECKPOINT",
  "CAPTCHA_SECURITY_CHECKPOINT",
  "ACCESS_BLOCKED",
  "MAINTENANCE",
  "NETWORK_FAILURE",
  "BROWSER_UNAVAILABLE",
  "UNEXPECTED_SURFACE",
  "ORIGIN_POLICY_VIOLATION",
]);
export type NoSessionBlocker = z.infer<typeof NoSessionBlockerSchema>;

export const NoSessionClassificationBasisSchema = z.enum([
  "PUBLIC_SURFACE_PRIMARY",
  "AUTH_REQUIRED_BOUNDARY",
  "IDENTITY_NOT_PROVEN",
  "ORIGIN_POLICY_FAILURE",
  "NETWORK_FAILURE",
  "SECURITY_CHECKPOINT",
  "ACCESS_BLOCKED",
  "MAINTENANCE_SURFACE",
  "REQUIRED_CONTOUR_MISSING",
  "UNEXPECTED_SURFACE",
  "BROWSER_FAILURE",
]);
export type NoSessionClassificationBasis = z.infer<
  typeof NoSessionClassificationBasisSchema
>;

export const NoSessionElementMetadataSchema = z
  .object({
    elementCount: z.number().int().min(0).max(64),
    visible: z.boolean(),
    editable: z.boolean(),
    actionable: z.boolean(),
  })
  .strict();
export type NoSessionElementMetadata = z.infer<
  typeof NoSessionElementMetadataSchema
>;

export const NoSessionEvidenceReferenceSchema = z
  .object({
    evidenceId: z.uuid(),
    ruleId: z.enum(["SAFE_ELEMENT_METADATA", "STATE_TRANSITION_TRACE"]),
    classification: z.literal("METADATA"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().min(0).max(4_096),
  })
  .strict();
export type NoSessionEvidenceReference = z.infer<
  typeof NoSessionEvidenceReferenceSchema
>;

export const NoSessionPageSnapshotSchema = z
  .object({
    profileId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    finalOrigin: z.string().url().max(256),
    identityMarkerCount: z.number().int().min(0).max(64),
    surfaceMarkerCount: z.number().int().min(0).max(64),
    composer: NoSessionElementMetadataSchema,
    editableInput: NoSessionElementMetadataSchema,
    sendControl: NoSessionElementMetadataSchema,
    authWallObserved: z.boolean(),
    loginWallObserved: z.boolean(),
    securityCheckpointObserved: z.boolean(),
    captchaObserved: z.boolean(),
    accessBlockedObserved: z.boolean(),
    maintenanceObserved: z.boolean(),
  })
  .strict();
export type NoSessionPageSnapshot = z.infer<typeof NoSessionPageSnapshotSchema>;

export const NoSessionObservationResultSchema = z
  .object({
    providerId: NoSessionProviderIdSchema,
    surfaceId: NoSessionSurfaceIdSchema,
    targetKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    strategyRevision: z.number().int().positive(),
    browserRuntime: BrowserRuntimeMetadataSchema,
    navigation: NoSessionNavigationStateSchema,
    finalOrigin: z.string().url().max(256).nullable(),
    expectedOriginValid: z.boolean(),
    identity: NoSessionIdentityStateSchema,
    publicSurface: NoSessionReachabilitySchema,
    composer: NoSessionContourStateSchema,
    editableInput: NoSessionContourStateSchema,
    sendControl: NoSessionContourStateSchema,
    authentication: NoSessionAuthStateSchema,
    blocker: NoSessionBlockerSchema,
    classification: HealthStateSchema,
    classificationBasis: NoSessionClassificationBasisSchema,
    elementMetadata: z
      .object({
        composer: NoSessionElementMetadataSchema,
        editableInput: NoSessionElementMetadataSchema,
        sendControl: NoSessionElementMetadataSchema,
      })
      .strict(),
    noInteraction: z.literal(true),
    observedAt: z.string().datetime({ offset: true }),
    evidence: z.array(NoSessionEvidenceReferenceSchema).max(2),
  })
  .strict();
export type NoSessionObservationResult = Readonly<
  Omit<z.infer<typeof NoSessionObservationResultSchema>, "evidence"> & {
    readonly evidence: readonly NoSessionEvidenceReference[];
  }
>;

export function parseNoSessionObservationResult(
  input: unknown,
): NoSessionObservationResult {
  return NoSessionObservationResultSchema.parse(
    input,
  ) as NoSessionObservationResult;
}

export function healthState(value: HealthState): HealthState {
  return HealthStateSchema.parse(value);
}
