import { createHash, randomUUID } from "node:crypto";
import { canonicalizeJson } from "@product/remote-config";
import { z } from "zod";
import {
  NoSessionBlockerSchema,
  NoSessionClassificationBasisSchema,
  NoSessionContourStateSchema,
  NoSessionIdentityStateSchema,
  NoSessionNavigationStateSchema,
  NoSessionProviderIdSchema,
  NoSessionReachabilitySchema,
  NoSessionSurfaceIdSchema,
  NoSessionEvidenceReferenceSchema,
  type NoSessionObservationResult,
  type NoSessionEvidenceReference,
} from "./no-session-contracts.js";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CommonPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: NoSessionProviderIdSchema,
    surfaceId: NoSessionSurfaceIdSchema,
    targetKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    strategyRevision: z.number().int().positive(),
    browserMode: z
      .object({
        canonicalMode: z.enum(["HEADED", "HEADLESS_DIAGNOSTIC"]),
        authoritativeMode: z.enum(["HEADED", "HEADLESS_DIAGNOSTIC"]),
        diagnosticMode: z.enum(["HEADED", "HEADLESS_DIAGNOSTIC"]).nullable(),
        fallbackAttempted: z.boolean(),
        fallbackReason: z.enum([
          "NOT_REQUIRED",
          "SECURITY_CHECKPOINT",
          "ACCESS_BLOCKED",
          "IDENTITY_NOT_PROVEN",
          "UNEXPECTED_STATIC_SURFACE",
          "HEADED_INFRASTRUCTURE_UNAVAILABLE",
        ]),
        headedInfrastructure: z.enum([
          "AVAILABLE",
          "UNAVAILABLE",
          "NOT_CHECKED",
        ]),
        environmentLimited: z.boolean(),
        canonicalObservation: z
          .object({
            mode: z.enum(["HEADED", "HEADLESS_DIAGNOSTIC"]),
            identity: NoSessionIdentityStateSchema,
            blocker: NoSessionBlockerSchema,
            classification: z.enum([
              "HEALTHY",
              "DRIFT",
              "DEGRADED",
              "BROKEN",
              "UNKNOWN",
              "MAINTENANCE",
            ]),
            surfaceOutcome: z.enum([
              "PUBLIC_INTERACTIVE",
              "PUBLIC_LANDING",
              "AUTH_REQUIRED",
              "NOT_OBSERVABLE_WITHOUT_SESSION",
              "REGION_OR_ELIGIBILITY_RESTRICTED",
              "UNSUPPORTED_ENVIRONMENT",
              "SECURITY_CHECKPOINT",
              "ACCESS_BLOCKED",
              "MAINTENANCE",
              "DRIFT",
              "BROKEN",
              "NETWORK_FAILURE",
              "BROWSER_FAILURE",
              "IDENTITY_NOT_PROVEN",
            ]),
          })
          .strict(),
        diagnosticObservation: z
          .object({
            mode: z.enum(["HEADED", "HEADLESS_DIAGNOSTIC"]),
            identity: NoSessionIdentityStateSchema,
            blocker: NoSessionBlockerSchema,
            classification: z.enum([
              "HEALTHY",
              "DRIFT",
              "DEGRADED",
              "BROKEN",
              "UNKNOWN",
              "MAINTENANCE",
            ]),
            surfaceOutcome: z.enum([
              "PUBLIC_INTERACTIVE",
              "PUBLIC_LANDING",
              "AUTH_REQUIRED",
              "NOT_OBSERVABLE_WITHOUT_SESSION",
              "REGION_OR_ELIGIBILITY_RESTRICTED",
              "UNSUPPORTED_ENVIRONMENT",
              "SECURITY_CHECKPOINT",
              "ACCESS_BLOCKED",
              "MAINTENANCE",
              "DRIFT",
              "BROKEN",
              "NETWORK_FAILURE",
              "BROWSER_FAILURE",
              "IDENTITY_NOT_PROVEN",
            ]),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    finalOrigin: z.string().url().max(256).nullable(),
    expectedOriginValid: z.boolean(),
    navigation: NoSessionNavigationStateSchema,
    navigationEvidence: z
      .object({
        requestedStartUrl: z.string().url().max(256),
        finalUrl: z.string().url().max(256).nullable(),
        finalOrigin: z.string().url().max(256).nullable(),
        mainDocumentHttpStatus: z.number().int().min(100).max(599).nullable(),
        redirectCount: z.number().int().min(0).max(8),
        outcome: z.enum([
          "NOT_ATTEMPTED",
          "LOADED",
          "HTTP_FAILURE",
          "TIMEOUT",
          "NETWORK_FAILURE",
          "ORIGIN_REJECTED",
        ]),
      })
      .strict(),
    identity: NoSessionIdentityStateSchema,
    publicSurface: NoSessionReachabilitySchema,
    composer: NoSessionContourStateSchema,
    editableInput: NoSessionContourStateSchema,
    sendControl: NoSessionContourStateSchema,
    blocker: NoSessionBlockerSchema,
    classification: z.enum([
      "HEALTHY",
      "DRIFT",
      "DEGRADED",
      "BROKEN",
      "UNKNOWN",
      "MAINTENANCE",
    ]),
    classificationBasis: NoSessionClassificationBasisSchema,
    surfaceOutcome: z.enum([
      "PUBLIC_INTERACTIVE",
      "PUBLIC_LANDING",
      "AUTH_REQUIRED",
      "NOT_OBSERVABLE_WITHOUT_SESSION",
      "REGION_OR_ELIGIBILITY_RESTRICTED",
      "SECURITY_CHECKPOINT",
      "ACCESS_BLOCKED",
      "MAINTENANCE",
      "DRIFT",
      "BROKEN",
      "NETWORK_FAILURE",
      "BROWSER_FAILURE",
      "IDENTITY_NOT_PROVEN",
    ]),
    readiness: z.enum([
      "NOT_OBSERVED",
      "STATIC_LANDING",
      "APP_HYDRATED",
      "ACCESS_GATE",
      "SECURITY_GATE",
      "MAINTENANCE_GATE",
    ]),
    noInteraction: z.literal(true),
  })
  .strict();

export const NoSessionSafeMetadataPayloadSchema = CommonPayloadSchema.extend({
  kind: z.literal("SAFE_ELEMENT_METADATA"),
  composerElementCount: z.number().int().min(0).max(64),
  composerVisible: z.boolean(),
  composerEditable: z.boolean(),
  composerActionable: z.boolean(),
  inputElementCount: z.number().int().min(0).max(64),
  inputVisible: z.boolean(),
  inputEditable: z.boolean(),
  inputActionable: z.boolean(),
  sendElementCount: z.number().int().min(0).max(64),
  sendVisible: z.boolean(),
  sendEditable: z.boolean(),
  sendActionable: z.boolean(),
}).strict();

export const NoSessionStateTransitionPayloadSchema = CommonPayloadSchema.extend(
  {
    kind: z.literal("STATE_TRANSITION_TRACE"),
    transitions: z
      .array(
        z.enum([
          "NAVIGATION_COMPLETED",
          "ORIGIN_VALIDATED",
          "IDENTITY_PROVEN",
          "PUBLIC_SURFACE_REACHABLE",
          "AUTH_WALL_OBSERVED",
          "CHECKPOINT_OBSERVED",
          "MAINTENANCE_OBSERVED",
          "ACCESS_BLOCKED",
          "REQUIRED_CONTOUR_ABSENT",
        ]),
      )
      .max(16),
  },
).strict();

export const NoSessionSafeEvidencePayloadSchema = z.discriminatedUnion("kind", [
  NoSessionSafeMetadataPayloadSchema,
  NoSessionStateTransitionPayloadSchema,
]);
export type NoSessionSafeEvidencePayload = z.infer<
  typeof NoSessionSafeEvidencePayloadSchema
>;

export const NoSessionSafeEvidenceArtifactSchema = z
  .object({
    evidenceId: z.uuid(),
    providerId: NoSessionProviderIdSchema,
    surfaceId: NoSessionSurfaceIdSchema,
    targetKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    ruleId: z.enum(["SAFE_ELEMENT_METADATA", "STATE_TRANSITION_TRACE"]),
    classification: z.literal("METADATA"),
    sha256: Sha256Schema,
    sizeBytes: z.number().int().min(0).max(4_096),
    payload: NoSessionSafeEvidencePayloadSchema,
  })
  .strict();
export type NoSessionSafeEvidenceArtifact = Readonly<
  z.infer<typeof NoSessionSafeEvidenceArtifactSchema>
>;

export const NoSessionSafeEvidenceReferenceSchema =
  NoSessionEvidenceReferenceSchema;
export type NoSessionSafeEvidenceReference = NoSessionEvidenceReference;

export const NoSessionSafeEvidencePackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: NoSessionProviderIdSchema,
    surfaceId: NoSessionSurfaceIdSchema,
    targetKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    semanticHash: Sha256Schema,
    artifacts: z.array(NoSessionSafeEvidenceArtifactSchema).max(2),
  })
  .strict();
export type NoSessionSafeEvidencePackage = Readonly<
  z.infer<typeof NoSessionSafeEvidencePackageSchema>
>;

function commonPayload(result: NoSessionObservationResult) {
  return {
    schemaVersion: 1 as const,
    providerId: result.providerId,
    surfaceId: result.surfaceId,
    targetKey: result.targetKey,
    strategyId: result.strategyId,
    strategyRevision: result.strategyRevision,
    browserMode: result.browserMode,
    finalOrigin: result.finalOrigin,
    expectedOriginValid: result.expectedOriginValid,
    navigation: result.navigation,
    navigationEvidence: result.navigationEvidence,
    identity: result.identity,
    publicSurface: result.publicSurface,
    composer: result.composer,
    editableInput: result.editableInput,
    sendControl: result.sendControl,
    blocker: result.blocker,
    classification: result.classification,
    classificationBasis: result.classificationBasis,
    surfaceOutcome: result.surfaceOutcome,
    readiness: result.readiness,
    noInteraction: true as const,
  };
}

function transitionsFor(result: NoSessionObservationResult): readonly string[] {
  const transitions: string[] = [];
  if (result.navigation === "LOADED") transitions.push("NAVIGATION_COMPLETED");
  if (result.expectedOriginValid) transitions.push("ORIGIN_VALIDATED");
  if (result.identity === "PROVEN") transitions.push("IDENTITY_PROVEN");
  if (result.publicSurface === "REACHABLE")
    transitions.push("PUBLIC_SURFACE_REACHABLE");
  if (result.authentication !== "NOT_REQUIRED")
    transitions.push("AUTH_WALL_OBSERVED");
  if (
    result.blocker === "SECURITY_CHECKPOINT" ||
    result.blocker === "CAPTCHA_SECURITY_CHECKPOINT"
  )
    transitions.push("CHECKPOINT_OBSERVED");
  if (result.blocker === "MAINTENANCE")
    transitions.push("MAINTENANCE_OBSERVED");
  if (result.blocker === "ACCESS_BLOCKED") transitions.push("ACCESS_BLOCKED");
  if (
    [result.composer, result.editableInput, result.sendControl].includes(
      "ABSENT",
    )
  )
    transitions.push("REQUIRED_CONTOUR_ABSENT");
  return transitions;
}

function artifactFor(
  result: NoSessionObservationResult,
  ruleId: "SAFE_ELEMENT_METADATA" | "STATE_TRANSITION_TRACE",
): NoSessionSafeEvidenceArtifact {
  const payload =
    ruleId === "SAFE_ELEMENT_METADATA"
      ? NoSessionSafeMetadataPayloadSchema.parse({
          ...commonPayload(result),
          kind: "SAFE_ELEMENT_METADATA",
          composerElementCount: result.elementMetadata.composer.elementCount,
          composerVisible: result.elementMetadata.composer.visible,
          composerEditable: result.elementMetadata.composer.editable,
          composerActionable: result.elementMetadata.composer.actionable,
          inputElementCount: result.elementMetadata.editableInput.elementCount,
          inputVisible: result.elementMetadata.editableInput.visible,
          inputEditable: result.elementMetadata.editableInput.editable,
          inputActionable: result.elementMetadata.editableInput.actionable,
          sendElementCount: result.elementMetadata.sendControl.elementCount,
          sendVisible: result.elementMetadata.sendControl.visible,
          sendEditable: result.elementMetadata.sendControl.editable,
          sendActionable: result.elementMetadata.sendControl.actionable,
        })
      : NoSessionStateTransitionPayloadSchema.parse({
          ...commonPayload(result),
          kind: "STATE_TRANSITION_TRACE",
          transitions: transitionsFor(result),
        });
  const bytes = canonicalizeJson(payload);
  if (bytes.byteLength > 4_096)
    throw new Error("NO_SESSION_SAFE_ARTIFACT_SIZE_LIMIT");
  return NoSessionSafeEvidenceArtifactSchema.parse({
    evidenceId: randomUUID(),
    providerId: result.providerId,
    surfaceId: result.surfaceId,
    targetKey: result.targetKey,
    ruleId,
    classification: "METADATA",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    payload,
  });
}

export function createNoSessionSafeEvidence(
  result: NoSessionObservationResult,
): {
  package: NoSessionSafeEvidencePackage;
  references: readonly NoSessionSafeEvidenceReference[];
} {
  const artifacts = [
    artifactFor(result, "SAFE_ELEMENT_METADATA"),
    artifactFor(result, "STATE_TRANSITION_TRACE"),
  ];
  const semanticHash = createHash("sha256")
    .update(canonicalizeJson(artifacts.map(({ payload }) => payload)))
    .digest("hex");
  const evidencePackage = NoSessionSafeEvidencePackageSchema.parse({
    schemaVersion: 1,
    providerId: result.providerId,
    surfaceId: result.surfaceId,
    targetKey: result.targetKey,
    semanticHash,
    artifacts,
  });
  return {
    package: Object.freeze(evidencePackage),
    references: Object.freeze(
      artifacts.map((artifact) => ({
        evidenceId: artifact.evidenceId,
        ruleId: artifact.ruleId,
        classification: artifact.classification,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      })),
    ),
  };
}

export function validateNoSessionSafeEvidence(
  evidencePackage: unknown,
): NoSessionSafeEvidencePackage {
  const parsed = NoSessionSafeEvidencePackageSchema.parse(evidencePackage);
  for (const artifact of parsed.artifacts) {
    const bytes = canonicalizeJson(artifact.payload);
    if (
      artifact.sha256 !== createHash("sha256").update(bytes).digest("hex") ||
      artifact.sizeBytes !== bytes.byteLength ||
      artifact.payload.providerId !== parsed.providerId ||
      artifact.payload.surfaceId !== parsed.surfaceId ||
      artifact.payload.targetKey !== parsed.targetKey
    ) {
      throw new Error("NO_SESSION_EVIDENCE_INTEGRITY_FAILURE");
    }
  }
  const semanticHash = createHash("sha256")
    .update(canonicalizeJson(parsed.artifacts.map(({ payload }) => payload)))
    .digest("hex");
  if (semanticHash !== parsed.semanticHash)
    throw new Error("NO_SESSION_SEMANTIC_HASH_MISMATCH");
  return parsed;
}
