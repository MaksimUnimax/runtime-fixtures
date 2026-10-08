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
import { InMemoryProductCrosswalkStore } from "./crosswalk.js";
import { InMemoryApiWatchIncidentStore } from "./incident.js";
import {
  createInMemoryApiWatchReportState,
  InMemoryApiWatchReportStore,
} from "./report.js";
import { runApiWatchReport } from "./run.js";
import { extractProductRegistry, productIdentity } from "./product-registry.js";
import type {
  ApiWatchProductBaseline,
  ApiWatchProductBaselineReader,
} from "./types.js";

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
    OZON_SELLER: {
      officialUrl: url,
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
    OZON_PERFORMANCE: {
      officialUrl: url,
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
    WILDBERRIES: {
      officialUrl: url,
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
  });
}

function missingAuthorityRegistry() {
  return createSourceRegistry({
    OZON_SELLER: { officialUrl: null, documents: [] },
    OZON_PERFORMANCE: { officialUrl: null, documents: [] },
    WILDBERRIES: { officialUrl: null, documents: [] },
  });
}

function mutableBaselineReader() {
  let baseline: ApiWatchProductBaseline | undefined;
  const reader: ApiWatchProductBaselineReader = {
    async read(scope) {
      if (
        !baseline ||
        baseline.sourceFamily !== scope.sourceFamily ||
        baseline.documentKey !== scope.documentKey
      )
        return undefined;
      return baseline;
    },
  };
  return {
    reader,
    set(value: ApiWatchProductBaseline | undefined) {
      baseline = value;
    },
  };
}

function reportDependencies(
  registry: ReturnType<typeof allFamilyRegistry>,
  urlRoot: string,
  reportStore = new InMemoryApiWatchReportStore(),
  apiState = createInMemoryApiWatchState(),
  productBaselineRepository?: ApiWatchProductBaselineReader,
  clock: () => Date = () => new Date("2026-09-22T00:00:00Z"),
) {
  for (const entry of registry.list()) {
    for (const document of entry.documents ?? []) {
      if (new URL(document.officialUrl).hostname !== "127.0.0.1") {
        throw new Error("EXTERNAL_NETWORK_FORBIDDEN_IN_REPORT_FIXTURE");
      }
    }
  }
  return {
    dependencies: {
      registry,
      store: new InMemoryApiWatchStore(apiState),
      pendingStore: new InMemorySwaggerSourceStore(),
      reportStore,
      productBaselineRepository,
      snapshotRoot: urlRoot,
      clock,
    },
    reportStore,
    apiState,
  };
}

describe("A6 API-watch report lifecycle", () => {
  it("rejects a fixture registry that accidentally retains production URLs", () => {
    expect(() => reportDependencies(createSourceRegistry(), "/unused")).toThrow(
      "EXTERNAL_NETWORK_FORBIDDEN_IN_REPORT_FIXTURE",
    );
  });

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
        missingAuthorityRegistry(),
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
        OZON_SELLER: {
          officialUrl: server.url,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
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

  it("C03 report preserves source, exact snapshot version identity, and uncertainty", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-report-"));
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: server.url,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(registry, root);
      await runApiWatchReport({
        ...setup,
        runId: "c03-evidence",
        source: "FORCED",
      });
      const report = await setup.reportStore.getReport(
        "api-watch:c03-evidence",
      );
      const observed = report?.sources.find(
        (source) => source.sourceFamily === "OZON_SELLER",
      );
      const uncertain = report?.sources.find(
        (source) => source.sourceFamily === "WILDBERRIES",
      );
      expect(observed?.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(observed?.baseSnapshotSha256).toBeNull();
      expect(observed?.blockerCode).toBeNull();
      expect(uncertain?.snapshotSha256).toBeNull();
      expect(uncertain?.blockerCode).toBe("SOURCE_URL_AUTHORITY_MISSING");
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
      expect(result.coverage).toMatchObject({
        checkDepth: "API_DOCUMENT_COMPARISON",
        testedTargets: [],
        comparisonState: "NOT_RUN",
      });
      expect(result.coverage?.unverifiedTargets).toHaveLength(3);
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
        createSourceRegistry({
          OZON_SELLER: {
            officialUrl: server.url,
            requiredServerIdentity: undefined,
            titlePattern: undefined,
          },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: { officialUrl: null, documents: [] },
        }),
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
        createSourceRegistry({
          OZON_SELLER: {
            officialUrl: server.url,
            requiredServerIdentity: undefined,
            titlePattern: undefined,
          },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: { officialUrl: null, documents: [] },
        }),
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

  it("C03 keeps repeated breaking acquisitions compared to the accepted product baseline", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-product-base-"));
    const baseline = mutableBaselineReader();
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: server.url,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(
        registry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        baseline.reader,
      );
      await runApiWatchReport({
        ...setup,
        runId: "baseline-a",
        source: "FORCED",
      });
      const accepted = (await setup.dependencies.store.listSnapshots()).find(
        (snapshot) => snapshot.sourceFamily === "OZON_SELLER",
      )!;
      baseline.set({
        baselineId: "baseline-1",
        sourceFamily: accepted.sourceFamily,
        documentKey: accepted.documentKey ?? null,
        snapshotId: accepted.snapshotId,
        snapshotSha256: accepted.sha256,
        snapshotSpecVersion: accepted.specVersion,
        revision: 1,
        acceptedAt: new Date("2026-09-22T00:00:00Z"),
        acceptedBy: "fixture",
        acceptanceReference: "fixture:accepted-a",
      });

      server.setBody(DOCUMENT_B);
      for (const runId of ["breaking-b-one", "breaking-b-two"]) {
        const runResult = await runApiWatchReport({
          ...setup,
          runId,
          source: "FORCED",
        });
        expect(runResult.coverage).toMatchObject({
          checkDepth: "API_DOCUMENT_COMPARISON",
          testedTargets: ["OZON_SELLER:OZON_SELLER"],
          comparisonState: "PARTIAL",
        });
        const source = (
          await setup.reportStore.getReport(`api-watch:${runId}`)
        )?.sources.find((row) => row.sourceFamily === "OZON_SELLER");
        expect(source?.baseSnapshotSha256).toBe(accepted.sha256);
        expect(source?.changeMode).toBe("CHANGED");
        expect(source?.errorCode).toBeNull();
        expect(source?.diffSha256).toMatch(/^[a-f0-9]{64}$/);
      }

      server.setBody(DOCUMENT_A);
      await runApiWatchReport({
        ...setup,
        runId: "restored-a",
        source: "FORCED",
      });
      const restored = (
        await setup.reportStore.getReport("api-watch:restored-a")
      )?.sources.find((row) => row.sourceFamily === "OZON_SELLER");
      expect(restored?.baseSnapshotSha256).toBe(accepted.sha256);
      expect(restored?.snapshotSha256).toBe(accepted.sha256);
      expect(restored?.changeMode).toBe("NO_CHANGE");
      expect(restored?.errorCode).toBeNull();
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 marks latest-observed comparison as uncertain when no product baseline exists", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-no-product-base-"));
    const baseline = mutableBaselineReader();
    let clockTick = 0;
    const clock = () =>
      new Date(Date.parse("2026-09-22T00:00:00Z") + clockTick++ * 1000);
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: server.url,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(
        registry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        baseline.reader,
        clock,
      );
      await runApiWatchReport({
        ...setup,
        runId: "unaccepted-a",
        source: "FORCED",
      });
      server.setBody(DOCUMENT_B);
      await runApiWatchReport({
        ...setup,
        runId: "unaccepted-b-one",
        source: "FORCED",
      });
      await runApiWatchReport({
        ...setup,
        runId: "unaccepted-b-two",
        source: "FORCED",
      });

      const changed = (
        await setup.reportStore.getReport("api-watch:unaccepted-b-one")
      )?.sources.find((row) => row.sourceFamily === "OZON_SELLER");
      const repeated = (
        await setup.reportStore.getReport("api-watch:unaccepted-b-two")
      )?.sources.find((row) => row.sourceFamily === "OZON_SELLER");
      expect(changed?.changeMode).toBe("CHANGED");
      expect(changed?.errorCode).toBe("PRODUCT_BASELINE_MISSING");
      expect(repeated?.changeMode).toBe("NO_CHANGE");
      expect(repeated?.errorCode).toBe("PRODUCT_BASELINE_MISSING");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 wires accepted document comparison through crosswalk into incidents", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-crosswalk-wiring-"));
    const baseline = mutableBaselineReader();
    const crosswalkStore = new InMemoryProductCrosswalkStore();
    const incidentStore = new InMemoryApiWatchIncidentStore();
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: null,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: [
            {
              documentKey: "seller-public",
              officialUrl: server.url,
              expectedArtifactTypes: ["JSON"],
            },
          ],
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(
        registry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        baseline.reader,
      );
      const dependencies = {
        ...setup.dependencies,
        crosswalkStore,
        incidentStore,
      };
      await runApiWatchReport({
        dependencies,
        runId: "document-baseline",
        source: "FORCED",
      });
      expect(
        await crosswalkStore.listRows("api-watch:document-baseline"),
      ).toEqual([]);
      expect(
        (await incidentStore.listOpen()).some(
          (incident) => incident.documentKey !== null,
        ),
      ).toBe(false);
      const accepted = (await setup.dependencies.store.listSnapshots()).find(
        (snapshot) =>
          snapshot.sourceFamily === "OZON_SELLER" &&
          snapshot.documentKey === "seller-public",
      )!;
      baseline.set({
        baselineId: "seller-public-baseline",
        sourceFamily: accepted.sourceFamily,
        documentKey: "seller-public",
        snapshotId: accepted.snapshotId,
        snapshotSha256: accepted.sha256,
        snapshotSpecVersion: accepted.specVersion,
        revision: 1,
        acceptedAt: new Date("2026-09-22T00:00:00Z"),
        acceptedBy: "fixture",
        acceptanceReference: "fixture:seller-public",
      });
      server.setBody(DOCUMENT_B);
      await runApiWatchReport({
        dependencies,
        runId: "document-crosswalk",
        source: "FORCED",
      });
      const rows = await crosswalkStore.listRows(
        "api-watch:document-crosswalk",
      );
      const scoped = rows.filter((row) => row.documentKey === "seller-public");
      expect(scoped.length).toBeGreaterThan(0);
      expect(
        scoped.every((row) => row.reportId === "api-watch:document-crosswalk"),
      ).toBe(true);
      expect(
        scoped.some((row) => row.sourceIdentity === "OZON_SELLER:GET:/items"),
      ).toBe(true);
      expect(scoped.some((row) => row.diffSha256 !== null)).toBe(true);
      const incidents = await incidentStore.listOpen();
      expect(
        incidents.some(
          (incident) =>
            incident.documentKey === "seller-public" &&
            incident.latestReportId === "api-watch:document-crosswalk",
        ),
      ).toBe(true);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 uses the PostgreSQL18 inferable document-scope conflict target", async () => {
    const reportSource = await readFile(
      new URL("./report.ts", import.meta.url),
      "utf8",
    );
    expect(reportSource).toContain(
      "ON CONFLICT (report_id,source_family,document_key) DO UPDATE",
    );
    expect(reportSource).not.toMatch(
      /ON CONFLICT[^\n]+WHERE document_key IS (?:NULL|NOT NULL)/,
    );
  });

  it("C03 scopes product baseline reads to the exact source document", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-document-scope-"));
    const seen: Array<{ sourceFamily: string; documentKey: string | null }> =
      [];
    const reader: ApiWatchProductBaselineReader = {
      async read(scope) {
        seen.push(scope);
        return undefined;
      },
    };
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: null,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: [
            {
              documentKey: "seller-public",
              officialUrl: server.url,
              expectedArtifactTypes: ["JSON"],
            },
          ],
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(
        registry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        reader,
      );
      await runApiWatchReport({
        ...setup,
        runId: "document-scope",
        source: "FORCED",
      });
      expect(seen).toContainEqual({
        sourceFamily: "OZON_SELLER",
        documentKey: "seller-public",
      });
      const source = (
        await setup.reportStore.getReport("api-watch:document-scope")
      )?.sources.find((row) => row.sourceFamily === "OZON_SELLER");
      expect(source?.documentKey).toBe("seller-public");
      expect(source?.errorCode).toBe("PRODUCT_BASELINE_MISSING");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 fails one scope closed when the accepted baseline reference is invalid", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "s2-c03-invalid-product-base-"));
    const reader: ApiWatchProductBaselineReader = {
      async read(scope) {
        if (scope.sourceFamily !== "OZON_SELLER") return undefined;
        return {
          baselineId: "missing-baseline",
          sourceFamily: scope.sourceFamily,
          documentKey: scope.documentKey,
          snapshotId: "missing-snapshot",
          snapshotSha256: "f".repeat(64),
          snapshotSpecVersion: "3.0.3",
          revision: 1,
          acceptedAt: new Date("2026-09-22T00:00:00Z"),
          acceptedBy: "fixture",
          acceptanceReference: "fixture:missing",
        };
      },
    };
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: server.url,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: { officialUrl: null, documents: [] },
      });
      const setup = reportDependencies(
        registry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        reader,
      );
      const result = await runApiWatchReport({
        ...setup,
        runId: "invalid-product-base",
        source: "FORCED",
      });
      expect(result.code).toBe("API_WATCH_REPORT_BLOCKED");
      const report = await setup.reportStore.getReport(
        "api-watch:invalid-product-base",
      );
      expect(report?.state).toBe("BLOCKED");
      const source = report?.sources.find(
        (row) => row.sourceFamily === "OZON_SELLER",
      );
      expect(source?.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source?.baseSnapshotSha256).toBe("f".repeat(64));
      expect(source?.diffSha256).toBeNull();
      expect(source?.impactSeverity).toBe("UNKNOWN");
      expect(source?.errorCode).toBe("PRODUCT_BASELINE_REFERENCE_INVALID");
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
        ...reportDependencies(missingAuthorityRegistry(), root, reportStore),
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
        ...reportDependencies(missingAuthorityRegistry(), root, reportStore),
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
  it("recomputes cached baseline semantics with the current normalizer", async () => {
    const server = await fixtureServer(DOCUMENT_A);
    const root = await mkdtemp(join(tmpdir(), "api-normalizer-upgrade-"));
    try {
      const setup = reportDependencies(
        createSourceRegistry({
          OZON_SELLER: {
            officialUrl: server.url,
            requiredServerIdentity: undefined,
            titlePattern: undefined,
          },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: { officialUrl: null, documents: [] },
        }),
        root,
      );
      await runApiWatchReport({
        ...setup,
        runId: "cached-base",
        source: "FORCED",
      });
      expect(setup.apiState.inventories.size).toBe(1);
      for (const [key, value] of setup.apiState.inventories) {
        setup.apiState.inventories.set(key, {
          ...value,
          operations: value.operations.map((operation) => ({
            ...operation,
            parameterSchemaSha256: "0".repeat(64),
            responseSchemaSha256: "0".repeat(64),
            securityRequirementsSha256: "0".repeat(64),
          })),
        });
      }
      const documented = JSON.parse(DOCUMENT_A.toString()) as Record<
        string,
        unknown
      >;
      documented.info = { title: "Updated documentation only", version: "1" };
      server.setBody(Buffer.from(JSON.stringify(documented)));
      await runApiWatchReport({
        ...setup,
        runId: "new-normalizer",
        source: "FORCED",
      });
      const report = await setup.reportStore.getReport(
        "api-watch:new-normalizer",
      );
      const source = report?.sources.find(
        (row) => row.sourceFamily === "OZON_SELLER",
      );
      expect(source?.diffSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source?.changedCount).toBe(0);
      expect(source?.unchangedCount).toBe(1);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("family-wide product absence", () => {
  it("does not invent missing WB operations across healthy documents, and retains real absence checks", async () => {
    const entries = await extractProductRegistry({
      sourceFamily: "WILDBERRIES",
    });
    const document = (rows: typeof entries) => {
      const paths: Record<string, Record<string, unknown>> = {};
      for (const entry of rows) {
        (paths[entry.normalizedPath] ??= {})[entry.method.toLowerCase()] = {
          responses: { "200": { description: "ok" } },
        };
      }
      return Buffer.from(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "WB fixture", version: "1" },
          paths,
        }),
      );
    };
    const groups = [
      entries.filter((_, i) => i % 2 === 0),
      entries.filter((_, i) => i % 2 === 1),
    ];
    const servers = await Promise.all(
      groups.map((rows) => fixtureServer(document(rows))),
    );
    const root = await mkdtemp(join(tmpdir(), "api-watch-family-scope-"));
    const baselines = new Map<string, ApiWatchProductBaseline>();
    const crosswalkStore = new InMemoryProductCrosswalkStore();
    const incidentStore = new InMemoryApiWatchIncidentStore();
    try {
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: null, documents: [] },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: {
          officialUrl: null,
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: servers.map((server, index) => ({
            documentKey: "WB_" + index,
            officialUrl: server.url,
            expectedArtifactTypes: ["JSON"],
          })),
        },
      });
      // Exercise a complete report for this two-document family.
      const familyRegistry = {
        ...registry,
        list: () => [registry.get("WILDBERRIES")],
      };
      const setup = reportDependencies(
        familyRegistry,
        root,
        new InMemoryApiWatchReportStore(),
        createInMemoryApiWatchState(),
        {
          async read(scope) {
            return baselines.get(scope.documentKey ?? "");
          },
        },
      );
      const dependencies = {
        ...setup.dependencies,
        crosswalkStore,
        incidentStore,
      };
      const run = (runId: string) =>
        runApiWatchReport({ dependencies, runId, source: "FORCED" });
      await run("family-baseline");
      for (const snapshot of await dependencies.store.listSnapshots()) {
        baselines.set(snapshot.documentKey!, {
          baselineId: "baseline-" + snapshot.documentKey,
          sourceFamily: snapshot.sourceFamily,
          documentKey: snapshot.documentKey!,
          snapshotId: snapshot.snapshotId,
          snapshotSha256: snapshot.sha256,
          snapshotSpecVersion: snapshot.specVersion,
          revision: 1,
          acceptedAt: new Date("2026-09-22T00:00:00Z"),
          acceptedBy: "fixture",
          acceptanceReference: "fixture:" + snapshot.documentKey,
        });
      }
      await run("family-unchanged");
      const report = await setup.reportStore.getReport(
        "api-watch:family-unchanged",
      );
      expect(
        report?.sources
          .filter((row) => row.sourceFamily === "WILDBERRIES")
          .map((row) => row.changeMode),
      ).toEqual(["NO_CHANGE", "NO_CHANGE"]);
      const healthy = await crosswalkStore.listRows(
        "api-watch:family-unchanged",
      );
      expect(
        healthy.filter((row) => row.crosswalkState === "RUNTIME_ONLY"),
      ).toEqual([]);
      expect(
        healthy.filter((row) => row.reviewState === "BLOCKING_RISK"),
      ).toEqual([]);
      expect(new Set(healthy.map((row) => row.sourceIdentity))).toEqual(
        new Set(entries.map(productIdentity)),
      );
      expect(healthy.some((row) => row.documentKey === "WB_0")).toBe(true);
      expect(healthy.some((row) => row.documentKey === "WB_1")).toBe(true);
      expect(
        (await incidentStore.listOpen()).filter(
          (row) => row.sourceFamily === "WILDBERRIES",
        ),
      ).toEqual([]);

      const removed = groups[0]!.find((entry) => entry.executionEnabled)!;
      servers[0]!.setBody(
        document(
          groups[0]!.filter(
            (entry) => productIdentity(entry) !== productIdentity(removed),
          ),
        ),
      );
      await run("family-missing");
      const missing = (
        await crosswalkStore.listRows("api-watch:family-missing")
      ).filter((row) => row.crosswalkState === "RUNTIME_ONLY");
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({
        sourceIdentity: productIdentity(removed),
        reviewState: "BLOCKING_RISK",
        documentKey: null,
        diffSha256: null,
      });
      expect(
        (await incidentStore.listOpen()).filter(
          (row) =>
            row.sourceFamily === "WILDBERRIES" &&
            row.incidentType === "API_CHANGE_BLOCKING",
        ),
      ).toHaveLength(1);

      const familyIncident = (await incidentStore.listOpen()).find(
        (row) => row.incidentType === "API_CHANGE_BLOCKING",
      )!;
      servers[0]!.setBody(document(groups[0]!));
      const secondBaseline = baselines.get("WB_1")!;
      baselines.delete("WB_1");
      await run("family-restored-incomplete");
      expect(
        (await incidentStore.listOpen()).some(
          (row) => row.incidentKey === familyIncident.incidentKey,
        ),
      ).toBe(true);
      baselines.set("WB_1", secondBaseline);
      await run("family-restored");
      const restored = await setup.reportStore.getReport(
        "api-watch:family-restored",
      );
      expect(restored?.state).toBe("COMPLETED");
      expect(restored?.sources.map((row) => row.changeMode)).toEqual([
        "NO_CHANGE",
        "NO_CHANGE",
      ]);
      expect(
        (await crosswalkStore.listRows("api-watch:family-restored")).filter(
          (row) => row.reviewState === "BLOCKING_RISK",
        ),
      ).toEqual([]);
      expect(
        (await incidentStore.listOpen()).some(
          (row) => row.incidentKey === familyIncident.incidentKey,
        ),
      ).toBe(false);
      await run("family-restored-again");
      expect(
        (await incidentStore.listOpen()).some(
          (row) => row.incidentKey === familyIncident.incidentKey,
        ),
      ).toBe(false);

      // A missing baseline is not evidence that the other document lost operations.
      baselines.delete("WB_1");
      await run("family-incomplete-baseline");
      expect(
        (
          await crosswalkStore.listRows("api-watch:family-incomplete-baseline")
        ).filter((row) => row.crosswalkState === "RUNTIME_ONLY"),
      ).toEqual([]);
      // Failed source acquisition must also remain unknown, not absent.
      servers[1]!.setBody(Buffer.from("not an API document"));
      await run("family-unavailable");
      expect(
        (await crosswalkStore.listRows("api-watch:family-unavailable")).filter(
          (row) => row.crosswalkState === "RUNTIME_ONLY",
        ),
      ).toEqual([]);
    } finally {
      await Promise.all(servers.map((server) => server.close()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
