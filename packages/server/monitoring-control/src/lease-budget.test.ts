import { afterEach, describe, expect, it, vi } from "vitest";
import { IndependentMonitoringScheduler } from "./scheduler.js";
import {
  createPostgresMonitoringScheduleStore,
  type MonitoringSqlRuntime,
} from "./store.js";

afterEach(() => vi.useRealTimers());

function database(lockDelayMs = 0, clockDelayMs = 0) {
  const row = {
    lane: "LLM",
    enabled: true,
    intervalSeconds: 5400,
    nextRunAt: new Date(0),
    lastRunAt: null as Date | null,
    activeRunId: null as string | null,
    activeRunSource: null as string | null,
    activeRunStartedAt: null as Date | null,
    activeRunLeaseExpiresAt: null as Date | null,
    lastResult: null as unknown,
    notificationFailureCount: 0,
    lastNotificationError: null,
    updatedAt: new Date(0),
  };
  let firstLock = true;
  let firstClock = true;
  const statements: string[] = [];
  const runtime: MonitoringSqlRuntime = {
    transaction: async (operation) => operation(runtime),
    async query<T extends Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
    ) {
      statements.push(text);
      const rows = (value: unknown[]) => ({ rows: value as T[] });
      if (text.includes("FOR UPDATE") && firstLock) {
        firstLock = false;
        if (lockDelayMs)
          await new Promise((resolve) => setTimeout(resolve, lockDelayMs));
      }
      if (text.includes("clock_timestamp() AS")) {
        const now = new Date();
        if (firstClock) {
          firstClock = false;
          if (clockDelayMs)
            await new Promise((resolve) => setTimeout(resolve, clockDelayMs));
        }
        return rows([{ now }]);
      }
      if (text.startsWith('SELECT active_run_id AS "runId"'))
        return rows([
          {
            runId: row.activeRunId,
            leaseExpiresAt: row.activeRunLeaseExpiresAt,
          },
        ]);
      if (text.startsWith("SELECT ")) return rows([{ ...row }]);
      if (text.includes("SET active_run_id=$2")) {
        row.activeRunId = values[1] as string;
        row.activeRunSource = values[2] as string;
        row.activeRunStartedAt = values[3] as Date;
        row.activeRunLeaseExpiresAt = values[4] as Date;
        row.nextRunAt = values[5] as Date;
        return rows([]);
      }
      if (text.includes("last_result=jsonb_set")) {
        if (
          row.activeRunId !== values[3] ||
          !row.activeRunLeaseExpiresAt ||
          row.activeRunLeaseExpiresAt <= new Date()
        )
          return rows([]);
        row.lastRunAt = values[1] as Date;
        row.lastResult = {
          ...JSON.parse(String(values[2])),
          finishedAt: values[1],
        };
        row.activeRunId = null;
        row.activeRunSource = null;
        row.activeRunStartedAt = null;
        row.activeRunLeaseExpiresAt = null;
        return rows([{ ...row }]);
      }
      if (text.includes("active_run_source='SCHEDULED'")) {
        if (row.activeRunId === values[1]) {
          row.activeRunId = null;
          row.activeRunLeaseExpiresAt = null;
        }
        return rows([]);
      }
      throw new Error("UNEXPECTED_SYNTHETIC_SQL");
    },
  };
  return { store: createPostgresMonitoringScheduleStore(runtime), statements };
}

describe("F06 PostgreSQL lease cancellation budget", () => {
  for (const offset of [16 * 60_000, -16 * 60_000]) {
    it(`keeps a DB-valid lease executable with scheduler clock offset ${offset}`, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
      const db = database();
      let signal: AbortSignal | undefined;
      const runner = async (input: { signal?: AbortSignal }) => {
        signal = input.signal;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          status: "SUCCEEDED" as const,
          code: null,
          summary: "DB-valid run",
        };
      };
      const scheduler = new IndependentMonitoringScheduler({
        store: db.store,
        leaseMs: 1000,
        clock: { now: () => new Date(Date.now() + offset) },
        runners: { LLM: runner, SWAGGER_API: runner },
      });
      const terminal = scheduler.runNowAndWait("LLM").then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(20);
      const outcome = await terminal;
      expect("value" in outcome && outcome.value.status).toBe("SUCCEEDED");
      expect(signal?.aborted).toBe(false);
      await scheduler.stop();
    });
  }

  it("starts its budget after row-lock wait, not before reservation exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
    const db = database(2000);
    let entered = false;
    const runner = async () => {
      entered = true;
      return {
        status: "SUCCEEDED" as const,
        code: null,
        summary: "fresh reservation",
      };
    };
    const scheduler = new IndependentMonitoringScheduler({
      store: db.store,
      leaseMs: 1000,
      runners: { LLM: runner, SWAGGER_API: runner },
    });
    const terminal = scheduler.runNowAndWait("LLM").then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(2010);
    const outcome = await terminal;
    expect(entered).toBe(true);
    expect("value" in outcome && outcome.value.status).toBe("SUCCEEDED");
    await scheduler.stop();
  });

  it("does not extend the budget by response latency or a slow local wall clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));
    const db = database(0, 600);
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = async (input: { signal?: AbortSignal }) => {
      signal = input.signal;
      await blocked;
      return { status: "SUCCEEDED" as const, code: null, summary: "late" };
    };
    const scheduler = new IndependentMonitoringScheduler({
      store: db.store,
      leaseMs: 1000,
      clock: { now: () => new Date(Date.now() - 16 * 60_000) },
      runners: { LLM: runner, SWAGGER_API: runner },
    });
    const terminal = scheduler
      .runNowAndWait("LLM")
      .catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(610);
      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(391);
      expect(signal?.aborted).toBe(true);
    } finally {
      release();
      await terminal;
      await scheduler.stop();
    }
  });
});
