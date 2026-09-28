import type { HealthState, LlmHealthNotificationPolicy } from "@product/health";
import type { DatabaseRuntime } from "./index.js";
import {
  createHealthIncidentRepository,
  type HealthIncidentProcessingResult,
} from "./health-incident-repository.js";
import { createHealthNoSessionPersistenceRepository } from "./health-no-session-persistence-repository.js";
import { markNoSessionIncidentProcessed } from "./health-retention-repository.js";

export type NoSessionHealthCompletionResult = Readonly<{
  scheduledRunId: string;
  healthRunId: string;
  healthState: HealthState;
  incident: HealthIncidentProcessingResult;
}>;

export function createHealthNoSessionCompletionAdapter(
  runtime: DatabaseRuntime,
  options: { notificationPolicy?: LlmHealthNotificationPolicy } = {},
) {
  const persistence = createHealthNoSessionPersistenceRepository(runtime);
  const incidents = createHealthIncidentRepository(runtime, options);

  return {
    async completeScheduledNoSessionHealthRun(
      input: unknown,
    ): Promise<NoSessionHealthCompletionResult> {
      const persisted =
        await persistence.persistCompletedNoSessionHealthRun(input);
      const alreadyProcessed =
        persisted.payloadPruned || persisted.incidentProcessed;
      const incident = alreadyProcessed
        ? ({
            runId: persisted.healthRunId,
            action: "NOOP",
            incidentIds: [],
          } satisfies HealthIncidentProcessingResult)
        : await incidents.processCompletedHealthRun(persisted.healthRunId);
      if (!alreadyProcessed) {
        await markNoSessionIncidentProcessed(
          runtime,
          persisted.healthRunId,
          new Date(),
        );
      }
      return {
        scheduledRunId: persisted.scheduledRunId,
        healthRunId: persisted.healthRunId,
        healthState: persisted.healthState,
        incident,
      };
    },
  };
}
