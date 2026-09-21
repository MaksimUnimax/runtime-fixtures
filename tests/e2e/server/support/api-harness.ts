import { createHash } from "node:crypto";
import {
  createAuthRepository,
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  createDeviceManagementRepository,
  createExtensionAuthRepository,
  createAdminAuthRepository,
  createAdminOpsRepository,
  createBootstrapAiResolutionRepository,
  createP6AdminBillingRepository,
  createP6AdminSubscriptionCommandAdapter,
  createP6AdminCommercialReadRepository,
  createP6AdminPlanCommandAdapter,
  createP6AdminPriceCommandAdapter,
  createP6AdminEntitlementCommandAdapter,
  createP6AdminCompatibilityCommandAdapter,
  createP3BootstrapPolicyCatalogRepository,
  createP4EntitlementRepository,
  createP5CommercialPortalRepository,
  createP5SubscriptionAccessResolver,
  createP5SubscriptionRepository,
  createP7AdminAiReadRepository,
  createP7AdminAiCommandRepository,
  createProfileLifecycleRepository,
  authorizeAdminMutationInTransaction,
  createBetaAdmissionRepository,
} from "@product/db";
import { AuthService, deriveAuthKeys } from "@product/auth";
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
import { DeviceManagementService } from "@product/device-management";
import {
  CommercialAccessService,
  CommercialPortalService,
} from "../../../../packages/server/commercial-access/src/index.js";
import {
  ExtensionAuthService,
  deriveExtensionAuthKeys,
} from "@product/extension-auth";
import { loadConfig } from "@product/shared";
import { createApiApp } from "../../../../apps/api/src/app.js";
import { createInfrastructureReadiness } from "../../../../apps/api/src/infrastructure.js";
import {
  BootstrapAiResolutionService,
  BootstrapService,
} from "../../../../packages/server/bootstrap/src/index.js";
import { resolveP3BootstrapPolicy } from "../../../../packages/server/remote-config/src/index.js";
import {
  bindConfigSigningRing,
  createConfigSigningService,
  loadConfigSigningMaterial,
} from "../../../../apps/api/src/bootstrap-signing.js";
import { assertE2eDatabase } from "./database.js";
import {
  TEST_ONLY_ACCESS_TOKEN_SIGNING_KEY,
  TEST_ONLY_AUTH_ROOT,
} from "./auth-material.js";

assertE2eDatabase();
const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  API_PORT: process.env.API_PORT ?? "3100",
});
const database = createDatabaseRuntime(config.databaseUrl);
const root = TEST_ONLY_AUTH_ROOT;
const signingKey = TEST_ONLY_ACCESS_TOKEN_SIGNING_KEY;
const auth = new AuthService(
  createAuthRepository(database),
  deriveAuthKeys(root),
  undefined,
  () => "424242",
);
let app: ReturnType<typeof createApiApp> | undefined;
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await app?.close();
  await database.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
async function main(): Promise<void> {
  try {
    const bootstrapSigningMaterial = loadConfigSigningMaterial(process.env);
    const p3Catalog = createP3BootstrapPolicyCatalogRepository(database);
    // The only key material persisted in the disposable database is the derived
    // public SPKI and fingerprint. This is the same binding production performs.
    // The guarded disposable database may contain metadata from a prior
    // Playwright process. Reset it before binding this run's new identity.
    await database.query("TRUNCATE signing_keys CASCADE");
    for (const entry of bootstrapSigningMaterial.keys.values())
      await database.query(
        "INSERT INTO signing_keys(key_id,algorithm,public_key_spki_der,public_key_sha256) VALUES($1,'Ed25519',$2,$3)",
        [
          entry.keyId,
          entry.publicKeySpkiDer,
          createHash("sha256").update(entry.publicKeySpkiDer).digest("hex"),
        ],
      );
    await bindConfigSigningRing(bootstrapSigningMaterial, (keyId) =>
      p3Catalog.findSigningKey(keyId),
    );
    const subscriptionRepository = createP5SubscriptionRepository(database);
    const betaAdmission = new BetaAdmissionService(
      createBetaAdmissionRepository(database),
    );
    const adminAuth = new AdminAuthService(
      createAdminAuthRepository(database),
      deriveAdminAuthKeys(root),
    );
    const commercialAccess = new CommercialAccessService({
      accessResolver: createP5SubscriptionAccessResolver(
        subscriptionRepository,
      ),
      currentSubscriptionReader: subscriptionRepository,
      entitlementResolver: createP4EntitlementRepository(database),
    });
    app = createApiApp({
      config,
      isInfrastructureReady: createInfrastructureReadiness(database),
      authService: auth,
      deviceAuthorizationService: new DeviceAuthorizationService(
        createDeviceAuthorizationRepository(database),
        deriveDeviceAuthKeys(root),
      ),
      extensionAuthService: new ExtensionAuthService(
        createExtensionAuthRepository(database),
        deriveExtensionAuthKeys(root),
        undefined,
        signingKey,
      ),
      deviceManagementService: new DeviceManagementService(
        createDeviceManagementRepository(database),
        root,
        signingKey,
        {
          resolve: async (accountId, at) => {
            const beta = await betaAdmission.resolve(accountId);
            if (beta.kind === "BETA")
              return { kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" as const };
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
        commercialAccess,
        new BootstrapAiResolutionService(
          createBootstrapAiResolutionRepository(database),
        ),
        betaAdmission,
      ),
      commercialPortalService: new CommercialPortalService(
        createP5CommercialPortalRepository(database),
        commercialAccess,
        undefined,
        betaAdmission,
      ),
      adminAuthService: adminAuth,
      adminOpsService: new AdminOpsService(
        createAdminOpsRepository(database),
        new CommercialPortalService(
          createP5CommercialPortalRepository(database),
          commercialAccess,
          undefined,
          betaAdmission,
        ),
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
    });
    await app.listen({ host: "127.0.0.1", port: config.apiPort });
  } catch (error) {
    await close();
    throw error;
  }
}
void main();
