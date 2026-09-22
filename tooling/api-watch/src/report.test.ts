import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemorySwaggerSourceStore } from "@product/monitoring-control";
import {
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
} from "./authority.js";
import { createSourceRegistry } from "./source-registry.js";
import {
  createInMemoryApiWatchReportState,
  InMemoryApiWatchReportStore,
} from "./report.js";
import { runApiWatchReport } from "./run.js";

const DOCUMENT_A = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "A", version: "1" },
    paths: { "/items": { get: { responses: { "200": {} } } } },
  }),
);
const DOCUMENT_B = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "B", version: "2" },
    paths: {
      "/items": { get: { responses: { "200": {}, "404": {} } } },
      "/orders": { post: { responses: { "201": {} } } },
    },
  }),
);

async function fixtureServer(initial: Buffer): Promise<{
  url: string;
  setBody: (body: Buffer) => void;
  close: () => Promise<void>;
}> {
  let body = initial;
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("FIXTURE_ADDRESS_MISSING");
  return {
    url: `http://127.0.0.1:${address.port}/openapi.json`,
    setBody: (next) => {
      body = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function allFamilyRegistry(url: string) {
  return createSourceRegistry({
    OZON_SELLER: { officialUrl: url },
    OZON_PERFORMANCE: { officialUrl: url },
    WILDBERRIES: { officialUrl: url },
  });
}

function reportDependencies(
  registry: ReturnType<typeof allFamilyRegistry>,
  urlRoot: string,
  reportStore = new InMemoryApiWatchReportStore(),
  apiState = createInMemoryApiWatchState(),
) {
  return {
    dependencies: {
      registry,
      store: new InMemoryApiWatchStore(apiState),
      pendingStore: new InMemorySwaggerSourceStore(),
      reportStore,
      snapshotRoot: urlRoot,
      clock: () => new Date("2026-09-22T00:00:00Z"),
    },
    reportStore,
    apiState,
  };
}

describe("A6 API-watch report lifecycle", () => {
  it("A6-01 transitions CREATED to RUNNING", async () => {
    const store = new InMemoryApiWatchReportStore();
    const report = await store.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    const running = await store.transitionReport({
      reportId: report.reportId,
      state: "RUNNING",
      at: new Date(),
    });
    expect(running.state).toBe("RUNNING");
  });

  for (const state of ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"] as const)
    it(`A6-${state === "COMPLETED" ? "02" : state === "PARTIAL" ? "03" : state === "BLOCKED" ? "04" : "05"} transitions RUNNING to ${state}`, async () => {
      const store = new InMemoryApiWatchReportStore();
      const report = await store.createReport({
        runSource: "SCHEDULED",
        createdAt: new Date(),
      });
      await store.transitionReport({
        reportId: report.reportId,
        state: "RUNNING",
        at: new Date(),
      });
      expect(
        (
          await store.transitionReport({
            reportId: report.reportId,
            state,
            at: new Date(),
          })
        ).state,
      ).toBe(state);
    });

  it("A6-06 terminal state cannot transition", async () => {
    const store = new InMemoryApiWatchReportStore();
    const report = await store.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    await store.transitionReport({
      reportId: report.reportId,
      state: "RUNNING",
      at: new Date(),
    });
    await store.transitionReport({
      reportId: report.reportId,
      state: "COMPLETED",
      at: new Date(),
    });
    await expect(
      store.transitionReport({
        reportId: report.reportId,
        state: "FAILED",
        at: new Date(),
      }),
    ).rejects.toThrow("REPORT_TERMINAL_OR_INVALID_TRANSITION");
  });

  it("A6-07 all source URL authority missing is BLOCKED, not FAILED", async () => {
    const reportStore = new InMemoryApiWatchReportStore();
    const apiState = createInMemoryApiWatchState();
    const result = await runApiWatchReport({
      ...reportDependencies(
        createSourceRegistry(),
        await mkdtemp(join(tmpdir(), "s2-a6-")),
        reportStore,
        apiState,
      ),
      runId: "blocked",
      source: "FORCED",
    });
    expect(result.code).toBe("API_WATCH_REPORT_BLOCKED");
    expect((await reportStore.getReport("api-watch:blocked"))?.state).toBe(
      "BLOCKED",
    );
  });

  it("A6-08 one usable source and two blocked sources is PARTIAL", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const reportStore = new InMemoryApiWatchReportStore();
    const root = await mkdtemp(join(tmpdir(), "s2-a6-partial-"));
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: server.url },
      });
      const result = await runApiWatchReport({
        ...reportDependencies(registry, root, reportStore),
        runId: "partial",
        source: "SCHEDULED",
      });
      expect(result.code).toBe("API_WATCH_REPORT_PARTIAL");
      expect(
        (await reportStore.getReport("api-watch:partial"))?.sources,
      ).toHaveLength(3);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-09 all usable first observations complete successfully", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-a6-complete-"));
    try {
      const setup = reportDependencies(allFamilyRegistry(server.url), root);
      const result = await runApiWatchReport({
        ...setup,
        runId: "complete",
        source: "SCHEDULED",
      });
      const report = await setup.reportStore.getReport("api-watch:complete");
      expect(result.code).toBe("API_WATCH_REPORT_COMPLETED");
      expect(report?.state).toBe("COMPLETED");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-10 a semantic change still completes when observation succeeds", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-a6-change-"));
    try {
      const setup = reportDependencies(allFamilyRegistry(server.url), root);
      await runApiWatchReport({
        ...setup,
        runId: "first",
        source: "SCHEDULED",
      });
      server.setBody(DOCUMENT_B);
      const result = await runApiWatchReport({
        ...setup,
        runId: "changed",
        source: "FORCED",
      });
      const report = await setup.reportStore.getReport("api-watch:changed");
      expect(result.code).toBe("API_WATCH_REPORT_COMPLETED");
      expect(report?.changedCount).toBeGreaterThan(0);
      expect(report?.sources.some((source) => source.diffSha256 !== null)).toBe(
        true,
      );
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-11 first snapshot has no fake diff", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-a6-first-"));
    try {
      const setup = reportDependencies(
        createSourceRegistry({ OZON_SELLER: { officialUrl: server.url } }),
        root,
      );
      await runApiWatchReport({
        ...setup,
        runId: "first-only",
        source: "FORCED",
      });
      const source = (
        await setup.reportStore.getReport("api-watch:first-only")
      )?.sources.find((item) => item.sourceFamily === "OZON_SELLER");
      expect(source?.baseSnapshotSha256).toBeNull();
      expect(source?.diffSha256).toBeNull();
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-12 same SHA is NO_CHANGE without a duplicate diff", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-a6-same-"));
    const apiState = createInMemoryApiWatchState();
    try {
      const setup = reportDependencies(
        createSourceRegistry({ OZON_SELLER: { officialUrl: server.url } }),
        root,
        new InMemoryApiWatchReportStore(),
        apiState,
      );
      await runApiWatchReport({
        ...setup,
        runId: "same-one",
        source: "SCHEDULED",
      });
      await runApiWatchReport({
        ...setup,
        runId: "same-two",
        source: "SCHEDULED",
      });
      const source = (
        await setup.reportStore.getReport("api-watch:same-two")
      )?.sources.find((item) => item.sourceFamily === "OZON_SELLER");
      expect(source?.changeMode).toBe("NO_CHANGE");
      expect(apiState.diffs.size).toBe(0);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-13 records FORCED run source", async () => {
    const reportStore = new InMemoryApiWatchReportStore();
    const root = await mkdtemp(join(tmpdir(), "s2-a6-forced-"));
    try {
      await runApiWatchReport({
        ...reportDependencies(createSourceRegistry(), root, reportStore),
        runId: "forced",
        source: "FORCED",
      });
      expect((await reportStore.getReport("api-watch:forced"))?.runSource).toBe(
        "FORCED",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-14 records SCHEDULED run source", async () => {
    const reportStore = new InMemoryApiWatchReportStore();
    const root = await mkdtemp(join(tmpdir(), "s2-a6-scheduled-"));
    try {
      await runApiWatchReport({
        ...reportDependencies(createSourceRegistry(), root, reportStore),
        runId: "scheduled",
        source: "SCHEDULED",
      });
      expect(
        (await reportStore.getReport("api-watch:scheduled"))?.runSource,
      ).toBe("SCHEDULED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A6-15 report survives store recreation", async () => {
    const state = createInMemoryApiWatchReportState();
    const first = new InMemoryApiWatchReportStore(state);
    const report = await first.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    const recreated = new InMemoryApiWatchReportStore(state);
    expect((await recreated.getReport(report.reportId))?.state).toBe("CREATED");
  });

  it("A6-16 report persistence contains no raw Swagger body", async () => {
    const store = new InMemoryApiWatchReportStore();
    const report = await store.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    await store.transitionReport({
      reportId: report.reportId,
      state: "RUNNING",
      at: new Date(),
    });
    const final = await store.transitionReport({
      reportId: report.reportId,
      state: "COMPLETED",
      at: new Date(),
      sources: [
        {
          sourceFamily: "OZON_SELLER",
          acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
          authorityStatus: "AUTHORITY_ACCEPTED",
          snapshotSha256: "a".repeat(64),
          inventoryOperationCount: 1,
          baseSnapshotSha256: null,
          diffSha256: null,
          impactSeverity: null,
          blockerCode: null,
          errorCode: null,
          changeMode: "FIRST_SNAPSHOT",
          addedCount: null,
          removedCount: null,
          changedCount: null,
          unchangedCount: null,
          blockingRiskCount: null,
          reviewRequiredCount: null,
          unknownCount: null,
          noPolicyImpactCount: null,
        },
      ],
    });
    expect(JSON.stringify(final)).not.toContain("openapi");
    expect(JSON.stringify(final)).not.toContain("responses");
  });

  it("A6-17 report persistence contains no Telegram private content", async () => {
    const store = new InMemoryApiWatchReportStore();
    const report = await store.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    expect(JSON.stringify(report)).not.toMatch(
      /telegram|private message|chat history/i,
    );
  });

  it("A6-18 report persistence contains no credentials", async () => {
    const store = new InMemoryApiWatchReportStore();
    const report = await store.createReport({
      runSource: "FORCED",
      createdAt: new Date(),
    });
    expect(JSON.stringify(report)).not.toMatch(/token|secret|password|cookie/i);
  });

  it("A6-19 has no product auto-patch path", async () => {
    const source = await readFile(
      new URL("./report.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/auto.?patch|adapter|child_process|eval\s*\(/i);
  });

  it("A6-20 has no Stream-1 authority mutation", async () => {
    const source = await readFile(
      new URL("../../../apps/telegram-operator/src/main.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /executionAuthority|bootstrapAuthority|offlineGrace/,
    );
  });
});
