import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
  withMonitoringRun,
  type MonitoringRunAuthority,
  type MonitoringSqlQuery,
  type MonitoringSqlRuntime,
} from "@product/monitoring-control";
import {
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
} from "./authority.js";
import {
  InMemoryApiWatchReportStore,
  createPostgresApiWatchReportStore,
} from "./report.js";
import { InMemoryApiWatchIncidentStore } from "./incident.js";
import { createSourceRegistry } from "./source-registry.js";
import { createApiWatchRunner } from "./run.js";
import type { SourceRegistry, SwaggerSourceFamily } from "./types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function oneFamily(
  family: SwaggerSourceFamily,
  url: string | null = null,
): SourceRegistry {
  const registry = createSourceRegistry({
    [family]: {
      officialUrl: url,
      documents: [],
      acceptedHosts: url ? [new URL(url).hostname] : [],
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
  });
  return {
    ...registry,
    list: () =>
      registry.list().filter((entry) => entry.sourceFamily === family),
  };
}

describe("F-06 actual API-watch consumer lease boundary", () => {
  it("does not accept a delayed snapshot/inventory after takeover", async () => {
    const directory = await mkdtemp(join(tmpdir(), "octoport-f06-snapshot-"));
    const entered = deferred();
    const release = deferred();
    const state = createInMemoryApiWatchState();
    class DelayedSnapshotStore extends InMemoryApiWatchStore {
      override async saveSnapshotWithInventory(
        ...args: Parameters<InMemoryApiWatchStore["saveSnapshotWithInventory"]>
      ) {
        entered.resolve();
        await release.promise;
        return super.saveSnapshotWithInventory(...args);
      }
    }
    let time = new Date("2026-10-29T00:00:00Z");
    const clock = { now: () => new Date(time) };
    const schedule = new InMemoryMonitoringScheduleStore();
    await schedule.ensureDefaults(clock.now());
    const reports = new InMemoryApiWatchReportStore();
    const oldStore = new DelayedSnapshotStore(state);
    const oldRunner = createApiWatchRunner({
      registry: oneFamily(
        "OZON_PERFORMANCE",
        "https://fixture.invalid/swagger.json",
      ),
      store: oldStore,
      pendingStore: new InMemorySwaggerSourceStore(),
      reportStore: reports,
      clock: clock.now,
      snapshotRoot: directory,
      fetcher: async () =>
        new Response(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "fixture", version: "1" },
            paths: { "/items": { get: { responses: { "200": {} } } } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    const bRunner = createApiWatchRunner({
      registry: oneFamily("OZON_SELLER"),
      store: new InMemoryApiWatchStore(state),
      pendingStore: new InMemorySwaggerSourceStore(),
      reportStore: reports,
      clock: clock.now,
    });
    const scheduler = (runner: typeof oldRunner) =>
      new IndependentMonitoringScheduler({
        store: schedule,
        clock,
        leaseMs: 10_000,
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "fixture",
          }),
          SWAGGER_API: runner,
        },
      });
    const a = scheduler(oldRunner);
    const b = scheduler(bRunner);
    const terminalA = a
      .runNowAndWait("SWAGGER_API")
      .catch((error: unknown) => error);
    try {
      await Promise.race([
        entered.promise,
        terminalA.then((result) => {
          throw new Error(
            "SNAPSHOT_BOUNDARY_NOT_REACHED: " +
              (result instanceof Error
                ? result.message
                : JSON.stringify(result)),
          );
        }),
      ]);
      const authorityBeforeLoss = await oldStore.listAuthorityRecords();
      expect(
        authorityBeforeLoss.some(
          (record) => record.authorityStatus === "AUTHORITY_ACCEPTED",
        ),
      ).toBe(true);
      time = new Date(time.valueOf() + 10_001);
      await b.runNowAndWait("SWAGGER_API");
      release.resolve();
      await terminalA;
      expect(await oldStore.listSnapshots()).toEqual([]);
      expect(
        await oldStore.findInventory(
          "OZON_PERFORMANCE",
          authorityBeforeLoss[0]!.sha256!,
        ),
      ).toBeUndefined();
    } finally {
      release.resolve();
      await terminalA;
      await a.stop();
      await b.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
  for (const pause of [
    "before-acquisition",
    "before-authority-acceptance",
  ] as const) {
    it(`rejects old owner's durable report/authority/incident after takeover (${pause})`, async () => {
      const entered = deferred();
      const release = deferred();
      const state = createInMemoryApiWatchState();
      class DelayedStore extends InMemoryApiWatchStore {
        override async listSnapshots() {
          if (pause === "before-acquisition") {
            entered.resolve();
            await release.promise;
          }
          return super.listSnapshots();
        }
        override async saveAuthorityRecord(
          input: Parameters<InMemoryApiWatchStore["saveAuthorityRecord"]>[0],
        ) {
          if (pause === "before-authority-acceptance") {
            entered.resolve();
            await release.promise;
          }
          return super.saveAuthorityRecord(input);
        }
      }
      let time = new Date("2026-10-29T00:00:00.000Z");
      const clock = { now: () => new Date(time) };
      const schedule = new InMemoryMonitoringScheduleStore();
      await schedule.ensureDefaults(clock.now());
      const reports = new InMemoryApiWatchReportStore();
      const incidents = new InMemoryApiWatchIncidentStore();
      const notifications: Array<SwaggerSourceFamily | null> = [];
      const runner = (
        family: SwaggerSourceFamily,
        store: InMemoryApiWatchStore,
      ) =>
        createApiWatchRunner({
          registry: oneFamily(family),
          store,
          pendingStore: new InMemorySwaggerSourceStore(),
          reportStore: reports,
          incidentStore: incidents,
          incidentNotifier: async (event) => {
            notifications.push(event.incident.sourceFamily);
          },
          clock: clock.now,
        });
      const old = new IndependentMonitoringScheduler({
        store: schedule,
        clock,
        leaseMs: 100,
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "fixture",
          }),
          SWAGGER_API: runner("OZON_PERFORMANCE", new DelayedStore(state)),
        },
      });
      const next = new IndependentMonitoringScheduler({
        store: schedule,
        clock,
        leaseMs: 100,
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "fixture",
          }),
          SWAGGER_API: runner("OZON_SELLER", new InMemoryApiWatchStore(state)),
        },
      });
      const oldResult = old.runNowAndWait("SWAGGER_API").then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await entered.promise;
      const oldId = (await schedule.getState("SWAGGER_API")).activeRun!.runId;
      time = new Date(time.valueOf() + 101);
      const accepted = await next.runNowAndWait("SWAGGER_API");
      expect(accepted.status).toBe("NOT_OBSERVABLE");
      const successorResult = (await schedule.getState("SWAGGER_API"))
        .lastResult;
      release.resolve();
      await oldResult;
      const authority = await new InMemoryApiWatchStore(
        state,
      ).listAuthorityRecords();
      expect(
        authority.filter(
          (record) => record.sourceFamily === "OZON_PERFORMANCE",
        ),
      ).toEqual([]);
      expect(
        authority.some((record) => record.sourceFamily === "OZON_SELLER"),
      ).toBe(true);
      expect((await reports.getReport(`api-watch:${oldId}`))?.state).toBe(
        "RUNNING",
      );
      expect(notifications).toEqual(["OZON_SELLER"]);
      expect((await schedule.getState("SWAGGER_API")).lastResult).toEqual(
        successorResult,
      );
      await old.stop();
      await next.stop();
    });
  }

  it("stop revokes the acquisition signal before any delayed result can be accepted", async () => {
    const entered = deferred();
    const release = deferred();
    let transportSignal: AbortSignal | null | undefined;
    const schedule = new InMemoryMonitoringScheduleStore();
    const clock = { now: () => new Date("2026-10-29T00:00:00.000Z") };
    await schedule.ensureDefaults(clock.now());
    const store = new InMemoryApiWatchStore();
    const reports = new InMemoryApiWatchReportStore();
    const registry = oneFamily(
      "OZON_SELLER",
      "https://fixture.invalid/swagger.json",
    );
    const realRunner = createApiWatchRunner({
      registry,
      store,
      reportStore: reports,
      pendingStore: new InMemorySwaggerSourceStore(),
      clock: clock.now,
      fetcher: async (_url, init) => {
        transportSignal = init?.signal;
        entered.resolve();
        await release.promise;
        return new Response("synthetic unavailable", { status: 503 });
      },
    });
    const implementation = new IndependentMonitoringScheduler({
      store: schedule,
      clock,
      runners: {
        LLM: async () => ({
          status: "SUCCEEDED",
          code: null,
          summary: "fixture",
        }),
        SWAGGER_API: realRunner,
      },
    });
    const terminal = implementation
      .runNowAndWait("SWAGGER_API")
      .catch((error: unknown) => error);
    await entered.promise;
    await implementation.stop();
    const abortedOnStop = transportSignal?.aborted;
    release.resolve();
    await terminal;
    expect(abortedOnStop).toBe(true);
    expect(await store.listAuthorityRecords()).toEqual([]);
    expect((await schedule.getState("SWAGGER_API")).lastResult).toBeNull();
  });
});

describe("F-06 actual PostgreSQL report-store admission", () => {
  for (const mode of ["taken-over", "delayed-insert"] as const) {
    it(`does not commit the consumer report (${mode})`, async () => {
      let now = 0;
      const durable: string[] = [];
      const runtime: MonitoringSqlRuntime = {
        async query() {
          throw new Error("UNFENCED_REPORT_QUERY");
        },
        async transaction(operation) {
          const pending: string[] = [];
          const query: MonitoringSqlQuery = {
            async query<T extends Record<string, unknown>>(text: string) {
              if (text.includes("FOR UPDATE"))
                return {
                  rows: [
                    {
                      runId: mode === "taken-over" ? "B" : "A",
                      leaseExpiresAt: new Date(100),
                    },
                  ] as unknown as T[],
                };
              if (text.includes("clock_timestamp"))
                return { rows: [{ now: new Date(now) }] as unknown as T[] };
              if (!text.includes("INSERT INTO api_watch_reports"))
                throw new Error("UNEXPECTED_REPORT_QUERY");
              pending.push(text);
              now = 101;
              return { rows: [{}] as T[] };
            },
          };
          const result = await operation(query);
          durable.push(...pending);
          return result;
        },
      };
      const controller = new AbortController();
      const authority: MonitoringRunAuthority = {
        lane: "SWAGGER_API",
        runId: "A",
        signal: controller.signal,
        revoke: () => controller.abort(),
        assertCurrent: async () => {},
        assertCurrentSync: () => {
          throw new Error("NO_MEMORY_FENCE");
        },
        withCurrent: (operation) => operation(),
      };
      await expect(
        withMonitoringRun(authority, () =>
          createPostgresApiWatchReportStore(runtime).createReport({
            runSource: "FORCED",
            createdAt: new Date(0),
          }),
        ),
      ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
      expect(durable).toEqual([]);
      expect(controller.signal.aborted).toBe(true);
    });
  }
});
