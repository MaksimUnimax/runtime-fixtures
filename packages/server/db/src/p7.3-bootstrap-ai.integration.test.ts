import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BootstrapAiResolutionService,
  type BootstrapAiResolutionInput,
} from "../../bootstrap/src/index.js";
import type { ProfileCompatibilityConstraintsV1 } from "@product/adapter-registry";
import {
  createBootstrapAiResolutionRepository,
  createDatabaseRuntime,
  createProfileLifecycleRepository,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const A = "30000000-0000-4000-8000-000000000001";
const S_STANDARD = "30000000-0000-4000-8000-000000000002";
const S_WORK = "30000000-0000-4000-8000-000000000003";
const V_STANDARD = "30000000-0000-4000-8000-000000000004";
const V_WORK = "30000000-0000-4000-8000-000000000005";
const P_STANDARD = "30000000-0000-4000-8000-000000000006";
const P_DEFAULT = "30000000-0000-4000-8000-000000000007";
const P_CANDIDATE = "30000000-0000-4000-8000-000000000008";
const P_WORK = "30000000-0000-4000-8000-000000000009";
const ACCOUNT = "30000000-0000-4000-8000-000000000010";
const DEVICE = "30000000-0000-4000-8000-000000000011";

const content = {
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
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    composer: {
      strategy: "composer_root" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "composer-root" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    send: {
      strategy: "send_control" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "send-control" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    assistantResponse: {
      strategy: "assistant_response" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "assistant-response" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
  },
  observation: { mode: "polling" as const, intervalMs: 100 },
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
};
const compatibility: ProfileCompatibilityConstraintsV1 = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};
const context = {
  actorType: "SYSTEM" as const,
  correlationId: "p7.3-bootstrap-ai",
  reason: "P7.3 integration test",
};
const input = (
  detected: BootstrapAiResolutionInput["detected"],
): BootstrapAiResolutionInput => ({
  detected,
  contractVersion: "control_plane_v1",
  extensionVersion: "1.0.0",
  browser: { family: "chrome", version: "123" },
  accountId: ACCOUNT,
  deviceId: DEVICE,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let runtime: DatabaseRuntime;
let resolver: BootstrapAiResolutionService;

async function reset(): Promise<void> {
  await runtime.db.execute(sql`DROP SCHEMA public CASCADE`);
  await runtime.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await runtime.db.execute(sql`CREATE SCHEMA public`);
  await runMigrations({ connectionString: connectionString! });
  await runtime.query(
    "INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'chatgpt','ChatGPT')",
    [A],
  );
  await runtime.query(
    "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'standard','Standard'),($3,$2,'work','Work')",
    [S_STANDARD, A, S_WORK],
  );
  await runtime.query(
    "INSERT INTO ai_variants(id,surface_id,machine_key,display_name) VALUES($1,$2,'standard_composer_v1','Standard'),($3,$4,'work_composer_v3','Work')",
    [V_STANDARD, S_STANDARD, V_WORK, S_WORK],
  );
  await runtime.query(
    "INSERT INTO adapter_profiles(id,adapter_id,surface_id,variant_id,machine_key,display_name) VALUES($1,$2,$3,$4,'standard-profile','Standard'),($5,$2,$3,NULL,'default-profile','Default'),($6,$2,$3,$4,'candidate-profile','Candidate'),($7,$2,$8,$9,'work-profile','Work')",
    [
      P_STANDARD,
      A,
      S_STANDARD,
      V_STANDARD,
      P_DEFAULT,
      P_CANDIDATE,
      P_WORK,
      S_WORK,
      V_WORK,
    ],
  );
}

async function publishWithCompatibility(
  profileId: string,
  profileCompatibility = compatibility,
): Promise<string> {
  const repository = createProfileLifecycleRepository(runtime);
  const draft = await repository.createDraftProfileRevision({
    profileId,
    content,
    compatibility: profileCompatibility,
    context,
  });
  await repository.markProfileRevisionCandidate({
    profileId,
    revision: draft.revision,
    context,
  });
  const published = await repository.publishProfileRevision({
    profileId,
    revision: draft.revision,
    context,
  });
  return published.id;
}

async function publish(profileId: string): Promise<string> {
  return publishWithCompatibility(profileId);
}

async function createScope(
  variantId: string | null,
  subjectKind: "ACCOUNT" | "DEVICE" = "ACCOUNT",
) {
  return createProfileLifecycleRepository(runtime).createAssignmentScope({
    scope: {
      adapterId: A,
      surfaceId: S_STANDARD,
      variantId,
      browserFamily: "chrome",
      subjectKind,
    },
    context,
  });
}

describe.sequential("P7.3 bootstrap AI resolution with PostgreSQL", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString!);
    await runtime.ready();
    resolver = new BootstrapAiResolutionService(
      createBootstrapAiResolutionRepository(runtime),
    );
  });
  beforeEach(async () => {
    await reset();
    await publish(P_STANDARD);
    await publish(P_DEFAULT);
    await publish(P_CANDIDATE);
    await publish(P_WORK);
  });
  afterAll(async () => runtime.close());

  it("resolves Standard and Work independently, and uses exact then default precedence", async () => {
    const standard = await createScope(V_STANDARD);
    await createProfileLifecycleRepository(runtime).assignDirect({
      assignmentId: standard.id,
      baselineProfileRevisionId: await publish(P_STANDARD),
      expectedLatestAssignmentRevision: null,
      context,
    });
    const workScope = await createProfileLifecycleRepository(
      runtime,
    ).createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S_WORK,
        variantId: V_WORK,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
      },
      context,
    });
    const workRevision = await publish(P_WORK);
    await createProfileLifecycleRepository(runtime).assignDirect({
      assignmentId: workScope.id,
      baselineProfileRevisionId: workRevision,
      expectedLatestAssignmentRevision: null,
      context,
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "standard-profile" },
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "work",
          variant: "work_composer_v3",
        }),
      ),
    ).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "work-profile" },
    });
  });

  it("uses the surface default when exact scope is absent or has no revision", async () => {
    const fallback = await createScope(null);
    const defaultRevision = await publish(P_DEFAULT);
    await createProfileLifecycleRepository(runtime).assignDirect({
      assignmentId: fallback.id,
      baselineProfileRevisionId: defaultRevision,
      expectedLatestAssignmentRevision: null,
      context,
    });
    const exactWithoutRevision = await createScope(V_STANDARD);
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({
      status: "RESOLVED",
      profile: { profileKey: "default-profile", scopeVariant: null },
    });
    expect(exactWithoutRevision.id).not.toBe(fallback.id);
  });

  it("returns safe unavailable states for unknown and disabled hierarchy or absent assignment", async () => {
    expect(
      await resolver.resolve(
        input({ family: "unknown", surface: "standard", variant: null }),
      ),
    ).toMatchObject({ reason: "UNSUPPORTED_DETECTED_AI" });
    expect(
      await resolver.resolve(
        input({ family: "chatgpt", surface: "unknown", variant: null }),
      ),
    ).toMatchObject({ reason: "UNSUPPORTED_DETECTED_AI" });
    expect(
      await resolver.resolve(
        input({ family: "chatgpt", surface: "standard", variant: "unknown" }),
      ),
    ).toMatchObject({ reason: "UNSUPPORTED_DETECTED_AI" });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "work",
          variant: "work_composer_v3",
        }),
      ),
    ).toMatchObject({ reason: "NO_PROFILE" });
    await runtime.query(
      "UPDATE ai_adapters SET status='DISABLED' WHERE id=$1",
      [A],
    );
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({ reason: "AI_DISABLED" });
  });

  it("reuses P7.2 DIRECT, PAUSED and ROLLOUT selection with authenticated subject kind", async () => {
    const scope = await createScope(V_STANDARD, "DEVICE");
    const baseline = await publish(P_STANDARD);
    const candidate = await publish(P_CANDIDATE);
    const repository = createProfileLifecycleRepository(runtime);
    await repository.assignDirect({
      assignmentId: scope.id,
      baselineProfileRevisionId: baseline,
      expectedLatestAssignmentRevision: null,
      context,
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({ profile: { profileKey: "standard-profile" } });
    await repository.startRollout({
      assignmentId: scope.id,
      baselineProfileRevisionId: baseline,
      candidateProfileRevisionId: candidate,
      percentageBps: 10000,
      expectedLatestAssignmentRevision: 1,
      context,
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({ profile: { profileKey: "candidate-profile" } });
    await repository.pauseProfileRollout({
      assignmentId: scope.id,
      expectedLatestAssignmentRevision: 2,
      context,
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({ profile: { profileKey: "standard-profile" } });
  });

  it("returns PROFILE_INCOMPATIBLE for a valid profile outside request compatibility", async () => {
    const scope = await createScope(V_STANDARD);
    const repository = createProfileLifecycleRepository(runtime);
    const compatible = {
      ...compatibility,
      minimumExtensionVersion: "2.0.0" as const,
    };
    const profileId = await publishWithCompatibility(P_STANDARD, compatible);
    await repository.assignDirect({
      assignmentId: scope.id,
      baselineProfileRevisionId: profileId,
      expectedLatestAssignmentRevision: null,
      context,
    });
    expect(
      await resolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      ),
    ).toMatchObject({ reason: "PROFILE_INCOMPATIBLE" });
  });

  it("materializes family-scoped AI candidates without client software metadata", async () => {
    const chrome = await createScope(V_STANDARD, "DEVICE");
    const firefoxScope = await createProfileLifecycleRepository(
      runtime,
    ).createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S_STANDARD,
        variantId: V_STANDARD,
        browserFamily: "firefox",
        subjectKind: "ACCOUNT",
      },
      context,
    });
    const chromeCompatibility = {
      ...compatibility,
      minimumExtensionVersion: "9.0.0",
    };
    const firefoxCompatibility = {
      ...compatibility,
      browserFamilies: ["firefox" as const],
      minimumExtensionVersion: "9.0.0",
    };
    const chromeRevision = await publishWithCompatibility(
      P_STANDARD,
      chromeCompatibility,
    );
    const firefoxRevision = await publishWithCompatibility(
      P_STANDARD,
      firefoxCompatibility,
    );
    const repository = createProfileLifecycleRepository(runtime);
    await repository.assignDirect({
      assignmentId: chrome.id,
      baselineProfileRevisionId: chromeRevision,
      expectedLatestAssignmentRevision: null,
      context,
    });
    await repository.assignDirect({
      assignmentId: firefoxScope.id,
      baselineProfileRevisionId: firefoxRevision,
      expectedLatestAssignmentRevision: null,
      context,
    });

    const candidates = await resolver.resolveLocalCandidates({
      detected: {
        family: "chatgpt",
        surface: "standard",
        variant: "standard_composer_v1",
      },
      contractVersion: "control_plane_v2",
      accountId: ACCOUNT,
      deviceId: DEVICE,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates).toMatchObject([
      {
        browserFamily: "chrome",
        resolution: {
          status: "RESOLVED",
          profile: { profileKey: "standard-profile" },
        },
      },
      {
        browserFamily: "firefox",
        resolution: {
          status: "RESOLVED",
          profile: { profileKey: "standard-profile" },
        },
      },
    ]);
  });

  it("proves one-statement coherence during a competing PostgreSQL mutation", async () => {
    const scope = await createScope(V_STANDARD);
    const repository = createProfileLifecycleRepository(runtime);
    const baseline = await publish(P_STANDARD);
    const candidate = await publish(P_CANDIDATE);
    await repository.assignDirect({
      assignmentId: scope.id,
      baselineProfileRevisionId: baseline,
      expectedLatestAssignmentRevision: null,
      context,
    });

    const oldTuple = {
      assignmentRevision: 1,
      mode: "DIRECT",
      baselineProfileRevisionId: baseline,
      selectedProfileRevisionId: baseline,
      profileKey: "standard-profile",
    } as const;
    const newTuple = {
      assignmentRevision: 2,
      mode: "DIRECT",
      baselineProfileRevisionId: candidate,
      selectedProfileRevisionId: candidate,
      profileKey: "candidate-profile",
    } as const;
    const forbiddenHybrid = {
      assignmentRevision: newTuple.assignmentRevision,
      mode: newTuple.mode,
      baselineProfileRevisionId: newTuple.baselineProfileRevisionId,
      selectedProfileRevisionId: oldTuple.selectedProfileRevisionId,
      profileKey: oldTuple.profileKey,
    };

    const mutationHeld = deferred();
    const mutationRelease = deferred();
    const mutationCommitted = deferred();
    const resolverStarted = deferred();
    const snapshotCaptured = deferred();
    const observedEvents: string[] = [];
    let resolverSqlStatements = 0;
    let raceActive = true;
    const capturedSnapshots: Awaited<
      ReturnType<
        ReturnType<typeof createBootstrapAiResolutionRepository>["resolve"]
      >
    >[] = [];

    // Connection B is an independent PostgreSQL transaction. It performs the
    // same append-only assignment-revision mutation as the accepted lifecycle
    // repository, but keeps its transaction open at the deterministic barrier.
    const mutationRuntime = createDatabaseRuntime(connectionString!);
    const mutation = mutationRuntime.transaction(async (q) => {
      observedEvents.push("mutation-begin");
      await q.query(
        "INSERT INTO adapter_profile_assignment_revisions(id,assignment_id,revision,mode,baseline_profile_revision_id,candidate_profile_revision_id,percentage_bps) VALUES($1,$2,$3,'DIRECT',$4,NULL,0)",
        [
          "30000000-0000-4000-8000-000000000012",
          scope.id,
          newTuple.assignmentRevision,
          newTuple.baselineProfileRevisionId,
        ],
      );
      observedEvents.push("mutation-held");
      mutationHeld.resolve();
      await mutationRelease.promise;
      observedEvents.push("mutation-release");
    });

    // The resolver uses Connection A through the normal production repository.
    // This test-only driver wrapper delays delivery after PostgreSQL has
    // captured the first statement result. If resolution were split into
    // independent reads, the second read would run after B commits and could
    // assemble the forbidden hybrid tuple.
    const instrumentedRuntime = {
      ...runtime,
      query: async <
        T extends Record<string, unknown> = Record<string, unknown>,
      >(
        text: string,
        values?: unknown[],
      ): Promise<{ rows: T[] }> => {
        if (!raceActive) return runtime.query<T>(text, values);
        resolverSqlStatements += 1;
        if (resolverSqlStatements === 1) {
          observedEvents.push("resolver-start");
          resolverStarted.resolve();
          const result = await runtime.query<T>(text, values);
          observedEvents.push("snapshot-captured");
          snapshotCaptured.resolve();
          await mutationCommitted.promise;
          observedEvents.push("resolver-release");
          return result;
        }
        return runtime.query<T>(text, values);
      },
    };
    const instrumentedRepository =
      createBootstrapAiResolutionRepository(instrumentedRuntime);
    const raceResolver = new BootstrapAiResolutionService({
      resolve: async (request) => {
        const snapshot = await instrumentedRepository.resolve(request);
        capturedSnapshots.push(snapshot);
        return snapshot;
      },
    });

    try {
      await mutationHeld.promise;
      const resolutionPromise = raceResolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      );
      await resolverStarted.promise;
      await snapshotCaptured.promise;
      expect(observedEvents).toEqual([
        "mutation-begin",
        "mutation-held",
        "resolver-start",
        "snapshot-captured",
      ]);

      mutationRelease.resolve();
      await mutation;
      observedEvents.push("mutation-committed");
      mutationCommitted.resolve();
      const beforeCommit = await resolutionPromise;
      raceActive = false;

      expect(beforeCommit).toMatchObject({
        status: "RESOLVED",
        profile: { profileKey: oldTuple.profileKey },
      });
      const firstSnapshot = capturedSnapshots[0];
      expect(firstSnapshot?.exactAssignment?.latest).toMatchObject({
        revision: oldTuple.assignmentRevision,
        mode: oldTuple.mode,
        baselineProfileRevisionId: oldTuple.baselineProfileRevisionId,
      });
      expect(firstSnapshot?.profiles).toContainEqual(
        expect.objectContaining({
          revisionId: oldTuple.selectedProfileRevisionId,
          profileKey: oldTuple.profileKey,
        }),
      );
      expect(
        firstSnapshot?.exactAssignment?.latest?.baselineProfileRevisionId ===
          oldTuple.baselineProfileRevisionId &&
          firstSnapshot?.profiles.some(
            (profile) =>
              profile.revisionId === oldTuple.selectedProfileRevisionId &&
              profile.profileKey === oldTuple.profileKey,
          ),
      ).toBe(true);
      expect(
        firstSnapshot?.exactAssignment?.latest?.baselineProfileRevisionId ===
          forbiddenHybrid.baselineProfileRevisionId &&
          firstSnapshot?.profiles.some(
            (profile) =>
              profile.revisionId ===
                forbiddenHybrid.selectedProfileRevisionId &&
              profile.profileKey === forbiddenHybrid.profileKey,
          ),
      ).toBe(false);

      const afterCommit = await raceResolver.resolve(
        input({
          family: "chatgpt",
          surface: "standard",
          variant: "standard_composer_v1",
        }),
      );
      expect(afterCommit).toMatchObject({
        status: "RESOLVED",
        profile: { profileKey: newTuple.profileKey },
      });
      const secondSnapshot = capturedSnapshots[1];
      expect(secondSnapshot?.exactAssignment?.latest).toMatchObject({
        revision: newTuple.assignmentRevision,
        mode: newTuple.mode,
        baselineProfileRevisionId: newTuple.baselineProfileRevisionId,
      });
      expect(secondSnapshot?.profiles).toContainEqual(
        expect.objectContaining({
          revisionId: newTuple.selectedProfileRevisionId,
          profileKey: newTuple.profileKey,
        }),
      );
      expect(resolverSqlStatements).toBe(1);
      expect(observedEvents).toEqual([
        "mutation-begin",
        "mutation-held",
        "resolver-start",
        "snapshot-captured",
        "mutation-release",
        "mutation-committed",
        "resolver-release",
      ]);
    } finally {
      raceActive = false;
      mutationRelease.resolve();
      mutationCommitted.resolve();
      await mutation.catch(() => undefined);
      await mutationRuntime.close();
    }
  });
});
