import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabaseRuntime,
  createProfileLifecycleRepository,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import {
  P7_PROFILE_ROLLOUT_KEY,
  profileRevisionFingerprint,
  selectAssignedProfileRevision,
} from "@product/adapter-registry";
import { selectRolloutCandidateV1 } from "@product/remote-config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";
const S = "20000000-0000-4000-8000-000000000003";
const S2 = "20000000-0000-4000-8000-000000000004";
const S3 = "20000000-0000-4000-8000-000000000005";
const V = "20000000-0000-4000-8000-000000000006";
const P = "20000000-0000-4000-8000-000000000006";
const P2 = "20000000-0000-4000-8000-000000000007";
const P3 = "20000000-0000-4000-8000-000000000008";
const PV = "20000000-0000-4000-8000-000000000009";

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
const compatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};
const context = {
  actorType: "SYSTEM" as const,
  correlationId: "p7.2-correction",
  reason: "p7.2 correction integration",
};

let runtime: DatabaseRuntime;

async function rejectsQuery(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(Error);
}
async function insertDraft(
  id: string,
  profileId = P,
  revision = 1,
  values: { content?: unknown; compatibility?: unknown; hash?: string } = {},
): Promise<void> {
  await runtime.query(
    "INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,variant_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,$5,$6,'adapter_profile_v1','DRAFT',$7::jsonb,$8::jsonb,$9)",

    [
      id,
      profileId,
      profileId === P2 ? B : A,
      profileId === P2 ? S3 : profileId === P3 ? S2 : S,
      profileId === PV ? V : null,
      revision,
      JSON.stringify(values.content ?? content),
      JSON.stringify(values.compatibility ?? compatibility),
      values.hash ?? profileRevisionFingerprint({ content, compatibility }),
    ],
  );
}
async function promoteRaw(id: string, publish = true): Promise<void> {
  await runtime.query(
    "UPDATE adapter_profile_revisions SET state='CANDIDATE' WHERE id=$1",
    [id],
  );
  if (publish)
    await runtime.query(
      "UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=now() WHERE id=$1",
      [id],
    );
}
async function insertScope(
  q: DatabaseQuery,
  id = randomUUID(),
  variantId: string | null = null,
): Promise<string> {
  await q.query(
    "INSERT INTO adapter_profile_assignments(id,adapter_id,surface_id,variant_id,browser_family,subject_kind,cohort_seed) VALUES($1,$2,$3,$4,'chrome','ACCOUNT',$5)",
    [
      id,
      A,
      S,
      variantId ? (variantId === V ? V : variantId) : null,
      Buffer.alloc(32, 7),
    ],
  );
  return id;
}
async function insertAssignmentRevision(
  q: DatabaseQuery,
  assignmentId: string,
  baseline: string,
  candidate: string | null = null,
  mode = candidate ? "ROLLOUT" : "DIRECT",
  percentageBps = candidate ? 5000 : 0,
  revision = 1,
): Promise<void> {
  await q.query(
    "INSERT INTO adapter_profile_assignment_revisions(id,assignment_id,revision,mode,baseline_profile_revision_id,candidate_profile_revision_id,percentage_bps) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      assignmentId,
      revision,
      mode,
      baseline,
      candidate,
      percentageBps,
    ],
  );
}
async function createPublished(
  profileId = P,
): Promise<{ id: string; revision: number }> {
  const repo = createProfileLifecycleRepository(runtime);
  const draft = await repo.createDraftProfileRevision({
    profileId,
    content,
    compatibility,
    context,
  });
  await repo.markProfileRevisionCandidate({
    profileId,
    revision: draft.revision,
    context,
  });
  const published = await repo.publishProfileRevision({
    profileId,
    revision: draft.revision,
    context,
  });
  return { id: published.id, revision: published.revision };
}
async function reset(): Promise<void> {
  await runtime.db.execute(
    sql`DROP SCHEMA IF EXISTS octoport_transfer_fence CASCADE; DROP SCHEMA public CASCADE`,
  );
  await runtime.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await runtime.db.execute(sql`CREATE SCHEMA public`);
  await runMigrations({ connectionString: connectionString! });
  await runMigrations({ connectionString: connectionString! });
  await runtime.query(
    "INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'a','A'),($2,'b','B')",
    [A, B],
  );
  await runtime.query(
    "INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'s','S'),($3,$4,'s2','S2'),($5,$6,'s3','S3')",
    [S, A, S2, A, S3, B],
  );
  await runtime.query(
    "INSERT INTO ai_variants(id,surface_id,machine_key,display_name) VALUES($1,$2,'v','V')",
    [V, S],
  );
  await runtime.query(
    "INSERT INTO adapter_profiles(id,adapter_id,surface_id,variant_id,machine_key,display_name) VALUES($1,$2,$3,NULL,'p','P'),($4,$5,$6,NULL,'p2','P2'),($7,$8,$9,NULL,'p3','P3'),($10,$11,$12,$13,'pv','PV')",
    [P, A, S, P2, B, S3, P3, A, S2, PV, A, S, V],
  );
}

describe.sequential("P7.2 correction permanent PostgreSQL coverage", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString!);
    await runtime.ready();
    await reset();
  });
  beforeEach(async () => reset());
  afterAll(async () => runtime.close());

  it("rejects every non-DRAFT physical initial revision insert", async () => {
    for (const [state, suffix] of [
      ["CANDIDATE", "11"],
      ["PUBLISHED", "12"],
      ["RETIRED", "13"],
    ] as const) {
      await rejectsQuery(
        runtime.query(
          "INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256,published_at) VALUES($1,$2,$3,$4,$5,'adapter_profile_v1',$6,$7::jsonb,$8::jsonb,$9,CASE WHEN $6 IN ('PUBLISHED','RETIRED') THEN now() END)",
          [
            `20000000-0000-4000-8000-0000000000${suffix}`,
            P,
            A,
            S,
            Number(suffix),
            state,
            JSON.stringify(content),
            JSON.stringify(compatibility),
            profileRevisionFingerprint({ content, compatibility }),
          ],
        ),
      );
    }
  });

  it("generates stable-scope seeds on the server and reuses the persisted seed for P3 selection", async () => {
    const repo = createProfileLifecycleRepository(runtime);
    const callerSeed = Buffer.alloc(32, 9);
    const first = await repo.createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S,
        variantId: null,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
      },
      context,
      internalTestCohortSeed: callerSeed,
    } as unknown as Parameters<
      ReturnType<
        typeof createProfileLifecycleRepository
      >["createAssignmentScope"]
    >[0]);
    const second = await repo.createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S2,
        variantId: null,
        browserFamily: "yandex_chromium",
        subjectKind: "ACCOUNT",
      },
      context,
    });
    expect(first.cohortSeed).toHaveLength(32);
    expect(second.cohortSeed).toHaveLength(32);
    expect(first.cohortSeed).not.toEqual(callerSeed);
    expect(second.cohortSeed).not.toEqual(callerSeed);
    expect(second.cohortSeed).not.toEqual(first.cohortSeed);

    const persisted = await runtime.query<{ cohortSeed: Buffer }>(
      'SELECT cohort_seed AS "cohortSeed" FROM adapter_profile_assignments WHERE id=$1',
      [first.id],
    );
    expect(persisted.rows[0]?.cohortSeed).toEqual(first.cohortSeed);

    const subjectId = "account-seed-authority";
    const percentageBps = 5000;
    const p3Selected = selectRolloutCandidateV1({
      state: "ACTIVE",
      percentageBps,
      rolloutKey: P7_PROFILE_ROLLOUT_KEY,
      cohortSeed: first.cohortSeed,
      subjectKind: "ACCOUNT",
      subjectId,
    });
    expect(
      selectAssignedProfileRevision({
        mode: "ROLLOUT",
        baselineProfileRevisionId: "baseline",
        candidateProfileRevisionId: "candidate",
        percentageBps,
        cohortSeed: first.cohortSeed,
        subjectKind: "ACCOUNT",
        subjectId,
      }),
    ).toBe(p3Selected ? "candidate" : "baseline");
  });

  it("rejects all combined DRAFT-to-CANDIDATE mutations", async () => {
    const mutations: Array<[string, string]> = [
      ["content", "content='{}'::jsonb"],
      ["compatibility", "compatibility_constraints='{}'::jsonb"],
      ["fingerprint", "content_sha256='b'::text || repeat('b',63)"],
      ["schema", "schema_version='other'"],
      ["identity", "id='20000000-0000-4000-8000-000000009999'"],
      ["created metadata", "created_at=created_at + interval '1 second'"],
    ];
    for (const [name, expression] of mutations) {
      const id = randomUUID();
      await insertDraft(
        id,
        P,
        100 + mutations.findIndex((entry) => entry[0] === name),
      );
      await rejectsQuery(
        runtime.query(
          `UPDATE adapter_profile_revisions SET state='CANDIDATE',${expression} WHERE id=$1`,
          [id],
        ),
      );
    }
  });

  it("rejects candidate self-rewrites and combined publish payload mutations", async () => {
    for (const [field, expression] of [
      ["content", "content='{}'::jsonb"],
      ["compatibility", "compatibility_constraints='{}'::jsonb"],
      ["fingerprint", "content_sha256='c'::text || repeat('c',63)"],
      ["identity", "id='20000000-0000-4000-8000-000000009998'"],
      ["created metadata", "created_at=created_at + interval '1 second'"],
    ] as const) {
      const id = randomUUID();
      await insertDraft(
        id,
        P,
        200 +
          [
            "content",
            "compatibility",
            "fingerprint",
            "identity",
            "created metadata",
          ].indexOf(field),
      );
      await promoteRaw(id, false);
      await rejectsQuery(
        runtime.query(
          `UPDATE adapter_profile_revisions SET ${expression} WHERE id=$1`,
          [id],
        ),
      );
    }
    for (const [expression, suffix] of [
      ["content='{}'::jsonb", "31"],
      ["compatibility_constraints='{}'::jsonb", "32"],
      ["content_sha256='d'::text || repeat('d',63)", "33"],
    ] as const) {
      const id = `20000000-0000-4000-8000-0000000000${suffix}`;
      await insertDraft(id, P, Number(suffix));
      await promoteRaw(id, false);
      await rejectsQuery(
        runtime.query(
          `UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=now(),${expression} WHERE id=$1`,
          [id],
        ),
      );
    }
  });

  it("normal candidate promotion rejects malformed and forged DRAFT rows", async () => {
    const malformed = randomUUID();
    await insertDraft(malformed, P, 400, {
      content: {},
      compatibility: {},
      hash: "e".repeat(64),
    });
    const repo = createProfileLifecycleRepository(runtime);
    await expect(
      repo.markProfileRevisionCandidate({
        profileId: P,
        revision: 400,
        context,
      }),
    ).rejects.toThrow();
    const forged = randomUUID();
    await insertDraft(forged, P, 401, { hash: "f".repeat(64) });
    await expect(
      repo.markProfileRevisionCandidate({
        profileId: P,
        revision: 401,
        context,
      }),
    ).rejects.toThrow("P7_PROFILE_REVISION_FINGERPRINT_MISMATCH");
  });

  it("rejects direct SQL non-published and cross-hierarchy assignment targets", async () => {
    const repo = createProfileLifecycleRepository(runtime);
    const draft = await repo.createDraftProfileRevision({
      profileId: P,
      content,
      compatibility,
      context,
    });
    const candidate = await repo.createDraftProfileRevision({
      profileId: P,
      content,
      compatibility,
      context,
    });
    await repo.markProfileRevisionCandidate({
      profileId: P,
      revision: candidate.revision,
      context,
    });
    const retired = await createPublished();
    await repo.retireProfileRevision({
      profileId: P,
      revision: retired.revision,
      context,
    });
    const scopeId = await insertScope(runtime as unknown as DatabaseQuery);
    for (const target of [draft.id, candidate.id, retired.id]) {
      await rejectsQuery(
        insertAssignmentRevision(
          runtime as unknown as DatabaseQuery,
          scopeId,
          target,
        ).then(() => undefined),
      );
    }
    const wrongAdapter = await createPublished(P2);
    const wrongSurface = await createPublished(P3);
    const wrongVariant = await createPublished(PV);
    for (const target of [wrongAdapter.id, wrongSurface.id, wrongVariant.id]) {
      await rejectsQuery(
        insertAssignmentRevision(
          runtime as unknown as DatabaseQuery,
          scopeId,
          target,
        ).then(() => undefined),
      );
    }
  });

  it("rejects every invalid assignment shape through direct SQL", async () => {
    const baseline = await createPublished();
    const candidate = await createPublished();
    const cases: Array<[string | null, string, number]> = [
      [candidate.id, "DIRECT", 0],
      [null, "ROLLOUT", 5000],
      [baseline.id, "ROLLOUT", 5000],
      [candidate.id, "ROLLOUT", -1],
      [candidate.id, "ROLLOUT", 10001],
      [baseline.id, "PAUSED", 5000],
    ];
    const scopeId = await insertScope(runtime as unknown as DatabaseQuery);
    for (const [target, mode, percentage] of cases) {
      await rejectsQuery(
        insertAssignmentRevision(
          runtime as unknown as DatabaseQuery,
          scopeId,
          baseline.id,
          target,
          mode,
          percentage,
        ).then(() => undefined),
      );
    }
  });

  async function runServiceRace(
    kind:
      | "DIRECT"
      | "ROLLOUT_BASELINE"
      | "ROLLOUT_CANDIDATE"
      | "ROLLBACK"
      | "COMPLETE",
  ): Promise<void> {
    await reset();
    const target = await createPublished();
    const other = await createPublished();
    const setup = createProfileLifecycleRepository(runtime);
    const scope = await setup.createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S,
        variantId: null,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
      },
      context,
    });
    let expected = null;
    if (kind === "ROLLBACK") {
      await setup.assignDirect({
        assignmentId: scope.id,
        baselineProfileRevisionId: other.id,
        expectedLatestAssignmentRevision: null,
        context,
      });
      expected = 1;
    } else if (kind === "COMPLETE") {
      await setup.startRollout({
        assignmentId: scope.id,
        baselineProfileRevisionId: other.id,
        candidateProfileRevisionId: target.id,
        percentageBps: 5000,
        expectedLatestAssignmentRevision: null,
        context,
      });
      expected = 1;
    }
    const runtimeRetire = createDatabaseRuntime(connectionString!);
    const runtimeMutation = createDatabaseRuntime(connectionString!);
    await Promise.all([runtimeRetire.ready(), runtimeMutation.ready()]);
    const retireRepo = createProfileLifecycleRepository(runtimeRetire);
    const mutationRepo = createProfileLifecycleRepository(runtimeMutation);
    const retire = retireRepo.retireProfileRevision({
      profileId: P,
      revision: target.revision,
      context,
    });
    const mutation =
      kind === "DIRECT"
        ? mutationRepo.assignDirect({
            assignmentId: scope.id,
            baselineProfileRevisionId: target.id,
            expectedLatestAssignmentRevision: expected,
            context,
          })
        : kind === "ROLLOUT_BASELINE"
          ? mutationRepo.startRollout({
              assignmentId: scope.id,
              baselineProfileRevisionId: target.id,
              candidateProfileRevisionId: other.id,
              percentageBps: 5000,
              expectedLatestAssignmentRevision: expected,
              context,
            })
          : kind === "ROLLOUT_CANDIDATE"
            ? mutationRepo.startRollout({
                assignmentId: scope.id,
                baselineProfileRevisionId: other.id,
                candidateProfileRevisionId: target.id,
                percentageBps: 5000,
                expectedLatestAssignmentRevision: expected,
                context,
              })
            : kind === "ROLLBACK"
              ? mutationRepo.rollbackProfileAssignment({
                  assignmentId: scope.id,
                  profileRevisionId: target.id,
                  expectedLatestAssignmentRevision: expected!,
                  context,
                })
              : mutationRepo.completeRollout({
                  assignmentId: scope.id,
                  expectedLatestAssignmentRevision: expected!,
                  context,
                });
    const results = await Promise.allSettled([retire, mutation]);
    await Promise.all([runtimeRetire.close(), runtimeMutation.close()]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const state = await runtime.query<{ state: string }>(
      "SELECT state FROM adapter_profile_revisions WHERE id=$1",
      [target.id],
    );
    const latest = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM adapter_profile_assignment_revisions ar JOIN (SELECT assignment_id,max(revision) revision FROM adapter_profile_assignment_revisions GROUP BY assignment_id) latest ON latest.assignment_id=ar.assignment_id AND latest.revision=ar.revision WHERE ar.baseline_profile_revision_id=$1 OR ar.candidate_profile_revision_id=$1",
      [target.id],
    );
    expect(
      !(state.rows[0]?.state === "RETIRED" && latest.rows[0]?.count !== "0"),
    ).toBe(true);
  }

  it("serializes retirement against every current-target assignment command with real transactions", async () => {
    for (const kind of [
      "DIRECT",
      "ROLLOUT_BASELINE",
      "ROLLOUT_CANDIDATE",
      "ROLLBACK",
      "COMPLETE",
    ] as const) {
      await runServiceRace(kind);
      await runServiceRace(kind);
    }
  }, 60_000);

  async function runOrderedDirectSqlRace(
    assignmentFirst: boolean,
  ): Promise<void> {
    await reset();
    const target = await createPublished();
    const runtimeAssignment = createDatabaseRuntime(connectionString!);
    const runtimeRetire = createDatabaseRuntime(connectionString!);
    await Promise.all([runtimeAssignment.ready(), runtimeRetire.ready()]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const acquiredPromise = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const assignment = runtimeAssignment.transaction(async (q) => {
      if (assignmentFirst) {
        await q.query("SELECT p7_2_lock_profile_revision_target($1)", [
          target.id,
        ]);
        acquired();
        await gate;
      }
      const assignmentId = await insertScope(q);
      await insertAssignmentRevision(q, assignmentId, target.id);
      return "assignment";
    });
    const retirement = runtimeRetire.transaction(async (q) => {
      if (!assignmentFirst) {
        await q.query("SELECT p7_2_lock_profile_revision_target($1)", [
          target.id,
        ]);
        acquired();
        await gate;
      }
      await q.query(
        "UPDATE adapter_profile_revisions SET state='RETIRED' WHERE id=$1",
        [target.id],
      );
      return "retirement";
    });
    await acquiredPromise;
    release();
    const results = await Promise.allSettled([assignment, retirement]);
    await Promise.all([runtimeAssignment.close(), runtimeRetire.close()]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const row = await runtime.query<{ state: string }>(
      "SELECT state FROM adapter_profile_revisions WHERE id=$1",
      [target.id],
    );
    const latest = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM adapter_profile_assignment_revisions ar JOIN (SELECT assignment_id,max(revision) revision FROM adapter_profile_assignment_revisions GROUP BY assignment_id) latest ON latest.assignment_id=ar.assignment_id AND latest.revision=ar.revision WHERE ar.baseline_profile_revision_id=$1 OR ar.candidate_profile_revision_id=$1",
      [target.id],
    );
    if (assignmentFirst) {
      expect(row.rows[0]?.state).toBe("PUBLISHED");
      expect(latest.rows[0]?.count).toBe("1");
    } else {
      expect(row.rows[0]?.state).toBe("RETIRED");
      expect(latest.rows[0]?.count).toBe("0");
      const orphan = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM adapter_profile_assignments a LEFT JOIN adapter_profile_assignment_revisions ar ON ar.assignment_id=a.id WHERE ar.id IS NULL",
      );
      expect(orphan.rows[0]?.count).toBe("0");
    }
  }

  it("proves both shared-lock winner orders and rolls back orphan scopes", async () => {
    await runOrderedDirectSqlRace(true);
    await runOrderedDirectSqlRace(false);
  }, 30_000);

  it("allows retirement when a target is historical-only", async () => {
    await reset();
    const target = await createPublished();
    const current = await createPublished();
    const repo = createProfileLifecycleRepository(runtime);
    const scope = await repo.createAssignmentScope({
      scope: {
        adapterId: A,
        surfaceId: S,
        variantId: null,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
      },
      context,
    });
    await repo.assignDirect({
      assignmentId: scope.id,
      baselineProfileRevisionId: target.id,
      expectedLatestAssignmentRevision: null,
      context,
    });
    await repo.assignDirect({
      assignmentId: scope.id,
      baselineProfileRevisionId: current.id,
      expectedLatestAssignmentRevision: 1,
      context,
    });
    const retired = await repo.retireProfileRevision({
      profileId: P,
      revision: target.revision,
      context,
    });
    expect(retired.state).toBe("RETIRED");
  });
});
