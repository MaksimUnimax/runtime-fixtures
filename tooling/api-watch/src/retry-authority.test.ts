import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import { InMemoryApiWatchStore, runAuthorityPass } from "./authority.js";
import { InMemoryApiWatchReportStore } from "./report.js";
import {
  applyRetryPassDecisions,
  InMemoryApiWatchRetryStore,
} from "./retry.js";
import { createSourceRegistry } from "./source-registry.js";
import { runApiWatchReport } from "./run.js";
import type { AcquisitionOutcome } from "./types.js";

const blocked: AcquisitionOutcome = {
  kind: "OPERATOR_SOURCE_REQUIRED",
  sourceFamily: "WILDBERRIES",
  officialUrl: "http://127.0.0.1/blocked",
  documentKey: "blocked",
  blockerReason: "synthetic403",
  httpStatus: 403,
};
function transient(status: number): AcquisitionOutcome {
  return {
    kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
    sourceFamily: "WILDBERRIES",
    officialUrl: "http://127.0.0.1/transient",
    documentKey: "transient",
    blockerReason: "synthetic",
    httpStatus: status,
    retryAfterSeconds: status === 429 ? 7200 : undefined,
  };
}

describe("independent PR97 rework: operator authority takes precedence", () => {
  it("holds scheduled acquisition, permits an explicit pass and uses its newer exact authority evidence", async () => {
    let now = new Date("2026-10-14T03:00:00Z"),
      calls = 0,
      status = 403;
    const registry = createSourceRegistry({
      OZON_SELLER: { officialUrl: null, documents: [] },
      OZON_PERFORMANCE: { officialUrl: null, documents: [] },
      WILDBERRIES: {
        officialUrl: null,
        acceptedHosts: ["127.0.0.1"],
        documents: [
          {
            documentKey: "blocked",
            officialUrl: "http://127.0.0.1/blocked",
            expectedArtifactTypes: ["JSON"],
          },
        ],
      },
    });
    const store = new InMemoryApiWatchStore(),
      pendingStore = new InMemorySwaggerSourceStore();
    const dependencies = {
      registry,
      store,
      pendingStore,
      now: () => new Date(now),
      fetcher: (async () => {
        calls++;
        return new Response("synthetic", { status });
      }) as typeof fetch,
    };
    await runAuthorityPass(dependencies);
    expect(calls).toBe(1);
    now = new Date(now.valueOf() + 1000);
    await runAuthorityPass({ ...dependencies, skipOperatorBlocked: true });
    expect(calls).toBe(1);
    now = new Date(now.valueOf() + 1000);
    status = 503;
    const forced = await runAuthorityPass(dependencies);
    expect(calls).toBe(2);
    expect(
      forced.outcomes.find((o) => o.sourceFamily === "WILDBERRIES")?.kind,
    ).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    now = new Date(now.valueOf() + 1000);
    await runAuthorityPass({ ...dependencies, skipOperatorBlocked: true });
    expect(calls).toBe(3);
  });

  it.each(["URL", "DOCUMENT_KEY"] as const)(
    "a changed exact configured %s does not inherit unrelated blocked authority",
    async (change) => {
      let calls = 0;
      const store = new InMemoryApiWatchStore(),
        pendingStore = new InMemorySwaggerSourceStore();
      const registry = (changed: boolean) =>
        createSourceRegistry({
          OZON_SELLER: { officialUrl: null, documents: [] },
          OZON_PERFORMANCE: { officialUrl: null, documents: [] },
          WILDBERRIES: {
            officialUrl: null,
            acceptedHosts: ["127.0.0.1"],
            documents: [
              {
                documentKey:
                  changed && change === "DOCUMENT_KEY" ? "new-key" : "blocked",
                officialUrl:
                  changed && change === "URL"
                    ? "http://127.0.0.1/new-url"
                    : "http://127.0.0.1/blocked",
                expectedArtifactTypes: ["JSON"],
              },
            ],
          },
        });
      const fetcher = (async () => {
        calls++;
        return new Response("synthetic", { status: 403 });
      }) as typeof fetch;
      await runAuthorityPass({
        registry: registry(false),
        store,
        pendingStore,
        fetcher,
      });
      await runAuthorityPass({
        registry: registry(true),
        store,
        pendingStore,
        fetcher,
        skipOperatorBlocked: true,
      });
      expect(calls).toBe(2);
    },
  );
  it.each([
    [503, false],
    [503, true],
    [429, false],
    [429, true],
  ] as const)(
    "403 + %i, reverse=%s never schedules a family retry",
    async (status, reverse) => {
      const store = new InMemoryApiWatchRetryStore(),
        scheduled: Date[] = [];
      const outcomes = reverse
        ? [transient(status), blocked]
        : [blocked, transient(status)];
      await applyRetryPassDecisions({
        outcomes,
        store,
        scheduleEarlier: async (at) => {
          scheduled.push(at);
        },
      });
      expect(scheduled).toHaveLength(0);
      expect(await store.get("WILDBERRIES")).toBeUndefined();
    },
  );
  it("cancels a previous retry time without erasing the episode or retry cap", async () => {
    const store = new InMemoryApiWatchRetryStore(),
      scheduled: Date[] = [];
    const scheduleEarlier = async (at: Date) => {
      scheduled.push(at);
    };
    await applyRetryPassDecisions({
      outcomes: [transient(503)],
      store,
      scheduleEarlier,
    });
    const before = await store.get("WILDBERRIES");
    await applyRetryPassDecisions({
      outcomes: [blocked, transient(503)],
      store,
      scheduleEarlier,
    });
    const after = await store.get("WILDBERRIES");
    expect(after?.failureEpisodeId).toBe(before?.failureEpisodeId);
    expect(after?.retryCount).toBe(before?.retryCount);
    expect(after?.nextRetryAt).toBeNull();
    expect(after?.lastResult).toBe("OPERATOR_SOURCE_REQUIRED");
    expect(scheduled).toHaveLength(1);
  });

  it.each([
    [503, false],
    [503, true],
    [429, false],
    [429, true],
  ] as const)(
    "scheduled acquisition after 403/%i (reverse=%s) does not refetch the held family even when Ozon retries",
    async (status, reverse) => {
      let now = new Date("2026-10-14T03:00:00Z");
      const calls: Record<string, number> = {
        blocked: 0,
        transient: 0,
        ozon: 0,
      };

      const docs = [
        {
          documentKey: "blocked",
          officialUrl: "http://127.0.0.1/blocked",
          expectedArtifactTypes: ["JSON"] as const,
        },
        {
          documentKey: "transient",
          officialUrl: "http://127.0.0.1/transient",
          expectedArtifactTypes: ["JSON"] as const,
        },
      ];
      const registry = createSourceRegistry({
        OZON_SELLER: {
          officialUrl: "http://127.0.0.1/ozon",
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: {
          officialUrl: null,
          documents: reverse ? [...docs].reverse() : docs,
          acceptedHosts: ["127.0.0.1"],
          requiredServerIdentity: undefined,
          titlePattern: undefined,
        },
      });
      const apiStore = new InMemoryApiWatchStore(),
        retryStore = new InMemoryApiWatchRetryStore();
      const reportStore = new InMemoryApiWatchReportStore(),
        pendingStore = new InMemorySwaggerSourceStore();
      const store = new InMemoryMonitoringScheduleStore();
      const scheduler = new IndependentMonitoringScheduler({
        store,
        clock: { now: () => new Date(now) },
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "synthetic",
          }),
          SWAGGER_API: async (run) =>
            runApiWatchReport({
              runId: run.runId,
              source: run.source,
              dependencies: {
                registry,
                store: apiStore,
                reportStore,
                pendingStore,
                retryStore,
                clock: () => new Date(now),
                scheduleEarlier: async (at) => {
                  await scheduler.scheduleEarlier("SWAGGER_API", at);
                },
                fetcher: (async (url) => {
                  const name = new URL(String(url)).pathname.slice(1);
                  expect(name in calls).toBe(true);
                  calls[name] = (calls[name] ?? 0) + 1;
                  return new Response("synthetic", {
                    status:
                      name === "blocked"
                        ? 403
                        : name === "transient"
                          ? status
                          : 503,
                  });
                }) as typeof fetch,
              },
            }),
        },
      });
      await store.ensureDefaults(now);
      await scheduler.runNowAndWait("SWAGGER_API");
      expect(calls).toEqual({ blocked: 1, transient: 1, ozon: 1 });
      expect(await retryStore.get("WILDBERRIES")).toBeUndefined();
      now = new Date(now.valueOf() + 15 * 60_000);
      await scheduler.tick();
      now = new Date(now.valueOf() + 60 * 60_000);
      await scheduler.tick();
      expect(calls).toEqual({ blocked: 1, transient: 1, ozon: 3 });
      expect(
        (await pendingStore.listPending(now)).some(
          (request) => request.sourceFamily === "WILDBERRIES",
        ),
      ).toBe(true);
      await scheduler.stop();
    },
  );
});
