import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";
export { createAuthRepository } from "./auth-repository.js";
export { createAdminAuthRepository } from "./p6-admin-auth-repository.js";
export { createDeviceAuthorizationRepository } from "./device-authorization-repository.js";
export { createExtensionAuthRepository } from "./extension-auth-repository.js";
export { createDeviceManagementRepository } from "./device-management-repository.js";
export { createAdminOpsRepository } from "./p6-admin-ops-repository.js";
export { createP6AdminBillingRepository } from "./p6-admin-billing-repository.js";
export { createP6AdminSubscriptionCommandAdapter } from "./p6-admin-subscription-command-adapter.js";
export { createP5CommercialPortalRepository } from "./p5-commercial-portal-repository.js";
export { createCompatibilityCatalogRepository } from "./compatibility-catalog-repository.js";
export { createRemoteConfigCatalogRepository } from "./remote-config-catalog-repository.js";
export { createP3PolicyPublicationRepository } from "./p3-policy-publication-repository.js";
export { createP3BootstrapPolicyCatalogRepository } from "./p3-bootstrap-policy-catalog-repository.js";
export { createP4PlanCommandRepository } from "./p4-plan-command-repository.js";
export { createP4PriceCommandRepository } from "./p4-price-command-repository.js";
export { createP4EntitlementRepository } from "./p4-entitlement-repository.js";
export { createP4CommercialCatalogRepository } from "./p4-commercial-catalog-repository.js";
export { createP6AdminCommercialReadRepository } from "./p6-admin-commercial-read-repository.js";
export { createAdapterRegistryCatalogRepository } from "./adapter-registry-repository.js";
export { createProfileLifecycleRepository } from "./p7-profile-lifecycle-repository.js";
export { createHealthPersistenceRepository } from "./health-persistence-repository.js";
export { createHealthSchedulerRepository } from "./health-scheduler-repository.js";
export { createHealthIncidentRepository } from "./health-incident-repository.js";
export {
  createHealthNotificationRepository,
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_LEASE_MS,
  recordLlmHealthNotificationInTransaction,
  observeLlmHealthFailureInTransaction,
  suppressLlmHealthProductNotificationsInTransaction,
  resumeLlmHealthProductNotificationInTransaction,
} from "./health-notification-repository.js";
export { createHealthEvaluationRepository } from "./health-evaluation-repository.js";
export { createHealthAdminReadRepository } from "./health-admin-read-repository.js";
export { createHealthNotificationAdminReadRepository } from "./health-notification-admin-read-repository.js";
export type {
  PersistedHealthProfileEvaluation,
  UpsertHealthProfileEvaluationResult,
} from "./health-evaluation-repository.js";
export type {
  HealthIncident,
  HealthIncidentProcessingResult,
} from "./health-incident-repository.js";
export type {
  HealthNotificationIntent,
  HealthNotificationRepository,
  NotificationDeliveryFailureCode,
} from "./health-notification-repository.js";
export { createBetaAdmissionRepository } from "./beta-admission-repository.js";
export { createBootstrapAiResolutionRepository } from "./bootstrap-ai-resolution-repository.js";
export { createP7AdminAiReadRepository } from "./p7-admin-ai-read-repository.js";
export { createP7AdminAiCommandRepository } from "./p7-admin-ai-command-repository.js";
export { authorizeAdminMutationInTransaction } from "./admin-mutation-authorization.js";
export type { P7MutationAuthorizationHook } from "./p7-profile-lifecycle-repository.js";
export {
  createP6AdminPlanCommandAdapter,
  createP6AdminPriceCommandAdapter,
  createP6AdminEntitlementCommandAdapter,
  createP6AdminCompatibilityCommandAdapter,
} from "./p6-admin-commercial-command-adapters.js";
export {
  createP5SubscriptionAccessResolver,
  createP5SubscriptionRepository,
  type P5SubscriptionRepository,
} from "./p5-subscription-repository.js";
export { createP5CheckoutRepository } from "./p5-checkout-repository.js";
export { createP5BillingEventRepository } from "./p5-billing-event-repository.js";
export { createP5ReconciliationRepository } from "./p5-reconciliation-repository.js";
export {
  createP5SubscriptionLifecycleRepository,
  type SubscriptionLifecycleJobRepository,
  type SubscriptionLifecycleProcessSummary,
} from "./p5-subscription-lifecycle-repository.js";

export interface DatabaseRuntime {
  db: NodePgDatabase<typeof schema>;
  ready(): Promise<void>;
  close(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(
    operation: (transaction: DatabaseQuery) => Promise<T>,
  ): Promise<T>;
}

export interface DatabaseQuery {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function createDatabaseRuntime(
  connectionString: string,
): DatabaseRuntime {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle({ client: pool, schema }),
    ready: async () => {
      await pool.query("SELECT 1");
    },
    close: () => pool.end(),
    query: (text, values) => pool.query(text, values),
    transaction: async <T>(
      operation: (transaction: DatabaseQuery) => Promise<T>,
    ) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await operation({
          query: (text, values) => client.query(text, values),
        });
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export const createDatabaseConnection = createDatabaseRuntime;
