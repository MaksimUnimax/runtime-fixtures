import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createDatabaseRuntime,
  createApiWatchProductBaselineRepository,
} from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import {
  createPostgresSwaggerSourceStore,
  createSwaggerHandoffService,
  createPostgresMonitoringScheduleStore,
  IndependentMonitoringScheduler,
} from "../../../packages/server/monitoring-control/src/index.js";
import {
  createPostgresApiWatchStore,
  evaluateOperatorCandidate,
} from "../../../tooling/api-watch/src/authority.js";
import { createPostgresApiWatchReportStore } from "../../../tooling/api-watch/src/report.js";
import { createPostgresApiWatchRetryStore } from "../../../tooling/api-watch/src/retry.js";
import {
  createApiWatchRunner,
  runApiWatchReport,
} from "../../../tooling/api-watch/src/run.js";
import { productionSourceRegistry } from "../../../tooling/api-watch/src/source-registry.js";
import {
  createWbBundle,
  validateWbBundleUpload,
  WB_BUNDLE_DOCUMENT_KEY,
} from "../../../tooling/api-watch/src/wb-bundle.js";
import { readAcceptedSnapshot } from "../../../tooling/api-watch/src/snapshot.js";
import { TelegramOperatorService } from "../../../apps/telegram-operator/src/telegram.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const connection = new URL(connectionString);
if (
  !["127.0.0.1", "localhost"].includes(connection.hostname) ||
  ![
    "product_control_plane_test",
    "octoport_a_test",
    "octoport_b_test",
    "octoport_c_test",
  ].includes(decodeURIComponent(connection.pathname.slice(1)))
)
  throw new Error("REVIEW_FIX_DISPOSABLE_DATABASE_REQUIRED");
const schema = "reviewwb_" + randomUUID().replaceAll("-", "");
const admin = createDatabaseRuntime(connectionString);
const scopedUrl = new URL(connectionString);
scopedUrl.searchParams.set("options", "-csearch_path=" + schema + ",public");
const db = createDatabaseRuntime(scopedUrl.toString());
let created = false;
let tables: string[] = [];
const roots: string[] = [];

function bundleBytes(version = "1") {
  return new TextEncoder().encode(
    createWbBundle(
      productionSourceRegistry
        .get("WILDBERRIES")
        .documents!.map((doc, index) => ({
          documentKey: doc.documentKey,
          filename: doc.officialUrl.split("/").pop()!.split("?")[0]!,
          content:
            "openapi: 3.0.3\ninfo:\n  title: WB " +
            index +
            "\n  version: '" +
            version +
            "'\npaths:\n  /document-" +
            index +
            ":\n    get:\n      responses:\n        '200':\n          description: ok\n",
        })),
      "2026-10-15T00:00:00Z",
    ),
  );
}
function dependencies(runtime = db, root = "") {
  return {
    registry: {
      get: productionSourceRegistry.get.bind(productionSourceRegistry),
      list: () => [productionSourceRegistry.get("WILDBERRIES")],
    },
    store: createPostgresApiWatchStore(runtime),
    pendingStore: createPostgresSwaggerSourceStore(runtime),
    reportStore: createPostgresApiWatchReportStore(runtime),
    retryStore: createPostgresApiWatchRetryStore(runtime),
    productBaselineRepository: createApiWatchProductBaselineRepository(runtime),
    quarantineDir: join(root, "quarantine"),
    snapshotRoot: join(root, "snapshots"),
    fetcher: vi.fn(
      async () => new Response("synthetic403", { status: 403 }),
    ) as unknown as typeof fetch,
  };
}
async function fixture(wake = true) {
  const root = await mkdtemp(join(tmpdir(), "native-review-wb-"));
  roots.push(root);
  const deps = dependencies(db, root);
  const scheduleStore = createPostgresMonitoringScheduleStore(db);
  await scheduleStore.ensureDefaults(new Date());
  const scheduler = new IndependentMonitoringScheduler({
    store: scheduleStore,
    runners: {
      LLM: async () => ({
        status: "SUCCEEDED",
        code: null,
        summary: "synthetic",
      }),
      SWAGGER_API: createApiWatchRunner(deps),
    },
  });
  if (!wake)
    vi.spyOn(scheduler, "runNow").mockResolvedValue({
      kind: "NOT_DUE",
      lane: "SWAGGER_API",
    });
  const messages: string[] = [];
  const bot = new TelegramOperatorService({
    scheduler,
    swaggerHandoff: createSwaggerHandoffService({
      store: deps.pendingStore,
      quarantineDir: deps.quarantineDir,
      validateUpload: validateWbBundleUpload,
    }),
    operatorIds: new Set(["7"]),
    transport: {
      getUpdates: async () => ({ updates: [] }),
      sendMessage: async (_chat, text) => {
        messages.push(text);
      },
      answerCallback: async () => {},
    },
  });
  let updateId = 0;
  const command = (text: string, userId = "7") =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: { chatId: "42", userId, text },
    });
  const upload = (id: string, version = "1") =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload " + id,
        document: {
          fileId: "synthetic",
          fileName: "bundle.json",
          bytes: bundleBytes(version),
        },
      },
    });
  await runApiWatchReport({
    dependencies: deps,
    source: "FORCED",
    runId: "initial",
  });
  const first = (await deps.pendingStore.listPending(new Date()))[0]!;
  return {
    root,
    deps,
    scheduler,
    scheduleStore,
    messages,
    command,
    upload,
    first,
  };
}

describe.sequential("review main109ce9df native WB operator boundaries", () => {
  beforeAll(async () => {
    await admin.ready();
    await runMigrations({ connectionString });
    await admin.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    const result = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'api_watch_%' OR tablename LIKE 'swagger_source_%' OR tablename='monitoring_lane_schedules')",
    );
    tables = result.rows.map((row) => row.tablename);
    for (const table of tables) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("UNEXPECTED_TEST_TABLE");
      await admin.query(
        'CREATE TABLE "' +
          schema +
          '"."' +
          table +
          '" (LIKE public."' +
          table +
          '" INCLUDING ALL)',
      );
    }
    await db.ready();
    expect(
      (await db.query<{ schema: string }>("SELECT current_schema() AS schema"))
        .rows[0]?.schema,
    ).toBe(schema);
  }, 120000);
  beforeEach(async () => {
    await db.query(
      "TRUNCATE " +
        tables.map((table) => '"' + schema + '"."' + table + '"').join(","),
    );
  });
  afterEach(async () => {
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    await db.close();
    if (created) await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.close();
  });

  it("native upload readback maps bigint before strict evaluation and retains size/digest rejections", async () => {
    const f = await fixture(false);
    await f.upload(f.first.requestId);
    const [artifact] = await f.deps.pendingStore.listArtifacts(
      f.first.requestId,
    );
    expect(artifact?.sizeBytes).toBe(bundleBytes().byteLength);
    expect(typeof artifact?.sizeBytes).toBe("number");
    const evaluate = () =>
      evaluateOperatorCandidate({ ...f.deps, requestId: f.first.requestId });
    const accepted = await evaluate();
    expect(accepted.kind).toBe("AUTHORITY_ACCEPTED");
    if (accepted.kind !== "AUTHORITY_ACCEPTED")
      throw new Error("EXPECTED_ACCEPTED");
    expect(accepted.records).toHaveLength(13);
    expect(
      accepted.records?.every((record) => typeof record.sizeBytes === "number"),
    ).toBe(true);
    await db.query(
      "UPDATE swagger_source_artifacts SET size_bytes=size_bytes+1 WHERE artifact_id=$1",
      [artifact!.artifactId],
    );
    expect(await evaluate()).toEqual({
      kind: "AUTHORITY_REJECTED",
      reason: "CANDIDATE_SIZE_MISMATCH",
    });
    await db.query(
      "UPDATE swagger_source_artifacts SET size_bytes=$2,sha256=$3 WHERE artifact_id=$1",
      [artifact!.artifactId, artifact!.sizeBytes, "0".repeat(64)],
    );
    expect(await evaluate()).toEqual({
      kind: "AUTHORITY_REJECTED",
      reason: "CANDIDATE_DIGEST_MISMATCH",
    });
  });

  it("public bot reaches PG authority, snapshots, inventory and report with no comparable base", async () => {
    const f = await fixture();
    await f.upload(f.first.requestId);
    await vi.waitFor(
      async () =>
        expect(
          (await f.scheduleStore.getState("SWAGGER_API")).lastResult?.status,
        ).toBe("SUCCEEDED"),
      { timeout: 15000 },
    );
    const state = await f.scheduleStore.getState("SWAGGER_API");
    expect(state.lastResult?.coverage?.comparisonState).toBe("NOT_RUN");
    const report = await f.deps.reportStore.getReport(
      "api-watch:" + state.lastResult!.runId,
    );
    expect(report?.sources).toHaveLength(13);
    expect(
      report?.sources.every(
        (source) =>
          source.baseSnapshotSha256 === null && source.diffSha256 === null,
      ),
    ).toBe(true);
    const snapshots = await f.deps.store.listSnapshots();
    expect(snapshots).toHaveLength(13);
    for (const snapshot of snapshots) {
      expect(typeof snapshot.sizeBytes).toBe("number");
      expect((await readAcceptedSnapshot(snapshot)).byteLength).toBe(
        snapshot.sizeBytes,
      );
      expect(
        await f.deps.store.findInventory("WILDBERRIES", snapshot.sha256),
      ).toBeDefined();
    }
    expect(
      (await f.deps.store.listAuthorityRecords()).filter(
        (record) => record.authorityStatus === "AUTHORITY_ACCEPTED",
      ),
    ).toHaveLength(13);
  });

  it("new store connections resume durable upload after a snapshot/inventory failure without official refetch", async () => {
    const f = await fixture(false);
    await f.upload(f.first.requestId);
    const restarted = createDatabaseRuntime(scopedUrl.toString());
    try {
      const deps = dependencies(restarted, f.root);
      const failure = vi
        .spyOn(deps.store, "saveInventory")
        .mockRejectedValueOnce(new Error("SYNTHETIC_INVENTORY_FAILURE"));
      expect(
        (
          await runApiWatchReport({
            dependencies: deps,
            source: "SCHEDULED",
            runId: "resume-fail",
          })
        ).status,
      ).toBe("FAILED");
      failure.mockRestore();
      expect(
        (
          await runApiWatchReport({
            dependencies: deps,
            source: "SCHEDULED",
            runId: "resume-ok",
          })
        ).status,
      ).toBe("SUCCEEDED");
      expect(await deps.store.listSnapshots()).toHaveLength(13);
      expect(
        (await deps.store.listAuthorityRecords()).filter(
          (record) => record.authorityStatus === "AUTHORITY_ACCEPTED",
        ),
      ).toHaveLength(13);
      expect(deps.fetcher).not.toHaveBeenCalled();
    } finally {
      await restarted.close();
    }
  });

  it.each(["CANDIDATE_READY", "CANCELLED", "EXPIRED"] as const)(
    "public bot creates only one new generation after %s",
    async (terminal) => {
      const f = await fixture(false);
      if (terminal === "CANDIDATE_READY") await f.upload(f.first.requestId);
      else
        await f.deps.pendingStore.setRequestStatus(f.first.requestId, terminal);
      await f.command("/swagger_new", "unauthorized");
      expect(await f.deps.pendingStore.listPending(new Date())).toHaveLength(0);
      await Promise.all([
        f.command("/swagger_new"),
        f.command("/swagger_new"),
        f.command("/swagger_new"),
      ]);
      const pending = (
        await f.deps.pendingStore.listPending(new Date())
      ).filter((request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY);
      expect(pending).toHaveLength(1);
      const next = pending[0]!;
      expect(next.requestId).not.toBe(f.first.requestId);
      expect(
        (await f.deps.pendingStore.getRequest(f.first.requestId))?.status,
      ).toBe(terminal);
      await f.upload(next.requestId, "2");
      expect(
        (await f.deps.pendingStore.getRequest(next.requestId))?.status,
      ).toBe("CANDIDATE_READY");
      expect(
        (await f.deps.pendingStore.listArtifacts(next.requestId))[0]?.sizeBytes,
      ).toBe(bundleBytes("2").byteLength);
      const evaluation = await evaluateOperatorCandidate({
        ...f.deps,
        requestId: next.requestId,
      });
      expect(evaluation.kind).toBe("AUTHORITY_ACCEPTED");
      expect(
        (await f.deps.pendingStore.getRequest(f.first.requestId))?.status,
      ).toBe(terminal);
    },
  );

  it("a mid-family PostgreSQL rejection commits zero authority members, then resumes all13", async () => {
    const f = await fixture(false);
    await f.upload(f.first.requestId);
    await db.query(
      "CREATE FUNCTION " +
        schema +
        ".reject_wb_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.safe_provenance->>'documentKey'='WB_07_ORDERS_FBW' THEN RAISE EXCEPTION 'SYNTHETIC_FAMILY_WRITE_FAILURE'; END IF; RETURN NEW; END $$",
    );
    await db.query(
      "CREATE TRIGGER reject_wb_member BEFORE INSERT ON api_watch_authority_records FOR EACH ROW EXECUTE FUNCTION " +
        schema +
        ".reject_wb_member()",
    );
    try {
      await expect(
        evaluateOperatorCandidate({ ...f.deps, requestId: f.first.requestId }),
      ).rejects.toThrow("SYNTHETIC_FAMILY_WRITE_FAILURE");
      expect(
        (await f.deps.store.listAuthorityRecords()).filter(
          (record) => record.authorityStatus === "AUTHORITY_ACCEPTED",
        ),
      ).toHaveLength(0);
    } finally {
      await db.query(
        "DROP TRIGGER reject_wb_member ON api_watch_authority_records",
      );
      await db.query("DROP FUNCTION " + schema + ".reject_wb_member()");
    }
    expect(
      (
        await runApiWatchReport({
          dependencies: f.deps,
          source: "SCHEDULED",
          runId: "after-rollback",
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(
      (await f.deps.store.listAuthorityRecords()).filter(
        (record) => record.authorityStatus === "AUTHORITY_ACCEPTED",
      ),
    ).toHaveLength(13);
    expect(await f.deps.store.listSnapshots()).toHaveLength(13);
    const artifact = (
      await f.deps.pendingStore.listArtifacts(f.first.requestId)
    )[0]!;
    expect(
      await readFile(join(f.deps.quarantineDir, artifact.quarantineFilename)),
    ).toEqual(Buffer.from(bundleBytes()));
  });
});
