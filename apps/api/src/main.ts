import {
  createAuthRepository,
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  createExtensionAuthRepository,
  createDeviceManagementRepository,
  createP3BootstrapPolicyCatalogRepository,
  createP4CommercialCatalogRepository,
  createP4EntitlementRepository,
  createP5SubscriptionAccessResolver,
  createP5SubscriptionRepository,
  createP5CommercialPortalRepository,
  createAdminAuthRepository,
  createAdminOpsRepository,
  createP6AdminBillingRepository,
  createP6AdminSubscriptionCommandAdapter,
  createP6AdminCommercialReadRepository,
  createP6AdminPlanCommandAdapter,
  createP6AdminPriceCommandAdapter,
  createP6AdminEntitlementCommandAdapter,
  createP6AdminCompatibilityCommandAdapter,
  createBootstrapAiResolutionRepository,
  createP7AdminAiReadRepository,
  createP7AdminAiCommandRepository,
  createProfileLifecycleRepository,
  authorizeAdminMutationInTransaction,
  createBetaAdmissionRepository,
  createSyncRepository,
  createSyncSnapshotReader,
  createCredentialTransferRepository,
  createFeedbackSupportRepository,
  createHealthAdminReadRepository,
  createHealthNotificationAdminReadRepository,
  createHealthDiagnosticsReadRepository,
} from "@product/db";
import { AuthService, deriveAuthKeys, loadAuthRootSecret } from "@product/auth";
import { AdminAuthService, deriveAdminAuthKeys } from "@product/admin-auth";
import { AdminOpsService } from "@product/admin-ops";
import { AdminBillingService } from "@product/admin-billing";
import { createAdminCommercialService } from "@product/admin-commercial";
import { AdminAiService } from "@product/admin-ai";
import { BetaAdmissionService } from "@product/beta-access";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
} from "@product/device-auth";
import {
  ExtensionAuthService,
  deriveExtensionAuthKeys,
  loadAccessTokenSigningKey,
} from "@product/extension-auth";
import { DeviceManagementService } from "@product/device-management";
import {
  BootstrapAiResolutionService,
  BootstrapService,
} from "@product/bootstrap";
import {
  CommercialAccessService,
  CommercialPortalService,
} from "@product/commercial-access";
import { resolveP3BootstrapPolicy } from "@product/remote-config";
import {
  bindConfigSigningRing,
  createConfigSigningService,
  loadConfigSigningMaterial,
} from "./bootstrap-signing.js";
import { loadConfig } from "@product/shared";
import { createApiApp } from "./app.js";
import { SyncService } from "@product/sync";
import { CredentialTransferService } from "@product/credential-transfer";
import { createInfrastructureReadiness } from "./infrastructure.js";
import { FeedbackSupportService } from "@product/feedback-support";
import { sellerAgentsCommercialModeFromEnvironment } from "@product/entitlements/seller-agents-commercial-policy";

const config = loadConfig(process.env);
const commercialModeEnabled =
  sellerAgentsCommercialModeFromEnvironment(process.env) === "ENABLED";
const database = createDatabaseRuntime(config.databaseUrl);
const subscriptions = createP5SubscriptionRepository(database);
const subscriptionAccess = createP5SubscriptionAccessResolver(subscriptions);
const entitlements = createP4EntitlementRepository(database);
const betaAdmission = new BetaAdmissionService(
  createBetaAdmissionRepository(database),
);
const commercialAccess = new CommercialAccessService({
  accessResolver: subscriptionAccess,
  currentSubscriptionReader: subscriptions,
  entitlementResolver: entitlements,
});
const commercialPortal = new CommercialPortalService(
  createP5CommercialPortalRepository(database),
  commercialAccess,
  undefined,
  betaAdmission,
);
const rootSecret = loadAuthRootSecret(process.env);
const adminAuth = new AdminAuthService(
  createAdminAuthRepository(database),
  deriveAdminAuthKeys(rootSecret),
);
const bootstrapSigningMaterial = loadConfigSigningMaterial(process.env);
const p3Catalog = createP3BootstrapPolicyCatalogRepository(database);
await bindConfigSigningRing(bootstrapSigningMaterial, (keyId) =>
  p3Catalog.findSigningKey(keyId),
);
const app = createApiApp({
  config,
  isInfrastructureReady: createInfrastructureReadiness(database),
  authService: new AuthService(
    createAuthRepository(database),
    deriveAuthKeys(rootSecret),
  ),
  deviceAuthorizationService: new DeviceAuthorizationService(
    createDeviceAuthorizationRepository(database),
    deriveDeviceAuthKeys(rootSecret),
  ),
  extensionAuthService: new ExtensionAuthService(
    createExtensionAuthRepository(database),
    deriveExtensionAuthKeys(rootSecret),
    undefined,
    loadAccessTokenSigningKey(process.env),
  ),
  deviceManagementService: new DeviceManagementService(
    createDeviceManagementRepository(database),
    rootSecret,
    loadAccessTokenSigningKey(process.env),
    {
      resolve: async (accountId, at) => {
        const beta = await betaAdmission.resolve(accountId);
        if (beta.kind === "BETA")
          return { kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" as const };
        if (!commercialModeEnabled)
          return {
            kind: "INELIGIBLE" as const,
            reason: "NO_CURRENT_SUBSCRIPTION" as const,
          };
        return commercialAccess.resolveDeviceAdmission(
          accountId,
          at ?? new Date(),
        );
      },
    },
  ),
  bootstrapService: new BootstrapService(
    { resolve: (input) => resolveP3BootstrapPolicy(input, p3Catalog) },
    createConfigSigningService(bootstrapSigningMaterial, p3Catalog),
    undefined,
    commercialModeEnabled ? commercialAccess : undefined,
    new BootstrapAiResolutionService(
      createBootstrapAiResolutionRepository(database),
    ),
    betaAdmission,
  ),
  publicCommercialCatalogReader: createP4CommercialCatalogRepository(database),
  commercialPortalService: commercialPortal,
  adminAuthService: adminAuth,
  adminOpsService: new AdminOpsService(
    createAdminOpsRepository(database),
    commercialPortal,
  ),
  adminBillingService: new AdminBillingService(
    createP6AdminSubscriptionCommandAdapter(database),
    createP6AdminBillingRepository(database),
  ),
  adminCommercialService: createAdminCommercialService(
    createP6AdminCommercialReadRepository(database),
    {
      plans: createP6AdminPlanCommandAdapter(database),
      prices: createP6AdminPriceCommandAdapter(database),
      overrides: createP6AdminEntitlementCommandAdapter(database),
      compatibility: createP6AdminCompatibilityCommandAdapter(database),
    },
  ),
  adminAiService: new AdminAiService(
    createP7AdminAiReadRepository(database),
    createP7AdminAiCommandRepository(database),
    createProfileLifecycleRepository(database, {
      beforeMutation: authorizeAdminMutationInTransaction,
    }),
  ),
  betaAdmissionService: betaAdmission,
  syncService: new SyncService(
    createSyncRepository(database),
    createSyncSnapshotReader(database),
  ),
  credentialTransferService: new CredentialTransferService(
    createCredentialTransferRepository(database),
  ),
  feedbackSupportService: new FeedbackSupportService(
    createFeedbackSupportRepository(database),
  ),
  healthAdminService: createHealthAdminReadRepository(database),
  healthNotificationAdminService:
    createHealthNotificationAdminReadRepository(database),
  healthDiagnosticsService: createHealthDiagnosticsReadRepository(database),
});
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "API shutdown requested");
  await app.close();
  await database.close();
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
try {
  await app.listen({ host: "127.0.0.1", port: config.apiPort });
} catch (error) {
  closing = true;
  try {
    await app.close();
  } catch {
    // Preserve the original startup failure after bounded cleanup.
  }
  try {
    await database.close();
  } catch {
    // Preserve the original startup failure after bounded cleanup.
  }
  throw error;
}
