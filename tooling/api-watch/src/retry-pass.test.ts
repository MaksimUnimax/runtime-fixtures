import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import { InMemoryApiWatchStore } from "./authority.js";
import { InMemoryApiWatchReportStore } from "./report.js";
import {
  applyRetryPassDecisions,
  InMemoryApiWatchRetryStore,
} from "./retry.js";
import type { AcquisitionOutcome } from "./types.js";
import {
  createSourceRegistry,
  productionSourceRegistry,
} from "./source-registry.js";
import { runApiWatchReport } from "./run.js";

describe("review P2 family retry budget counts passes rather than documents", () => {
  it.each([1, 13])(
    "%i failed WB documents receive both real scheduled retry passes",
    async (documentCount) => {
      let now = new Date("2026-10-14T00:00:00Z"),
        calls = 0,
        passes = 0;
      const retryStore = new InMemoryApiWatchRetryStore();
      const registry = createSourceRegistry({
        OZON_SELLER: { officialUrl: null, documents: [] },
        OZON_PERFORMANCE: { officialUrl: null, documents: [] },
        WILDBERRIES: {
          officialUrl: null,
          acceptedHosts: ["127.0.0.1"],
          requiredServerIdentity: undefined,
          titlePattern: undefined,
          documents: productionSourceRegistry
            .get("WILDBERRIES")
            .documents!.slice(0, documentCount)
            .map((doc, i) => ({
              ...doc,
              officialUrl: "http://127.0.0.1/review-doc-" + i,
            })),
        },
      });
      const store = new InMemoryMonitoringScheduleStore();
      const reportStore = new InMemoryApiWatchReportStore();
      const scheduler = new IndependentMonitoringScheduler({
        store,
        clock: { now: () => new Date(now) },
        runners: {
          LLM: async () => ({
            status: "SUCCEEDED",
            code: null,
            summary: "synthetic",
          }),
          SWAGGER_API: async (run) => {
            passes++;
            return runApiWatchReport({
              runId: run.runId,
              source: run.source,
              dependencies: {
                registry,
                store: new InMemoryApiWatchStore(),
                pendingStore: new InMemorySwaggerSourceStore(),
                reportStore,
                retryStore,
                clock: () => new Date(now),
                fetcher: (async (url) => {
                  expect(String(url)).toMatch(
                    /^http:\/\/127\.0\.0\.1\/review-doc-/,
                  );
                  calls++;
                  return new Response("synthetic unavailable", { status: 503 });
                }) as typeof fetch,
                scheduleEarlier: async (at) => {
                  await scheduler.scheduleEarlier("SWAGGER_API", at);
                },
              },
            });
          },
        },
      });
      await store.ensureDefaults(now);
      await scheduler.runNowAndWait("SWAGGER_API");
      expect((await retryStore.get("WILDBERRIES"))?.retryCount).toBe(1);
      now = new Date(now.valueOf() + 15 * 60_000);
      await scheduler.tick();
      expect((await retryStore.get("WILDBERRIES"))?.retryCount).toBe(2);
      now = new Date(now.valueOf() + 60 * 60_000);
      await scheduler.tick();
      expect(passes).toBe(3);
      expect(calls).toBe(3 * documentCount);
      expect((await retryStore.get("WILDBERRIES"))?.nextRetryAt).toBeNull();
      // Exhaustion forbids a fourth immediate pass.
      now = new Date(now.valueOf() + 60_000);
      await scheduler.tick();
      expect(passes).toBe(3);
      await scheduler.stop();
    },
  );
});

function temporary(
  httpStatus = 503,
  retryAfterSeconds?: number,
): AcquisitionOutcome {
  return {
    kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
    sourceFamily: "WILDBERRIES",
    officialUrl: "https://synthetic.invalid",
    blockerReason: "synthetic",
    httpStatus,
    retryAfterSeconds,
  };
}
const acquired: AcquisitionOutcome = {
  kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
  sourceFamily: "WILDBERRIES",
  officialUrl: "https://synthetic.invalid",
  bytes: new Uint8Array(),
  sha256: "synthetic",
  sizeBytes: 0,
  specVersion: "3",
  artifactType: "JSON",
  finalUrl: "https://synthetic.invalid",
  parserResult: {},
  validationResult: {},
};
describe("family pass aggregation preserves retry safety", () => {
  it("partial success cannot reset the failure episode or spend multiple attempts", async () => {
    const store = new InMemoryApiWatchRetryStore(),
      now = new Date("2026-10-14T00:00:00Z");
    await applyRetryPassDecisions({
      outcomes: [temporary(), temporary(), acquired],
      store,
      now,
    });
    const first = await store.get("WILDBERRIES");
    await applyRetryPassDecisions({
      outcomes: [acquired, temporary(), temporary()],
      store,
      now: new Date(now.valueOf() + 900000),
    });
    const second = await store.get("WILDBERRIES");
    expect(first?.retryCount).toBe(1);
    expect(second?.retryCount).toBe(2);
    expect(second?.failureEpisodeId).toBe(first?.failureEpisodeId);
    await applyRetryPassDecisions({
      outcomes: [acquired, acquired],
      store,
      now,
    });
    expect(await store.get("WILDBERRIES")).toBeUndefined();
  });
  it("429 wins over 5xx and preserves the longest Retry-After and one-retry cap", async () => {
    const store = new InMemoryApiWatchRetryStore(),
      scheduled: Date[] = [],
      now = new Date("2026-10-14T00:00:00Z");
    const input = {
      store,
      now,
      scheduleEarlier: async (at: Date) => {
        scheduled.push(at);
      },
      outcomes: [
        temporary(),
        temporary(429, 300),
        temporary(429, 7200),
        acquired,
      ],
    };
    await applyRetryPassDecisions(input);
    expect((await store.get("WILDBERRIES"))?.failureClass).toBe("HTTP_429");
    expect(scheduled.map((at) => at.valueOf() - now.valueOf())).toEqual([
      7200000,
    ]);
    await applyRetryPassDecisions(input);
    expect((await store.get("WILDBERRIES"))?.nextRetryAt).toBeNull();
    expect(scheduled).toHaveLength(1);
  });
  it("authority blockers receive no automatic retry and partial success does not clear prior failure", async () => {
    const store = new InMemoryApiWatchRetryStore(),
      scheduled: Date[] = [];
    const blocked: AcquisitionOutcome = {
      kind: "OPERATOR_SOURCE_REQUIRED",
      sourceFamily: "WILDBERRIES",
      officialUrl: null,
      blockerReason: "synthetic authority required",
    };
    const scheduleEarlier = async (at: Date) => {
      scheduled.push(at);
    };
    await applyRetryPassDecisions({
      outcomes: [blocked, blocked],
      store,
      scheduleEarlier,
    });
    expect(await store.get("WILDBERRIES")).toBeUndefined();
    expect(scheduled).toHaveLength(0);
    await applyRetryPassDecisions({
      outcomes: [temporary()],
      store,
      scheduleEarlier,
    });
    const previous = await store.get("WILDBERRIES");
    await applyRetryPassDecisions({
      outcomes: [blocked, acquired],
      store,
      scheduleEarlier,
    });
    const held = await store.get("WILDBERRIES");
    expect(held?.failureEpisodeId).toBe(previous?.failureEpisodeId);
    expect(held?.retryCount).toBe(previous?.retryCount);
    expect(held?.nextRetryAt).toBeNull();
    expect(held?.lastResult).toBe("OPERATOR_SOURCE_REQUIRED");
    expect(scheduled).toHaveLength(1);
  });
});
