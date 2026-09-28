import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type MonitorProfileRepairBindingV1,
  type MonitorProfileRepairDecisionRequestV1,
} from "@product/contracts";
import { validateProfileContent } from "@product/adapter-registry";
import {
  NoSessionObservationResultSchema,
  monitorProfileRepairBindingSha256,
} from "@product/health";
import {
  createAdminOpsRepository,
  createDatabaseRuntime,
  createHealthRetentionRepository,
  createMonitorProfileRepairAdmissionRepository,
  createMonitorProfileRepairReadRepository,
  createProfileLifecycleRepository,
  noSessionRetentionScopeSha256,
  normalizedNoSessionResultSha256,
  type MonitorProfileRepairTrustedEvidence,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const lockerRuntime = createDatabaseRuntime(connectionString);

const IDS = {
  user: "e5000000-0000-4000-8000-000000000001",
  principal: "e5000000-0000-4000-8000-000000000002",
  adapter: "e5000000-0000-4000-8000-000000000003",
  surface: "e5000000-0000-4000-8000-000000000004",
  profile: "e5000000-0000-4000-8000-000000000005",
  baselineRevision: "e5000000-0000-4000-8000-000000000006",
  candidateRevision: "e5000000-0000-4000-8000-000000000007",
  rollbackRevision: "e5000000-0000-4000-8000-000000000008",
  unrelatedRevision: "e5000000-0000-4000-8000-000000000009",
  suite: "e5000000-0000-4000-8000-000000000010",
  schedule: "e5000000-0000-4000-8000-000000000011",
  scheduledRun: "e5000000-0000-4000-8000-000000000012",
  observationRun: "e5000000-0000-4000-8000-000000000013",
  baselineRun: "e5000000-0000-4000-8000-000000000014",
  rollbackRun: "e5000000-0000-4000-8000-000000000015",
  incident: "e5000000-0000-4000-8000-000000000016",
  h4: "e5000000-0000-4000-8000-000000000017",
  assignment: "e5000000-0000-4000-8000-000000000018",
  assignmentRevision: "e5000000-0000-4000-8000-000000000019",
  h4Execution: "e5000000-0000-4000-8000-000000000020",
  repairCase: "e5000000-0000-4000-8000-000000000021",
} as const;

const BASE = new Date("2026-09-28T09:00:00.000Z");
const sha = (char: string) => char.repeat(64);
const gitSha = (char: string) => char.repeat(40);

function observation() {
  return NoSessionObservationResultSchema.parse({
    providerId: "chatgpt",
    surfaceId: "CHATGPT_STANDARD",
    targetKey: "repair_target",
    strategyId: "repair-standard-v1",
    strategyRevision: 1,
    browserRuntime: {
      family: "chrome",
      browserName: "Chrome",
      browserVersion: "154.0.0.0",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED",
    },
    browserMode: {
      canonicalMode: "HEADLESS_DIAGNOSTIC",
      authoritativeMode: "HEADLESS_DIAGNOSTIC",
      diagnosticMode: null,
      fallbackAttempted: false,
      fallbackReason: "NOT_REQUIRED",
      headedInfrastructure: "NOT_CHECKED",
      environmentLimited: false,
      canonicalObservation: {
        mode: "HEADLESS_DIAGNOSTIC",
        identity: "PROVEN",
        blocker: "BROWSER_UNAVAILABLE",
        classification: "BROKEN",
        surfaceOutcome: "BROWSER_FAILURE",
      },
      diagnosticObservation: null,
    },
    navigation: "LOADED",
    navigationEvidence: {
      requestedStartUrl: "https://chatgpt.com",
      finalUrl: "https://chatgpt.com",
      finalOrigin: "https://chatgpt.com",
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: "LOADED",
    },
    finalOrigin: "https://chatgpt.com",
    expectedOriginValid: true,
    identity: "PROVEN",
    publicSurface: "REACHABLE",
    composer: "OBSERVED",
    editableInput: "OBSERVED",
    sendControl: "OBSERVED",
    authentication: "NOT_REQUIRED",
    blocker: "BROWSER_UNAVAILABLE",
    classification: "BROKEN",
    classificationBasis: "BROWSER_FAILURE",
    surfaceOutcome: "BROWSER_FAILURE",
    readiness: "APP_HYDRATED",
    elementMetadata: {
      composer: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      editableInput: {
        elementCount: 1,
        visible: true,
        editable: true,
        actionable: true,
      },
      sendControl: {
        elementCount: 1,
        visible: true,
        editable: false,
        actionable: true,
      },
    },
    noInteraction: true,
    observedAt: BASE.toISOString(),
    evidence: [],
  });
}

type Fixture = Awaited<ReturnType<typeof setupFixture>>;

async function resetDatabase() {
  await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
  await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runtime.query("CREATE SCHEMA public");
  await runMigrations({ connectionString: connectionString! });
}

async function setupFixture() {
  await resetDatabase();
  const obs = observation();
  const normalized = normalizedNoSessionResultSha256(obs);
  const retentionScope = noSessionRetentionScopeSha256(
    {
      browserFamily: "chrome",
      profileRevisionId: IDS.baselineRevision,
      profileRevision: 1,
    },
    obs,
  );
  const scopeSha256 = sha("c");
  const suiteDefinitionSha256 = sha("5");
  const h4Key = sha("f");

  await runtime.query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [
    IDS.user,
  ]);
  await runtime.query(
    "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
    [IDS.principal, IDS.user, new Date(BASE.valueOf() - 24 * 60 * 60 * 1_000)],
  );
  await runtime.query(
    "INSERT INTO admin_role_grants(id,admin_principal_id,role,granted_at,granted_by_admin_principal_id) VALUES($1,$2,'ADMIN_OWNER',$3,$2)",
    [
      randomUUID(),
      IDS.principal,
      new Date(BASE.valueOf() - 24 * 60 * 60 * 1_000),
    ],
  );

  await runtime.query(
    "INSERT INTO ai_adapters(id,machine_key,display_name,status) VALUES($1,'repair-ai','Repair AI','ACTIVE')",
    [IDS.adapter],
  );
  await runtime.query(
    "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name,status) VALUES($1,$2,'repair-surface','Repair surface','ACTIVE')",
    [IDS.surface, IDS.adapter],
  );
  await runtime.query(
    "INSERT INTO adapter_profiles(id,adapter_id,surface_id,variant_id,machine_key,display_name,status) VALUES($1,$2,$3,NULL,'repair-profile','Repair profile','ACTIVE')",
    [IDS.profile, IDS.adapter, IDS.surface],
  );

  const compatibility = {
    schemaVersion: "profile_compatibility_v1" as const,
    contractVersion: "control_plane_v1" as const,
    browserFamilies: ["chrome" as const, "opera" as const],
    minimumBrowserVersions: [
      { browserFamily: "chrome" as const, minimumVersion: "120.0" },
      { browserFamily: "opera" as const, minimumVersion: "120.0" },
    ],
    minimumExtensionVersion: "0.2.6",
  };
  const profileContent = (intervalMs: number) => ({
    schemaVersion: "adapter_profile_v1" as const,
    page: {
      identityStrategy: "page_identity" as const,
      conversationStrategy: "conversation_root" as const,
      composerStrategy: "composer_root" as const,
    },
    selectors: {
      conversation: {
        strategy: "conversation_root" as const,
        primary: {
          kind: "packaged_selector_reference" as const,
          reference: "conversation-root" as const,
        },
        fallbacks: [],
        timeoutMs: 1_000,
        observationMode: "polling" as const,
      },
      composer: {
        strategy: "composer_root" as const,
        primary: {
          kind: "packaged_selector_reference" as const,
          reference: "composer-root" as const,
        },
        fallbacks: [],
        timeoutMs: 1_000,
        observationMode: "polling" as const,
      },
      send: {
        strategy: "send_control" as const,
        primary: {
          kind: "packaged_selector_reference" as const,
          reference: "send-control" as const,
        },
        fallbacks: [],
        timeoutMs: 1_000,
        observationMode: "polling" as const,
      },
      assistantResponse: {
        strategy: "assistant_response" as const,
        primary: {
          kind: "packaged_selector_reference" as const,
          reference: "assistant-response" as const,
        },
        fallbacks: [],
        timeoutMs: 1_000,
        observationMode: "polling" as const,
      },
    },
    observation: { mode: "polling" as const, intervalMs },
    contours: [
      {
        key: "page_identity" as const,
        required: true,
        expectedState: "PRESENT" as const,
        strategy: "page_identity" as const,
      },
      {
        key: "conversation_root" as const,
        required: true,
        expectedState: "PRESENT" as const,
        strategy: "conversation_root" as const,
      },
      {
        key: "composer_root" as const,
        required: true,
        expectedState: "INTERACTIVE" as const,
        strategy: "composer_root" as const,
      },
      {
        key: "send_control" as const,
        required: true,
        expectedState: "INTERACTIVE" as const,
        strategy: "send_control" as const,
      },
    ],
  });
  const profilePayloads = {
    baseline: validateProfileContent({
      content: profileContent(101),
      compatibility,
    }),
    candidate: validateProfileContent({
      content: profileContent(102),
      compatibility,
    }),
    rollback: validateProfileContent({
      content: profileContent(103),
      compatibility,
    }),
    unrelated: validateProfileContent({
      content: profileContent(104),
      compatibility,
    }),
  };
  const revisions = [
    [IDS.baselineRevision, 1, profilePayloads.baseline],
    [IDS.candidateRevision, 2, profilePayloads.candidate],
    [IDS.rollbackRevision, 3, profilePayloads.rollback],
    [IDS.unrelatedRevision, 4, profilePayloads.unrelated],
  ] as const;
  for (const [id, revision, payload] of revisions) {
    await runtime.query(
      `INSERT INTO adapter_profile_revisions(
        id,profile_id,adapter_id,surface_id,variant_id,revision,schema_version,state,
        content,compatibility_constraints,content_sha256,published_at
      ) VALUES($1,$2,$3,$4,NULL,$5,'adapter_profile_v1',
        'DRAFT',$6::jsonb,$7::jsonb,$8,NULL)`,
      [
        id,
        IDS.profile,
        IDS.adapter,
        IDS.surface,
        revision,
        JSON.stringify(payload.content),
        JSON.stringify(payload.compatibility),
        payload.contentSha256,
      ],
    );
  }

  const fixtureLifecycle = createProfileLifecycleRepository(runtime);
  const systemContext = {
    actorType: "SYSTEM" as const,
    correlationId: "b19-fixture-profile-states",
    reason: "B19 fixture state transitions through production lifecycle",
  };
  for (const revision of [1, 2, 3, 4]) {
    await fixtureLifecycle.markProfileRevisionCandidate({
      profileId: IDS.profile,
      revision,
      context: systemContext,
    });
  }
  for (const revision of [1, 3, 4]) {
    await fixtureLifecycle.publishProfileRevision({
      profileId: IDS.profile,
      revision,
      context: systemContext,
    });
  }

  await runtime.query(
    `INSERT INTO health_suite_revisions(
      id,machine_key,revision,suite_kind,definition,definition_sha256
    ) VALUES($1,'repair_suite',1,'BASELINE_CONTRACT_FIXTURE','{}'::jsonb,$2)`,
    [IDS.suite, suiteDefinitionSha256],
  );

  await runtime.query(
    `INSERT INTO health_schedules(
      id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision
    ) VALUES($1,'repair_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',true,$2::jsonb,$3,1)`,
    [
      IDS.schedule,
      JSON.stringify({
        intervalSeconds: 5400,
        timeoutSeconds: 180,
        maxAttempts: 3,
        retryPolicyVersion: "health-retry-v1",
      }),
      new Date(BASE.valueOf() + 5_400_000),
    ],
  );
  await runtime.query(
    `INSERT INTO health_scheduled_runs(
      id,schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,
      due_slot_at,idempotency_key,state,attempt,started_at,finished_at,health_state
    ) VALUES($1,$2,'repair_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',1,
      $3,$4,'SUCCEEDED',1,$3,$5,'BROKEN')`,
    [
      IDS.scheduledRun,
      IDS.schedule,
      BASE,
      sha("d"),
      new Date(BASE.valueOf() + 1_000),
    ],
  );

  const runScope = JSON.stringify({
    schemaVersion: "repair-scope-v1",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    target: "repair_target",
  });
  for (const row of [
    {
      id: IDS.baselineRun,
      profileRevisionId: IDS.baselineRevision,
      profileRevision: 1,
      healthState: "HEALTHY",
      runKind: "BASELINE_CONTOUR",
    },
    {
      id: IDS.rollbackRun,
      profileRevisionId: IDS.rollbackRevision,
      profileRevision: 3,
      healthState: "HEALTHY",
      runKind: "BASELINE_CONTOUR",
    },
  ] as const) {
    await runtime.query(
      `INSERT INTO health_runs(
        id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,
        profile_revision_id,profile_revision,browser_family,browser_version,
        extension_version,adapter_engine_version,scheduled_run_id,health_level,
        health_state,classifier_version,scope,scope_sha256,operator_maintenance,
        operator_maintenance_authority,started_at,completed_at
      ) VALUES($1,'BASELINE_CONTOUR',$2,$3,$4,NULL,$5,$6,$7,'chrome','154.0.0.0',
        '0.2.6','repair-engine-v1',NULL,'H3',$8,'repair-fixture-v1',$9::jsonb,$10,
        false,NULL,$11,$12)`,
      [
        row.id,
        IDS.suite,
        IDS.adapter,
        IDS.surface,
        IDS.profile,
        row.profileRevisionId,
        row.profileRevision,
        row.healthState,
        runScope,
        scopeSha256,
        new Date(BASE.valueOf() - 20_000),
        new Date(BASE.valueOf() - 10_000),
      ],
    );
  }

  await runtime.query(
    `INSERT INTO health_runs(
      id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,
      profile_revision_id,profile_revision,browser_family,browser_version,
      extension_version,adapter_engine_version,scheduled_run_id,health_level,
      health_state,classifier_version,scope,scope_sha256,operator_maintenance,
      operator_maintenance_authority,started_at,completed_at
    ) VALUES($1,'NO_SESSION_OBSERVATION',NULL,$2,$3,NULL,$4,$5,1,'chrome',
      '154.0.0.0',NULL,NULL,$6,'H2','BROKEN','repair-fixture-v1',$7::jsonb,$8,
      false,NULL,$9,$10)`,
    [
      IDS.observationRun,
      IDS.adapter,
      IDS.surface,
      IDS.profile,
      IDS.baselineRevision,
      IDS.scheduledRun,
      runScope,
      scopeSha256,
      BASE,
      new Date(BASE.valueOf() + 1_000),
    ],
  );
  await runtime.query(
    "UPDATE health_scheduled_runs SET health_run_id=$2 WHERE id=$1",
    [IDS.scheduledRun, IDS.observationRun],
  );

  await runtime.query(
    `INSERT INTO health_no_session_observations(
      run_id,provider_id,observation_surface_id,target_key,strategy_id,
      strategy_revision,classification,classification_basis,surface_outcome,
      blocker,observed_at,result_sha256,observation
    ) VALUES($1,'chatgpt','CHATGPT_STANDARD','repair_target','repair-standard-v1',
      1,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE','BROWSER_UNAVAILABLE',
      $2,$3,$4::jsonb)`,
    [IDS.observationRun, BASE, sha("e"), JSON.stringify(obs)],
  );
  await runtime.query(
    `INSERT INTO health_no_session_run_receipts(
      run_id,scheduled_run_id,schedule_id,schedule_revision,due_slot_at,
      idempotency_key,monitor_target,health_state,scope_sha256,callback_result_sha256,
      normalized_result_sha256,adapter_id,surface_id,variant_id,profile_id,
      profile_revision_id,profile_revision,browser_family,completed_at,
      projection_applied_at,incident_processed_at
    ) VALUES($1,$2,$3,1,$4,$5,'repair_target','BROKEN',$6,$7,$8,$9,$10,NULL,
      $11,$12,1,'chrome',$13,$13,$13)`,
    [
      IDS.observationRun,
      IDS.scheduledRun,
      IDS.schedule,
      BASE,
      sha("d"),
      scopeSha256,
      sha("e"),
      normalized,
      IDS.adapter,
      IDS.surface,
      IDS.profile,
      IDS.baselineRevision,
      new Date(BASE.valueOf() + 1_000),
    ],
  );

  await runtime.query(
    `INSERT INTO health_no_session_scope_states(
      scope_sha256,provider_id,observation_surface_id,target_key,strategy_id,
      strategy_revision,browser_family,latest_run_id,latest_normalized_result_sha256,
      latest_health_state,latest_classification_basis,latest_surface_outcome,
      latest_blocker,latest_observed_at,last_attempt_at,last_verified_at
    ) VALUES($1,'chatgpt','CHATGPT_STANDARD','repair_target','repair-standard-v1',
      1,'chrome',$2,$3,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE',
      'BROWSER_UNAVAILABLE',$4,$5,$4)`,
    [
      retentionScope,
      IDS.observationRun,
      normalized,
      BASE,
      new Date(BASE.valueOf() + 1_000),
    ],
  );
  await runtime.query(
    `INSERT INTO health_no_session_recent_states(
      scope_sha256,slot,normalized_result_sha256,health_state,classification_basis,
      surface_outcome,blocker,summary,first_seen_at,last_seen_at,repeat_count,latest_run_id
    ) VALUES($1,1,$2,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE',
      'BROWSER_UNAVAILABLE',$3::jsonb,$4,$4,1,$5)`,
    [
      retentionScope,
      normalized,
      JSON.stringify({
        schemaVersion: "health_no_session_compact_v1",
        state: "BROKEN",
      }),
      BASE,
      IDS.observationRun,
    ],
  );

  await runtime.query(
    `INSERT INTO health_incidents(
      id,incident_scope_sha256,incident_key_sha256,scope_sha256,status,
      first_seen_run_id,latest_seen_run_id,root_contour_key,first_seen_at,last_seen_at,
      last_observed_run_id,last_observed_at
    ) VALUES($1,$2,$3,$4,'OPEN',$5,$5,NULL,$6,$6,$5,$6)`,
    [IDS.incident, sha("a"), sha("b"), scopeSha256, IDS.observationRun, BASE],
  );

  await runtime.query(
    `INSERT INTO health_profile_evaluations(
      id,evaluation_key_sha256,phase,provider,surface,target,variant,probe_layer,
      baseline_profile_revision_id,candidate_profile_revision_id,suite_machine_key,
      suite_revision,browser_family,browser_version,environment_class,status,outcome,
      recommendation,result,first_execution_id,latest_execution_id,
      first_evaluated_at,latest_evaluated_at
    ) VALUES($1,$2,'H4_CANDIDATE','chatgpt','CHATGPT_STANDARD','repair_target',NULL,
      'NO_SESSION',$3,$4,'repair_suite',1,'chrome','154.0.0.0','OWNER_TEST',
      'COMPLETED','PASS','PROMOTE','{}'::jsonb,$5,$5,$6,$6)`,
    [
      IDS.h4,
      h4Key,
      IDS.baselineRevision,
      IDS.candidateRevision,
      IDS.h4Execution,
      new Date(BASE.valueOf() + 2_000),
    ],
  );

  await runtime.query(
    `INSERT INTO adapter_profile_assignments(
      id,adapter_id,surface_id,variant_id,browser_family,subject_kind,cohort_seed,
      created_by_admin_principal_id
    ) VALUES($1,$2,$3,NULL,'chrome','ACCOUNT',$4,$5)`,
    [
      IDS.assignment,
      IDS.adapter,
      IDS.surface,
      Buffer.alloc(32, 7),
      IDS.principal,
    ],
  );
  await runtime.query(
    `INSERT INTO adapter_profile_assignment_revisions(
      id,assignment_id,revision,mode,baseline_profile_revision_id,
      candidate_profile_revision_id,percentage_bps,created_by_admin_principal_id,reason
    ) VALUES($1,$2,1,'DIRECT',$3,NULL,0,$4,'repair fixture baseline')`,
    [
      IDS.assignmentRevision,
      IDS.assignment,
      IDS.baselineRevision,
      IDS.principal,
    ],
  );

  const binding: MonitorProfileRepairBindingV1 = {
    schemaVersion: "monitor_profile_repair_binding_v1",
    repairCaseId: IDS.repairCase,
    caseRevision: 1,
    incidentId: IDS.incident,
    scopeSha256,
    deploymentEnvironment: "OWNER_TEST",
    observation: {
      runId: IDS.observationRun,
      normalizedStateSha256: normalized,
    },
    acceptedBaseline: {
      acceptedRunId: IDS.baselineRun,
      profile: {
        profileId: IDS.profile,
        profileRevisionId: IDS.baselineRevision,
        revision: 1,
        contentSha256: profilePayloads.baseline.contentSha256,
      },
    },
    candidate: {
      profileId: IDS.profile,
      profileRevisionId: IDS.candidateRevision,
      revision: 2,
      contentSha256: profilePayloads.candidate.contentSha256,
    },
    testedExtension: {
      version: "0.2.6",
      browserFamily: "chrome",
      browserVersion: "154.0.0.0",
      sourceCommitSha: gitSha("a"),
      sourceTreeSha: gitSha("b"),
      packageSha256: sha("9"),
    },
    suite: {
      machineKey: "repair_suite",
      revision: 1,
      definitionSha256: suiteDefinitionSha256,
    },
    validation: {
      h4EvaluationKey: h4Key,
      installedBehaviorEvidenceSha256: sha("6"),
      matrixSha256: sha("7"),
      resultsSha256: sha("8"),
    },
    assignment: {
      id: IDS.assignment,
      expectedRevision: 1,
      initialPercentageBps: 1_000,
    },
    rollback: {
      acceptedRunId: IDS.rollbackRun,
      profile: {
        profileId: IDS.profile,
        profileRevisionId: IDS.rollbackRevision,
        revision: 3,
        contentSha256: profilePayloads.rollback.contentSha256,
      },
    },
  };

  const evidence: MonitorProfileRepairTrustedEvidence = {
    deploymentEnvironment: "OWNER_TEST",
    testedExtension: binding.testedExtension,
    extensionAccepted: true,
    h4EnvironmentClass: "OWNER_TEST",
    installedBehaviorEvidenceSha256:
      binding.validation.installedBehaviorEvidenceSha256,
    installedBehaviorPassed: true,
    matrixSha256: binding.validation.matrixSha256,
    matrixPassed: true,
    resultsSha256: binding.validation.resultsSha256,
    resultsPassed: true,
    latestObservationNormalizedStateSha256: normalized,
    latestObservationFresh: true,
    rollbackUsable: true,
  };
  const evidenceBox = { value: evidence };
  const clockBox = {
    value: new Date("2026-09-28T09:10:00.000Z"),
  };
  const repository = createMonitorProfileRepairAdmissionRepository(runtime, {
    evidenceResolver: async () => ({ ...evidenceBox.value }),
    clock: () => new Date(clockBox.value),
  });
  const lifecycle = createProfileLifecycleRepository(runtime);

  return {
    binding,
    evidenceBox,
    clockBox,
    repository,
    lifecycle,
    normalized,
    retentionScope,
  };
}

async function appendIdenticalBrokenObservation(
  fixture: Fixture,
  input: {
    observedAt: Date;
    idempotencyChar: string;
    processIncident: boolean;
  },
): Promise<string> {
  if (input.idempotencyChar.length !== 1)
    throw new Error("B19_TEST_IDEMPOTENCY_CHAR_REQUIRED");
  const runId = randomUUID();
  const scheduledRunId = randomUUID();
  const completedAt = new Date(input.observedAt.valueOf() + 1_000);
  const idempotencyKey = sha(input.idempotencyChar);
  const nextObservation = NoSessionObservationResultSchema.parse({
    ...observation(),
    observedAt: input.observedAt.toISOString(),
  });

  await runtime.query(
    `INSERT INTO health_scheduled_runs
     SELECT (
       jsonb_populate_record(
         NULL::health_scheduled_runs,
         to_jsonb(source)
         || jsonb_build_object(
           'id',$2::text,
           'due_slot_at',$3::text,
           'idempotency_key',$4::text,
           'health_run_id',NULL,
           'started_at',$3::text,
           'finished_at',$5::text
         )
       )
     ).*
     FROM health_scheduled_runs source WHERE id=$1`,
    [
      IDS.scheduledRun,
      scheduledRunId,
      input.observedAt,
      idempotencyKey,
      completedAt,
    ],
  );
  await runtime.query(
    `INSERT INTO health_runs
     SELECT (
       jsonb_populate_record(
         NULL::health_runs,
         to_jsonb(source)
         || jsonb_build_object(
           'id',$2::text,
           'scheduled_run_id',$3::text,
           'started_at',$4::text,
           'completed_at',$5::text
         )
       )
     ).*
     FROM health_runs source WHERE id=$1`,
    [IDS.observationRun, runId, scheduledRunId, input.observedAt, completedAt],
  );
  await runtime.query(
    "UPDATE health_scheduled_runs SET health_run_id=$2 WHERE id=$1",
    [scheduledRunId, runId],
  );
  await runtime.query(
    `INSERT INTO health_no_session_observations
     SELECT (
       jsonb_populate_record(
         NULL::health_no_session_observations,
         to_jsonb(source)
         || jsonb_build_object(
           'run_id',$2::text,
           'observed_at',$3::text,
           'observation',$4::jsonb
         )
       )
     ).*
     FROM health_no_session_observations source WHERE run_id=$1`,
    [
      IDS.observationRun,
      runId,
      input.observedAt,
      JSON.stringify(nextObservation),
    ],
  );
  await runtime.query(
    `INSERT INTO health_no_session_run_receipts
     SELECT (
       jsonb_populate_record(
         NULL::health_no_session_run_receipts,
         to_jsonb(source)
         || jsonb_build_object(
           'run_id',$2::text,
           'scheduled_run_id',$3::text,
           'due_slot_at',$4::text,
           'idempotency_key',$5::text,
           'completed_at',$6::text,
           'incident_processed_at',NULL
         )
       )
     ).*
     FROM health_no_session_run_receipts source WHERE run_id=$1`,
    [
      IDS.observationRun,
      runId,
      scheduledRunId,
      input.observedAt,
      idempotencyKey,
      completedAt,
    ],
  );
  await runtime.query(
    `UPDATE health_no_session_scope_states SET
      latest_run_id=$2,
      latest_normalized_result_sha256=$3,
      latest_health_state='BROKEN',
      latest_observed_at=$4,
      last_attempt_at=$5,
      last_verified_at=$4,
      updated_at=$5
     WHERE scope_sha256=$1`,
    [
      fixture.retentionScope,
      runId,
      fixture.normalized,
      input.observedAt,
      completedAt,
    ],
  );
  await runtime.query(
    `UPDATE health_no_session_recent_states SET
      latest_run_id=$3,
      last_seen_at=$4,
      repeat_count=repeat_count+1,
      updated_at=$5
     WHERE scope_sha256=$1 AND normalized_result_sha256=$2`,
    [
      fixture.retentionScope,
      fixture.normalized,
      runId,
      input.observedAt,
      completedAt,
    ],
  );

  if (input.processIncident) {
    await runtime.query(
      `UPDATE health_incidents SET
        latest_seen_run_id=$2,
        last_seen_at=$3,
        last_observed_run_id=$2,
        last_observed_at=$3,
        updated_at=GREATEST(updated_at,$3)
       WHERE id=$1 AND status IN (
         'OPEN','INVESTIGATING','CANDIDATE_FIX','CANDIDATE_PASS',
         'CANARY_ROLLOUT','ROLLOUT','MAINTENANCE'
       )`,
      [IDS.incident, runId, completedAt],
    );
    await runtime.query(
      `UPDATE health_no_session_run_receipts
       SET incident_processed_at=$2 WHERE run_id=$1`,
      [runId, completedAt],
    );
  }

  return runId;
}

async function revokeFixtureOwnerPermission(): Promise<void> {
  const backupUserId = randomUUID();
  const backupPrincipalId = randomUUID();
  await runtime.query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [
    backupUserId,
  ]);
  await runtime.query(
    "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
    [
      backupPrincipalId,
      backupUserId,
      new Date(BASE.valueOf() - 24 * 60 * 60 * 1_000),
    ],
  );
  await runtime.query(
    "INSERT INTO admin_role_grants(id,admin_principal_id,role,granted_at,granted_by_admin_principal_id) VALUES($1,$2,'ADMIN_OWNER',$3,$4)",
    [
      randomUUID(),
      backupPrincipalId,
      new Date(BASE.valueOf() - 24 * 60 * 60 * 1_000),
      IDS.principal,
    ],
  );

  const result = await createAdminOpsRepository(runtime).revokeRole({
    actorId: IDS.principal,
    principalId: IDS.principal,
    role: "ADMIN_OWNER",
    expectedRevision: 1,
    correlationId: randomUUID(),
    reason: "B19 fixture current-permission loss",
  });
  if (result.kind !== "OK")
    throw new Error(`B19_PERMISSION_REVOKE_FIXTURE_FAILED_${result.kind}`);
}

async function registerAndApprove(
  fixture: Fixture,
  binding: MonitorProfileRepairBindingV1 = fixture.binding,
) {
  const registered = await fixture.repository.registerCandidate({
    binding,
  });
  const request: MonitorProfileRepairDecisionRequestV1 = {
    idempotencyKey: randomUUID(),
    repairCaseId: binding.repairCaseId,
    expectedCaseRevision: binding.caseRevision,
    expectedBindingSha256: registered.bindingSha256,
    decision: "APPROVED",
    manualCheck: {
      checkedBindingSha256: registered.bindingSha256,
      checklistSha256: sha("0"),
      result: "PASS",
    },
  };
  const approval = await fixture.repository.recordDecision({
    request,
    operatorPrincipalId: IDS.principal,
  });
  return { registered, request, approval };
}

describe.sequential(
  "B19 monitor profile repair admission PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await lockerRuntime.ready();
    });
    afterAll(async () => {
      await lockerRuntime.close();
      await runtime.close();
    });

    it("registers one immutable exact binding and rejects missing evidence or conflicting replay", async () => {
      const fixture = await setupFixture();
      const noEvidence = createMonitorProfileRepairAdmissionRepository(runtime);
      await expect(
        noEvidence.registerCandidate({ binding: fixture.binding }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_EVIDENCE_RESOLVER_REQUIRED");

      await expect(
        fixture.repository.registerCandidate({
          binding: {
            ...fixture.binding,
            candidate: {
              ...fixture.binding.candidate,
              contentSha256: sha("e"),
            },
          },
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_CANDIDATE_PROFILE_CHANGED");
      await expect(
        fixture.repository.registerCandidate({
          binding: {
            ...fixture.binding,
            suite: {
              ...fixture.binding.suite,
              definitionSha256: sha("e"),
            },
          },
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_SUITE_CHANGED");

      const first = await fixture.repository.registerCandidate({
        binding: fixture.binding,
      });
      const second = await fixture.repository.registerCandidate({
        binding: fixture.binding,
      });
      expect(second).toEqual(first);
      expect(first.bindingSha256).toBe(
        monitorProfileRepairBindingSha256(fixture.binding),
      );

      await expect(
        fixture.repository.registerCandidate({
          binding: {
            ...fixture.binding,
            validation: {
              ...fixture.binding.validation,
              matrixSha256: sha("e"),
            },
          },
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_REGISTRATION_CONFLICT");

      await expect(
        runtime.query(
          "UPDATE monitor_profile_repair_bindings SET scope_sha256=$2 WHERE repair_case_id=$1",
          [fixture.binding.repairCaseId, sha("f")],
        ),
      ).rejects.toBeInstanceOf(Error);
    });

    it("keeps operator decision replay idempotent and does not renew or bypass permissions", async () => {
      const fixture = await setupFixture();
      const registered = await fixture.repository.registerCandidate({
        binding: fixture.binding,
      });
      const idempotencyKey = randomUUID();
      const request: MonitorProfileRepairDecisionRequestV1 = {
        idempotencyKey,
        repairCaseId: fixture.binding.repairCaseId,
        expectedCaseRevision: 1,
        expectedBindingSha256: registered.bindingSha256,
        decision: "APPROVED",
        manualCheck: {
          checkedBindingSha256: registered.bindingSha256,
          checklistSha256: sha("0"),
          result: "PASS",
        },
      };
      const first = await fixture.repository.recordDecision({
        request,
        operatorPrincipalId: IDS.principal,
      });
      fixture.clockBox.value = new Date(
        fixture.clockBox.value.valueOf() + 60 * 60 * 1_000,
      );
      const replay = await fixture.repository.recordDecision({
        request,
        operatorPrincipalId: IDS.principal,
      });
      expect(replay).toEqual(first);
      expect(replay.expiresAt).toBe(first.expiresAt);

      await expect(
        fixture.repository.recordDecision({
          request: {
            ...request,
            manualCheck: {
              ...request.manualCheck,
              checklistSha256: sha("a"),
            },
          },
          operatorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_DECISION_IDEMPOTENCY_CONFLICT");

      await revokeFixtureOwnerPermission();
      await expect(
        fixture.repository.recordDecision({
          request: {
            ...request,
            idempotencyKey: randomUUID(),
          },
          operatorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("ADMIN_FORBIDDEN");

      const replayAfterPermissionLoss = await fixture.repository.recordDecision(
        {
          request,
          operatorPrincipalId: IDS.principal,
        },
      );
      expect(replayAfterPermissionLoss).toEqual(first);
    });

    it("serializes concurrent apply and replays one committed operation without duplicate assignment", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const command = {
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      };

      const [first, second] = await Promise.all([
        fixture.repository.applyInitialRollout(command),
        fixture.repository.applyInitialRollout(command),
      ]);
      expect(second).toEqual(first);

      const replay = await fixture.repository.applyInitialRollout(command);
      expect(replay).toEqual(first);
      const counts = await runtime.query<{
        operations: string;
        assignmentRevisions: string;
        candidateState: string;
      }>(
        `SELECT
        (SELECT count(*)::text FROM monitor_profile_repair_operations) AS operations,
        (SELECT count(*)::text FROM adapter_profile_assignment_revisions
          WHERE assignment_id=$1) AS "assignmentRevisions",
        (SELECT state::text FROM adapter_profile_revisions WHERE id=$2)
          AS "candidateState"`,
        [IDS.assignment, IDS.candidateRevision],
      );
      expect(counts.rows[0]).toEqual({
        operations: "1",
        assignmentRevisions: "2",
        candidateState: "PUBLISHED",
      });
      expect(first.assignmentRevision).toBe(2);
      expect(first.percentageBps).toBe(1_000);
    });

    it("blocks old publish/exposure bypass, allows exact pause and bound rollback only", async () => {
      const fixture = await setupFixture();
      await fixture.repository.registerCandidate({ binding: fixture.binding });
      const systemContext = {
        actorType: "SYSTEM" as const,
        correlationId: "b19-bypass",
        reason: "B19 direct bypass regression",
      };

      await expect(
        fixture.lifecycle.publishProfileRevision({
          profileId: IDS.profile,
          revision: 2,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair candidate requires current repair admission/,
      );

      await expect(
        runtime.query(
          `INSERT INTO adapter_profile_assignment_revisions(
          id,assignment_id,revision,mode,baseline_profile_revision_id,
          candidate_profile_revision_id,percentage_bps,reason
        ) VALUES($1,$2,2,'ROLLOUT',$3,$4,1000,'raw bypass')`,
          [
            randomUUID(),
            IDS.assignment,
            IDS.baselineRevision,
            IDS.candidateRevision,
          ],
        ),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );

      const { approval } = await registerAndApprove(fixture);
      await fixture.repository.applyInitialRollout({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      });

      const secondAssignment = await fixture.lifecycle.createAssignmentScope({
        scope: {
          adapterId: IDS.adapter,
          surfaceId: IDS.surface,
          variantId: null,
          browserFamily: "opera",
          subjectKind: "DEVICE",
        },
        context: systemContext,
      });
      await expect(
        fixture.lifecycle.assignDirect({
          assignmentId: secondAssignment.id,
          baselineProfileRevisionId: IDS.candidateRevision,
          expectedLatestAssignmentRevision: null,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );

      await expect(
        fixture.lifecycle.changeRolloutPercentage({
          assignmentId: IDS.assignment,
          percentageBps: 2_000,
          expectedLatestAssignmentRevision: 2,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );
      await expect(
        fixture.lifecycle.completeRollout({
          assignmentId: IDS.assignment,
          expectedLatestAssignmentRevision: 2,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );
      await expect(
        fixture.lifecycle.rollbackProfileAssignment({
          assignmentId: IDS.assignment,
          profileRevisionId: IDS.unrelatedRevision,
          expectedLatestAssignmentRevision: 2,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );

      const paused = await fixture.lifecycle.pauseProfileRollout({
        assignmentId: IDS.assignment,
        expectedLatestAssignmentRevision: 2,
        context: systemContext,
      });
      expect(paused).toMatchObject({
        revision: 3,
        mode: "PAUSED",
        candidateProfileRevisionId: IDS.candidateRevision,
        percentageBps: 1_000,
      });
      await expect(
        fixture.lifecycle.resumeProfileRollout({
          assignmentId: IDS.assignment,
          expectedLatestAssignmentRevision: 3,
          context: systemContext,
        }),
      ).rejects.toThrow(
        /registered repair assignment requires current repair admission/,
      );

      const rolledBack = await fixture.lifecycle.rollbackProfileAssignment({
        assignmentId: IDS.assignment,
        profileRevisionId: IDS.rollbackRevision,
        expectedLatestAssignmentRevision: 3,
        context: systemContext,
      });
      expect(rolledBack).toMatchObject({
        revision: 4,
        mode: "DIRECT",
        baselineProfileRevisionId: IDS.rollbackRevision,
        candidateProfileRevisionId: null,
      });
    });

    it("fails closed when trusted matrix or current observation drifts", async () => {
      const matrixFixture = await setupFixture();
      const matrixApproval = await registerAndApprove(matrixFixture);
      matrixFixture.evidenceBox.value = {
        ...matrixFixture.evidenceBox.value,
        matrixSha256: sha("e"),
      };
      await expect(
        matrixFixture.repository.applyInitialRollout({
          repairCaseId: matrixFixture.binding.repairCaseId,
          caseRevision: 1,
          approvalId: matrixApproval.approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_EXTERNAL_EVIDENCE_CHANGED");

      const unknownFixture = await setupFixture();
      const unknownApproval = await registerAndApprove(unknownFixture);
      await runtime.query(
        `UPDATE health_no_session_scope_states
         SET latest_health_state='UNKNOWN'
         WHERE scope_sha256=$1`,
        [unknownFixture.retentionScope],
      );
      await expect(
        unknownFixture.repository.applyInitialRollout({
          repairCaseId: unknownFixture.binding.repairCaseId,
          caseRevision: 1,
          approvalId: unknownApproval.approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_CURRENT_OBSERVATION_CHANGED");
    });

    it("fails closed when H4 target or probe layer drifts", async () => {
      const h4Fixture = await setupFixture();
      await runtime.query(
        "UPDATE health_profile_evaluations SET target='other-target' WHERE id=$1",
        [IDS.h4],
      );
      await expect(
        h4Fixture.repository.registerCandidate({ binding: h4Fixture.binding }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_H4_AUTHORITY_CHANGED");

      const probeLayerFixture = await setupFixture();
      await runtime.query(
        "UPDATE health_profile_evaluations SET probe_layer='AUTHENTICATED_DEEP' WHERE id=$1",
        [IDS.h4],
      );
      await expect(
        probeLayerFixture.repository.registerCandidate({
          binding: probeLayerFixture.binding,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_H4_AUTHORITY_CHANGED");
    });

    it("rejects registration when the pinned observation is not part of the incident", async () => {
      const fixture = await setupFixture();
      const unrelatedRunId = await appendIdenticalBrokenObservation(fixture, {
        observedAt: new Date(BASE.valueOf() + 15_000),
        idempotencyChar: "1",
        processIncident: false,
      });
      const unrelatedBinding: MonitorProfileRepairBindingV1 = {
        ...fixture.binding,
        observation: {
          ...fixture.binding.observation,
          runId: unrelatedRunId,
        },
      };

      await expect(
        fixture.repository.registerCandidate({ binding: unrelatedBinding }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_INCIDENT_OBSERVATION_MISMATCH");
    });

    it("keeps a registered mid-incident trigger valid after an identical later incident observation", async () => {
      const fixture = await setupFixture();
      const triggerRunId = await appendIdenticalBrokenObservation(fixture, {
        observedAt: new Date(BASE.valueOf() + 30_000),
        idempotencyChar: "2",
        processIncident: true,
      });
      const triggerBinding: MonitorProfileRepairBindingV1 = {
        ...fixture.binding,
        observation: {
          ...fixture.binding.observation,
          runId: triggerRunId,
        },
      };
      const { approval } = await registerAndApprove(fixture, triggerBinding);

      const laterRunId = await appendIdenticalBrokenObservation(fixture, {
        observedAt: new Date(BASE.valueOf() + 60_000),
        idempotencyChar: "3",
        processIncident: true,
      });
      const incident = await runtime.query<{
        firstSeenRunId: string;
        latestSeenRunId: string;
        lastObservedRunId: string;
      }>(
        `SELECT first_seen_run_id AS "firstSeenRunId",
          latest_seen_run_id AS "latestSeenRunId",
          last_observed_run_id AS "lastObservedRunId"
         FROM health_incidents WHERE id=$1`,
        [IDS.incident],
      );
      expect(incident.rows[0]).toMatchObject({
        firstSeenRunId: IDS.observationRun,
        latestSeenRunId: laterRunId,
        lastObservedRunId: laterRunId,
      });
      expect(triggerRunId).not.toBe(incident.rows[0]?.firstSeenRunId);
      expect(triggerRunId).not.toBe(incident.rows[0]?.latestSeenRunId);
      expect(triggerRunId).not.toBe(incident.rows[0]?.lastObservedRunId);

      fixture.clockBox.value = new Date("2026-09-28T09:11:00.000Z");
      const command = {
        repairCaseId: triggerBinding.repairCaseId,
        caseRevision: triggerBinding.caseRevision,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      };
      const first = await fixture.repository.applyInitialRollout(command);
      const replay = await fixture.repository.applyInitialRollout(command);
      expect(replay).toEqual(first);
      expect(first).toMatchObject({
        repairCaseId: triggerBinding.repairCaseId,
        caseRevision: triggerBinding.caseRevision,
        approvalId: approval.id,
        percentageBps: triggerBinding.assignment.initialPercentageBps,
      });

      const counts = await runtime.query<{
        operations: string;
        assignmentRevisions: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM monitor_profile_repair_operations)
            AS operations,
          (SELECT count(*)::text FROM adapter_profile_assignment_revisions
           WHERE assignment_id=$1) AS "assignmentRevisions"`,
        [IDS.assignment],
      );
      expect(counts.rows[0]).toEqual({
        operations: "1",
        assignmentRevisions: "2",
      });
    });

    it("rejects apply when the registered incident has resolved", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const resolvedAt = new Date();
      await runtime.query(
        `UPDATE health_incidents SET
          status='RESOLVED',
          resolved_by_run_id=last_observed_run_id,
          resolved_at=$2,
          updated_at=$2
         WHERE id=$1`,
        [IDS.incident, resolvedAt],
      );

      await expect(
        fixture.repository.applyInitialRollout({
          repairCaseId: fixture.binding.repairCaseId,
          caseRevision: fixture.binding.caseRevision,
          approvalId: approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_INCIDENT_NOT_ACTIVE");
    });

    it("keeps approval current across a newer identical semantic observation", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const newerRunId = randomUUID();
      const newerObservedAt = new Date(BASE.valueOf() + 30_000);
      await runtime.query(
        `UPDATE health_no_session_scope_states SET
          latest_run_id=$2,
          latest_normalized_result_sha256=$3,
          latest_health_state='BROKEN',
          latest_observed_at=$4,
          last_attempt_at=$4,
          last_verified_at=$4
         WHERE scope_sha256=$1`,
        [
          fixture.retentionScope,
          newerRunId,
          fixture.normalized,
          newerObservedAt,
        ],
      );

      const applied = await fixture.repository.applyInitialRollout({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      });
      expect(applied).toMatchObject({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        percentageBps: fixture.binding.assignment.initialPercentageBps,
      });
    });

    it("fails closed when exact validation results hash drifts", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      fixture.evidenceBox.value = {
        ...fixture.evidenceBox.value,
        resultsSha256: sha("e"),
      };
      await expect(
        fixture.repository.applyInitialRollout({
          repairCaseId: fixture.binding.repairCaseId,
          caseRevision: 1,
          approvalId: approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("MONITOR_PROFILE_REPAIR_EXTERNAL_EVIDENCE_CHANGED");
    });

    it("blocks revoked approval and current operator permission loss", async () => {
      const revokedFixture = await setupFixture();
      const revoked = await registerAndApprove(revokedFixture);
      const revokedReceipt = await revokedFixture.repository.revokeDecision({
        approvalId: revoked.approval.id,
        actorPrincipalId: IDS.principal,
      });
      expect(revokedReceipt.revokedAt).not.toBeNull();
      await expect(
        revokedFixture.repository.applyInitialRollout({
          repairCaseId: revokedFixture.binding.repairCaseId,
          caseRevision: 1,
          approvalId: revoked.approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow(/APPROVAL_REVOKED/);

      const permissionFixture = await setupFixture();
      const permissionApproval = await registerAndApprove(permissionFixture);
      await revokeFixtureOwnerPermission();
      await expect(
        permissionFixture.repository.applyInitialRollout({
          repairCaseId: permissionFixture.binding.repairCaseId,
          caseRevision: 1,
          approvalId: permissionApproval.approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ).rejects.toThrow("ADMIN_FORBIDDEN");
    });

    it("serializes concurrent apply and revoke without lock-order deadlock", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const command = {
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      };

      const [apply, revoke] = await Promise.allSettled([
        fixture.repository.applyInitialRollout(command),
        fixture.repository.revokeDecision({
          approvalId: approval.id,
          actorPrincipalId: IDS.principal,
        }),
      ]);

      for (const outcome of [apply, revoke]) {
        if (outcome.status === "rejected") {
          const message =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          expect(message).not.toMatch(/deadlock detected/i);
          expect(message).toMatch(/APPROVAL_REVOKED/);
        }
      }
      expect(revoke.status).toBe("fulfilled");

      const state = await runtime.query<{
        operations: string;
        assignmentRevisions: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM monitor_profile_repair_operations)
            AS operations,
          (SELECT count(*)::text FROM adapter_profile_assignment_revisions
           WHERE assignment_id=$1) AS "assignmentRevisions"`,
        [IDS.assignment],
      );
      if (apply.status === "fulfilled") {
        expect(state.rows[0]).toEqual({
          operations: "1",
          assignmentRevisions: "2",
        });
      } else {
        expect(state.rows[0]).toEqual({
          operations: "0",
          assignmentRevisions: "1",
        });
      }
    });

    it("uses post-lock server time so approval can expire while apply waits", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);

      let lockedResolve!: () => void;
      let releaseResolve!: () => void;
      const locked = new Promise<void>((resolve) => {
        lockedResolve = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      const blocker = lockerRuntime.transaction(async (q) => {
        await q.query(
          `SELECT repair_case_id
           FROM monitor_profile_repair_bindings
           WHERE repair_case_id=$1 AND case_revision=1
           FOR UPDATE`,
          [fixture.binding.repairCaseId],
        );
        lockedResolve();
        await release;
      });
      await locked;

      const apply = fixture.repository.applyInitialRollout({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      });
      const expiredAssertion =
        expect(apply).rejects.toThrow(/APPROVAL_EXPIRED/);
      await new Promise((resolve) => setTimeout(resolve, 50));
      fixture.clockBox.value = new Date(Date.parse(approval.expiresAt));
      releaseResolve();
      await blocker;
      await expiredAssertion;

      const assignment = await runtime.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM adapter_profile_assignment_revisions
         WHERE assignment_id=$1`,
        [IDS.assignment],
      );
      expect(assignment.rows[0]?.count).toBe("1");
    });

    it("reads pending cases with stable pagination and strict scope isolation", async () => {
      const fixture = await setupFixture();
      await fixture.repository.registerCandidate({ binding: fixture.binding });
      const secondBinding: MonitorProfileRepairBindingV1 = {
        ...fixture.binding,
        repairCaseId: randomUUID(),
      };
      await fixture.repository.registerCandidate({ binding: secondBinding });

      const reads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(fixture.clockBox.value),
      });
      const firstPage = await reads.listCases({
        scopeSha256: fixture.binding.scopeSha256,
        limit: 1,
      });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();
      const cursor = firstPage.nextCursor!;
      const secondPage = await reads.listCases({
        scopeSha256: fixture.binding.scopeSha256,
        limit: 1,
        cursor: {
          createdAt: new Date(cursor.createdAt),
          repairCaseId: cursor.repairCaseId,
          caseRevision: cursor.caseRevision,
        },
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set([
          firstPage.items[0]!.repairCaseId,
          secondPage.items[0]!.repairCaseId,
        ]),
      ).toEqual(
        new Set([fixture.binding.repairCaseId, secondBinding.repairCaseId]),
      );

      const detail = await reads.getCase({
        scopeSha256: fixture.binding.scopeSha256,
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: fixture.binding.caseRevision,
      });
      expect(detail).toMatchObject({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        bindingSha256: monitorProfileRepairBindingSha256(fixture.binding),
        caseState: "PENDING_APPROVAL",
        staleReasons: [],
        executionAuthority: false,
        candidate: {
          profileRevisionId: fixture.binding.candidate.profileRevisionId,
          revision: fixture.binding.candidate.revision,
          contentSha256: fixture.binding.candidate.contentSha256,
          state: "CANDIDATE",
        },
        decision: null,
        operation: null,
      });
      expect(detail?.testEvidence).toMatchObject({
        suiteMachineKey: fixture.binding.suite.machineKey,
        suiteRevision: fixture.binding.suite.revision,
        suiteDefinitionSha256: fixture.binding.suite.definitionSha256,
        h4EvaluationKey: fixture.binding.validation.h4EvaluationKey,
        installedBehaviorEvidenceSha256:
          fixture.binding.validation.installedBehaviorEvidenceSha256,
        matrixSha256: fixture.binding.validation.matrixSha256,
        resultsSha256: fixture.binding.validation.resultsSha256,
      });
      expect(
        await reads.getCase({
          scopeSha256: sha("d"),
          repairCaseId: fixture.binding.repairCaseId,
          caseRevision: 1,
        }),
      ).toBeNull();
      expect(
        (
          await reads.listCases({
            scopeSha256: sha("d"),
            limit: 10,
          })
        ).items,
      ).toEqual([]);

      const serialized = JSON.stringify(detail);
      expect(serialized).not.toContain('"binding":');
      expect(serialized).not.toContain('"request":');
      expect(serialized).not.toContain('"result":');
    });

    it("shows current approval without treating the read model as execution authority", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const reads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(fixture.clockBox.value),
      });

      const current = await reads.getCase({
        scopeSha256: fixture.binding.scopeSha256,
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
      });
      expect(current).toMatchObject({
        caseState: "APPROVAL_CURRENT",
        staleReasons: [],
        executionAuthority: false,
        decision: {
          id: approval.id,
          decision: "APPROVED",
          state: "CURRENT_APPROVED",
        },
      });

      const newerRunId = randomUUID();
      await runtime.query(
        `UPDATE health_no_session_scope_states SET
          latest_run_id=$2,
          latest_normalized_result_sha256=$3,
          latest_health_state='BROKEN',
          latest_observed_at=$4,
          last_attempt_at=$4,
          last_verified_at=$4
         WHERE scope_sha256=$1`,
        [
          fixture.retentionScope,
          newerRunId,
          fixture.normalized,
          new Date(BASE.valueOf() + 30_000),
        ],
      );
      const sameSemanticState = await reads.getCase({
        scopeSha256: fixture.binding.scopeSha256,
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
      });
      expect(sameSemanticState).toMatchObject({
        caseState: "APPROVAL_CURRENT",
        staleReasons: [],
        executionAuthority: false,
        observation: {
          currentRunId: newerRunId,
          currentNormalizedStateSha256: fixture.normalized,
          currentHealthState: "BROKEN",
        },
        decision: { state: "CURRENT_APPROVED" },
      });
    });

    it("surfaces expired, revoked and rejected decisions explicitly", async () => {
      const expiredFixture = await setupFixture();
      const expired = await registerAndApprove(expiredFixture);
      const expiredReads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(Date.parse(expired.approval.expiresAt)),
      });
      expect(
        await expiredReads.getCase({
          scopeSha256: expiredFixture.binding.scopeSha256,
          repairCaseId: expiredFixture.binding.repairCaseId,
          caseRevision: 1,
        }),
      ).toMatchObject({
        caseState: "APPROVAL_EXPIRED",
        decision: { state: "EXPIRED" },
        executionAuthority: false,
      });

      const revokedFixture = await setupFixture();
      const revoked = await registerAndApprove(revokedFixture);
      await revokedFixture.repository.revokeDecision({
        approvalId: revoked.approval.id,
        actorPrincipalId: IDS.principal,
      });
      const revokedReads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(revokedFixture.clockBox.value),
      });
      expect(
        await revokedReads.getCase({
          scopeSha256: revokedFixture.binding.scopeSha256,
          repairCaseId: revokedFixture.binding.repairCaseId,
          caseRevision: 1,
        }),
      ).toMatchObject({
        caseState: "APPROVAL_REVOKED",
        decision: { state: "REVOKED" },
        executionAuthority: false,
      });

      const rejectedFixture = await setupFixture();
      const registered = await rejectedFixture.repository.registerCandidate({
        binding: rejectedFixture.binding,
      });
      const rejectedRequest: MonitorProfileRepairDecisionRequestV1 = {
        idempotencyKey: randomUUID(),
        repairCaseId: rejectedFixture.binding.repairCaseId,
        expectedCaseRevision: 1,
        expectedBindingSha256: registered.bindingSha256,
        decision: "REJECTED",
        manualCheck: {
          checkedBindingSha256: registered.bindingSha256,
          checklistSha256: sha("0"),
          result: "PASS",
        },
      };
      await rejectedFixture.repository.recordDecision({
        request: rejectedRequest,
        operatorPrincipalId: IDS.principal,
      });
      const rejectedReads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(rejectedFixture.clockBox.value),
      });
      expect(
        await rejectedReads.getCase({
          scopeSha256: rejectedFixture.binding.scopeSha256,
          repairCaseId: rejectedFixture.binding.repairCaseId,
          caseRevision: 1,
        }),
      ).toMatchObject({
        caseState: "REJECTED",
        decision: { decision: "REJECTED", state: "REJECTED" },
        executionAuthority: false,
      });
    });

    it("marks an approved case stale when authoritative observation changes", async () => {
      const fixture = await setupFixture();
      await registerAndApprove(fixture);
      await runtime.query(
        `UPDATE health_no_session_scope_states
         SET latest_health_state='UNKNOWN'
         WHERE scope_sha256=$1`,
        [fixture.retentionScope],
      );
      const reads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(fixture.clockBox.value),
      });
      const detail = await reads.getCase({
        scopeSha256: fixture.binding.scopeSha256,
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
      });
      expect(detail).toMatchObject({
        caseState: "APPROVAL_STALE",
        executionAuthority: false,
        decision: { state: "STALE_APPROVED" },
      });
      expect(detail?.staleReasons).toContain("CURRENT_OBSERVATION_CHANGED");
    });

    it("shows committed rollout identity as applied while keeping execution authority false", async () => {
      const fixture = await setupFixture();
      const { approval } = await registerAndApprove(fixture);
      const applied = await fixture.repository.applyInitialRollout({
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
        approvalId: approval.id,
        actorPrincipalId: IDS.principal,
      });
      fixture.clockBox.value = new Date(
        fixture.clockBox.value.valueOf() + 60 * 1_000,
      );
      await fixture.repository.recordDecision({
        request: {
          idempotencyKey: randomUUID(),
          repairCaseId: fixture.binding.repairCaseId,
          expectedCaseRevision: 1,
          expectedBindingSha256: approval.bindingSha256,
          decision: "REJECTED",
          manualCheck: {
            checkedBindingSha256: approval.bindingSha256,
            checklistSha256: sha("1"),
            result: "PASS",
          },
        },
        operatorPrincipalId: IDS.principal,
      });
      const reads = createMonitorProfileRepairReadRepository(runtime, {
        clock: () => new Date(fixture.clockBox.value),
      });
      const detail = await reads.getCase({
        scopeSha256: fixture.binding.scopeSha256,
        repairCaseId: fixture.binding.repairCaseId,
        caseRevision: 1,
      });
      expect(detail).toMatchObject({
        caseState: "APPLIED",
        staleReasons: [],
        executionAuthority: false,
        candidate: { state: "PUBLISHED" },
        decision: { id: approval.id, state: "CURRENT_APPROVED" },
        operation: {
          id: applied.operationId,
          approvalId: approval.id,
          kind: "INITIAL_ROLLOUT",
          state: "COMMITTED",
          publishedProfileRevisionId: applied.publishedProfileRevisionId,
          assignmentRevisionId: applied.assignmentRevisionId,
        },
        assignment: {
          currentRevision: applied.assignmentRevision,
          currentRevisionId: applied.assignmentRevisionId,
          currentMode: "ROLLOUT",
          currentCandidateProfileRevisionId:
            fixture.binding.candidate.profileRevisionId,
          currentPercentageBps: fixture.binding.assignment.initialPercentageBps,
        },
      });
    });

    it("pins repair evidence during GC while pruning unrelated evicted routine payload", async () => {
      const fixture = await setupFixture();
      await fixture.repository.registerCandidate({ binding: fixture.binding });
      const gcNow = new Date(BASE.valueOf() + 4 * 60 * 60 * 1_000);
      const retention = createHealthRetentionRepository(runtime, {
        clock: () => gcNow,
      });
      const boundInventory = await retention.listRoutineNoSessionGcInventory({
        before: new Date(BASE.valueOf() + 2_000),
        limit: 100,
      });
      expect(
        boundInventory.find((item) => item.runId === IDS.observationRun)
          ?.reason,
      ).toBe("REPAIR_APPROVAL_PINNED");
      expect(
        await retention.pruneRoutineNoSessionPayload({
          runId: IDS.observationRun,
          before: new Date(BASE.valueOf() + 2_000),
        }),
      ).toEqual({ status: "BLOCKED", reason: "REPAIR_APPROVAL_PINNED" });

      const scheduleId = randomUUID();
      await runtime.query(
        `INSERT INTO health_schedules(
          id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision
        ) VALUES($1,'gc_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',true,
          $2::jsonb,$3,1)`,
        [
          scheduleId,
          JSON.stringify({
            intervalSeconds: 5400,
            timeoutSeconds: 180,
            maxAttempts: 3,
            retryPolicyVersion: "health-retry-v1",
          }),
          new Date(BASE.valueOf() + 9_000_000),
        ],
      );

      const gcRows: Array<{
        runId: string;
        scheduledRunId: string;
        observedAt: Date;
        normalized: string;
        observation: ReturnType<typeof observation>;
      }> = [];
      for (let index = 0; index < 4; index += 1) {
        const runId = randomUUID();
        const scheduledRunId = randomUUID();
        const observedAt = new Date(
          BASE.valueOf() - 8_000_000 + index * 60_000,
        );
        const current = NoSessionObservationResultSchema.parse({
          ...observation(),
          targetKey: "gc_target",
          observedAt: observedAt.toISOString(),
          elementMetadata: {
            ...observation().elementMetadata,
            composer: {
              ...observation().elementMetadata.composer,
              elementCount: index + 1,
            },
          },
        });
        const normalized = normalizedNoSessionResultSha256(current);
        const due = new Date(observedAt.valueOf() - 1_000);
        await runtime.query(
          `INSERT INTO health_scheduled_runs(
            id,schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,
            due_slot_at,idempotency_key,state,attempt,started_at,finished_at,health_state
          ) VALUES($1,$2,'gc_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',1,
            $3,$4,'SUCCEEDED',1,$3,$5,'BROKEN')`,
          [scheduledRunId, scheduleId, due, sha(String(index + 1)), observedAt],
        );
        await runtime.query(
          `INSERT INTO health_runs(
            id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,
            profile_revision_id,profile_revision,browser_family,browser_version,
            extension_version,adapter_engine_version,scheduled_run_id,health_level,
            health_state,classifier_version,scope,scope_sha256,operator_maintenance,
            operator_maintenance_authority,started_at,completed_at
          ) VALUES($1,'NO_SESSION_OBSERVATION',NULL,$2,$3,NULL,$4,$5,1,'chrome',
            '154.0.0.0',NULL,NULL,$6,'H2','BROKEN','repair-gc-fixture-v1',
            '{}'::jsonb,$7,false,NULL,$8,$9)`,
          [
            runId,
            IDS.adapter,
            IDS.surface,
            IDS.profile,
            IDS.baselineRevision,
            scheduledRunId,
            sha("f"),
            due,
            observedAt,
          ],
        );
        await runtime.query(
          "UPDATE health_scheduled_runs SET health_run_id=$2 WHERE id=$1",
          [scheduledRunId, runId],
        );
        await runtime.query(
          `INSERT INTO health_no_session_observations(
            run_id,provider_id,observation_surface_id,target_key,strategy_id,
            strategy_revision,classification,classification_basis,surface_outcome,
            blocker,observed_at,result_sha256,observation
          ) VALUES($1,'chatgpt','CHATGPT_STANDARD','gc_target','repair-standard-v1',
            1,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE','BROWSER_UNAVAILABLE',
            $2,$3,$4::jsonb)`,
          [runId, observedAt, sha(String(index + 5)), JSON.stringify(current)],
        );
        await runtime.query(
          `INSERT INTO health_no_session_run_receipts(
            run_id,scheduled_run_id,schedule_id,schedule_revision,due_slot_at,
            idempotency_key,monitor_target,health_state,scope_sha256,
            callback_result_sha256,normalized_result_sha256,adapter_id,surface_id,
            variant_id,profile_id,profile_revision_id,profile_revision,browser_family,
            completed_at,projection_applied_at,incident_processed_at
          ) VALUES($1,$2,$3,1,$4,$5,'gc_target','BROKEN',$6,$7,$8,$9,$10,NULL,
            $11,$12,1,'chrome',$13,$13,$13)`,
          [
            runId,
            scheduledRunId,
            scheduleId,
            due,
            sha(String(index + 1)),
            sha("f"),
            sha(String(index + 5)),
            normalized,
            IDS.adapter,
            IDS.surface,
            IDS.profile,
            IDS.baselineRevision,
            observedAt,
          ],
        );
        gcRows.push({
          runId,
          scheduledRunId,
          observedAt,
          normalized,
          observation: current,
        });
      }

      const gcScope = noSessionRetentionScopeSha256(
        {
          browserFamily: "chrome",
          profileRevisionId: IDS.baselineRevision,
          profileRevision: 1,
        },
        gcRows[3]!.observation,
      );
      await runtime.query(
        `INSERT INTO health_no_session_scope_states(
          scope_sha256,provider_id,observation_surface_id,target_key,strategy_id,
          strategy_revision,browser_family,latest_run_id,latest_normalized_result_sha256,
          latest_health_state,latest_classification_basis,latest_surface_outcome,
          latest_blocker,latest_observed_at,last_attempt_at,last_verified_at
        ) VALUES($1,'chatgpt','CHATGPT_STANDARD','gc_target','repair-standard-v1',
          1,'chrome',$2,$3,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE',
          'BROWSER_UNAVAILABLE',$4,$4,$4)`,
        [
          gcScope,
          gcRows[3]!.runId,
          gcRows[3]!.normalized,
          gcRows[3]!.observedAt,
        ],
      );
      for (let slot = 1; slot <= 3; slot += 1) {
        const row = gcRows[slot]!;
        await runtime.query(
          `INSERT INTO health_no_session_recent_states(
            scope_sha256,slot,normalized_result_sha256,health_state,
            classification_basis,surface_outcome,blocker,summary,first_seen_at,
            last_seen_at,repeat_count,latest_run_id
          ) VALUES($1,$2,$3,'BROKEN','BROWSER_FAILURE','BROWSER_FAILURE',
            'BROWSER_UNAVAILABLE','{}'::jsonb,$4,$4,1,$5)`,
          [gcScope, slot, row.normalized, row.observedAt, row.runId],
        );
      }

      const inventory = await retention.listRoutineNoSessionGcInventory({
        before: new Date(BASE.valueOf() - 7_000_000),
        limit: 100,
      });
      expect(
        inventory.find((item) => item.runId === gcRows[0]!.runId)?.reason,
      ).toBe("ELIGIBLE");
      expect(
        await retention.pruneRoutineNoSessionPayload({
          runId: gcRows[0]!.runId,
          before: new Date(BASE.valueOf() - 7_000_000),
        }),
      ).toEqual({ status: "PRUNED", reason: "ELIGIBLE" });
      const pruned = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_runs WHERE id=$1",
        [gcRows[0]!.runId],
      );
      expect(pruned.rows[0]?.count).toBe("0");
    });
  },
);
