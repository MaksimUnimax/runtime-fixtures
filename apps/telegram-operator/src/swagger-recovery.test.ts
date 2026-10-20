import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
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
async function fixture(swaggerDelayMs = 0) {
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
  const swaggerRunner = createApiWatchRunner(dependencies);
  const scheduler = new IndependentMonitoringScheduler({
    store: scheduleStore,
    runners: {
      LLM: async () => ({
        status: "SUCCEEDED",
        code: null,
        summary: "synthetic",
      }),
      SWAGGER_API: async (run) => {
        // This optional fixture delay models a busy CI worker, not provider I/O.
        if (swaggerDelayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, swaggerDelayMs));
        return swaggerRunner(run);
      },
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
    notificationChatIds: ["42"],
  });
  let updateId = 0;
  const command = (text: string, userId = "7") =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: { chatId: "42", userId, text },
    });
  const renewButton = () =>
    bot.handleUpdate({
      updateId: ++updateId,
      callbackQuery: {
        id: "synthetic-renew",
        chatId: "42",
        userId: "7",
        data: "monitor:SWAGGER_API:new",
      },
    });
  const upload = (requestId: string, version = "1", payload = bytes(version)) =>
    bot.handleUpdate({
      updateId: ++updateId,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload " + requestId,
        document: {
          fileId: "synthetic",
          fileName: "bundle.json",
          bytes: payload,
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
    bot,
    messages,
    command,
    upload,
    renewButton,
    first,
  };
}
// A stored inventory may be published by the legacy two-step writer or
// by the atomic snapshot+inventory writer. Inject the same failure at the
// actual persistence boundary in either reviewed source version.
function failInventoryPersistence(
  store: InMemoryApiWatchStore,
  failAt: number,
  failureCode: string,
) {
  // Probe an API that is deliberately absent from older store classes.
  // Keep a callable type for vi.spyOn in both TypeScript versions.
  const compatible = store as unknown as {
    saveSnapshotWithInventory: (
      metadata: Parameters<InMemoryApiWatchStore["saveSnapshot"]>[0],
      inventory: Parameters<InMemoryApiWatchStore["saveInventory"]>[0],
    ) => ReturnType<InMemoryApiWatchStore["saveSnapshot"]>;
  };
  let saves = 0;
  if (typeof compatible.saveSnapshotWithInventory === "function") {
    const original = compatible.saveSnapshotWithInventory.bind(compatible);
    return vi
      .spyOn(compatible, "saveSnapshotWithInventory")
      .mockImplementation(async (metadata, inventory) => {
        if (++saves === failAt) throw new Error(failureCode);
        return original(metadata, inventory);
      });
  }
  const original = store.saveInventory.bind(store);
  return vi
    .spyOn(store, "saveInventory")
    .mockImplementation(async (inventory) => {
      if (++saves === failAt) throw new Error(failureCode);
      return original(inventory);
    });
}

// Source-only tests: one operator attachment, no manually typed request identity.
async function sendWbAttachment(
  f: Awaited<ReturnType<typeof fixture>>,
  input: {
    userId?: string;
    chatId?: string;
    caption?: string;
    fileSize?: number;
    payload?: Uint8Array;
  } = {},
) {
  return f.bot.handleUpdate({
    updateId: 1000,
    message: {
      chatId: input.chatId ?? "42",
      userId: input.userId ?? "7",
      caption: input.caption,
      document: {
        fileId: "synthetic",
        fileName: "wb-official-bundle.json",
        fileSize: input.fileSize,
        bytes: input.payload ?? bytes(),
      },
    },
  });
}

async function waitForCaptionlessSourceConsumption(
  f: Awaited<ReturnType<typeof fixture>>,
) {
  await vi.waitFor(
    async () => {
      const state = await f.scheduleStore.getState("SWAGGER_API");
      expect(state.activeRun).toBeNull();
      expect(state.lastResult?.status).toBe("SUCCEEDED");
    },
    { timeout: 15_000 },
  );
}

describe("C04 WB single-attachment intake without a request ID", () => {
  it("advertises the captionless upload after an existing request, without asking for its ID", async () => {
    const f = await fixture();
    await f.command("/swagger_pending");
    expect(f.messages.at(-1)).toContain("without a caption or request ID");
  });

  it("accepts one complete WB bundle from an allowlisted operator in the configured chat", async () => {
    const f = await fixture();
    await sendWbAttachment(f);
    expect(f.messages.at(-1)).toBe(
      `Swagger candidate ready: ${f.first.requestId}`,
    );
    expect((await f.pendingStore.getRequest(f.first.requestId))?.status).toBe(
      "CANDIDATE_READY",
    );
    const artifacts = await f.pendingStore.listArtifacts(f.first.requestId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.status).toBe("CANDIDATE_READY");
    expect(artifacts[0]?.sourceFamily).toBe("WILDBERRIES");
    await waitForCaptionlessSourceConsumption(f);
    expect(await f.store.listSnapshots()).toHaveLength(13);
  }, 20_000);

  it("rejects another user and another chat without downloading or creating an artifact", async () => {
    const f = await fixture();
    await sendWbAttachment(f, { userId: "8" });
    expect(f.messages.at(-1)).toBe("DENIED");
    await sendWbAttachment(f, { chatId: "99" });
    expect(f.messages.at(-1)).toBe("DENIED");
    expect(await f.pendingStore.listArtifacts(f.first.requestId)).toHaveLength(
      0,
    );
  });

  it("refuses ambiguous WB requests even when each has the official bundle identity", async () => {
    const f = await fixture();
    await f.pendingStore.createRequest({
      sourceFamily: "WILDBERRIES",
      officialUrl: f.first.officialUrl,
      documentKey: f.first.documentKey,
      bundleVersion: f.first.bundleVersion,
      expectedArtifactType: "JSON",
      blockerReason: "Second independent pending operator request.",
    });
    await sendWbAttachment(f);
    expect(f.messages.at(-1)).toContain("WB_BUNDLE_PENDING_NOT_UNIQUE");
    expect(await f.pendingStore.listArtifacts(f.first.requestId)).toHaveLength(
      0,
    );
  });

  it("refuses missing, expired and non-official WB requests", async () => {
    const f = await fixture();
    await f.pendingStore.setRequestStatus(f.first.requestId, "EXPIRED");
    await sendWbAttachment(f);
    expect(f.messages.at(-1)).toContain("WB_BUNDLE_PENDING_NOT_UNIQUE");
    await f.pendingStore.createRequest({
      sourceFamily: "WILDBERRIES",
      officialUrl: "https://untrusted.example.test/wb.json",
      documentKey: f.first.documentKey,
      bundleVersion: f.first.bundleVersion,
      expectedArtifactType: "JSON",
      blockerReason: "Different official source required.",
    });
    await sendWbAttachment(f);
    expect(f.messages.at(-1)).toContain("WB_BUNDLE_PENDING_NOT_UNIQUE");
    expect(await f.pendingStore.listArtifacts(f.first.requestId)).toHaveLength(
      0,
    );
  });

  it("refuses oversize attachments and invalid 13-document bundles", async () => {
    const f = await fixture();
    await sendWbAttachment(f, {
      fileSize: 26 * 1024 * 1024,
    });
    expect(f.messages.at(-1)).toBe("UPLOAD_TOO_LARGE");
    expect(await f.pendingStore.listArtifacts(f.first.requestId)).toHaveLength(
      0,
    );
    await sendWbAttachment(f, {
      payload: new TextEncoder().encode("{}"),
    });
    expect(f.messages.at(-1)).not.toMatch(/candidate ready/i);
    expect(
      (await f.pendingStore.listArtifacts(f.first.requestId)).filter(
        (artifact) => artifact.status === "CANDIDATE_READY",
      ),
    ).toHaveLength(0);
  });

  it("keeps explicit /swagger_upload bound to its provided request ID", async () => {
    const f = await fixture();
    await f.upload(f.first.requestId);
    expect(f.messages.at(-1)).toBe(
      `Swagger candidate ready: ${f.first.requestId}`,
    );
    await waitForCaptionlessSourceConsumption(f);
  }, 20_000);
});

describe("review main109ce9df public WB recovery", () => {
  it("bot upload wakes the report pipeline and persists all13 snapshots/inventories without a fabricated diff", async () => {
    const f = await fixture(1250);
    const run = vi.spyOn(f.scheduler, "runNow");
    // Bot upload acknowledges the wake before the async report finishes.
    // Observe this run's persisted result, not a one-second timing poll.
    let notifyFinished: (() => void) | undefined;
    const swaggerFinished = new Promise<void>((resolve) => {
      notifyFinished = resolve;
    });
    const finishRun = f.scheduleStore.finishRun.bind(f.scheduleStore);
    vi.spyOn(f.scheduleStore, "finishRun").mockImplementation(async (input) => {
      const persisted = await finishRun(input);
      if (
        input.lane === "SWAGGER_API" &&
        persisted.lastResult?.runId === input.runId
      ) {
        notifyFinished?.();
      }
      return persisted;
    });
    await f.upload(f.first.requestId);
    expect(run).toHaveBeenCalledWith("SWAGGER_API");
    await swaggerFinished;
    expect(
      (await f.scheduleStore.getState("SWAGGER_API")).lastResult?.status,
    ).toBe("SUCCEEDED");
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
  }, 15_000);
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
    const save = failInventoryPersistence(
      restarted.store,
      1,
      "SYNTHETIC_WRITE_FAILURE",
    );
    vi.mocked(f.fetcher).mockClear();
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

function officialV2(input: Parameters<typeof fetch>[0]): Response {
  const index = productionSourceRegistry
    .get("WILDBERRIES")
    .documents!.findIndex((doc) => doc.officialUrl === String(input));
  if (index < 0) throw new Error("UNEXPECTED_SYNTHETIC_URL");
  return new Response(
    `openapi: 3.0.3\ninfo:\n  title: WB ${index}\n  version: '2'\npaths:\n  /document-${index}:\n    get:\n      responses:\n        '200':\n          description: ok\n  /added-${index}:\n    post:\n      responses:\n        '200':\n          description: new\n`,
    { headers: { "content-type": "application/yaml" } },
  );
}

describe("review main299d6113 WB next observation", () => {
  it("renews a failed artifact once through repeated/concurrent bot actions and accepts corrected bytes", async () => {
    const f = await fixture();
    const bad = new TextEncoder().encode("{}");
    await f.upload(f.first.requestId, "1", bad);
    expect(
      (await f.dependencies.pendingStore.getRequest(f.first.requestId))?.status,
    ).toBe("VALIDATION_FAILED");
    const [old] = await f.dependencies.pendingStore.listArtifacts(
      f.first.requestId,
    );
    expect(old?.parserResult.errorCode).toBe("WB_BUNDLE_VERSION_INVALID");
    await f.command("/swagger_new", "unauthorized");
    await Promise.all([
      f.command("/swagger_new"),
      f.renewButton(),
      f.command("/swagger_new"),
    ]);
    await f.command("/swagger_new");
    const waiting = (
      await f.dependencies.pendingStore.listPending(new Date())
    ).filter((x) => x.status === "PENDING_OPERATOR_UPLOAD");
    expect(waiting).toHaveLength(1);
    const next = waiting[0]!;
    expect(next.requestId).not.toBe(f.first.requestId);
    await f.upload(next.requestId);
    await vi.waitFor(
      async () => {
        const state = await f.scheduleStore.getState("SWAGGER_API");
        expect(state.activeRun).toBeNull();
        expect(state.lastResult?.status).toBe("SUCCEEDED");
      },
      { timeout: 15000 },
    );
    expect(await f.dependencies.store.listSnapshots()).toHaveLength(13);
    expect(
      await f.dependencies.pendingStore.listArtifacts(f.first.requestId),
    ).toEqual([old]);
    expect(
      await readFile(
        join(f.dependencies.quarantineDir, old!.quarantineFilename),
      ),
    ).toEqual(Buffer.from(bad));
    expect(
      (await f.dependencies.pendingStore.getRequest(f.first.requestId))?.status,
    ).toBe("VALIDATION_FAILED");
    expect(
      await f.dependencies.pendingStore.listArtifacts(next.requestId),
    ).toHaveLength(1);
    expect(
      f.messages.some((x) => x.includes("REQUEST_ARTIFACT_ALREADY_RECEIVED")),
    ).toBe(false);
    expect(
      (await f.dependencies.pendingStore.listArtifacts(next.requestId))[0]
        ?.sizeBytes,
    ).toBe(bytes().byteLength);
  });

  it("a completed bot candidate permits forced official v2 and never replays historical v1", async () => {
    const f = await fixture();
    await f.upload(f.first.requestId);
    await vi.waitFor(
      async () => {
        const state = await f.scheduleStore.getState("SWAGGER_API");
        expect(state.activeRun).toBeNull();
        expect(state.lastResult?.status).toBe("SUCCEEDED");
      },
      { timeout: 15000 },
    );
    const original = await f.dependencies.store.listSnapshots();
    expect(original).toHaveLength(13);
    const baselines = new Map(
      original.map((snapshot) => [
        snapshot.documentKey,
        {
          sourceFamily: snapshot.sourceFamily,
          documentKey: snapshot.documentKey ?? null,
          baselineId: "fixture-" + snapshot.documentKey,
          snapshotId: snapshot.snapshotId,
          snapshotSha256: snapshot.sha256,
          snapshotSpecVersion: snapshot.specVersion,
          revision: 1,
          acceptedAt: new Date(),
          acceptedBy: "review-fixture",
          acceptanceReference: "review299",
        },
      ]),
    );
    Object.assign(f.dependencies, {
      productBaselineRepository: {
        read: async (scope: { documentKey: string | null }) =>
          baselines.get(scope.documentKey),
      },
    });

    vi.mocked(f.dependencies.fetcher).mockClear();
    vi.mocked(f.dependencies.fetcher).mockImplementation(async (url) =>
      officialV2(url),
    );
    const result = await f.scheduler.runNowAndWait("SWAGGER_API");
    expect(result.status).toBe("SUCCEEDED");
    expect(f.dependencies.fetcher).toHaveBeenCalledTimes(13);
    const report = await f.dependencies.reportStore.getReport(
      "api-watch:" +
        (await f.scheduleStore.getState("SWAGGER_API")).lastResult!.runId,
    );
    expect(report?.sources).toHaveLength(13);
    expect(
      report?.sources.every(
        (x) => x.changeMode === "CHANGED" && x.addedCount === 1,
      ),
    ).toBe(true);
    expect(report?.addedCount).toBe(13);
    expect(await f.dependencies.store.listSnapshots()).toHaveLength(26);
    expect(
      (await f.dependencies.pendingStore.getRequest(f.first.requestId))?.status,
    ).toBe("CANDIDATE_READY");
    vi.mocked(f.dependencies.fetcher).mockClear();
    await f.scheduler.runNowAndWait("SWAGGER_API");
    expect(f.dependencies.fetcher).toHaveBeenCalledTimes(13);
    const nextReport = await f.dependencies.reportStore.getReport(
      "api-watch:" +
        (await f.scheduleStore.getState("SWAGGER_API")).lastResult!.runId,
    );
    expect(nextReport?.sources.every((x) => x.changeMode === "CHANGED")).toBe(
      true,
    );
    expect(nextReport?.sources.map((x) => x.snapshotSha256)).toEqual(
      report?.sources.map((x) => x.snapshotSha256),
    );
    expect(nextReport?.sources.map((x) => x.baseSnapshotSha256)).toEqual(
      report?.sources.map((x) => x.baseSnapshotSha256),
    );
    expect(result.coverage?.comparisonState).toBe("COMPLETED");
    expect(await f.dependencies.store.listSnapshots()).toHaveLength(26);
  });
});

describe("review main299d6113 receipt and hold boundaries", () => {
  it("completed upload retains scheduled operator hold, and forced403 does not start automatic retries", async () => {
    const f = await fixture();
    await f.upload(f.first.requestId);
    await vi.waitFor(
      async () =>
        expect(
          (await f.scheduleStore.getState("SWAGGER_API")).activeRun,
        ).toBeNull(),
      { timeout: 15000 },
    );
    vi.mocked(f.dependencies.fetcher).mockClear();
    const held = await runApiWatchReport({
      dependencies: f.dependencies,
      source: "SCHEDULED",
      runId: "receipt-held",
    });
    expect(held.status).toBe("NOT_OBSERVABLE");
    expect(f.dependencies.fetcher).not.toHaveBeenCalled();
    const blocked = await f.dependencies.reportStore.getReport(
      "api-watch:receipt-held",
    );
    expect(
      blocked?.sources.every(
        (x) =>
          x.acquisitionOutcome === "OPERATOR_SOURCE_REQUIRED" &&
          x.changeMode === null,
      ),
    ).toBe(true);
    await f.scheduler.runNowAndWait("SWAGGER_API");
    expect(f.dependencies.fetcher).toHaveBeenCalledTimes(13);
    expect(await f.dependencies.retryStore.get("WILDBERRIES")).toBeUndefined();
    await runApiWatchReport({
      dependencies: f.dependencies,
      source: "SCHEDULED",
      runId: "receipt-held-again",
    });
    expect(f.dependencies.fetcher).toHaveBeenCalledTimes(13);
    expect(await f.dependencies.store.listSnapshots()).toHaveLength(13);
  });

  it.each(["inventory", "report_commit_before_ack"] as const)(
    "resumes the exact bundle after %s without mistaking a persisted request/report for a receipt",
    async (boundary) => {
      const f = await fixture();
      vi.spyOn(f.scheduler, "runNow").mockResolvedValue({
        kind: "NOT_DUE",
        lane: "SWAGGER_API",
      });
      await f.upload(f.first.requestId);
      vi.mocked(f.dependencies.fetcher).mockClear();
      if (boundary === "inventory") {
        failInventoryPersistence(
          f.dependencies.store,
          7,
          "SYNTHETIC_SEVENTH_INVENTORY",
        );
      } else {
        const original = f.dependencies.reportStore.transitionReport.bind(
          f.dependencies.reportStore,
        );
        vi.spyOn(
          f.dependencies.reportStore,
          "transitionReport",
        ).mockImplementation(async (input) => {
          const committed = await original(input);
          if (input.state === "COMPLETED")
            throw new Error("SYNTHETIC_REPORT_ACK_LOSS");
          return committed;
        });
      }
      expect(
        (
          await runApiWatchReport({
            dependencies: f.dependencies,
            source: "SCHEDULED",
            runId: "partial-" + boundary,
          })
        ).status,
      ).toBe("FAILED");
      expect(
        (await readdir(f.dependencies.quarantineDir)).filter((x) =>
          x.startsWith("wb-consumed-"),
        ),
      ).toHaveLength(0);
      expect(
        (await f.dependencies.pendingStore.getRequest(f.first.requestId))
          ?.status,
      ).toBe("CANDIDATE_READY");
      expect(
        (
          await f.dependencies.reportStore.getReport(
            "api-watch:partial-" + boundary,
          )
        )?.state,
      ).toBe(boundary === "inventory" ? "FAILED" : "COMPLETED");
      vi.restoreAllMocks();
      const restarted = {
        ...f.dependencies,
        store: new InMemoryApiWatchStore(f.state),
        pendingStore: new InMemorySwaggerSourceStore(f.handoffState),
      };
      expect(
        (
          await runApiWatchReport({
            dependencies: restarted,
            source: "SCHEDULED",
            runId: "recover-" + boundary,
          })
        ).status,
      ).toBe("SUCCEEDED");
      expect(restarted.fetcher).not.toHaveBeenCalled();
      expect(
        (await readdir(restarted.quarantineDir)).filter((x) =>
          x.startsWith("wb-consumed-"),
        ),
      ).toHaveLength(1);
      expect(
        (await restarted.store.listAuthorityRecords()).filter(
          (x) => x.authorityStatus === "AUTHORITY_ACCEPTED",
        ),
      ).toHaveLength(13);
      expect(await restarted.store.listSnapshots()).toHaveLength(13);
      vi.mocked(restarted.fetcher).mockImplementation(async (url) =>
        officialV2(url),
      );
      expect(
        (
          await runApiWatchReport({
            dependencies: restarted,
            source: "FORCED",
            runId: "next-" + boundary,
          })
        ).status,
      ).toBe("SUCCEEDED");
      expect(restarted.fetcher).toHaveBeenCalledTimes(13);
      expect(await restarted.store.listSnapshots()).toHaveLength(26);
    },
  );

  it("concurrent complete pipelines keep one durable receipt and do not reopen an older ready generation", async () => {
    const f = await fixture();
    vi.spyOn(f.scheduler, "runNow").mockResolvedValue({
      kind: "NOT_DUE",
      lane: "SWAGGER_API",
    });
    await f.upload(f.first.requestId);
    vi.mocked(f.dependencies.fetcher).mockClear();
    const results = await Promise.all(
      ["receipt-race1", "receipt-race2"].map((runId) =>
        runApiWatchReport({
          dependencies: f.dependencies,
          source: "SCHEDULED",
          runId,
        }),
      ),
    );
    expect(results.every((x) => x.status === "SUCCEEDED")).toBe(true);
    const files = (await readdir(f.dependencies.quarantineDir)).filter((x) =>
      x.startsWith("wb-consumed-"),
    );
    expect(files).toHaveLength(1);
    const receipt = JSON.parse(
      await readFile(join(f.dependencies.quarantineDir, files[0]!), "utf8"),
    );
    expect(receipt.artifactId).toBe(
      (await f.dependencies.pendingStore.listArtifacts(f.first.requestId))[0]
        ?.artifactId,
    );
    expect(receipt.members).toHaveLength(13);
    expect(
      (await f.dependencies.reportStore.getReport(receipt.reportId))?.state,
    ).toBe("COMPLETED");
    await f.command("/swagger_new");
    const next = (
      await f.dependencies.pendingStore.listPending(new Date())
    ).find((x) => x.status === "PENDING_OPERATOR_UPLOAD")!;
    await f.upload(next.requestId, "2");
    expect(
      (
        await runApiWatchReport({
          dependencies: f.dependencies,
          source: "SCHEDULED",
          runId: "new-generation",
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(
      (await readdir(f.dependencies.quarantineDir)).filter((x) =>
        x.startsWith("wb-consumed-"),
      ),
    ).toHaveLength(2);
    vi.mocked(f.dependencies.fetcher).mockImplementation(async (url) =>
      officialV2(url),
    );
    expect(
      (
        await runApiWatchReport({
          dependencies: f.dependencies,
          source: "FORCED",
          runId: "past-both-generations",
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(f.dependencies.fetcher).toHaveBeenCalledTimes(13);
    const report = await f.dependencies.reportStore.getReport(
      "api-watch:past-both-generations",
    );
    expect(
      report?.sources.every((x) => x.changeMode !== "FIRST_SNAPSHOT"),
    ).toBe(true);
    expect(
      (await f.dependencies.pendingStore.getRequest(f.first.requestId))?.status,
    ).toBe("CANDIDATE_READY");
  });
});
