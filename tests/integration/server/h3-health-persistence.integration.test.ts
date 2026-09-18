import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASELINE_HEALTH_SUITE,
  HealthSuiteDefinitionSchema,
  type HealthSuiteDefinition,
} from "../../../packages/server/health/src/index.js";
import {
  createH3HealthPersistenceCommand,
  type H3HealthPersistenceContext,
} from "../../../apps/health-runner/src/h3-health-persistence.js";
import { H3ExecutionResultSchema } from "../../../apps/health-runner/src/h3-engine.js";
import type { H3BehaviorStep } from "../../../apps/health-runner/src/h3-contracts.js";
import {
  createDatabaseRuntime,
  createHealthPersistenceRepository,
} from "@product/db";
import { runMigrations } from "@product/db/migrations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  adapter: "00000000-0000-4000-8000-000000000101",
  standardSurface: "00000000-0000-4000-8000-000000000102",
  workSurface: "00000000-0000-4000-8000-000000000103",
  standardProfile: "00000000-0000-4000-8000-000000000104",
  workProfile: "00000000-0000-4000-8000-000000000105",
  standardRevision: "00000000-0000-4000-8000-000000000106",
  workRevision: "00000000-0000-4000-8000-000000000107",
};

const runtime = createDatabaseRuntime(connectionString);
const repository = createHealthPersistenceRepository(runtime);

function event(step: H3BehaviorStep, outcome: "PASS" | "FAIL" | "UNCERTAIN") {
  const result = outcome === "PASS" ? "PASS" : outcome;
  const observation = (
    contourKey: string,
    strategyId: string,
    evidenceKind: "NONE" | "METADATA" | "STATE_TRANSITION_TRACE" = "NONE",
  ) => ({
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

function execution(
  surface: "CHATGPT_STANDARD" | "CHATGPT_WORK",
  outcome: "PASS" | "FAIL" | "UNCERTAIN",
  events: readonly {
    step: H3BehaviorStep;
    outcome: "PASS" | "FAIL" | "UNCERTAIN";
  }[],
  failureCode:
    | "RESPONSE_OBSERVATION_FAILED"
    | "BRIDGE_SURFACE_VALIDATION_FAILED"
    | "LOGIN_REQUIRED"
    | null,
  failureStep:
    | "OBSERVE_RESPONSE"
    | "VALIDATE_BRIDGE_SURFACES"
    | "IDENTIFY_SURFACE"
    | null,
  environmentUncertainty: "LOGIN_EXPIRED" | null,
) {
  return H3ExecutionResultSchema.parse({
    level: "H3",
    targetKey:
      surface === "CHATGPT_STANDARD"
        ? "chatgpt_standard_health"
        : "chatgpt_work_health",
    surfaceProfile:
      surface === "CHATGPT_STANDARD"
        ? {
            surface,
            profileId: "CHATGPT_STANDARD_H3_V2",
            profileRevision: 2,
          }
        : {
            surface,
            profileId: "CHATGPT_WORK_H3_V1",
            profileRevision: 1,
          },
    outcome,
    completedSteps: events
      .filter((item) => item.outcome === "PASS")
      .map((item) => item.step),
    events,
    durationMs: 250,
    failureCode,
    failureStep,
    cleanupOutcome: "PASS",
    cleanupFailureCode: null,
    environmentUncertainty,
  });
}

const PASS_EVENTS = [
  event("IDENTIFY_SURFACE", "PASS"),
  event("IDENTIFY_COMPOSER", "PASS"),
  event("INSERT_PROMPT", "PASS"),
  event("SEND_ONCE", "PASS"),
  event("OBSERVE_BUSY", "PASS"),
  event("OBSERVE_RESPONSE", "PASS"),
  event("OBSERVE_COMPLETION", "PASS"),
  event("VALIDATE_BRIDGE_SURFACES", "PASS"),
  event("CLEANUP", "PASS"),
] as const;

const BRIDGE_FAILURE_EVENT = {
  step: "VALIDATE_BRIDGE_SURFACES",
  outcome: "FAIL",
  durationMs: 4,
  markerCount: 4,
  transitionObserved: false,
  observations: [
    {
      contourKey: "C09_COMMAND_CODE_BLOCK_SURFACE",
      observationStatus: "PRESENT",
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: "COMMAND_SURFACE",
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind: "NONE",
    },
    {
      contourKey: "C10_NATIVE_COPY_CONTROL",
      observationStatus: "PRESENT",
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: "NATIVE_COPY_CONTROL",
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind: "METADATA",
    },
    {
      contourKey: "C11_CONVERSATION_IDENTITY",
      observationStatus: "PRESENT",
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" },
      ],
      selectedStrategyId: "CONVERSATION_URL_IDENTITY",
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
      fallbackQuality: "APPROVED_EQUIVALENT",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind: "NONE",
    },
    {
      contourKey: "C12_DELIVERY_INSERTION_PATH",
      observationStatus: "PRESENT",
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: "DELIVERY_TARGET",
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind: "STATE_TRANSITION_TRACE",
    },
  ],
} as const;

function suiteFor(surface: "standard" | "work"): HealthSuiteDefinition {
  const standard = surface === "standard";
  const machineKey = standard ? "b5-chatgpt-standard" : "b5-chatgpt-work";
  return HealthSuiteDefinitionSchema.parse({
    ...BASELINE_HEALTH_SUITE,
    machineKey,
    scope: {
      ...BASELINE_HEALTH_SUITE.scope,
      adapterFamilyId: IDS.adapter,
      adapterFamilyKey: "chatgpt",
      surfaceId: standard ? IDS.standardSurface : IDS.workSurface,
      surfaceKey: surface,
      profile: {
        id: standard ? IDS.standardProfile : IDS.workProfile,
        revision: standard ? 2 : 1,
      },
      healthSuite: { machineKey, revision: 1 },
    },
  });
}

function context(suite: HealthSuiteDefinition): H3HealthPersistenceContext {
  return {
    suite,
    startedAt: "2026-09-15T11:00:00.000Z",
    completedAt: "2026-09-15T11:00:01.000Z",
    browserRuntime: {
      family: "chrome",
      browserName: "chromium",
      browserVersion: "120.0.0.0",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED",
    },
    operatorMaintenance: false,
    operatorMaintenanceAuthority: null,
    classifierVersion: "p8.1-classifier-v1",
  };
}

const TIMESTAMP_CASES = [
  {
    name: "A",
    startedAt: "2026-09-16T10:00:00+05:00",
    completedAt: "2026-09-16T06:00:00Z",
    deltaMs: 3_600_000,
  },
  {
    name: "C",
    startedAt: "2026-09-16T10:00:00.100+05:00",
    completedAt: "2026-09-16T05:00:00.200Z",
    deltaMs: 100,
  },
  {
    name: "E",
    startedAt: "2026-09-16T10:00:00+05:00",
    completedAt: "2026-09-16T05:00:00Z",
    deltaMs: 0,
  },
] as const;

const REVERSE_TIMESTAMP_CASES = [
  {
    name: "B",
    startedAt: "2026-09-16T06:00:00Z",
    completedAt: "2026-09-16T10:00:00+05:00",
  },
  {
    name: "D",
    startedAt: "2026-09-16T05:00:00.200Z",
    completedAt: "2026-09-16T10:00:00.100+05:00",
  },
] as const;

async function healthCounts() {
  const tables = [
    "health_suite_revisions",
    "health_runs",
    "health_contour_results",
    "health_evidence_references",
  ] as const;
  const result = {} as Record<(typeof tables)[number], number>;
  for (const table of tables) {
    const rows = await runtime.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table}`,
    );
    result[table] = Number(rows.rows[0]?.count ?? "0");
  }
  return result;
}

async function persist(
  surface: "standard" | "work",
  result: ReturnType<typeof H3ExecutionResultSchema.parse>,
) {
  const command = createH3HealthPersistenceCommand(
    result,
    context(suiteFor(surface)),
  );
  const run = await repository.persistCompletedHealthRun(command);
  return {
    run,
    contours: await repository.listContourResults(run.id),
    evidence: await repository.listEvidenceReferences(run.id),
  };
}

describe("B5 durable Standard/Work H3 evidence", () => {
  beforeAll(async () => {
    await runtime.ready();
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString: connectionString! });
    await runtime.query(
      `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','ChatGPT')`,
      [IDS.adapter],
    );
    await runtime.query(
      `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','ChatGPT Standard'),($3,$2,'work','ChatGPT Work')`,
      [IDS.standardSurface, IDS.adapter, IDS.workSurface],
    );
    await runtime.query(
      `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'standard-h3','Standard H3'),($4,$2,$5,'work-h3','Work H3')`,
      [
        IDS.standardProfile,
        IDS.adapter,
        IDS.standardSurface,
        IDS.workProfile,
        IDS.workSurface,
      ],
    );
    await runtime.query(
      `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,2,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5),($6,$7,$3,$8,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
      [
        IDS.standardRevision,
        IDS.standardProfile,
        IDS.adapter,
        IDS.standardSurface,
        "0".repeat(64),
        IDS.workRevision,
        IDS.workProfile,
        IDS.workSurface,
      ],
    );
  });

  afterAll(async () => runtime.close());

  for (const [surface, executionSurface] of [
    ["standard", "CHATGPT_STANDARD"],
    ["work", "CHATGPT_WORK"],
  ] as const) {
    it.each(TIMESTAMP_CASES)(
      "$name persists $surface PASS at the parsed UTC moments",
      async ({ startedAt, completedAt, deltaMs }) => {
        const suite = suiteFor(surface);
        const command = createH3HealthPersistenceCommand(
          execution(executionSurface, "PASS", PASS_EVENTS, null, null, null),
          {
            ...context(suite),
            startedAt,
            completedAt,
          },
        );
        const run = await repository.persistCompletedHealthRun(command);
        const storedRows = await runtime.query<{
          startedAt: Date;
          completedAt: Date;
          surfaceId: string;
          profileId: string;
          profileRevision: number;
          healthLevel: string;
          healthState: string;
        }>(
          `SELECT started_at AS "startedAt",completed_at AS "completedAt",surface_id AS "surfaceId",profile_id AS "profileId",profile_revision AS "profileRevision",health_level AS "healthLevel",health_state AS "healthState" FROM health_runs WHERE id=$1`,
          [run.id],
        );
        const stored = storedRows.rows[0];
        expect(stored).toBeDefined();
        expect(stored?.startedAt.valueOf()).toBe(Date.parse(startedAt));
        expect(stored?.completedAt.valueOf()).toBe(Date.parse(completedAt));
        expect(
          stored?.completedAt.valueOf() - stored?.startedAt.valueOf(),
        ).toBe(deltaMs);
        expect(run.healthLevel).toBe("H3");
        expect(run.healthState).toBe("HEALTHY");
        expect(run.surfaceId).toBe(suite.scope.surfaceId);
        expect(run.profileId).toBe(suite.scope.profile.id);
        expect(run.profileRevision).toBe(suite.scope.profile.revision);
        expect(run.scope).toEqual(suite.scope);
        expect(stored?.surfaceId).toBe(suite.scope.surfaceId);
        expect(stored?.profileId).toBe(suite.scope.profile.id);
        expect(stored?.profileRevision).toBe(suite.scope.profile.revision);
        expect(stored?.healthLevel).toBe("H3");
        expect(stored?.healthState).toBe("HEALTHY");
        expect(await repository.listContourResults(run.id)).toHaveLength(13);
        expect(await repository.listEvidenceReferences(run.id)).toHaveLength(
          11,
        );
      },
    );

    it.each(REVERSE_TIMESTAMP_CASES)(
      "$name rejects $surface before repository write",
      async ({ startedAt, completedAt }) => {
        const suite = suiteFor(surface);
        const before = await healthCounts();
        const build = () =>
          createH3HealthPersistenceCommand(
            execution(executionSurface, "PASS", PASS_EVENTS, null, null, null),
            {
              ...context(suite),
              startedAt,
              completedAt,
            },
          );
        expect(build).toThrow("completedAt must not precede startedAt");
        expect(await healthCounts()).toEqual(before);
      },
    );
  }

  it.each([
    ["standard", "CHATGPT_STANDARD"],
    ["work", "CHATGPT_WORK"],
  ] as const)(
    "persists %s PASS with sanitized contour evidence",
    async (surface, executionSurface) => {
      const stored = await persist(
        surface,
        execution(executionSurface, "PASS", PASS_EVENTS, null, null, null),
      );
      expect(stored.run.healthLevel).toBe("H3");
      expect(stored.run.healthState).toBe("HEALTHY");
      expect(stored.run.browserFamily).toBe("chrome");
      expect(stored.run.browserVersion).toBe("120.0.0.0");
      expect(stored.run.profileRevision).toBe(surface === "standard" ? 2 : 1);
      expect(stored.contours).toHaveLength(13);
      expect(stored.evidence).toHaveLength(11);
      expect(
        stored.evidence.every((item) => item.evidenceId.length === 36),
      ).toBe(true);
      expect(JSON.stringify(stored)).not.toMatch(
        /TOXIC_PROMPT|TOXIC_RESPONSE|TOXIC_DOM|TOXIC_HTML|TOXIC_PROJECT|TOXIC_CONVERSATION|TOXIC_COOKIE|TOXIC_TOKEN|TOXIC_STORAGE|TOXIC_SELLER/i,
      );
    },
  );

  it.each([
    ["standard", "CHATGPT_STANDARD"],
    ["work", "CHATGPT_WORK"],
  ] as const)(
    "persists %s bridge-validation C11 failure provenance",
    async (surface, executionSurface) => {
      const stored = await persist(
        surface,
        execution(
          executionSurface,
          "FAIL",
          [
            ...PASS_EVENTS.slice(0, 7),
            BRIDGE_FAILURE_EVENT,
            event("CLEANUP", "PASS"),
          ],
          "BRIDGE_SURFACE_VALIDATION_FAILED",
          "VALIDATE_BRIDGE_SURFACES",
          null,
        ),
      );
      expect(stored.run.healthState).toBe("BROKEN");
      expect(stored.run.surfaceId).toBe(
        surface === "standard" ? IDS.standardSurface : IDS.workSurface,
      );
      expect(stored.run.profileId).toBe(
        surface === "standard" ? IDS.standardProfile : IDS.workProfile,
      );
      expect(stored.contours).toHaveLength(13);
      for (const contourKey of [
        "C09_COMMAND_CODE_BLOCK_SURFACE",
        "C10_NATIVE_COPY_CONTROL",
        "C12_DELIVERY_INSERTION_PATH",
      ]) {
        expect(
          stored.contours.find((item) => item.contourKey === contourKey),
        ).toMatchObject({
          observationStatus: "PRESENT",
          primaryStrategyOutcome: "PASS",
        });
      }
      expect(
        stored.contours.find(
          (item) => item.contourKey === "C11_CONVERSATION_IDENTITY",
        ),
      ).toMatchObject({
        observationStatus: "PRESENT",
        primaryStrategyOutcome: "FAIL",
        fallbackStrategyOutcomes: [
          { strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" },
        ],
        selectedStrategyId: "CONVERSATION_URL_IDENTITY",
        structuralOutcome: "FAIL",
        behavioralOutcome: "FAIL",
        fallbackQuality: "APPROVED_EQUIVALENT",
        environmentStatus: "VALID",
        uncertaintyReason: null,
        evidence: [],
      });
    },
  );

  it.each([
    ["standard", "CHATGPT_STANDARD"],
    ["work", "CHATGPT_WORK"],
  ] as const)(
    "persists %s post-Send FAIL without raw response/DOM",
    async (surface, executionSurface) => {
      const failedEvents = [
        ...PASS_EVENTS.slice(0, 5),
        event("OBSERVE_RESPONSE", "FAIL"),
        event("CLEANUP", "PASS"),
      ];
      const stored = await persist(
        surface,
        execution(
          executionSurface,
          "FAIL",
          failedEvents,
          "RESPONSE_OBSERVATION_FAILED",
          "OBSERVE_RESPONSE",
          null,
        ),
      );
      expect(stored.run.healthState).toBe("BROKEN");
      expect(
        stored.contours.find(
          (item) => item.contourKey === "C07_ASSISTANT_MESSAGE",
        )?.primaryStrategyOutcome,
      ).toBe("FAIL");
      expect(
        stored.evidence.some(
          (item) => item.classification === "BOUNDED_FRAGMENT",
        ),
      ).toBe(false);
    },
  );

  it.each([
    ["standard", "CHATGPT_STANDARD"],
    ["work", "CHATGPT_WORK"],
  ] as const)(
    "persists %s pre-Send UNCERTAIN as bounded environment state",
    async (surface, executionSurface) => {
      const stored = await persist(
        surface,
        execution(
          executionSurface,
          "UNCERTAIN",
          [event("IDENTIFY_SURFACE", "UNCERTAIN"), event("CLEANUP", "PASS")],
          "LOGIN_REQUIRED",
          "IDENTIFY_SURFACE",
          "LOGIN_EXPIRED",
        ),
      );
      expect(stored.run.healthState).toBe("UNKNOWN");
      expect(
        stored.contours.find(
          (item) => item.contourKey === "C13_BLOCKING_STATE",
        ),
      ).toMatchObject({
        environmentStatus: "UNCERTAIN",
        uncertaintyReason: "LOGIN_EXPIRED",
      });
      expect(JSON.stringify(stored.contours)).not.toMatch(
        /TOXIC_PROMPT|TOXIC_RESPONSE|TOXIC_DOM|TOXIC_HTML|TOXIC_COOKIE|TOXIC_TOKEN|TOXIC_STORAGE/i,
      );
    },
  );
});
