import {
  classifyHealthDetailed,
  deriveLlmHealthNotificationEvent,
  healthIncidentKeySha256,
  healthIncidentScopeSha256,
  isActiveIncidentStatus,
  isIncidentWorthyHealthState,
  selectRootContour,
  type LlmHealthNotificationEventKind,
  HealthContourResultSchema,
  HealthLevelSchema,
  HealthStateSchema,
  HealthSuiteDefinitionSchema,
  NoSessionObservationResultSchema,
  type BaselineContourKey,
  type HealthIncidentStatus,
  type HealthLevel,
  type LlmHealthNotificationPolicy,
} from "@product/health";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "@product/remote-config";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import {
  observeLlmHealthFailureInTransaction,
  recordLlmHealthNotificationInTransaction,
  resumeLlmHealthProductNotificationInTransaction,
  suppressLlmHealthProductNotificationsInTransaction,
} from "./health-notification-repository.js";

export type HealthIncident = {
  id: string;
  incidentScopeSha256: string;
  incidentKeySha256: string;
  status: HealthIncidentStatus;
  firstSeenRunId: string;
  latestSeenRunId: string;
  rootContourKey: BaselineContourKey | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastObservedRunId: string;
  lastObservedAt: Date;
  resolvedByRunId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HealthIncidentProcessingResult = {
  runId: string;
  action:
    | "OPENED"
    | "UPDATED"
    | "RESOLVED"
    | "MAINTENANCE"
    | "IGNORED"
    | "NOOP";
  incidentIds: readonly string[];
};

type RunRow = {
  id: string;
  runKind: "BASELINE_CONTOUR" | "NO_SESSION_OBSERVATION";
  suiteRevisionId: string | null;
  healthLevel: string;
  healthState: string;
  scope: unknown;
  scopeSha256: string;
  operatorMaintenance: boolean;
  completedAt: Date;
  browserFamily: string;
  profileId: string;
};

type SuiteRow = { definition: unknown };

type IncidentRow = {
  id: string;
  incidentScopeSha256: string;
  incidentKeySha256: string;
  status: HealthIncidentStatus;
  firstSeenRunId: string;
  latestSeenRunId: string;
  rootContourKey: BaselineContourKey | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastObservedRunId: string;
  lastObservedAt: Date;
  resolvedByRunId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ACTIVE_STATUS_SQL =
  "'OPEN','INVESTIGATING','CANDIDATE_FIX','CANDIDATE_PASS','CANARY_ROLLOUT','ROLLOUT','MAINTENANCE'";
const TERMINAL_STATUS_SQL = "'RESOLVED','FALSE_POSITIVE'";

const INCIDENT_PROJECTION = `
  SELECT id,
    incident_scope_sha256 AS "incidentScopeSha256",
    incident_key_sha256 AS "incidentKeySha256",
    status,
    first_seen_run_id AS "firstSeenRunId",
    latest_seen_run_id AS "latestSeenRunId",
    root_contour_key AS "rootContourKey",
    first_seen_at AS "firstSeenAt",
    last_seen_at AS "lastSeenAt",
    last_observed_run_id AS "lastObservedRunId",
    last_observed_at AS "lastObservedAt",
    resolved_by_run_id AS "resolvedByRunId",
    resolved_at AS "resolvedAt",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM health_incidents`;

function mapIncident(row: IncidentRow): HealthIncident {
  return { ...row };
}

function isAfter(
  at: Date,
  runId: string,
  otherAt: Date,
  otherRunId: string,
): boolean {
  const currentMs = at.valueOf();
  const otherMs = otherAt.valueOf();
  return currentMs > otherMs || (currentMs === otherMs && runId > otherRunId);
}

async function getRun(q: DatabaseQuery, runId: string): Promise<RunRow> {
  const result = await q.query<RunRow>(
    `SELECT id,run_kind AS "runKind",suite_revision_id AS "suiteRevisionId",health_level AS "healthLevel",health_state AS "healthState",scope,scope_sha256 AS "scopeSha256",operator_maintenance AS "operatorMaintenance",completed_at AS "completedAt",browser_family AS "browserFamily",profile_id AS "profileId" FROM health_runs WHERE id=$1 FOR SHARE`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("HEALTH_RUN_NOT_FOUND");
  return row;
}

async function getClassification(
  q: DatabaseQuery,
  run: RunRow,
): Promise<ReturnType<typeof classifyHealthDetailed>> {
  const suiteResult = await q.query<SuiteRow>(
    `SELECT definition FROM health_suite_revisions WHERE id=$1`,
    [run.suiteRevisionId],
  );
  const suite = suiteResult.rows[0]
    ? HealthSuiteDefinitionSchema.parse(suiteResult.rows[0].definition)
    : undefined;
  if (!suite) throw new Error("HEALTH_SUITE_REVISION_NOT_FOUND");
  const contourResult = await q.query<{ result: unknown }>(
    `SELECT result FROM health_contour_results WHERE run_id=$1 ORDER BY contour_key`,
    [run.id],
  );
  const results = contourResult.rows.map((row) =>
    HealthContourResultSchema.parse(row.result),
  );
  return classifyHealthDetailed({
    suite,
    results,
    operatorMaintenance: run.operatorMaintenance,
  });
}

function noSessionIncidentIdentity(
  run: RunRow,
  observation: ReturnType<typeof NoSessionObservationResultSchema.parse>,
  healthLevel: HealthLevel,
) {
  const identity = {
    schemaVersion: "health_no_session_incident_v1",
    provider: observation.providerId,
    surface: observation.surfaceId,
    targetKey: observation.targetKey,
    browserFamily: run.browserFamily,
    profileId: run.profileId,
    strategyId: observation.strategyId,
    healthLevel,
  };
  const digest = createHash("sha256")
    .update(canonicalizeJson(identity))
    .digest("hex");
  return { identity, digest };
}

async function activeByKey(
  q: DatabaseQuery,
  incidentKeySha256: string,
): Promise<IncidentRow | undefined> {
  const result = await q.query<IncidentRow>(
    `${INCIDENT_PROJECTION} WHERE incident_key_sha256=$1 AND status IN (${ACTIVE_STATUS_SQL}) FOR UPDATE`,
    [incidentKeySha256],
  );
  return result.rows[0];
}

async function activeByScope(
  q: DatabaseQuery,
  incidentScopeSha256: string,
): Promise<IncidentRow[]> {
  const result = await q.query<IncidentRow>(
    `${INCIDENT_PROJECTION} WHERE incident_scope_sha256=$1 AND status IN (${ACTIVE_STATUS_SQL}) ORDER BY id FOR UPDATE`,
    [incidentScopeSha256],
  );
  return result.rows;
}

async function latestTerminalByKey(
  q: DatabaseQuery,
  incidentKeySha256: string,
): Promise<IncidentRow | undefined> {
  const result = await q.query<IncidentRow>(
    `${INCIDENT_PROJECTION} WHERE incident_key_sha256=$1 AND status IN (${TERMINAL_STATUS_SQL}) ORDER BY last_observed_at DESC,last_observed_run_id DESC,id DESC LIMIT 1 FOR UPDATE`,
    [incidentKeySha256],
  );
  return result.rows[0];
}

async function insertIncident(
  q: DatabaseQuery,
  values: {
    incidentScopeSha256: string;
    healthRunScopeSha256: string;
    keySha256: string;
    runId: string;
    rootContourKey: BaselineContourKey | null;
    observedAt: Date;
  },
): Promise<IncidentRow | undefined> {
  const result = await q.query<IncidentRow>(
    `INSERT INTO health_incidents(incident_scope_sha256,incident_key_sha256,scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,first_seen_at,last_seen_at,last_observed_run_id,last_observed_at) VALUES($1,$2,$3,'OPEN',$4,$4,$5,$6,$6,$4,$6) ON CONFLICT (incident_key_sha256) WHERE status IN (${ACTIVE_STATUS_SQL}) DO NOTHING RETURNING id,incident_scope_sha256 AS "incidentScopeSha256",incident_key_sha256 AS "incidentKeySha256",status,first_seen_run_id AS "firstSeenRunId",latest_seen_run_id AS "latestSeenRunId",root_contour_key AS "rootContourKey",first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",last_observed_run_id AS "lastObservedRunId",last_observed_at AS "lastObservedAt",resolved_by_run_id AS "resolvedByRunId",resolved_at AS "resolvedAt",created_at AS "createdAt",updated_at AS "updatedAt"`,
    [
      values.incidentScopeSha256,
      values.keySha256,
      values.healthRunScopeSha256,
      values.runId,
      values.rootContourKey,
      values.observedAt,
    ],
  );
  return result.rows[0];
}

async function updateIncidentObservation(
  q: DatabaseQuery,
  incident: IncidentRow,
  run: RunRow,
  state: "FAILURE" | "MAINTENANCE" | "HEALTHY",
): Promise<"UPDATED" | "MAINTENANCE" | "RESOLVED" | "IGNORED"> {
  if (
    !isAfter(
      run.completedAt,
      run.id,
      incident.lastObservedAt,
      incident.lastObservedRunId,
    )
  ) {
    return "IGNORED";
  }

  if (state === "HEALTHY") {
    if (!isActiveIncidentStatus(incident.status)) return "IGNORED";
    if (incident.status === "OPEN" || incident.status === "MAINTENANCE") {
      await q.query(
        `UPDATE health_incidents SET status='RESOLVED',resolved_by_run_id=$2,resolved_at=$3,last_observed_run_id=$2,last_observed_at=$3,updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP) WHERE id=$1`,
        [incident.id, run.id, run.completedAt],
      );
      return "RESOLVED";
    }
    await q.query(
      `UPDATE health_incidents SET last_observed_run_id=$2,last_observed_at=$3,updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP) WHERE id=$1`,
      [incident.id, run.id, run.completedAt],
    );
    return "IGNORED";
  }

  if (state === "MAINTENANCE") {
    if (incident.status !== "OPEN" && incident.status !== "MAINTENANCE") {
      await q.query(
        `UPDATE health_incidents SET last_observed_run_id=$2,last_observed_at=$3,updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP) WHERE id=$1`,
        [incident.id, run.id, run.completedAt],
      );
      return "IGNORED";
    }
    await q.query(
      `UPDATE health_incidents SET status='MAINTENANCE',last_observed_run_id=$2,last_observed_at=$3,updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP) WHERE id=$1`,
      [incident.id, run.id, run.completedAt],
    );
    return "MAINTENANCE";
  }

  const latestFailure = isAfter(
    run.completedAt,
    run.id,
    incident.lastSeenAt,
    incident.latestSeenRunId,
  );
  await q.query(
    `UPDATE health_incidents SET status=CASE WHEN status='MAINTENANCE' THEN 'OPEN' ELSE status END,latest_seen_run_id=CASE WHEN $2::timestamptz > last_seen_at OR ($2::timestamptz = last_seen_at AND $3 > latest_seen_run_id) THEN $4 ELSE latest_seen_run_id END,last_seen_at=CASE WHEN $2::timestamptz > last_seen_at OR ($2::timestamptz = last_seen_at AND $3 > latest_seen_run_id) THEN $2 ELSE last_seen_at END,last_observed_run_id=$4,last_observed_at=$2,updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP) WHERE id=$1`,
    [incident.id, run.completedAt, run.id, run.id],
  );
  return latestFailure ? "UPDATED" : "IGNORED";
}

export function createHealthIncidentRepository(
  runtime: DatabaseRuntime,
  options: { notificationPolicy?: LlmHealthNotificationPolicy } = {},
) {
  const notificationPolicy = options.notificationPolicy;
  return {
    async processCompletedHealthRun(
      runId: string,
    ): Promise<HealthIncidentProcessingResult> {
      return runtime.transaction(async (q) => {
        const run = await getRun(q, runId);
        const persistedState = HealthStateSchema.parse(run.healthState);
        const healthLevel = HealthLevelSchema.parse(
          run.healthLevel,
        ) as HealthLevel;
        let scope: { adapterFamilyKey: string; surfaceKey: string };
        let baselineScope:
          | ReturnType<typeof HealthSuiteDefinitionSchema.parse>["scope"]
          | undefined;
        let rootContourKey: BaselineContourKey | null;
        let incidentScope: string;
        let incidentKey: string;
        if (run.runKind === "NO_SESSION_OBSERVATION") {
          const detail = await q.query<{ observation: unknown }>(
            `SELECT observation FROM health_no_session_observations WHERE run_id=$1`,
            [run.id],
          );
          const observation = NoSessionObservationResultSchema.parse(
            detail.rows[0]?.observation,
          );
          if (observation.classification !== persistedState)
            throw new Error("HEALTH_RUN_CLASSIFICATION_MISMATCH");
          scope = {
            adapterFamilyKey: observation.providerId,
            surfaceKey: observation.surfaceId,
          };
          rootContourKey = null;
          const identity = noSessionIncidentIdentity(
            run,
            observation,
            healthLevel,
          );
          incidentScope = identity.digest;
          incidentKey = identity.digest;
        } else {
          const classification = await getClassification(q, run);
          if (classification.state !== persistedState)
            throw new Error("HEALTH_RUN_CLASSIFICATION_MISMATCH");
          baselineScope = HealthSuiteDefinitionSchema.parse(
            (
              await q.query<SuiteRow>(
                `SELECT definition FROM health_suite_revisions WHERE id=$1`,
                [run.suiteRevisionId],
              )
            ).rows[0]?.definition,
          ).scope;
          scope = baselineScope;
          rootContourKey = selectRootContour(classification);
          incidentScope = healthIncidentScopeSha256(baselineScope, healthLevel);
          incidentKey = healthIncidentKeySha256(
            baselineScope,
            healthLevel,
            rootContourKey,
          );
        }
        const notificationInput = (
          incidentId: string,
          eventKind: LlmHealthNotificationEventKind,
          healthState: typeof persistedState,
          eventRootContourKey = rootContourKey,
        ) =>
          deriveLlmHealthNotificationEvent(
            {
              incidentId,
              healthRunId: run.id,
              eventKind,
              healthState,
              provider: scope.adapterFamilyKey,
              surface: scope.surfaceKey,
              healthLevel,
              rootContourKey: eventRootContourKey,
              observedAt: run.completedAt,
            },
            notificationPolicy,
          );
        if (persistedState === "UNKNOWN") {
          return { runId, action: "NOOP", incidentIds: [] };
        }

        if (persistedState === "HEALTHY") {
          const incidents = await activeByScope(q, incidentScope);
          const resolved: string[] = [];
          for (const incident of incidents) {
            const action = await updateIncidentObservation(
              q,
              incident,
              run,
              "HEALTHY",
            );
            if (action === "RESOLVED") {
              if (incident.status === "MAINTENANCE") {
                const exited = notificationInput(
                  incident.id,
                  "MAINTENANCE_EXITED",
                  "HEALTHY",
                  incident.rootContourKey,
                );
                if (exited)
                  await recordLlmHealthNotificationInTransaction(q, exited);
              }
              const recovered = notificationInput(
                incident.id,
                "INCIDENT_RECOVERED",
                "HEALTHY",
                incident.rootContourKey,
              );
              if (recovered)
                await recordLlmHealthNotificationInTransaction(q, recovered);
              resolved.push(incident.id);
            }
          }
          return {
            runId,
            action: resolved.length > 0 ? "RESOLVED" : "NOOP",
            incidentIds: resolved,
          };
        }

        if (persistedState === "MAINTENANCE") {
          const incidents = await activeByScope(q, incidentScope);
          const changed: string[] = [];
          for (const incident of incidents) {
            const action = await updateIncidentObservation(
              q,
              incident,
              run,
              "MAINTENANCE",
            );
            if (action === "MAINTENANCE") {
              if (incident.status !== "MAINTENANCE") {
                const entered = notificationInput(
                  incident.id,
                  "MAINTENANCE_ENTERED",
                  "MAINTENANCE",
                  incident.rootContourKey,
                );
                if (entered)
                  await recordLlmHealthNotificationInTransaction(q, entered);
                await suppressLlmHealthProductNotificationsInTransaction(
                  q,
                  incident.id,
                );
              }
              changed.push(incident.id);
            }
          }
          return {
            runId,
            action: changed.length > 0 ? "MAINTENANCE" : "NOOP",
            incidentIds: changed,
          };
        }

        if (!isIncidentWorthyHealthState(persistedState)) {
          return { runId, action: "NOOP", incidentIds: [] };
        }

        const active = await activeByKey(q, incidentKey);
        if (active) {
          const action = await updateIncidentObservation(
            q,
            active,
            run,
            "FAILURE",
          );
          if (action === "UPDATED") {
            if (active.status === "MAINTENANCE") {
              await resumeLlmHealthProductNotificationInTransaction(
                q,
                active.id,
                run.completedAt,
              );
              const exited = notificationInput(
                active.id,
                "MAINTENANCE_EXITED",
                persistedState,
                active.rootContourKey,
              );
              if (exited)
                await recordLlmHealthNotificationInTransaction(q, exited);
            }
            await observeLlmHealthFailureInTransaction(
              q,
              {
                incidentId: active.id,
                healthRunId: run.id,
                eventKind: "INCIDENT_OPENED",
                healthState: persistedState,
                provider: scope.adapterFamilyKey,
                surface: scope.surfaceKey,
                healthLevel,
                rootContourKey: active.rootContourKey,
                observedAt: run.completedAt,
              },
              notificationPolicy,
            );
          }
          return { runId, action, incidentIds: [active.id] };
        }

        const terminal = await latestTerminalByKey(q, incidentKey);
        if (
          terminal &&
          !isAfter(
            run.completedAt,
            run.id,
            terminal.lastObservedAt,
            terminal.lastObservedRunId,
          )
        ) {
          return { runId, action: "IGNORED", incidentIds: [terminal.id] };
        }

        const created = await insertIncident(q, {
          incidentScopeSha256: incidentScope,
          healthRunScopeSha256: run.scopeSha256,
          keySha256: incidentKey,
          runId,
          rootContourKey,
          observedAt: run.completedAt,
        });
        if (created) {
          const opened = notificationInput(
            created.id,
            "INCIDENT_OPENED",
            persistedState,
            created.rootContourKey,
          );
          if (opened) await recordLlmHealthNotificationInTransaction(q, opened);
          return { runId, action: "OPENED", incidentIds: [created.id] };
        }
        const raced = await activeByKey(q, incidentKey);
        if (!raced) throw new Error("HEALTH_INCIDENT_DEDUP_RACE_UNRESOLVED");
        const action = await updateIncidentObservation(
          q,
          raced,
          run,
          "FAILURE",
        );
        if (action === "UPDATED") {
          await observeLlmHealthFailureInTransaction(
            q,
            {
              incidentId: raced.id,
              healthRunId: run.id,
              eventKind: "INCIDENT_OPENED",
              healthState: persistedState,
              provider: scope.adapterFamilyKey,
              surface: scope.surfaceKey,
              healthLevel,
              rootContourKey: raced.rootContourKey,
              observedAt: run.completedAt,
            },
            notificationPolicy,
          );
        }
        return { runId, action, incidentIds: [raced.id] };
      });
    },

    async getIncident(id: string): Promise<HealthIncident | undefined> {
      const result = await runtime.query<IncidentRow>(
        `${INCIDENT_PROJECTION} WHERE id=$1`,
        [id],
      );
      return result.rows[0] ? mapIncident(result.rows[0]) : undefined;
    },

    async listIncidents(): Promise<HealthIncident[]> {
      const result = await runtime.query<IncidentRow>(
        `${INCIDENT_PROJECTION} ORDER BY first_seen_at,first_seen_run_id,id`,
      );
      return result.rows.map(mapIncident);
    },
  };
}
