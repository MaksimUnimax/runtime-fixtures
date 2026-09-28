import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateProfileContent } from "../../../packages/server/adapter-registry/src/index.js";
import {
  BASELINE_HEALTH_SUITE,
  DEFAULT_NO_SESSION_CADENCE,
  HealthSuiteDefinitionSchema,
  runDurableHealthSchedulerCycle,
  type HealthSuiteDefinition,
} from "../../../packages/server/health/src/index.js";
import {
  createDatabaseRuntime,
  createHealthAuthenticatedDeepScopeRepository,
  createHealthIncidentRepository,
  createHealthPersistenceRepository,
  createHealthSchedulerRepository,
  createProfileLifecycleRepository,
} from "@product/db";
import { runMigrations } from "@product/db/migrations";
import {
  createH3HealthPersistenceCommand,
  type H3HealthPersistenceContext,
} from "../../../apps/health-runner/src/h3-health-persistence.js";
import { H3ExecutionResultSchema } from "../../../apps/health-runner/src/h3-engine.js";
import {
  H3ContourObservationSchema,
  type H3ContourObservation,
} from "../../../apps/health-runner/src/h3-strategy.js";
import type { H3SafeEvidenceEvent } from "../../../apps/health-runner/src/evidence-sanitizer.js";
import type { H3BehaviorStep } from "../../../apps/health-runner/src/h3-contracts.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "b1300000-0000-4000-8000-000000000001",
  standardSurface: "b1300000-0000-4000-8000-000000000002",
  workSurface: "b1300000-0000-4000-8000-000000000003",
  standardProfile: "b1300000-0000-4000-8000-000000000004",
  workProfile: "b1300000-0000-4000-8000-000000000005",
  standardRevision: "b1300000-0000-4000-8000-000000000006",
  workRevision: "b1300000-0000-4000-8000-000000000007",
  recoverySchedule: "b1300000-0000-4000-8000-00000000000c",
  terminalRecoverySchedule: "b1300000-0000-4000-8000-00000000000d",
} as const;

const runtime = createDatabaseRuntime(connectionString);
const resolver = createHealthAuthenticatedDeepScopeRepository(runtime);
const persistence = createHealthPersistenceRepository(runtime);
const scheduler = createHealthSchedulerRepository(runtime);
const lifecycle = createProfileLifecycleRepository(runtime);

function profileDefinition(
  browserFamilies: ("chrome" | "firefox")[] = ["chrome"],
) {
  const reference = (
    strategy:
      | "page_identity"
      | "conversation_root"
      | "composer_root"
      | "send_control"
      | "assistant_response",
    ref:
      | "page-root"
      | "conversation-root"
      | "composer-root"
      | "send-control"
      | "assistant-response",
  ) => ({
    strategy,
    primary: {
      kind: "packaged_selector_reference" as const,
      reference: ref,
    },
    fallbacks: [],
    timeoutMs: 1_000,
    observationMode: "polling" as const,
  });
  return validateProfileContent({
    content: {
      schemaVersion: "adapter_profile_v1",
      page: {
        identityStrategy: "page_identity",
        conversationStrategy: "conversation_root",
        composerStrategy: "composer_root",
      },
      selectors: {
        conversation: reference("conversation_root", "conversation-root"),
        composer: reference("composer_root", "composer-root"),
        send: reference("send_control", "send-control"),
        assistantResponse: reference(
          "assistant_response",
          "assistant-response",
        ),
      },
      observation: { mode: "polling", intervalMs: 1_000 },
      contours: [
        {
          key: "page_identity",
          required: true,
          expectedState: "PRESENT",
          strategy: "page_identity",
        },
        {
          key: "conversation_root",
          required: true,
          expectedState: "PRESENT",
          strategy: "conversation_root",
        },
        {
          key: "composer_root",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "composer_root",
        },
        {
          key: "send_control",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "send_control",
        },
        {
          key: "assistant_response",
          required: true,
          expectedState: "PRESENT",
          strategy: "assistant_response",
        },
      ],
    },
    compatibility: {
      schemaVersion: "profile_compatibility_v1",
      contractVersion: "control_plane_v1",
      browserFamilies,
      minimumBrowserVersions: [],
      minimumExtensionVersion: null,
    },
  });
}

const chromeProfile = profileDefinition();

async function insertRevision(input: {
  id: string;
  profileId: string;
  surfaceId: string;
  revision: number;
  definition?: ReturnType<typeof profileDefinition>;
}) {
  const definition = input.definition ?? chromeProfile;
  await runtime.query(
    "INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,variant_id,revision,schema_version,state,content,compatibility_constraints,content_sha256,published_at) VALUES($1,$2,$3,$4,NULL,$5,'adapter_profile_v1','DRAFT',$6::jsonb,$7::jsonb,$8,NULL)",
    [
      input.id,
      input.profileId,
      IDS.adapter,
      input.surfaceId,
      input.revision,
      JSON.stringify(definition.content),
      JSON.stringify(definition.compatibility),
      definition.contentSha256,
    ],
  );
  const context = {
    actorType: "SYSTEM" as const,
    correlationId: randomUUID(),
    reason: "B13 disposable authenticated-deep authority fixture",
  };
  await lifecycle.markProfileRevisionCandidate({
    profileId: input.profileId,
    revision: input.revision,
    context,
  });
  await lifecycle.publishProfileRevision({
    profileId: input.profileId,
    revision: input.revision,
    context: { ...context, correlationId: randomUUID() },
  });
}

function resolutionInput(
  surface: "CHATGPT_STANDARD" | "CHATGPT_WORK",
  machineKey: string,
) {
  return {
    surface,
    browserFamily: "chrome" as const,
    browserVersion: "154.0.0.0",
    extensionVersion: "1.0.0",
    adapterEngineVersion: "1.0.0",
    healthSuite: { machineKey, revision: 1 },
  };
}

function event(
  step: H3BehaviorStep,
  outcome: "PASS" | "FAIL" | "UNCERTAIN",
): H3SafeEvidenceEvent {
  const result = outcome === "PASS" ? "PASS" : outcome;
  const observation = (
    contourKey: string,
    strategyId: string,
    evidenceKind: "NONE" | "METADATA" | "STATE_TRANSITION_TRACE" = "NONE",
  ): H3ContourObservation =>
    H3ContourObservationSchema.parse({
      contourKey,
      observationStatus: "PRESENT",
      primaryStrategyOutcome: result,
      fallbackStrategyOutcomes: [],
      selectedStrategyId: result === "PASS" ? strategyId : null,
      structuralOutcome: result,
      behavioralOutcome: result,
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind,
    });

  const observations =
    outcome === "UNCERTAIN"
      ? []
      : step === "IDENTIFY_SURFACE"
        ? [
            observation("C01_PAGE_IDENTITY", "PAGE_HOST_MARKER", "METADATA"),
            observation("C13_BLOCKING_STATE", "BLOCKING_MARKER", "METADATA"),
          ]
        : step === "IDENTIFY_COMPOSER"
          ? [observation("C03_COMPOSER_ROOT", "COMPOSER_CONTAINER", "METADATA")]
          : step === "INSERT_PROMPT"
            ? [observation("C04_COMPOSER_INPUT", "EDITABLE_INPUT", "METADATA")]
            : step === "SEND_ONCE"
              ? [
                  observation(
                    "C05_SEND_CONTROL",
                    "SEMANTIC_SEND_CONTROL",
                    "STATE_TRANSITION_TRACE",
                  ),
                ]
              : step === "OBSERVE_BUSY"
                ? [
                    observation(
                      "C06_BUSY_STOP_STATE",
                      "BUSY_INDICATOR",
                      "STATE_TRANSITION_TRACE",
                    ),
                  ]
                : step === "OBSERVE_RESPONSE"
                  ? [
                      observation(
                        "C02_CONVERSATION_ROOT",
                        "CONVERSATION_ANCHOR",
                        "METADATA",
                      ),
                      observation(
                        "C07_ASSISTANT_MESSAGE",
                        "ASSISTANT_MESSAGE_REGION",
                      ),
                    ]
                  : step === "OBSERVE_COMPLETION"
                    ? [
                        observation(
                          "C08_MESSAGE_COMPLETION",
                          "COMPLETION_MARKER",
                          "STATE_TRANSITION_TRACE",
                        ),
                      ]
                    : step === "VALIDATE_BRIDGE_SURFACES"
                      ? [
                          observation(
                            "C09_COMMAND_CODE_BLOCK_SURFACE",
                            "COMMAND_SURFACE",
                          ),
                          observation(
                            "C10_NATIVE_COPY_CONTROL",
                            "NATIVE_COPY_CONTROL",
                            "METADATA",
                          ),
                          observation(
                            "C11_CONVERSATION_IDENTITY",
                            "CONVERSATION_IDENTIFIER",
                            "METADATA",
                          ),
                          observation(
                            "C12_DELIVERY_INSERTION_PATH",
                            "DELIVERY_TARGET",
                            "STATE_TRANSITION_TRACE",
                          ),
                        ]
                      : [];

  return {
    step,
    outcome,
    durationMs: 4,
    markerCount: null,
    transitionObserved: null,
    observations,
  };
}

async function seedCanonicalAuthority() {
  await runtime.query(
    "INSERT INTO ai_adapters(id,machine_key,display_name,status) VALUES($1,'chatgpt','ChatGPT','ACTIVE')",
    [IDS.adapter],
  );
  await runtime.query(
    "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name,status) VALUES($1,$3,'standard','ChatGPT Standard','ACTIVE'),($2,$3,'work','ChatGPT Work','ACTIVE')",
    [IDS.standardSurface, IDS.workSurface, IDS.adapter],
  );
  await runtime.query(
    "INSERT INTO adapter_profiles(id,adapter_id,surface_id,variant_id,machine_key,display_name,status) VALUES($1,$3,$4,NULL,'standard-h3','ChatGPT Standard H3','ACTIVE'),($2,$3,$5,NULL,'work-h3','ChatGPT Work H3','ACTIVE')",
    [
      IDS.standardProfile,
      IDS.workProfile,
      IDS.adapter,
      IDS.standardSurface,
      IDS.workSurface,
    ],
  );
  await insertRevision({
    id: IDS.standardRevision,
    profileId: IDS.standardProfile,
    surfaceId: IDS.standardSurface,
    revision: 2,
  });
  await insertRevision({
    id: IDS.workRevision,
    profileId: IDS.workProfile,
    surfaceId: IDS.workSurface,
    revision: 1,
  });
}

function failedStandardExecution() {
  const events = [
    event("IDENTIFY_SURFACE", "PASS"),
    event("IDENTIFY_COMPOSER", "PASS"),
    event("INSERT_PROMPT", "PASS"),
    event("SEND_ONCE", "PASS"),
    event("OBSERVE_BUSY", "PASS"),
    event("OBSERVE_RESPONSE", "FAIL"),
    event("CLEANUP", "PASS"),
  ] as const;
  return H3ExecutionResultSchema.parse({
    level: "H3",
    targetKey: "chatgpt_standard_health",
    surfaceProfile: {
      surface: "CHATGPT_STANDARD",
      profileId: "CHATGPT_STANDARD_H3_V2",
      profileRevision: 2,
    },
    outcome: "FAIL",
    completedSteps: events
      .filter((item) => item.outcome === "PASS")
      .map((item) => item.step),
    events,
    durationMs: 250,
    failureCode: "RESPONSE_OBSERVATION_FAILED",
    failureStep: "OBSERVE_RESPONSE",
    cleanupOutcome: "PASS",
    cleanupFailureCode: null,
    environmentUncertainty: null,
  });
}

function syntheticSuite(
  scope: Awaited<
    ReturnType<typeof resolver.resolveAuthenticatedDeepHealthScope>
  >,
): HealthSuiteDefinition {
  return HealthSuiteDefinitionSchema.parse({
    ...BASELINE_HEALTH_SUITE,
    machineKey: "b13-authdeep-standard-synthetic",
    displayName: "B13 synthetic authenticated-deep persistence proof",
    description:
      "Synthetic disposable-PostgreSQL proof only; no provider response bytes or live browser evidence.",
    scope,
  });
}

describe.sequential(
  "B13 authenticated deep health scope PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
    });

    afterAll(async () => runtime.close());

    it("fails missing provider authority read-only before any H3 catalog exists", async () => {
      await expect(
        resolver.resolveAuthenticatedDeepHealthScope(
          resolutionInput(
            "CHATGPT_STANDARD",
            "b13-authdeep-standard-synthetic",
          ),
        ),
      ).rejects.toThrow("AUTHENTICATED_DEEP_PROVIDER_AUTHORITY_NOT_FOUND");

      const counts = await runtime.query<{
        adapters: string;
        surfaces: string;
        profiles: string;
        revisions: string;
      }>(`SELECT
        (SELECT count(*)::text FROM ai_adapters) AS adapters,
        (SELECT count(*)::text FROM ai_surfaces) AS surfaces,
        (SELECT count(*)::text FROM adapter_profiles) AS profiles,
        (SELECT count(*)::text FROM adapter_profile_revisions) AS revisions`);
      expect(counts.rows[0]).toEqual({
        adapters: "0",
        surfaces: "0",
        profiles: "0",
        revisions: "0",
      });

      await seedCanonicalAuthority();
    });

    it("resolves distinct packaged Standard rev2 and Work rev1 P7 authority", async () => {
      const standard = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_STANDARD", "b13-authdeep-standard-synthetic"),
      );
      const work = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_WORK", "b13-authdeep-work-synthetic"),
      );

      expect(standard.adapterFamilyKey).toBe("chatgpt");
      expect(standard.surfaceKey).toBe("standard");
      expect(standard.surfaceId).toBe(IDS.standardSurface);
      expect(standard.profile).toEqual({
        id: IDS.standardProfile,
        revision: 2,
      });
      expect(standard.variant).toBeNull();

      expect(work.adapterFamilyKey).toBe("chatgpt");
      expect(work.surfaceKey).toBe("work");
      expect(work.surfaceId).toBe(IDS.workSurface);
      expect(work.profile).toEqual({ id: IDS.workProfile, revision: 1 });
      expect(work.variant).toBeNull();
      expect(work.profile.id).not.toBe(standard.profile.id);
    });

    it("fails closed for inactive, incompatible, ambiguous, and wrong packaged authority", async () => {
      const input = resolutionInput(
        "CHATGPT_STANDARD",
        "b13-authdeep-standard-synthetic",
      );

      await runtime.query(
        "UPDATE adapter_profiles SET status='DISABLED' WHERE id=$1",
        [IDS.standardProfile],
      );
      await expect(
        resolver.resolveAuthenticatedDeepHealthScope(input),
      ).rejects.toThrow("AUTHENTICATED_DEEP_PROFILE_AUTHORITY_INACTIVE");
      await runtime.query(
        "UPDATE adapter_profiles SET status='ACTIVE' WHERE id=$1",
        [IDS.standardProfile],
      );

      await expect(
        resolver.resolveAuthenticatedDeepHealthScope({
          ...input,
          browserFamily: "firefox",
        }),
      ).rejects.toThrow(
        "AUTHENTICATED_DEEP_PROFILE_REVISION_AUTHORITY_NOT_FOUND",
      );

      const extraRevision = "b1300000-0000-4000-8000-00000000000a";
      await insertRevision({
        id: extraRevision,
        profileId: IDS.standardProfile,
        surfaceId: IDS.standardSurface,
        revision: 3,
      });
      await expect(
        resolver.resolveAuthenticatedDeepHealthScope(input),
      ).rejects.toThrow(
        "AUTHENTICATED_DEEP_PROFILE_REVISION_AUTHORITY_AMBIGUOUS",
      );
      await lifecycle.retireProfileRevision({
        profileId: IDS.standardProfile,
        revision: 3,
        context: {
          actorType: "SYSTEM",
          correlationId: randomUUID(),
          reason: "B13 retire ambiguous disposable revision",
        },
      });

      await lifecycle.retireProfileRevision({
        profileId: IDS.workProfile,
        revision: 1,
        context: {
          actorType: "SYSTEM",
          correlationId: randomUUID(),
          reason: "B13 retire packaged Work revision for mismatch fixture",
        },
      });
      const wrongWorkRevision = "b1300000-0000-4000-8000-00000000000b";
      await insertRevision({
        id: wrongWorkRevision,
        profileId: IDS.workProfile,
        surfaceId: IDS.workSurface,
        revision: 2,
      });
      await expect(
        resolver.resolveAuthenticatedDeepHealthScope(
          resolutionInput("CHATGPT_WORK", "b13-authdeep-work-synthetic"),
        ),
      ).rejects.toThrow(
        "AUTHENTICATED_DEEP_PACKAGED_PROFILE_REVISION_MISMATCH",
      );
    });

    it("recovers a persisted H3 run through incident processing before scheduler success after a crash", async () => {
      const scheduledAt = new Date("2026-09-27T12:00:00.000Z");
      await scheduler.createSchedule({
        scheduleId: IDS.recoverySchedule,
        monitorTarget: "chatgpt_standard_health",
        provider: "chatgpt",
        surface: "CHATGPT_STANDARD",
        probeLayer: "AUTHENTICATED_DEEP",
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: scheduledAt,
        revision: 1,
      });
      const scheduled = await scheduler.materializeDueSlot(
        IDS.recoverySchedule,
        scheduledAt,
      );
      expect(scheduled).not.toBeNull();
      const claimed = await scheduler.claimNext({
        ownerId: "b15-crash-fixture",
        now: scheduledAt,
        leaseMs: 60_000,
      });
      expect(claimed?.id).toBe(scheduled!.id);
      const started = await scheduler.startRun({
        runId: scheduled!.id,
        ownerId: "b15-crash-fixture",
        leaseId: claimed!.leaseId!,
        now: scheduledAt,
      });
      expect(started.state).toBe("RUNNING");

      const scope = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_STANDARD", "b13-authdeep-standard-synthetic"),
      );
      const suite = syntheticSuite(scope);
      const context: H3HealthPersistenceContext = {
        suite,
        startedAt: "2026-09-27T12:00:00.000Z",
        completedAt: "2026-09-27T12:00:01.000Z",
        browserRuntime: {
          family: "chrome",
          browserName: "chromium",
          browserVersion: scope.browserVersion,
          headless: true,
          sessionKind: "EPHEMERAL_CONTROLLED",
        },
        operatorMaintenance: false,
        operatorMaintenanceAuthority: null,
        classifierVersion: "b15-synthetic-authdeep-recovery-v1",
      };

      const command = createH3HealthPersistenceCommand(
        failedStandardExecution(),
        context,
      );
      const run = await persistence.persistCompletedHealthRun({
        ...command,
        scheduledRunId: scheduled!.id,
      });

      expect(run.scheduledRunId).toBe(scheduled!.id);
      expect(run.healthLevel).toBe("H3");
      expect(run.healthState).toBe("BROKEN");
      expect(run.profileId).toBe(IDS.standardProfile);
      expect(run.profileRevision).toBe(2);
      expect((await scheduler.getScheduledRun(scheduled!.id))?.state).toBe(
        "RUNNING",
      );

      const before = await runtime.query<{
        incidents: string;
        intents: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM health_incidents WHERE latest_seen_run_id=$1) AS incidents,
          (SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$1) AS intents`,
        [run.id],
      );
      expect(before.rows[0]).toEqual({ incidents: "0", intents: "0" });

      const recovered = await scheduler.reconcilePersistedResults(
        new Date("2026-09-27T12:00:02.000Z"),
      );
      expect(recovered).toBe(1);

      const final = await scheduler.getScheduledRun(scheduled!.id);
      expect(final?.state).toBe("SUCCEEDED");
      expect(final?.healthRunId).toBe(run.id);
      expect(final?.healthState).toBe("BROKEN");

      const incidentRows = await runtime.query<{ id: string }>(
        "SELECT id FROM health_incidents WHERE latest_seen_run_id=$1",
        [run.id],
      );
      expect(incidentRows.rows).toHaveLength(1);

      const intents = await runtime.query<{
        sourceDomain: string;
        eventKind: string;
        healthRunId: string;
      }>(
        'SELECT source_domain AS "sourceDomain",event_kind AS "eventKind",health_run_id AS "healthRunId" FROM health_notification_intents WHERE incident_id=$1',
        [incidentRows.rows[0]!.id],
      );
      expect(intents.rows).toEqual([
        {
          sourceDomain: "LLM_HEALTH",
          eventKind: "INCIDENT_OPENED",
          healthRunId: run.id,
        },
      ]);

      expect(
        await scheduler.reconcilePersistedResults(
          new Date("2026-09-27T12:00:03.000Z"),
        ),
      ).toBe(0);
    });

    it("keeps persisted authenticated-deep evidence ahead of expired RUNNING reclaim", async () => {
      await runtime.query(
        "UPDATE health_scheduled_runs SET state='CANCELLED',owner_id=NULL,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE state NOT IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED')",
      );
      const scheduledAt = new Date("2026-09-28T03:40:00.000Z");
      const scheduleId = randomUUID();
      await scheduler.createSchedule({
        scheduleId,
        monitorTarget: "chatgpt_standard_health_b20_persisted_crash",
        provider: "chatgpt",
        surface: "CHATGPT_STANDARD",
        probeLayer: "AUTHENTICATED_DEEP",
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: scheduledAt,
        revision: 1,
      });
      const scheduled = await scheduler.materializeDueSlot(
        scheduleId,
        scheduledAt,
      );
      const claim = await scheduler.claimNext({
        ownerId: "b20-persist-before-crash",
        now: scheduledAt,
        leaseMs: 1_000,
      });
      await scheduler.startRun({
        runId: scheduled!.id,
        ownerId: "b20-persist-before-crash",
        leaseId: claim!.leaseId!,
        now: scheduledAt,
      });

      const scope = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_STANDARD", "b13-authdeep-standard-synthetic"),
      );
      const run = await persistence.persistCompletedHealthRun({
        ...createH3HealthPersistenceCommand(failedStandardExecution(), {
          suite: syntheticSuite(scope),
          startedAt: "2026-09-28T03:40:00.000Z",
          completedAt: "2026-09-28T03:40:00.500Z",
          browserRuntime: {
            family: "chrome",
            browserName: "chromium",
            browserVersion: scope.browserVersion,
            headless: true,
            sessionKind: "EPHEMERAL_CONTROLLED",
          },
          operatorMaintenance: false,
          operatorMaintenanceAuthority: null,
          classifierVersion: "b20-persist-before-crash-v1",
        }),
        scheduledRunId: scheduled!.id,
      });

      expect(
        await scheduler.claimNext({
          ownerId: "b20-reclaimer",
          now: new Date("2026-09-28T03:40:02.000Z"),
          leaseMs: 60_000,
        }),
      ).toBeNull();
      expect(await scheduler.getScheduledRun(scheduled!.id)).toMatchObject({
        state: "RUNNING",
        healthRunId: null,
        failureCode: null,
      });

      expect(
        await scheduler.reconcilePersistedResults(
          new Date("2026-09-28T03:40:02.100Z"),
        ),
      ).toBe(1);
      expect(await scheduler.getScheduledRun(scheduled!.id)).toMatchObject({
        state: "SUCCEEDED",
        healthRunId: run.id,
        healthState: "BROKEN",
      });
      const incidents = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_incidents WHERE latest_seen_run_id=$1",
        [run.id],
      );
      expect(incidents.rows[0]?.count).toBe("1");
      await runtime.query("DELETE FROM health_notification_intents");
      await runtime.query("DELETE FROM health_incidents");
    });

    it("accepts one late authenticated-deep result after crash fencing without a second execution", async () => {
      await runtime.query(
        "UPDATE health_scheduled_runs SET state='CANCELLED',owner_id=NULL,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE state NOT IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED')",
      );
      const scheduledAt = new Date("2026-09-28T03:50:00.000Z");
      const scheduleId = randomUUID();
      await scheduler.createSchedule({
        scheduleId,
        monitorTarget: "chatgpt_standard_health_b20_late_callback",
        provider: "chatgpt",
        surface: "CHATGPT_STANDARD",
        probeLayer: "AUTHENTICATED_DEEP",
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: scheduledAt,
        revision: 1,
      });
      const scheduled = await scheduler.materializeDueSlot(
        scheduleId,
        scheduledAt,
      );
      const claim = await scheduler.claimNext({
        ownerId: "b20-crashed-after-send",
        now: scheduledAt,
        leaseMs: 1_000,
      });
      await scheduler.startRun({
        runId: scheduled!.id,
        ownerId: "b20-crashed-after-send",
        leaseId: claim!.leaseId!,
        now: scheduledAt,
      });

      let secondExecutionCount = 0;
      const reclaimed = await scheduler.claimNext({
        ownerId: "b20-would-repeat",
        now: new Date("2026-09-28T03:50:02.000Z"),
        leaseMs: 60_000,
      });
      if (reclaimed) secondExecutionCount += 1;
      expect(reclaimed).toBeNull();
      expect(secondExecutionCount).toBe(0);
      expect(await scheduler.getScheduledRun(scheduled!.id)).toMatchObject({
        state: "FAILED_TERMINAL",
        failureCode: "SEND_UNCERTAIN",
        healthRunId: null,
      });

      const scope = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_STANDARD", "b13-authdeep-standard-synthetic"),
      );
      const run = await persistence.persistCompletedHealthRun({
        ...createH3HealthPersistenceCommand(failedStandardExecution(), {
          suite: syntheticSuite(scope),
          startedAt: "2026-09-28T03:50:00.000Z",
          completedAt: "2026-09-28T03:50:02.500Z",
          browserRuntime: {
            family: "chrome",
            browserName: "chromium",
            browserVersion: scope.browserVersion,
            headless: true,
            sessionKind: "EPHEMERAL_CONTROLLED",
          },
          operatorMaintenance: false,
          operatorMaintenanceAuthority: null,
          classifierVersion: "b20-late-authdeep-result-v1",
        }),
        scheduledRunId: scheduled!.id,
      });

      expect(
        await scheduler.reconcilePersistedResults(
          new Date("2026-09-28T03:50:03.000Z"),
        ),
      ).toBe(1);
      expect(await scheduler.getScheduledRun(scheduled!.id)).toMatchObject({
        state: "SUCCEEDED",
        healthRunId: run.id,
        healthState: "BROKEN",
      });

      const firstCounts = await runtime.query<{
        incidents: string;
        intents: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM health_incidents WHERE latest_seen_run_id=$1) AS incidents,
          (SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$1) AS intents`,
        [run.id],
      );
      expect(firstCounts.rows[0]).toEqual({ incidents: "1", intents: "1" });

      expect(
        await scheduler.reconcilePersistedResults(
          new Date("2026-09-28T03:50:04.000Z"),
        ),
      ).toBe(0);
      expect(
        await scheduler.claimNext({
          ownerId: "b20-no-repeat-after-late-result",
          now: new Date("2026-09-28T03:50:05.000Z"),
          leaseMs: 60_000,
        }),
      ).toBeNull();

      const finalCounts = await runtime.query<{
        incidents: string;
        intents: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM health_incidents WHERE latest_seen_run_id=$1) AS incidents,
          (SELECT count(*)::text FROM health_notification_intents WHERE health_run_id=$1) AS intents`,
        [run.id],
      );
      expect(finalCounts.rows[0]).toEqual(firstCounts.rows[0]);
      await runtime.query("DELETE FROM health_notification_intents");
      await runtime.query("DELETE FROM health_incidents");
    });

    it("recovers a terminal H3 result after incident failure without replaying H3", async () => {
      const scheduledAt = new Date("2026-09-28T02:30:00.000Z");
      await runtime.query("UPDATE health_schedules SET enabled=false");
      const realIncidents = createHealthIncidentRepository(runtime);
      let incidentCalls = 0;
      const incidentProcessor = {
        async processCompletedHealthRun(runId: string) {
          incidentCalls += 1;
          if (incidentCalls <= 2) {
            throw new Error("B16_SYNTHETIC_POST_PERSIST_INCIDENT_FAILURE");
          }
          return realIncidents.processCompletedHealthRun(runId);
        },
      };
      const recoveryScheduler = createHealthSchedulerRepository(runtime, {
        incidentProcessor,
      });

      await recoveryScheduler.createSchedule({
        scheduleId: IDS.terminalRecoverySchedule,
        monitorTarget: "chatgpt_standard_health",
        provider: "chatgpt",
        surface: "CHATGPT_STANDARD",
        probeLayer: "AUTHENTICATED_DEEP",
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: scheduledAt,
        revision: 2,
      });

      let h3Calls = 0;
      let scheduledRunId: string | undefined;
      let healthRunId: string | undefined;
      const execute = async (scheduledRun: { id: string }) => {
        h3Calls += 1;
        scheduledRunId = scheduledRun.id;
        const scope = await resolver.resolveAuthenticatedDeepHealthScope(
          resolutionInput(
            "CHATGPT_STANDARD",
            "b13-authdeep-standard-synthetic",
          ),
        );
        const persisted = await persistence.persistCompletedHealthRun({
          ...createH3HealthPersistenceCommand(failedStandardExecution(), {
            suite: syntheticSuite(scope),
            startedAt: "2026-09-28T02:30:00.000Z",
            completedAt: "2026-09-28T02:30:01.000Z",
            browserRuntime: {
              family: "chrome",
              browserName: "chromium",
              browserVersion: scope.browserVersion,
              headless: true,
              sessionKind: "EPHEMERAL_CONTROLLED",
            },
            operatorMaintenance: false,
            operatorMaintenanceAuthority: null,
            classifierVersion: "b16-terminal-recovery-synthetic-v1",
          }),
          scheduledRunId: scheduledRun.id,
        });
        healthRunId = persisted.id;
        try {
          await incidentProcessor.processCompletedHealthRun(persisted.id);
        } catch {
          return {
            outcome: "FAILED" as const,
            failureClass: "TRANSIENT_ENVIRONMENT" as const,
            failureCode: "AUTHENTICATED_DEEP_PERSISTENCE_REJECTED",
          };
        }
        return {
          outcome: "SUCCEEDED" as const,
          healthRunId: persisted.id,
          healthState: "BROKEN" as const,
        };
      };

      await expect(
        runDurableHealthSchedulerCycle({
          repository: recoveryScheduler,
          clock: { now: () => scheduledAt },
          ownerId: "b16-terminal-recovery",
          leaseMs: 60_000,
          maxConcurrency: 1,
          execute,
        }),
      ).rejects.toThrow("B16_SYNTHETIC_POST_PERSIST_INCIDENT_FAILURE");

      expect(h3Calls).toBe(1);
      expect(incidentCalls).toBe(2);
      expect(scheduledRunId).toBeDefined();
      expect(healthRunId).toBeDefined();
      const terminal = await recoveryScheduler.getScheduledRun(scheduledRunId!);
      expect(terminal?.state).toBe("FAILED_TERMINAL");
      expect(terminal?.failureCode).toBe(
        "AUTHENTICATED_DEEP_PERSISTENCE_REJECTED",
      );
      expect(terminal?.healthRunId).toBeNull();

      const afterFailedRecovery = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_notification_intents WHERE health_run_id=$1",
        [healthRunId],
      );
      expect(afterFailedRecovery.rows[0]?.count).toBe("0");

      const second = await runDurableHealthSchedulerCycle({
        repository: recoveryScheduler,
        clock: { now: () => new Date("2026-09-28T02:30:02.500Z") },
        ownerId: "b16-terminal-recovery-2",
        leaseMs: 60_000,
        maxConcurrency: 1,
        execute,
      });
      expect(second.reconciled).toBe(1);
      expect(second.claimed).toBe(0);
      expect(h3Calls).toBe(1);
      expect(incidentCalls).toBe(3);

      const final = await recoveryScheduler.getScheduledRun(scheduledRunId!);
      expect(final?.state).toBe("SUCCEEDED");
      expect(final?.healthRunId).toBe(healthRunId);
      expect(final?.healthState).toBe("BROKEN");

      const intents = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_notification_intents WHERE health_run_id=$1",
        [healthRunId],
      );
      expect(intents.rows[0]?.count).toBe("1");

      const third = await runDurableHealthSchedulerCycle({
        repository: recoveryScheduler,
        clock: { now: () => new Date("2026-09-28T02:30:03.000Z") },
        ownerId: "b16-terminal-recovery-3",
        leaseMs: 60_000,
        maxConcurrency: 1,
        execute,
      });
      expect(third.reconciled).toBe(0);
      expect(third.claimed).toBe(0);
      expect(h3Calls).toBe(1);
      expect(incidentCalls).toBe(3);
    });
  },
);
