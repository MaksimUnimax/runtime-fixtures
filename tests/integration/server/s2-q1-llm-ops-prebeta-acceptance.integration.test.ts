import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASELINE_HEALTH_SUITE,
  DEFAULT_NO_SESSION_CADENCE,
  DeterministicNotificationTestSink,
  HealthContourResultSchema,
  createHealthAdminReadService,
  validateHealthSuiteDefinition,
  type HealthContourResult,
  type HealthSuiteDefinition,
} from "../../../packages/server/health/src/index.js";
import {
  createDatabaseRuntime,
  createHealthAdminReadRepository,
  createHealthDiagnosticsReadRepository,
  createHealthIncidentRepository,
  createHealthNotificationAdminReadRepository,
  createHealthNotificationRepository,
  createHealthPersistenceRepository,
  createHealthSchedulerRepository,
} from "@product/db";
import { HealthNotificationRunner } from "../../../apps/worker/src/health-notification-runner.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const schedulerA = createHealthSchedulerRepository(runtime);
const workerRuntime = createDatabaseRuntime(connectionString);
const schedulerB = createHealthSchedulerRepository(workerRuntime);
const persistence = createHealthPersistenceRepository(runtime);
const incidents = createHealthIncidentRepository(runtime);
const notifications = createHealthNotificationRepository(runtime);
const notificationAdmin = createHealthNotificationAdminReadRepository(runtime);
const admin = createHealthAdminReadService(
  createHealthAdminReadRepository(runtime),
);
const diagnostics = createHealthDiagnosticsReadRepository(
  runtime,
  () => new Date("2026-09-19T12:00:00.000Z"),
);

const IDS = {
  adapter: "e2000000-0000-4000-8000-000000000001",
  standardSurface: "e2000000-0000-4000-8000-000000000002",
  workSurface: "e2000000-0000-4000-8000-000000000003",
  standardProfile: "e2000000-0000-4000-8000-000000000004",
  workProfile: "e2000000-0000-4000-8000-000000000005",
  standardProfileRevision: "e2000000-0000-4000-8000-000000000006",
  workProfileRevision: "e2000000-0000-4000-8000-000000000007",
  schedule: "e2000000-0000-4000-8000-000000000008",
};

function id(sequence: number): string {
  return `e2000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function suiteFor(
  machineKey: string,
  surface: "standard" | "work" = "standard",
): HealthSuiteDefinition {
  const surfaceId =
    surface === "standard" ? IDS.standardSurface : IDS.workSurface;
  const profileId =
    surface === "standard" ? IDS.standardProfile : IDS.workProfile;
  const surfaceKey = surface === "standard" ? "standard" : "work";
  return validateHealthSuiteDefinition({
    ...BASELINE_HEALTH_SUITE,
    machineKey,
    scope: {
      ...BASELINE_HEALTH_SUITE.scope,
      adapterFamilyId: IDS.adapter,
      adapterFamilyKey: "chatgpt",
      surfaceId,
      surfaceKey,
      profile: { id: profileId, revision: 1 },
      healthSuite: { machineKey, revision: 1 },
    },
  });
}

function passedResults(suite: HealthSuiteDefinition): HealthContourResult[] {
  return suite.contours.map((definition) =>
    HealthContourResultSchema.parse({
      contourKey: definition.key,
      required: definition.required,
      failureSeverity: definition.failureSeverity,
      observationStatus: "PRESENT",
      primaryStrategyId: definition.primaryStrategyId,
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: definition.primaryStrategyId,
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidence: [],
    }),
  );
}

function resultsFor(
  suite: HealthSuiteDefinition,
  state: "HEALTHY" | "DRIFT" | "BROKEN" | "UNKNOWN",
  evidenceId?: string,
): HealthContourResult[] {
  const base = passedResults(suite);
  if (state === "HEALTHY") return base;
  const key = state === "UNKNOWN" ? "C13_BLOCKING_STATE" : "C05_SEND_CONTROL";
  const current = base.find((item) => item.contourKey === key);
  if (!current) throw new Error(`missing fixture contour ${key}`);
  const fallbackStrategyId = suite.contours.find((item) => item.key === key)
    ?.fallbackStrategyIds[0];
  if (state === "DRIFT" && !fallbackStrategyId)
    throw new Error(`missing fixture fallback ${key}`);
  const result =
    state === "UNKNOWN"
      ? {
          ...current,
          primaryStrategyOutcome: "UNCERTAIN" as const,
          fallbackStrategyOutcomes: [],
          selectedStrategyId: null,
          structuralOutcome: "UNCERTAIN" as const,
          behavioralOutcome: "UNCERTAIN" as const,
          environmentStatus: "UNCERTAIN" as const,
          uncertaintyReason: "CONTROLLED_BROWSER_UNAVAILABLE" as const,
        }
      : state === "DRIFT"
        ? {
            ...current,
            primaryStrategyOutcome: "FAIL" as const,
            fallbackStrategyOutcomes: [
              {
                strategyId: fallbackStrategyId!,
                outcome: "PASS" as const,
              },
            ],
            selectedStrategyId: fallbackStrategyId!,
            fallbackQuality: "APPROVED_EQUIVALENT" as const,
          }
        : {
            ...current,
            primaryStrategyOutcome: "FAIL" as const,
            fallbackStrategyOutcomes: [],
            selectedStrategyId: current.primaryStrategyId,
            structuralOutcome: "FAIL" as const,
            behavioralOutcome: "FAIL" as const,
            evidence: evidenceId
              ? [
                  {
                    evidenceId,
                    ruleId: "STATE_TRANSITION_TRACE" as const,
                    classification: "METADATA" as const,
                    sha256: null,
                    sizeBytes: null,
                  },
                ]
              : [],
          };
  if (state !== "UNKNOWN") {
    return [
      ...base.filter((item) => item.contourKey !== current.contourKey),
      HealthContourResultSchema.parse(result),
    ];
  }
  return suite.contours.map((definition) => {
    if (definition.key === "C13_BLOCKING_STATE")
      return HealthContourResultSchema.parse(result);
    const item = base.find(
      (candidate) => candidate.contourKey === definition.key,
    )!;
    return HealthContourResultSchema.parse({
      ...item,
      observationStatus: "NOT_OBSERVED",
      primaryStrategyOutcome: "NOT_ATTEMPTED",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: null,
      structuralOutcome: "NOT_RUN",
      behavioralOutcome: "NOT_RUN",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
    });
  });
}

async function persistRun(
  suite: HealthSuiteDefinition,
  completedAt: string,
  state: "HEALTHY" | "DRIFT" | "BROKEN" | "UNKNOWN",
  changes: {
    scheduledRunId?: string | null;
    operatorMaintenance?: boolean;
    operatorMaintenanceAuthority?: string | null;
    evidenceId?: string;
  } = {},
) {
  const completed = new Date(completedAt);
  return persistence.persistCompletedHealthRun({
    suite,
    results: resultsFor(suite, state, changes.evidenceId),
    operatorMaintenance: changes.operatorMaintenance ?? false,
    operatorMaintenanceAuthority: changes.operatorMaintenanceAuthority ?? null,
    healthLevel: "H3",
    classifierVersion: "s2-q1-llm-ops-fixture-v1",
    startedAt: new Date(completed.valueOf() - 1_000),
    completedAt: completed,
    scheduledRunId: changes.scheduledRunId ?? null,
  });
}

async function normalizeNotificationTimes(incidentId: string, at: string) {
  await runtime.query(
    "UPDATE health_notification_intents SET created_at=$2,updated_at=$2 WHERE incident_id=$1",
    [incidentId, new Date(at)],
  );
}

async function deliverPending(sink: DeterministicNotificationTestSink) {
  await runtime.query(
    "UPDATE health_notification_intents SET next_attempt_at=CURRENT_TIMESTAMP WHERE state='PENDING'",
  );
  const runner = new HealthNotificationRunner(runtime, sink, 60_000);
  let delivered = 0;
  while (await runner.tick("s2-q1-r1-notification-worker")) delivered += 1;
  await runner.stop();
  return delivered;
}

async function deliverIntentIds(
  sink: DeterministicNotificationTestSink,
  ids: readonly string[],
) {
  if (ids.length === 0) return;
  await runtime.query(
    `UPDATE health_notification_intents
        SET next_attempt_at=CASE WHEN id = ANY($1::uuid[]) THEN $2::timestamptz ELSE $3::timestamptz END
      WHERE state='PENDING'`,
    [
      ids,
      new Date("2026-09-19T23:00:00.000Z"),
      new Date("9999-01-01T00:00:00.000Z"),
    ],
  );
  for (const intentId of ids) {
    await makeOnlyIntentDue(intentId, "2026-09-19T23:00:00.000Z");
    const claimed = await notifications.claimDue({
      ownerId: `targeted-notification-worker:${intentId}`,
      now: new Date("2026-09-19T23:00:00.000Z"),
    });
    expect(claimed?.id).toBe(intentId);
    const receipt = await sink.deliver({
      intentId,
      idempotencyKey: claimed!.dedupKey,
      routeKey: claimed!.routeKey,
      payload: claimed!.payload,
    });
    await notifications.markDelivered({
      id: intentId,
      claimToken: claimed!.claimToken!,
      providerAdapterKey: receipt.providerAdapterKey,
      providerDeliveryId: receipt.providerDeliveryId,
    });
  }
}

async function makeOnlyIntentDue(intentId: string, at: string) {
  await runtime.query(
    `UPDATE health_notification_intents
        SET next_attempt_at=CASE WHEN id=$1 THEN $2::timestamptz ELSE $3::timestamptz END
      WHERE state='PENDING'`,
    [intentId, new Date(at), new Date("9999-01-01T00:00:00.000Z")],
  );
}

async function diagnosticCounts() {
  const rows = await runtime.query<{ state: string; count: number }>(
    `SELECT health_state AS state,count(*)::int AS count
       FROM health_runs
      WHERE completed_at >= $1 AND completed_at < $2
      GROUP BY health_state`,
    [
      new Date("2026-09-18T12:00:00.000Z"),
      new Date("2026-09-19T12:00:00.000Z"),
    ],
  );
  return Object.fromEntries(rows.rows.map((row) => [row.state, row.count]));
}

describe.sequential("S2-Q1 bounded LLM+Ops pre-beta acceptance", () => {
  beforeAll(async () => {
    await runtime.ready();
    await workerRuntime.ready();
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
    await runtime.query(
      `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','ChatGPT fixture')`,
      [IDS.adapter],
    );
    await runtime.query(
      `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','ChatGPT Standard fixture'),($3,$2,'work','ChatGPT Work fixture')`,
      [IDS.standardSurface, IDS.adapter, IDS.workSurface],
    );
    await runtime.query(
      `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'s2_q1_standard_profile','S2-Q1 Standard'),($4,$2,$5,'s2_q1_work_profile','S2-Q1 Work')`,
      [
        IDS.standardProfile,
        IDS.adapter,
        IDS.standardSurface,
        IDS.workProfile,
        IDS.workSurface,
      ],
    );
    await runtime.query(
      `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$7),($5,$6,$3,$8,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$7)`,
      [
        IDS.standardProfileRevision,
        IDS.standardProfile,
        IDS.adapter,
        IDS.standardSurface,
        IDS.workProfileRevision,
        IDS.workProfile,
        "0".repeat(64),
        IDS.workSurface,
      ],
    );
  });

  afterAll(async () => {
    await Promise.all([runtime.close(), workerRuntime.close()]);
  });

  it("materializes one due run, survives scheduler takeover, and opens/delivers one incident", async () => {
    const suite = suiteFor("s2_q1_open_e2e");
    const due = new Date("2026-09-19T08:00:00.000Z");
    await schedulerA.createSchedule({
      scheduleId: IDS.schedule,
      monitorTarget: "s2_q1_llm_target",
      provider: "chatgpt",
      surface: "CHATGPT_STANDARD",
      probeLayer: "NO_SESSION",
      enabled: true,
      cadence: DEFAULT_NO_SESSION_CADENCE,
      nextDueAt: due,
      revision: 1,
    });
    const [left, right] = await Promise.all([
      schedulerA.materializeDueSlot(IDS.schedule, due),
      schedulerB.materializeDueSlot(IDS.schedule, due),
    ]);
    const materialized = left ?? right;
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect(materialized).toBeDefined();

    const firstClaim = await schedulerA.claimNext({
      ownerId: "scheduler-a",
      now: due,
      leaseMs: 1_000,
    });
    expect(firstClaim?.id).toBe(materialized?.id);
    const later = new Date("2026-09-19T08:00:02.000Z");
    const recoveredClaim = await schedulerB.claimNext({
      ownerId: "scheduler-b-restart",
      now: later,
      leaseMs: 10_000,
    });
    expect(recoveredClaim?.id).toBe(materialized?.id);
    await expect(
      schedulerA.finishSuccess({
        runId: materialized!.id,
        ownerId: "scheduler-a",
        leaseId: firstClaim!.leaseId!,
        now: later,
        healthRunId: id(100),
        healthState: "BROKEN",
      }),
    ).rejects.toThrow("STALE_OWNER");
    const started = await schedulerB.startRun({
      runId: materialized!.id,
      ownerId: "scheduler-b-restart",
      leaseId: recoveredClaim!.leaseId!,
      now: later,
    });

    const run = await persistRun(suite, "2026-09-19T08:00:03.000Z", "BROKEN", {
      scheduledRunId: materialized!.id,
      evidenceId: id(900),
    });
    const finished = await schedulerB.finishSuccess({
      runId: materialized!.id,
      ownerId: "scheduler-b-restart",
      leaseId: started.leaseId!,
      now: new Date("2026-09-19T08:00:04.000Z"),
      healthRunId: run.id,
      healthState: run.healthState,
    });
    expect(finished.state).toBe("SUCCEEDED");

    const processed = await incidents.processCompletedHealthRun(run.id);
    expect(processed.action).toBe("OPENED");
    const incidentId = processed.incidentIds[0]!;
    await normalizeNotificationTimes(incidentId, "2026-09-19T08:00:03.000Z");
    const pending = (await notifications.listIntents()).filter(
      (item) => item.incidentId === incidentId,
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      eventKind: "INCIDENT_OPENED",
      severity: "CRITICAL",
      state: "PENDING",
      groupCount: 1,
    });

    const sink = new DeterministicNotificationTestSink();
    expect(await deliverPending(sink)).toBe(1);
    expect(sink.deliveries.size).toBe(1);
    const delivered = (await notifications.listIntents()).find(
      (item) => item.id === pending[0]!.id,
    );
    expect(delivered?.state).toBe("DELIVERED");

    const target = await admin.getTarget(run.scopeSha256);
    const incident = await admin.getIncident(incidentId);
    const notification = await notificationAdmin.getNotification(
      pending[0]!.id,
    );
    const summary = await diagnostics.getSummary({
      window: "24h",
      provider: "chatgpt",
      surface: "standard",
    });
    expect(target).toMatchObject({
      targetId: run.scopeSha256,
      provider: "chatgpt",
      surface: "standard",
      latestHealthState: "BROKEN",
      activeIncidentId: incidentId,
    });
    expect(incident).toMatchObject({ id: incidentId, status: "OPEN" });
    expect(notification).toMatchObject({
      id: pending[0]!.id,
      state: "DELIVERED",
      incident: { id: incidentId, status: "OPEN" },
      sourceHealth: { healthState: "BROKEN" },
    });
    expect(summary.currentTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: run.scopeSha256,
          latestHealthState: "BROKEN",
          activeIncidentCount: 1,
          latestNotificationState: "DELIVERED",
        }),
      ]),
    );
    expect(
      summary.stateCounts.find((item) => item.state === "BROKEN")?.count,
    ).toBe((await diagnosticCounts()).BROKEN);
  });

  it("reuses an episode, groups repeated failures, escalates once, and rejects stale weaker observations", async () => {
    const repeatedSuite = suiteFor("s2_q1_repeated_failures");
    const first = await persistRun(
      repeatedSuite,
      "2026-09-19T08:10:00.000Z",
      "BROKEN",
    );
    const second = await persistRun(
      repeatedSuite,
      "2026-09-19T08:11:00.000Z",
      "BROKEN",
    );
    const third = await persistRun(
      repeatedSuite,
      "2026-09-19T08:12:00.000Z",
      "BROKEN",
    );
    const opened = await incidents.processCompletedHealthRun(first.id);
    const incidentId = opened.incidentIds[0]!;
    expect((await incidents.processCompletedHealthRun(second.id)).action).toBe(
      "UPDATED",
    );
    expect((await incidents.processCompletedHealthRun(third.id)).action).toBe(
      "UPDATED",
    );
    const repeated = (await notifications.listIntents()).filter(
      (item) => item.incidentId === incidentId,
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({
      eventKind: "INCIDENT_OPENED",
      groupCount: 3,
      suppressionReason: "COOLDOWN",
      state: "PENDING",
    });
    const sink = new DeterministicNotificationTestSink();
    await deliverIntentIds(
      sink,
      repeated.map((item) => item.id),
    );
    expect(sink.deliveries.size).toBe(1);

    const escalationSuite = suiteFor("s2_q1_escalation");
    const drift = await persistRun(
      escalationSuite,
      "2026-09-19T09:00:00.000Z",
      "DRIFT",
    );
    const broken = await persistRun(
      escalationSuite,
      "2026-09-19T09:01:00.000Z",
      "BROKEN",
    );
    const staleDrift = await persistRun(
      escalationSuite,
      "2026-09-19T09:00:30.000Z",
      "DRIFT",
    );
    const driftOpened = await incidents.processCompletedHealthRun(drift.id);
    const escalationIncidentId = driftOpened.incidentIds[0]!;
    expect((await incidents.processCompletedHealthRun(broken.id)).action).toBe(
      "UPDATED",
    );
    expect(
      (await incidents.processCompletedHealthRun(staleDrift.id)).action,
    ).toBe("IGNORED");
    const escalationIntents = (await notifications.listIntents()).filter(
      (item) => item.incidentId === escalationIncidentId,
    );
    expect(escalationIntents.map((item) => item.eventKind)).toEqual([
      "INCIDENT_OPENED",
      "INCIDENT_ESCALATED",
    ]);
    expect(
      escalationIntents.filter(
        (item) => item.eventKind === "INCIDENT_ESCALATED",
      ),
    ).toHaveLength(1);
    expect(
      escalationIntents.find((item) => item.eventKind === "INCIDENT_ESCALATED"),
    ).toMatchObject({
      severity: "CRITICAL",
      groupCount: 1,
    });
    const current = await incidents.getIncident(escalationIncidentId);
    expect(current?.lastObservedRunId).toBe(broken.id);
  });

  it("resolves once, delivers recovery, and creates a new post-recovery episode", async () => {
    const suite = suiteFor("s2_q1_recovery");
    const failure = await persistRun(
      suite,
      "2026-09-19T09:30:00.000Z",
      "BROKEN",
    );
    const healthy = await persistRun(
      suite,
      "2026-09-19T09:31:00.000Z",
      "HEALTHY",
    );
    const newFailure = await persistRun(
      suite,
      "2026-09-19T09:32:00.000Z",
      "BROKEN",
    );
    const opened = await incidents.processCompletedHealthRun(failure.id);
    const oldIncidentId = opened.incidentIds[0]!;
    expect((await incidents.processCompletedHealthRun(healthy.id)).action).toBe(
      "RESOLVED",
    );
    expect((await incidents.processCompletedHealthRun(healthy.id)).action).toBe(
      "NOOP",
    );
    const reopened = await incidents.processCompletedHealthRun(newFailure.id);
    const newIncidentId = reopened.incidentIds[0]!;
    expect(newIncidentId).not.toBe(oldIncidentId);
    const oldIncident = await incidents.getIncident(oldIncidentId);
    const newIncident = await incidents.getIncident(newIncidentId);
    expect(oldIncident).toMatchObject({
      status: "RESOLVED",
      firstSeenRunId: failure.id,
      resolvedByRunId: healthy.id,
    });
    expect(newIncident).toMatchObject({
      status: "OPEN",
      firstSeenRunId: newFailure.id,
    });
    const intents = (await notifications.listIntents()).filter(
      (item) =>
        item.incidentId === oldIncidentId || item.incidentId === newIncidentId,
    );
    expect(intents.map((item) => item.eventKind)).toEqual([
      "INCIDENT_OPENED",
      "INCIDENT_RECOVERED",
      "INCIDENT_OPENED",
    ]);
    const sink = new DeterministicNotificationTestSink();
    await deliverIntentIds(
      sink,
      intents.map((item) => item.id),
    );
    expect(sink.deliveries.size).toBe(3);
    expect((await admin.getIncident(oldIncidentId))?.status).toBe("RESOLVED");
    expect(
      (await diagnostics.getSummary({ window: "24h" })).currentTargets.find(
        (item) => item.targetId === newFailure.scopeSha256,
      ),
    ).toMatchObject({ latestHealthState: "BROKEN", activeIncidentCount: 1 });
  });

  it("suppresses maintenance, preserves visibility, resumes without duplicate OPEN, and keeps UNKNOWN truthful", async () => {
    const suite = suiteFor("s2_q1_maintenance");
    const failure = await persistRun(
      suite,
      "2026-09-19T10:00:00.000Z",
      "BROKEN",
    );
    const maintenance = await persistRun(
      suite,
      "2026-09-19T10:01:00.000Z",
      "BROKEN",
      {
        operatorMaintenance: true,
        operatorMaintenanceAuthority: "s2-q1-fixture-operator",
      },
    );
    const persistentFailure = await persistRun(
      suite,
      "2026-09-19T10:02:00.000Z",
      "BROKEN",
    );
    const opened = await incidents.processCompletedHealthRun(failure.id);
    const incidentId = opened.incidentIds[0]!;
    expect(
      (await incidents.processCompletedHealthRun(maintenance.id)).action,
    ).toBe("MAINTENANCE");
    const duringMaintenance = await diagnostics.getSummary({ window: "24h" });
    expect(
      duringMaintenance.stateCounts.find((item) => item.state === "MAINTENANCE")
        ?.count,
    ).toBe((await diagnosticCounts()).MAINTENANCE);
    const suppressed = (await notifications.listIntents()).filter(
      (item) => item.incidentId === incidentId,
    );
    expect(suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "INCIDENT_OPENED",
          state: "SUPPRESSED",
          suppressionReason: "MAINTENANCE_ENTERED",
        }),
        expect.objectContaining({ eventKind: "MAINTENANCE_ENTERED" }),
      ]),
    );
    expect(
      (await incidents.processCompletedHealthRun(persistentFailure.id)).action,
    ).toBe("UPDATED");
    const resumed = (await notifications.listIntents()).filter(
      (item) => item.incidentId === incidentId,
    );
    expect(
      resumed.filter((item) => item.eventKind === "INCIDENT_OPENED"),
    ).toHaveLength(1);
    expect(
      resumed.find((item) => item.eventKind === "INCIDENT_OPENED"),
    ).toMatchObject({
      state: "PENDING",
      suppressionReason: "COOLDOWN",
    });

    const unknownSuite = suiteFor("s2_q1_unknown", "work");
    const unknown = await persistRun(
      unknownSuite,
      "2026-09-19T10:03:00.000Z",
      "UNKNOWN",
    );
    expect((await incidents.processCompletedHealthRun(unknown.id)).action).toBe(
      "NOOP",
    );
    expect(
      (await incidents.listIncidents()).some(
        (item) => item.firstSeenRunId === unknown.id,
      ),
    ).toBe(false);
    expect(
      (await notifications.listIntents()).some(
        (item) => item.healthRunId === unknown.id,
      ),
    ).toBe(false);
    const unknownTarget = await admin.getTarget(unknown.scopeSha256);
    expect(unknownTarget).toMatchObject({
      provider: "chatgpt",
      surface: "work",
      latestHealthState: "UNKNOWN",
      activeIncidentId: null,
    });
    const summary = await diagnostics.getSummary({ window: "24h" });
    expect(summary.currentTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: unknown.scopeSha256,
          latestHealthState: "UNKNOWN",
          activeIncidentCount: 0,
        }),
      ]),
    );
    const breakdown = await diagnostics.getBreakdown({ window: "24h" });
    expect(breakdown).not.toHaveProperty("privateEvidenceBytes");
    expect(breakdown).not.toHaveProperty("rawEvidence");
    expect(
      (await notificationAdmin.listNotifications({ limit: 50 })).items,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          incidentId: expect.any(String),
          provider: "chatgpt",
          surface: "work",
        }),
      ]),
    );
  });

  it("replays notification crash windows with internal dedup and stable sink idempotency", async () => {
    const sink = new DeterministicNotificationTestSink();
    const cases = [
      ["s2_q1_notify_before_call", "2026-09-19T10:10:00.000Z"],
      ["s2_q1_notify_transient", "2026-09-19T10:20:00.000Z"],
      ["s2_q1_notify_success_crash", "2026-09-19T10:30:00.000Z"],
    ] as const;
    const runIds: string[] = [];
    for (const [machineKey, at] of cases) {
      const run = await persistRun(suiteFor(machineKey), at, "BROKEN");
      const opened = await incidents.processCompletedHealthRun(run.id);
      runIds.push(run.id);
      await normalizeNotificationTimes(opened.incidentIds[0]!, at);
    }
    const intents = (await notifications.listIntents()).filter((item) =>
      runIds.includes(item.healthRunId),
    );
    expect(intents).toHaveLength(3);

    const beforeCall = intents[0]!;
    await makeOnlyIntentDue(beforeCall.id, "2026-09-19T10:31:00.000Z");
    const firstClaim = await notifications.claimDue({
      ownerId: "notify-before-call",
      now: new Date("2026-09-19T10:31:00.000Z"),
      leaseMs: 1_000,
    });
    expect(firstClaim?.id).toBe(beforeCall.id);
    const reclaimed = await notifications.claimDue({
      ownerId: "notify-after-crash",
      now: new Date("2026-09-19T10:31:02.000Z"),
    });
    expect(reclaimed?.id).toBe(beforeCall.id);
    const beforeReceipt = await sink.deliver({
      intentId: reclaimed!.id,
      idempotencyKey: reclaimed!.dedupKey,
      routeKey: reclaimed!.routeKey,
      payload: reclaimed!.payload,
    });
    await notifications.markDelivered({
      id: reclaimed!.id,
      claimToken: reclaimed!.claimToken!,
      providerAdapterKey: beforeReceipt.providerAdapterKey,
      providerDeliveryId: beforeReceipt.providerDeliveryId,
    });

    const transient = intents[1]!;
    await makeOnlyIntentDue(transient.id, "2026-09-19T10:31:00.000Z");
    const transientClaim = await notifications.claimDue({
      ownerId: "notify-transient",
      now: new Date("2026-09-19T10:31:00.000Z"),
    });
    expect(transientClaim?.id).toBe(transient.id);
    await notifications.failClaim({
      id: transient.id,
      claimToken: transientClaim!.claimToken!,
      code: "TRANSIENT_PROVIDER_FAILURE",
      now: new Date("2026-09-19T10:31:00.000Z"),
    });
    await runtime.query(
      "UPDATE health_notification_intents SET next_attempt_at=$2 WHERE id=$1",
      [transient.id, new Date("2026-09-19T10:32:00.000Z")],
    );
    const transientRetry = await notifications.claimDue({
      ownerId: "notify-transient-retry",
      now: new Date("2026-09-19T10:32:00.000Z"),
    });
    expect(transientRetry?.id).toBe(transient.id);
    const transientReceipt = await sink.deliver({
      intentId: transient.id,
      idempotencyKey: transient.dedupKey,
      routeKey: transient.routeKey,
      payload: transient.payload,
    });
    await notifications.markDelivered({
      id: transient.id,
      claimToken: transientRetry!.claimToken!,
      providerAdapterKey: transientReceipt.providerAdapterKey,
      providerDeliveryId: transientReceipt.providerDeliveryId,
    });

    const successCrash = intents[2]!;
    await makeOnlyIntentDue(successCrash.id, "2026-09-19T10:31:00.000Z");
    const successClaim = await notifications.claimDue({
      ownerId: "notify-success-crash",
      now: new Date("2026-09-19T10:31:00.000Z"),
      leaseMs: 1_000,
    });
    expect(successClaim?.id).toBe(successCrash.id);
    const firstReceipt = await sink.deliver({
      intentId: successCrash.id,
      idempotencyKey: successCrash.dedupKey,
      routeKey: successCrash.routeKey,
      payload: successCrash.payload,
    });
    const replayClaim = await notifications.claimDue({
      ownerId: "notify-success-replay",
      now: new Date("2026-09-19T10:31:02.000Z"),
    });
    const replayReceipt = await sink.deliver({
      intentId: successCrash.id,
      idempotencyKey: successCrash.dedupKey,
      routeKey: successCrash.routeKey,
      payload: successCrash.payload,
    });
    expect(replayReceipt).toEqual(firstReceipt);
    await notifications.markDelivered({
      id: successCrash.id,
      claimToken: replayClaim!.claimToken!,
      providerAdapterKey: replayReceipt.providerAdapterKey,
      providerDeliveryId: replayReceipt.providerDeliveryId,
    });
    expect(sink.deliveries.size).toBe(3);
    expect(
      (await notifications.listIntents())
        .filter((item) => intents.some((source) => source.id === item.id))
        .every((item) => item.state === "DELIVERED"),
    ).toBe(true);
  });

  it("keeps evaluation/recommendation reads advisory and does not expose product mutation authority", async () => {
    const before = await runtime.query<{
      releases: string;
      assignments: string;
    }>(
      "SELECT (SELECT count(*)::text FROM config_releases) AS releases,(SELECT count(*)::text FROM adapter_profile_assignments) AS assignments",
    );
    expect((await admin.listEvaluations({ limit: 50 })).items).toBeInstanceOf(
      Array,
    );
    expect(
      (await admin.listRecommendations({ limit: 50 })).items,
    ).toBeInstanceOf(Array);
    expect(Object.keys(admin)).not.toEqual(
      expect.arrayContaining([
        "publishProfileRevision",
        "startRollout",
        "rollbackProfileAssignment",
      ]),
    );
    const after = await runtime.query<{
      releases: string;
      assignments: string;
    }>(
      "SELECT (SELECT count(*)::text FROM config_releases) AS releases,(SELECT count(*)::text FROM adapter_profile_assignments) AS assignments",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
