import { describe, expect, it } from "vitest";
import {
  fenceMonitoringSqlRuntime,
  withMonitoringRun,
  type MonitoringRunAuthority,
} from "./run-authority.js";
import type { MonitoringSqlQuery, MonitoringSqlRuntime } from "./store.js";
import {
  InMemoryMonitoringScheduleStore,
  createPostgresMonitoringScheduleStore,
} from "./store.js";
import { IndependentMonitoringScheduler } from "./scheduler.js";

function fixture() {
  let owner = "A";
  let now = 0;
  let expiry = 100;
  let duringWrite = async () => {};
  let duringLock = async () => {};
  const durable: string[] = [];
  const events: string[] = [];
  const controller = new AbortController();
  const runtime: MonitoringSqlRuntime = {
    async query() {
      throw new Error("OUTSIDE_TRANSACTION");
    },
    async transaction(operation) {
      const pending: string[] = [];
      const query: MonitoringSqlQuery = {
        async query<T extends Record<string, unknown>>(text: string) {
          if (text.includes("FOR UPDATE")) {
            events.push("LOCK");
            await duringLock();
            return {
              rows: [
                { runId: owner, leaseExpiresAt: new Date(expiry) },
              ] as unknown as T[],
            };
          }
          if (text.includes("clock_timestamp")) {
            events.push("CLOCK");
            return { rows: [{ now: new Date(now) }] as unknown as T[] };
          }
          events.push("WRITE");
          await duringWrite();
          pending.push(text);
          return { rows: [] };
        },
      };
      try {
        const value = await operation(query);
        durable.push(...pending);
        events.push("COMMIT");
        return value;
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    },
  };
  const authority: MonitoringRunAuthority = {
    lane: "SWAGGER_API",
    runId: "A",
    signal: controller.signal,
    revoke: () => controller.abort(),
    assertCurrent: async () => {},
    assertCurrentSync: () => {},
    withCurrent: async (operation) => operation(),
  };
  return {
    durable,
    events,
    controller,
    authority,
    runtime,
    setOwner(value: string) {
      owner = value;
    },
    setTime(value: number) {
      now = value;
    },
    setExpiry(value: number) {
      expiry = value;
    },
    onWrite(operation: () => Promise<void>) {
      duringWrite = operation;
    },
    onLock(operation: () => Promise<void>) {
      duringLock = operation;
    },
  };
}

describe("F-06 atomic SQL acceptance", () => {
  it("preserves uncertainty if effect initiation throws before returning a promise", async () => {
    const f = fixture();
    let initiated = 0;
    await expect(
      createPostgresMonitoringScheduleStore(f.runtime).withRunLease(
        f.authority,
        new Date(0),
        () => {
          initiated++;
          throw new Error("synthetic synchronous callback failure");
        },
      ),
    ).rejects.toThrow("MONITORING_EFFECT_OUTCOME_UNKNOWN");
    expect(initiated).toBe(1);
    expect(f.events.at(-1)).toBe("ROLLBACK");
  });
  it("commits a current owner's write only inside the lane-locked transaction", async () => {
    const f = fixture();
    await withMonitoringRun(f.authority, () =>
      fenceMonitoringSqlRuntime(f.runtime).query("accepted A"),
    );
    expect(f.durable).toEqual(["accepted A"]);
    expect(f.events).toEqual([
      "LOCK",
      "CLOCK",
      "WRITE",
      "LOCK",
      "CLOCK",
      "COMMIT",
    ]);
  });
  it("does not execute a write after another owner has acquired the lane", async () => {
    const f = fixture();
    f.setOwner("B");
    await expect(
      withMonitoringRun(f.authority, () =>
        fenceMonitoringSqlRuntime(f.runtime).query("stale A"),
      ),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(f.durable).toEqual([]);
    expect(f.events).not.toContain("WRITE");
  });
  it("rolls back a delayed write that completes after lease expiry", async () => {
    const f = fixture();
    f.onWrite(async () => {
      f.setTime(101);
    });
    await expect(
      withMonitoringRun(f.authority, () =>
        fenceMonitoringSqlRuntime(f.runtime).query("late A"),
      ),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(f.durable).toEqual([]);
    expect(f.events.at(-1)).toBe("ROLLBACK");
  });
  it("samples PG time after a lock wait, rather than trusting caller time", async () => {
    const f = fixture();
    f.onLock(async () => {
      f.setTime(100);
    });
    await expect(
      withMonitoringRun(f.authority, () =>
        fenceMonitoringSqlRuntime(f.runtime).query("expired A"),
      ),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(f.durable).toEqual([]);
    expect(f.events).toEqual(["LOCK", "CLOCK", "ROLLBACK"]);
  });
  it("does not start an effect cancelled while waiting for its row lock", async () => {
    const f = fixture();
    f.onLock(async () => {
      f.controller.abort();
    });
    await expect(
      withMonitoringRun(f.authority, () =>
        fenceMonitoringSqlRuntime(f.runtime).query("cancelled A"),
      ),
    ).rejects.toThrow("MONITORING_RUN_CANCELLED");
    expect(f.durable).toEqual([]);
    expect(f.events).not.toContain("WRITE");
  });
  it("fences the entire store transaction, not individually committed statements", async () => {
    const f = fixture();
    let writes = 0;
    f.onWrite(async () => {
      if (++writes === 2) f.setTime(101);
    });
    await expect(
      withMonitoringRun(f.authority, () =>
        fenceMonitoringSqlRuntime(f.runtime).transaction(async (query) => {
          await query.query("authority");
          await query.query("snapshot");
        }),
      ),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(f.durable).toEqual([]);
    expect(f.events.filter((event) => event === "WRITE")).toHaveLength(2);
  });
});

describe("F-06 completed-run notification admission", () => {
  it("does not retry or charge a previous run's notification against a successor", async () => {
    const store = new InMemoryMonitoringScheduleStore();
    const clock = { now: () => new Date("2026-10-29T00:00:00Z") };
    await store.ensureDefaults(clock.now());
    const runners = {
      LLM: async () => ({
        status: "SUCCEEDED" as const,
        code: null,
        summary: "current result",
      }),
      SWAGGER_API: async () => ({
        status: "SUCCEEDED" as const,
        code: null,
        summary: "current result",
      }),
    };
    const successor = new IndependentMonitoringScheduler({
      store,
      clock,
      runners,
    });
    let attempts = 0;
    const previous = new IndependentMonitoringScheduler({
      store,
      clock,
      runners,
      notificationRetryDelaysMs: [0, 0, 0],
      notifier: async () => {
        attempts++;
        await successor.runNowAndWait("LLM");
        throw new Error("synthetic delivery failure");
      },
    });
    await expect(previous.runNowAndWait("LLM")).rejects.toThrow();
    expect(attempts).toBe(1);
    const current = await store.getState("LLM");
    expect(current.lastResult?.status).toBe("SUCCEEDED");
    expect(current.notificationFailureCount).toBe(0);
    await previous.stop();
    await successor.stop();
  });

  it("stop does not wait indefinitely for an already initiated notification", async () => {
    const store = new InMemoryMonitoringScheduleStore();
    const clock = { now: () => new Date("2026-10-29T00:00:00Z") };
    await store.ensureDefaults(clock.now());
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = async () => ({
      status: "SUCCEEDED" as const,
      code: null,
      summary: "accepted before stop",
    });
    const scheduler = new IndependentMonitoringScheduler({
      store,
      clock,
      runners: { LLM: runner, SWAGGER_API: runner },
      notifier: async () => {
        entered();
        await blocked;
      },
    });
    const terminal = scheduler.runNowAndWait("LLM");
    await started;
    await scheduler.stop();
    expect((await store.getState("LLM")).lastResult?.status).toBe("SUCCEEDED");
    release();
    await terminal;
  });
});
