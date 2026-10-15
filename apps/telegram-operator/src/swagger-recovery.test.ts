import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSwaggerHandoffService,
  createInMemorySwaggerSourceState,
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import {
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
  InMemoryApiWatchReportStore,
  InMemoryApiWatchRetryStore,
  createApiWatchRunner,
  runApiWatchReport,
  productionSourceRegistry,
  createWbBundle,
  validateWbBundleUpload,
  WB_BUNDLE_DOCUMENT_KEY,
} from "@product/api-watch";
import { TelegramOperatorService } from "./telegram.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
function bytes(version = "1") {
  return new TextEncoder().encode(
    createWbBundle(
      productionSourceRegistry
        .get("WILDBERRIES")
        .documents!.map((doc, index) => ({
          documentKey: doc.documentKey,
          filename: doc.officialUrl.split("/").pop()!.split("?")[0]!,
          content: `openapi: 3.0.3\ninfo:\n  title: WB ${index}\n  version: '${version}'\npaths:\n  /document-${index}:\n    get:\n      responses:\n        '200':\n          description: ok\n`,
        })),
      "2026-10-15T00:00:00Z",
    ),
  );
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "review-wb-recovery-"));
  roots.push(root);
  const handoffState = createInMemorySwaggerSourceState();
  const pendingStore = new InMemorySwaggerSourceStore(handoffState);
  const state = createInMemoryApiWatchState();
  const store = new InMemoryApiWatchStore(state);
  const registry = {
    get: productionSourceRegistry.get.bind(productionSourceRegistry),
    list: () => [productionSourceRegistry.get("WILDBERRIES")],
  };
  const fetcher = vi.fn(
    async () => new Response("synthetic forbidden", { status: 403 }),
  );
  const dependencies = {
    registry,
    store,
    pendingStore,
    fetcher: fetcher as unknown as typeof fetch,
    reportStore: new InMemoryApiWatchReportStore(),
    retryStore: new InMemoryApiWatchRetryStore(),
    quarantineDir: join(root, "quarantine"),
    snapshotRoot: join(root, "snapshots"),
  };
  const scheduleStore = new InMemoryMonitoringScheduleStore();
  await scheduleStore.ensureDefaults(new Date());
  const scheduler = new IndependentMonitoringScheduler({
    store: scheduleStore,
    runners: {
      LLM: async () => ({
        status: "SUCCEEDED",
        code: null,
        summary: "synthetic",
      }),
      SWAGGER_API: createApiWatchRunner(dependencies),
    },
  });
  const messages: string[] = [];
  const bot = new TelegramOperatorService({
    scheduler,
    swaggerHandoff: createSwaggerHandoffService({
      store: pendingStore,
      quarantineDir: dependencies.quarantineDir,
      validateUpload: validateWbBundleUpload,
    }),
    transport: {
      getUpdates: async () => ({ updates: [] }),
      sendMessage: async (_chat, text) => {
        messages.push(text);
      },
      answerCallback: async () => {},
    },
    operatorIds: new Set(["7"]),
  });
  let updateId = 0;
  const command = (text: string, userId = "7") =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: { chatId: "42", userId, text },
    });
  const upload = (requestId: string, version = "1") =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload " + requestId,
        document: {
          fileId: "synthetic",
          fileName: "bundle.json",
          bytes: bytes(version),
        },
      },
    });
  await runApiWatchReport({
    dependencies,
    runId: "before-upload",
    source: "FORCED",
  });
  const first = (await pendingStore.listPending(new Date()))[0]!;
  return {
    ...dependencies,
    dependencies,
    scheduler,
    scheduleStore,
    pendingStore,
    handoffState,
    state,
    messages,
    command,
    upload,
    first,
  };
}
describe("review main109ce9df public WB recovery", () => {
  it("bot upload wakes the report pipeline and persists all13 snapshots/inventories without a fabricated diff", async () => {
    const f = await fixture();
    const run = vi.spyOn(f.scheduler, "runNow");
    await f.upload(f.first.requestId);
    expect(run).toHaveBeenCalledWith("SWAGGER_API");
    await vi.waitFor(async () =>
      expect(
        (await f.scheduleStore.getState("SWAGGER_API")).lastResult?.status,
      ).toBe("SUCCEEDED"),
    );
    expect(
      (await f.store.listAuthorityRecords()).filter(
        (x) => x.authorityStatus === "AUTHORITY_ACCEPTED",
      ),
    ).toHaveLength(13);
    const snapshots = await f.store.listSnapshots();
    expect(snapshots).toHaveLength(13);
    for (const snapshot of snapshots)
      expect(
        await f.store.findInventory("WILDBERRIES", snapshot.sha256),
      ).toBeDefined();
    const last = (await f.scheduleStore.getState("SWAGGER_API")).lastResult!;
    const report = await f.reportStore.getReport("api-watch:" + last.runId);
    expect(report?.sources).toHaveLength(13);
    expect(
      report?.sources.every(
        (x) => x.baseSnapshotSha256 === null && x.diffSha256 === null,
      ),
    ).toBe(true);
    expect(last.coverage?.comparisonState).toBe("NOT_RUN");
    expect(f.fetcher).toHaveBeenCalledTimes(13);
  });
  it("a restarted normal report consumes durable upload and resumes after snapshot persistence failure", async () => {
    const f = await fixture();
    // Suppress only the immediate wake to model process loss after durable upload.
    vi.spyOn(f.scheduler, "runNow").mockRejectedValue(
      new Error("SYNTHETIC_PROCESS_LOSS"),
    );
    await f.upload(f.first.requestId).catch(() => {});
    const restarted = {
      ...f.dependencies,
      pendingStore: new InMemorySwaggerSourceStore(f.handoffState),
      store: new InMemoryApiWatchStore(f.state),
    };
    const save = vi
      .spyOn(restarted.store, "saveInventory")
      .mockRejectedValueOnce(new Error("SYNTHETIC_WRITE_FAILURE"));
    f.fetcher.mockClear();
    expect(
      (
        await runApiWatchReport({
          dependencies: restarted,
          runId: "restart-fail",
          source: "SCHEDULED",
        })
      ).status,
    ).toBe("FAILED");
    save.mockRestore();
    expect(
      (
        await runApiWatchReport({
          dependencies: restarted,
          runId: "restart-recover",
          source: "SCHEDULED",
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(await restarted.store.listSnapshots()).toHaveLength(13);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(["CANDIDATE_READY", "CANCELLED", "EXPIRED"] as const)(
    "explicit bot renewal after %s preserves history and admits the next bundle",
    async (terminal) => {
      const f = await fixture();
      vi.spyOn(f.scheduler, "runNow").mockResolvedValue({
        kind: "NOT_DUE",
        lane: "SWAGGER_API",
      });
      if (terminal === "CANDIDATE_READY") {
        await f.upload(f.first.requestId);
      } else await f.pendingStore.setRequestStatus(f.first.requestId, terminal);
      await f.command("/swagger_new", "unauthorized");
      expect(await f.pendingStore.listPending(new Date())).toHaveLength(0);
      await Promise.all([f.command("/swagger_new"), f.command("/swagger_new")]);
      const next = (await f.pendingStore.listPending(new Date())).filter(
        (x) => x.documentKey === WB_BUNDLE_DOCUMENT_KEY,
      );
      expect(next).toHaveLength(1);
      expect(next[0]!.requestId).not.toBe(f.first.requestId);
      expect((await f.pendingStore.getRequest(f.first.requestId))?.status).toBe(
        terminal,
      );
      await f.upload(next[0]!.requestId, "2");
      expect(
        (await f.pendingStore.getRequest(next[0]!.requestId))?.status,
      ).toBe("CANDIDATE_READY");
      expect(
        await f.pendingStore.listArtifacts(next[0]!.requestId),
      ).toHaveLength(1);
      expect((await f.pendingStore.getRequest(f.first.requestId))?.status).toBe(
        terminal,
      );
    },
  );
});
