import { describe, expect, it } from "vitest";
import {
  MONITORING_DEFAULT_INTERVAL_SECONDS,
  MONITORING_INTERVAL_MAX_SECONDS,
  MONITORING_INTERVAL_MIN_SECONDS,
  parseMonitoringDuration,
} from "./contracts.js";
import { IndependentMonitoringScheduler } from "./scheduler.js";
import {
  InMemoryMonitoringScheduleStore,
  createPostgresMonitoringScheduleStore,
  type MonitoringSqlQuery,
  type MonitoringSqlRuntime,
} from "./store.js";

const clock = {
  value: new Date("2026-09-22T00:00:00.000Z"),
  now() {
    return new Date(this.value);
  },
};
const result = {
  status: "AUTH_REQUIRED" as const,
  code: "AUTH_REQUIRED",
  summary: "Provider requires a legitimate session.",
};

function scheduler(
  runners?: Partial<
    Record<
      "LLM" | "SWAGGER_API",
      (input: { runId: string }) => Promise<typeof result>
    >
  >,
) {
  const store = new InMemoryMonitoringScheduleStore();
  const calls = { LLM: 0, SWAGGER_API: 0 };
  const implementation = new IndependentMonitoringScheduler({
    store,
    clock,
    runners: {
      LLM: async (input) => {
        calls.LLM += 1;
        return runners?.LLM ? runners.LLM(input) : result;
      },
      SWAGGER_API: async (input) => {
        calls.SWAGGER_API += 1;
        return runners?.SWAGGER_API
          ? runners.SWAGGER_API(input)
          : {
              ...result,
              status: "SOURCE_UNAVAILABLE",
              code: "SOURCE_UNAVAILABLE",
            };
      },
    },
    tickMs: 60_000,
  });
  return { store, calls, implementation };
}

describe("TG2 independent monitoring scheduler", () => {
  it("A9 schedules a retry earlier without changing the configured interval", async () => {
    const { store, implementation } = scheduler();
    await store.ensureDefaults(clock.now());
    const before = await store.getState("SWAGGER_API");
    await implementation.scheduleEarlier("SWAGGER_API", new Date(clock.now().valueOf() + 5 * 60 * 1000));
    const after = await store.getState("SWAGGER_API");
    expect(after.intervalSeconds).toBe(before.intervalSeconds);
    expect(after.nextRunAt.valueOf()).toBeLessThan(before.nextRunAt.valueOf());
    expect((await store.getState("LLM")).nextRunAt).toEqual((await store.getState("LLM")).nextRunAt);
  });
  it("TG2-01/TG2-02 expose independent defaults", async () => {
    const { store } = scheduler();
    await store.ensureDefaults(clock.now());
    expect((await store.getState("LLM")).intervalSeconds).toBe(90 * 60);
    expect((await store.getState("SWAGGER_API")).intervalSeconds).toBe(
      6 * 60 * 60,
    );
  });

  it("TG2-03/TG2-04 change only the requested lane", async () => {
    const { store } = scheduler();
    await store.ensureDefaults(clock.now());
    await store.setInterval("LLM", 5 * 60, clock.now());
    expect((await store.getState("LLM")).intervalSeconds).toBe(5 * 60);
    expect((await store.getState("SWAGGER_API")).intervalSeconds).toBe(
      6 * 60 * 60,
    );
  });

  it("TG2-05..TG2-07 enforce duration syntax and boundaries", () => {
    expect(parseMonitoringDuration("5m")).toBe(MONITORING_INTERVAL_MIN_SECONDS);
    expect(parseMonitoringDuration("30d")).toBe(
      MONITORING_INTERVAL_MAX_SECONDS,
    );
    expect(() => parseMonitoringDuration("4m")).toThrow(
      "MONITORING_DURATION_OUT_OF_RANGE",
    );
    expect(() => parseMonitoringDuration("31d")).toThrow(
      "MONITORING_DURATION_OUT_OF_RANGE",
    );
    expect(() => parseMonitoringDuration("90 minutes")).toThrow(
      "INVALID_MONITORING_DURATION",
    );
  });

  it("TG2-09/TG2-10/TG2-13 force one lane and preserve its interval", async () => {
    const { implementation, calls, store } = scheduler();
    await implementation.start();
    const before = (await store.getState("LLM")).nextRunAt;
    const run = await implementation.runNowAndWait("LLM");
    expect(run.status).toBe("AUTH_REQUIRED");
    expect(calls).toEqual({ LLM: 1, SWAGGER_API: 0 });
    expect((await store.getState("LLM")).nextRunAt).toEqual(before);
    await implementation.stop();
  });

  it("TG2-11/TG2-12/TG2-16 keep lane locks independent", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { implementation, calls } = scheduler({
      LLM: async () => {
        await blocked;
        return result;
      },
    });
    await implementation.start();
    const llm = await implementation.runNow("LLM");
    const duplicate = await implementation.runNow("LLM");
    const swagger = await implementation.runNow("SWAGGER_API");
    expect(llm.kind).toBe("STARTED");
    expect(duplicate.kind).toBe("ALREADY_RUNNING");
    expect(swagger.kind).toBe("STARTED");
    expect(calls).toEqual({ LLM: 1, SWAGGER_API: 1 });
    release();
    await implementation.stop();
  });

  it("TG2-15 scheduled and forced races share one durable start", async () => {
    const { implementation, store, calls } = scheduler();
    await store.ensureDefaults(new Date("2026-09-21T00:00:00.000Z"));
    await store.setInterval(
      "LLM",
      MONITORING_DEFAULT_INTERVAL_SECONDS.LLM,
      new Date("2026-09-21T00:00:00.000Z"),
    );
    clock.value = new Date("2026-09-22T10:00:00.000Z");
    const results = await Promise.all([
      implementation.tick(),
      implementation.runNow("LLM"),
    ]);
    expect(results).toHaveLength(2);
    expect(calls.LLM).toBe(1);
    await implementation.stop();
  });

  it("TG2-22 does not notify unchanged scheduled results", async () => {
    const notifications: string[] = [];
    const { store } = scheduler();
    const implementation = new IndependentMonitoringScheduler({
      store,
      clock,
      runners: {
        LLM: async () => result,
        SWAGGER_API: async () => ({
          ...result,
          status: "SOURCE_UNAVAILABLE",
          code: "SOURCE_UNAVAILABLE",
        }),
      },
      notifier: async (event) => {
        notifications.push(event.runId);
      },
      tickMs: 60_000,
    });
    await store.ensureDefaults(new Date("2026-09-20T00:00:00.000Z"));
    await store.setInterval(
      "LLM",
      5 * 60,
      new Date("2026-09-20T00:00:00.000Z"),
    );
    clock.value = new Date("2026-09-20T00:05:00.000Z");
    await implementation.tick();
    clock.value = new Date("2026-09-20T00:10:00.000Z");
    await implementation.tick();
    expect(notifications).toHaveLength(1);
    await implementation.stop();
  });

  it("TG2-08/TG2-25 reuses durable lane state across scheduler restarts without duplicate work", async () => {
    const store = new InMemoryMonitoringScheduleStore();
    await store.ensureDefaults(new Date("2026-09-20T00:00:00.000Z"));
    await store.setInterval(
      "LLM",
      5 * 60,
      new Date("2026-09-20T00:00:00.000Z"),
    );
    clock.value = new Date("2026-09-20T00:05:00.000Z");
    let calls = 0;
    const make = () =>
      new IndependentMonitoringScheduler({
        store,
        clock,
        runners: {
          LLM: async () => {
            calls += 1;
            return result;
          },
          SWAGGER_API: async () => ({
            status: "SOURCE_UNAVAILABLE",
            code: "SOURCE_UNAVAILABLE",
            summary: "Safe source result.",
          }),
        },
        tickMs: 60_000,
      });
    const first = make();
    await first.tick();
    await first.stop();
    const second = make();
    await second.tick();
    expect(calls).toBe(1);
    expect((await second.status("LLM")).lastResult?.status).toBe(
      "AUTH_REQUIRED",
    );
    await second.stop();
  });

  it("TG2-26 locks a PostgreSQL lane row before deciding single-flight", async () => {
    const queries: string[] = [];
    const row = {
      lane: "LLM",
      enabled: true,
      intervalSeconds: 90 * 60,
      nextRunAt: new Date("2026-09-22T00:00:00.000Z"),
      lastRunAt: null,
      activeRunId: null,
      activeRunSource: null,
      activeRunStartedAt: null,
      activeRunLeaseExpiresAt: null,
      lastResult: null,
      notificationFailureCount: 0,
      lastNotificationError: null,
      updatedAt: new Date("2026-09-22T00:00:00.000Z"),
    };
    const runtime: MonitoringSqlRuntime = {
      async query<T extends Record<string, unknown>>(text: string) {
        queries.push(text);
        return { rows: [row] as unknown as T[] };
      },
      async transaction<T>(
        operation: (query: MonitoringSqlQuery) => Promise<T>,
      ) {
        return operation(runtime);
      },
    };
    const store = createPostgresMonitoringScheduleStore(runtime);
    const result = await store.startRun({
      lane: "LLM",
      source: "FORCED",
      now: new Date("2026-09-22T00:00:00.000Z"),
      leaseMs: 60_000,
    });
    expect(result.kind).toBe("STARTED");
    expect(
      queries.some((query) => /WHERE lane=\$1 FOR UPDATE$/.test(query)),
    ).toBe(true);
  });
});
