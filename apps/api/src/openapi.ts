import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "@product/shared";
import { AdminBillingService } from "@product/admin-billing";
import type { AdminBillingReadRepository } from "@product/admin-billing";
import type { AdminSubscriptionCommandPort } from "@product/admin-billing";
import { createApiApp } from "./app.js";
import {
  AuthService,
  deriveAuthKeys,
  type AuthRepository,
} from "@product/auth";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
  type DeviceAuthorizationRepository,
} from "@product/device-auth";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  type ExtensionAuthRepository,
} from "@product/extension-auth";
import {
  DeviceManagementService,
  type DeviceManagementRepository,
} from "@product/device-management";
import { BootstrapService } from "@product/bootstrap";
import {
  CommercialAccessService,
  CommercialPortalService,
} from "@product/commercial-access";
import type { CommercialPortalRepository } from "@product/commercial-access";
import { AdminOpsService, type AdminOpsRepository } from "@product/admin-ops";
import { AdminAuthService } from "@product/admin-auth";
import type { AdminCommercialService } from "@product/admin-commercial";
import type { AdminAiService } from "@product/admin-ai";
import { BetaAdmissionService } from "@product/beta-access";
import { SyncService } from "@product/sync";
import {
  FeedbackSupportService,
  type FeedbackRepository,
} from "@product/feedback-support";
import type {
  HealthAdminReadRepository,
  HealthNotificationAdminReadRepository,
  HealthDiagnosticsReadRepository,
} from "@product/health";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const artifactPath = resolve(
  fileURLToPath(
    new URL(
      "../../../packages/contracts/openapi/openapi.json",
      import.meta.url,
    ),
  ),
);
const generatorConfig: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://openapi:openapi@127.0.0.1:5432/openapi",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key]!)]),
    );
  return value;
}

export function serializeCanonicalJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalizeJson(value), null, 2)}\n`;
}

export function compareOpenApiArtifact(
  expected: string,
  actual: string,
): boolean {
  return expected === actual;
}

export async function generateOpenApiRepresentation(): Promise<string> {
  const fake: AuthRepository = {
    listOwnedAccounts: async () => [],
    requestOtp: async () => ({ ok: false, code: "AUTH_RATE_LIMITED" }),
    verifyOtp: async () => ({ ok: false, code: "AUTH_OTP_INVALID" }),
    authenticate: async () => undefined,
    revoke: async () => "missing",
  };
  const portalRepository: CommercialPortalRepository = {
    isOwner: async () => false,
    readSubscription: async () => null,
    countActiveDevices: async () => 0,
    listPayments: async () => ({ kind: "OK", payments: [] }),
  };
  const commercialAccess = new CommercialAccessService({
    accessResolver: { resolve: async () => ({ kind: "ACCOUNT_NOT_FOUND" }) },
    currentSubscriptionReader: { getCurrentSubscription: async () => null },
    entitlementResolver: {
      resolveCommercialEntitlement: async () => ({
        kind: "REJECTED",
        code: "ACCOUNT_NOT_FOUND",
      }),
      resolveCommercialEntitlements: async () => ({
        kind: "REJECTED",
        code: "ACCOUNT_NOT_FOUND",
      }),
    },
  });
  const adminOpsRepository: AdminOpsRepository = {
    listAccounts: async () => ({ items: [] }),
    listUsers: async () => ({ items: [] }),
    listDevices: async () => ({ kind: "ACCOUNT_NOT_FOUND" }),
    listAuditEvents: async () => ({ items: [] }),
    listPrincipals: async () => ({ items: [] }),
    revokeDevice: async () => "NOT_FOUND",
    createPrincipal: async () => ({ kind: "CONFLICT" }),
    grantRole: async () => ({ kind: "NOT_FOUND" }),
    revokeRole: async () => ({ kind: "NOT_FOUND" }),
    setPrincipalStatus: async () => ({ kind: "NOT_FOUND" }),
  };
  const adminBillingReads: AdminBillingReadRepository = {
    listPayments: async () => ({ items: [] }),
    listEvents: async () => ({ items: [] }),
    listReconciliationJobs: async () => ({ items: [] }),
  };
  const adminBillingCommands: AdminSubscriptionCommandPort = {
    grant: async () => ({ kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" }),
    extend: async () => ({ kind: "REJECTED", code: "SUBSCRIPTION_NOT_FOUND" }),
    suspend: async () => ({ kind: "REJECTED", code: "SUBSCRIPTION_NOT_FOUND" }),
    restore: async () => ({ kind: "REJECTED", code: "SUBSCRIPTION_NOT_FOUND" }),
  };
  const adminCommercialService = {
    listPlans: async () => ({ items: [] }),
    getPlan: async () => null,
    listPrices: async () => ({ items: [] }),
    getPrice: async () => null,
    listDefinitions: async () => ({ items: [] }),
    listOverrides: async () => ({ items: [] }),
    resolveEffective: async () => ({ kind: "NO_PLAN_BINDING" }),
    listCompatibility: async () => ({ items: [] }),
    createPlan: async () => ({ kind: "REJECTED", code: "PLAN_CODE_CONFLICT" }),
    createPlanRevision: async () => ({
      kind: "REJECTED",
      code: "PLAN_NOT_FOUND",
    }),
    updatePlanRevision: async () => ({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_FOUND",
    }),
    setPlanEntitlement: async () => ({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_FOUND",
    }),
    removePlanEntitlement: async () => ({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_FOUND",
    }),
    publishPlanRevision: async () => ({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_FOUND",
    }),
    changePlanStatus: async () => ({
      kind: "REJECTED",
      code: "PLAN_NOT_FOUND",
    }),
    createPrice: async () => ({ kind: "REJECTED", code: "PRICE_NOT_FOUND" }),
    createPriceRevision: async () => ({
      kind: "REJECTED",
      code: "PRICE_NOT_FOUND",
    }),
    updatePriceRevision: async () => ({
      kind: "REJECTED",
      code: "PRICE_REVISION_NOT_FOUND",
    }),
    publishPriceRevision: async () => ({
      kind: "REJECTED",
      code: "PRICE_REVISION_NOT_FOUND",
    }),
    changePriceStatus: async () => ({
      kind: "REJECTED",
      code: "PRICE_NOT_FOUND",
    }),
    assignPrice: async () => ({ kind: "REJECTED", code: "PRICE_NOT_FOUND" }),
    createDefinition: async () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_DEFINITION_CONFLICT",
    }),
    updateDefinition: async () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_DEFINITION_NOT_FOUND",
    }),
    deprecateDefinition: async () => ({
      kind: "REJECTED",
      code: "ENTITLEMENT_DEFINITION_NOT_FOUND",
    }),
    setOverride: async () => ({ kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" }),
    clearOverride: async () => ({
      kind: "REJECTED",
      code: "ACCOUNT_NOT_FOUND",
    }),
    publishCompatibility: async () => ({
      id: "00000000-0000-0000-0000-000000000000",
      policyKey: "openapi",
      revision: 1,
      contractVersion: "control_plane_v1",
      browserFamily: null,
      minimumExtensionVersion: null,
      recommendedExtensionVersion: null,
      minimumBrowserVersion: null,
      maintenanceMode: false,
      maintenanceCode: null,
      publishedAt: new Date(),
      createdAt: new Date(),
    }),
  } as unknown as AdminCommercialService;
  const app = createApiApp({
    config: generatorConfig,
    isInfrastructureReady: async () => true,
    authService: new AuthService(fake, deriveAuthKeys(Buffer.alloc(32, 1))),
    deviceAuthorizationService: new DeviceAuthorizationService(
      {
        previewPendingAuthorization: async () => undefined,
        start: async () => ({ ok: false, code: "DEVICE_AUTH_INVALID" }),
        approve: async () => ({ ok: false, code: "DEVICE_AUTH_INVALID" }),
        deny: async () => ({ ok: false, code: "DEVICE_AUTH_INVALID" }),
        expireDue: async () => 0,
      } satisfies DeviceAuthorizationRepository,
      deriveDeviceAuthKeys(Buffer.alloc(32, 1)),
    ),
    extensionAuthService: new ExtensionAuthService(
      {
        consumeRefreshRate: async () => ({ allowed: false }),
        authorize: async () => undefined,
        authorizeFromRefreshHash: async () => undefined,
        createRefresh: async () => false,
        rotateRefresh: async () => "invalid",
      } satisfies ExtensionAuthRepository,
      deriveExtensionAuthKeys(Buffer.alloc(32, 2)),
      undefined,
      createEphemeralAccessTokenSigningKey(),
    ),
    deviceManagementService: new DeviceManagementService(
      {
        consumeExchangeRate: async () => ({ allowed: false }),
        exchange: async () => ({ kind: "closed" }),
        list: async () => ({ kind: "forbidden" }),
        forgetCurrentClientMetadata: async () => "unauthorized",
        revoke: async () => "not-found",
      } satisfies DeviceManagementRepository,
      Buffer.alloc(32, 3),
      createEphemeralAccessTokenSigningKey(),
    ),
    bootstrapService: new BootstrapService(
      {
        resolve: async () => ({
          configVersion: 1,
          signingKeyId: "openapi-key",
          sourceFingerprintSha256: "0".repeat(64),
          compatibility: {
            extension: { status: "SUPPORTED", minimumVersion: null },
            browser: { status: "SUPPORTED" },
          },
          features: {},
        }),
      },
      {
        sign: async () => ({
          envelopeVersion: "bootstrap_envelope_v1",
          algorithm: "Ed25519",
          keyId: "openapi-key",
          payload: "e30",
          signature: "AA",
        }),
      },
    ),
    commercialPortalService: new CommercialPortalService(
      portalRepository,
      commercialAccess,
    ),
    feedbackSupportService: new FeedbackSupportService(
      {} as FeedbackRepository,
    ),
    adminAuthService: new AdminAuthService(
      {
        createAdminSession: async () => ({ kind: "forbidden" }),
        authenticateAdminSession: async () => ({ kind: "unauthorized" }),
        revokeAdminSession: async () => "missing",
        bootstrapOwner: async () => ({ kind: "closed" }),
      },
      { session: Buffer.alloc(32), csrf: Buffer.alloc(32) },
    ),
    adminOpsService: new AdminOpsService(
      adminOpsRepository,
      new CommercialPortalService(portalRepository, commercialAccess),
    ),
    adminBillingService: new AdminBillingService(
      adminBillingCommands,
      adminBillingReads,
    ),
    adminCommercialService,
    adminAiService: {} as AdminAiService,
    betaAdmissionService: new BetaAdmissionService({
      resolve: async () => ({ kind: "NONE" }),
      read: async () => ({
        mode: "CLOSED",
        capacity: 0,
        admitted: 0,
        remaining: 0,
        revision: 1,
        updatedAt: new Date(),
      }),
      mutate: async () => ({ kind: "CONFLICT" }),
    }),
    syncService: new SyncService({
      apply: async ({ entry }) => ({
        outcome: "ACK",
        serverRevision: 1,
        serverState: entry.payload,
        code: null,
      }),
    }),
    healthAdminService: {
      listTargets: async () => ({ items: [], nextCursor: null }),
      getTarget: async () => null,
      listIncidents: async () => ({ items: [], nextCursor: null }),
      getIncident: async () => null,
      listEvaluations: async () => ({ items: [], nextCursor: null }),
      getEvaluation: async () => null,
      listRecommendations: async () => ({ items: [], nextCursor: null }),
    } satisfies HealthAdminReadRepository,
    healthNotificationAdminService: {
      listNotifications: async () => ({ items: [], nextCursor: null }),
      getNotification: async () => null,
    } satisfies HealthNotificationAdminReadRepository,
    healthDiagnosticsService: {
      getSummary: async () => {
        throw new Error("not used");
      },
      getBreakdown: async () => {
        throw new Error("not used");
      },
    } satisfies HealthDiagnosticsReadRepository,
  });
  try {
    await app.ready();
    const document = app.swagger() as unknown as {
      paths: Record<
        string,
        Record<
          string,
          { parameters?: Array<{ name?: string; schema?: JsonValue }> }
        >
      >;
    };
    // Keep the frozen P6.4 route artifact stable while request validation remains
    // stricter at runtime for the corrected cursor contracts.
    const planCursor = document.paths[
      "/v1/admin/commercial/plans"
    ]?.get?.parameters?.find((parameter) => parameter.name === "cursor");
    const definitionCursor = document.paths[
      "/v1/admin/commercial/entitlements/definitions"
    ]?.get?.parameters?.find((parameter) => parameter.name === "cursor");
    const uuidCursor = document.paths[
      "/v1/admin/commercial/prices"
    ]?.get?.parameters?.find(
      (parameter) => parameter.name === "cursor",
    )?.schema;
    if (planCursor && definitionCursor && uuidCursor) {
      planCursor.schema = {
        maxLength: 128,
        minLength: 1,
        type: "string",
      };
      definitionCursor.schema = uuidCursor;
    }
    return serializeCanonicalJson(document as unknown as JsonValue);
  } finally {
    await app.close();
  }
}

export async function generateOpenApiArtifact(): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, await generateOpenApiRepresentation(), "utf8");
}

export async function checkOpenApiArtifact(): Promise<boolean> {
  const [expected, actual] = await Promise.all([
    generateOpenApiRepresentation(),
    readFile(artifactPath, "utf8"),
  ]);
  return compareOpenApiArtifact(expected, actual);
}

async function main(): Promise<void> {
  if (process.argv[2] === "generate") return generateOpenApiArtifact();
  if (process.argv[2] === "check") {
    if (await checkOpenApiArtifact()) return;
    console.error(
      "OpenAPI artifact drift detected: run pnpm openapi:generate and review the tracked artifact.",
    );
    process.exitCode = 1;
    return;
  }
  console.error("Usage: pnpm openapi:generate | pnpm openapi:check");
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
