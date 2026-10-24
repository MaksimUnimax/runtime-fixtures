import type { ApiDependencies } from "./app.js";
import { ControlledError } from "./app.js";

// Only the known read-only Health routes use these repositories. Each route's
// existing product-admin guard executes before the repository is invoked.
async function unavailable(): Promise<never> {
  throw new ControlledError(
    "SERVICE_UNAVAILABLE",
    "Health monitoring is unavailable",
    503,
  );
}

type HealthReadDependencies = Required<
  Pick<
    ApiDependencies,
    | "healthAdminService"
    | "healthNotificationAdminService"
    | "healthDiagnosticsService"
    | "healthRepairAdminService"
  >
>;

/** Never substitutes product data for a missing monitor-only read connection. */
export function createUnavailableHealthReadDependencies(): HealthReadDependencies {
  return {
    healthAdminService: {
      listTargets: unavailable,
      getTarget: unavailable,
      listIncidents: unavailable,
      getIncident: unavailable,
      listEvaluations: unavailable,
      getEvaluation: unavailable,
      listRecommendations: unavailable,
    },
    healthNotificationAdminService: {
      listNotifications: unavailable,
      getNotification: unavailable,
    },
    healthDiagnosticsService: {
      getSummary: unavailable,
      getBreakdown: unavailable,
    },
    healthRepairAdminService: {
      listCases: unavailable,
      getCase: unavailable,
    },
  };
}
