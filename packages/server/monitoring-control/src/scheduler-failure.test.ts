import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { IndependentMonitoringScheduler } from "./scheduler.js";
import { InMemoryMonitoringScheduleStore } from "./store.js";

const schedulerUrl = new URL("./scheduler.ts", import.meta.url).href;
const storeUrl = new URL("./store.ts", import.meta.url).href;
const cwd = fileURLToPath(new URL("../../../../", import.meta.url));

function child(mode: string, diagnostic = "async") {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { IndependentMonitoringScheduler } from ${JSON.stringify(schedulerUrl)};
    import { InMemoryMonitoringScheduleStore } from ${JSON.stringify(storeUrl)};
    const mode = ${JSON.stringify(mode)};
    const diagnostic = ${JSON.stringify(diagnostic)};
    const store = new InMemoryMonitoringScheduleStore();
    await store.ensureDefaults(new Date());
    let failTick = false, caught = false, notices = 0, foreignRunId;
    const startRun = store.startRun.bind(store);
    store.startRun = async (input) => {
      if (failTick && input.lane === "LLM") {
        failTick = false;
        throw new Error("SYNTHETIC_START_FAILURE");
      }
      return startRun(input);
    };
    const getState = store.getState.bind(store);
    store.getState = async (lane) => {
      if (mode === "read" && lane === "LLM")
        throw new Error("SYNTHETIC_READ_FAILURE");
      return getState(lane);
    };
    const finishRun = store.finishRun.bind(store);
    store.finishRun = async (input) => {
      if (input.lane === "LLM" && mode === "finish")
        throw new Error("SYNTHETIC_WRITE_FAILURE");
      if (input.lane === "LLM" && mode === "stale") {
        const replacement = await startRun({lane: "LLM", source: "FORCED", now: new Date(input.now.valueOf() + 3600000), leaseMs: 900000});
        foreignRunId = replacement.run.runId;
      }
      return finishRun(input);
    };
    const record = store.recordNotificationFailure.bind(store);
    store.recordNotificationFailure = async (input) => {
      if (input.lane === "LLM" && mode === "notification")
        throw new Error("SYNTHETIC_NOTIFICATION_WRITE_FAILURE");
      return record(input);
    };
    const result = {status: "SUCCEEDED", code: null, summary: "synthetic"};
    const scheduler = new IndependentMonitoringScheduler({
      store, tickMs: 10,
      onError: diagnostic === "async"
        ? async () => {notices++; throw new Error("SYNTHETIC_ASYNC_DIAGNOSTIC_FAILURE");}
        : () => {notices++; throw new Error("SYNTHETIC_SYNC_DIAGNOSTIC_FAILURE");},
      notifier: mode === "notification" ? async ({lane}) => {
        if (lane === "LLM") throw new Error("SYNTHETIC_DELIVERY_FAILURE");
      } : undefined,
      notificationRetryDelaysMs: [0],
      runners: {
        LLM: async () => {if (mode === "runner") throw new Error("SYNTHETIC_RUNNER_FAILURE"); return result;},
        SWAGGER_API: async () => result,
      },
    });
    if (mode === "tick") {
      await scheduler.start();
      failTick = true;
      await new Promise(resolve => setTimeout(resolve, 40));
    } else {
      try {await scheduler.runNowAndWait("LLM");} catch {caught = true;}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const other = await scheduler.runNowAndWait("SWAGGER_API");
    await scheduler.stop();
    const state = await getState("LLM");
    console.log(JSON.stringify({mode, caught, survived: true, other: other.status,
      notices, activeRunRetained: Boolean(state.activeRun?.runId), foreignOwnerRetained: !foreignRunId || state.activeRun?.runId === foreignRunId, lastResult: state.lastResult?.status ?? null}));
  `,
    ],
    { cwd, encoding: "utf8", timeout: 10000 },
  );
}

describe("review P2 monitoring failures stay contained in the original process", () => {
  it.each(["read", "finish", "stale", "notification", "tick", "runner"])(
    "%s preserves the process and the other lane without fabricating a result",
    (mode) => {
      const result = child(mode);
      expect(result.status, result.stderr).toBe(0);
      const observed = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      expect(observed.survived).toBe(true);
      expect(observed.other).toBe("SUCCEEDED");
      expect(observed.foreignOwnerRetained).toBe(true);
      if (["read", "finish", "stale", "notification"].includes(mode)) {
        expect(observed.caught).toBe(true);
      }
      if (["read", "finish", "stale"].includes(mode)) {
        expect(observed.activeRunRetained).toBe(true);
        expect(observed.lastResult).toBeNull();
      }
      if (mode === "runner") expect(observed.lastResult).toBe("FAILED");
      if (mode !== "runner") expect(observed.notices).toBeGreaterThan(0);
    },
  );
});

it("contains synchronous diagnostic failures while retaining the original failed run", () => {
  const result = child("finish", "sync");
  expect(result.status, result.stderr).toBe(0);
  const observed = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  expect(observed.caught).toBe(true);
  expect(observed.survived).toBe(true);
  expect(observed.other).toBe("SUCCEEDED");
  expect(observed.activeRunRetained).toBe(true);
  expect(observed.lastResult).toBeNull();
  expect(observed.notices).toBeGreaterThan(0);
});

describe("reviewer A startup timer ownership", () => {
  it("rejected initial start performs one attempt and leaves no periodic timer", async () => {
    vi.useFakeTimers();
    const store = new InMemoryMonitoringScheduleStore();
    const original = store.startRun.bind(store);
    let attempts = 0;
    store.startRun = async (input) => {
      if (input.lane === "LLM") {
        attempts++;
        throw new Error("SYNTHETIC_FIRST_TICK_FAILURE");
      }
      return original(input);
    };
    const result = {
      status: "SUCCEEDED" as const,
      code: null,
      summary: "synthetic",
    };
    const scheduler = new IndependentMonitoringScheduler({
      store,
      tickMs: 25,
      runners: { LLM: async () => result, SWAGGER_API: async () => result },
    });
    try {
      await expect(scheduler.start()).rejects.toThrow(
        "SYNTHETIC_FIRST_TICK_FAILURE",
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(attempts).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      expect((await scheduler.runNowAndWait("SWAGGER_API")).status).toBe(
        "SUCCEEDED",
      );
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });
  it("concurrent and repeated successful starts own exactly one timer", async () => {
    vi.useFakeTimers();
    const store = new InMemoryMonitoringScheduleStore();
    const result = {
      status: "SUCCEEDED" as const,
      code: null,
      summary: "synthetic",
    };
    const scheduler = new IndependentMonitoringScheduler({
      store,
      tickMs: 25,
      runners: { LLM: async () => result, SWAGGER_API: async () => result },
    });
    try {
      await Promise.all([scheduler.start(), scheduler.start()]);
      await scheduler.start();
      expect(vi.getTimerCount()).toBe(1);
      await scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });
  it("stop during initial store preparation prevents a late timer or scheduled work", async () => {
    vi.useFakeTimers();
    const store = new InMemoryMonitoringScheduleStore();
    const original = store.ensureDefaults.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.ensureDefaults = async (now) => {
      await gate;
      await original(now);
    };
    const startRun = vi.spyOn(store, "startRun");
    const result = {
      status: "SUCCEEDED" as const,
      code: null,
      summary: "synthetic",
    };
    const scheduler = new IndependentMonitoringScheduler({
      store,
      tickMs: 25,
      runners: { LLM: async () => result, SWAGGER_API: async () => result },
    });
    try {
      const starting = scheduler.start();
      await scheduler.stop();
      release();
      await expect(starting).rejects.toThrow("MONITORING_START_STOPPED");
      await vi.advanceTimersByTimeAsync(200);
      expect(startRun).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      release();
      await scheduler.stop();
      vi.useRealTimers();
    }
  });
});

describe("reviewer A stop during pending run reservation", () => {
  it.each(["before", "after"] as const)(
    "stop %s durable acquisition prevents late work and releases only its reservation",
    async (stage) => {
      vi.useFakeTimers();
      const now = new Date("2026-10-15T01:00:00Z");
      const store = new InMemoryMonitoringScheduleStore();
      const original = store.startRun.bind(store);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const claimed = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let block = true;
      store.startRun = async (input) => {
        if (input.lane === "LLM" && block) {
          block = false;
          await store.scheduleEarlier(
            "LLM",
            new Date(now.valueOf() - 1000),
            now,
          );
          const reserved =
            stage === "after" ? await original(input) : undefined;
          entered();
          await gate;
          return reserved ?? original(input);
        }
        return original(input);
      };
      const result = {
        status: "SUCCEEDED" as const,
        code: null,
        summary: "synthetic",
      };
      const runner = vi.fn(async () => result);
      const scheduler = new IndependentMonitoringScheduler({
        store,
        clock: { now: () => now },
        tickMs: 25,
        runners: { LLM: runner, SWAGGER_API: async () => result },
      });
      try {
        const starting = scheduler.start();
        const rejected = expect(starting).rejects.toThrow(
          "MONITORING_START_STOPPED",
        );
        await claimed;
        expect(runner).not.toHaveBeenCalled();
        await scheduler.stop();
        release();
        await rejected;
        expect(runner).not.toHaveBeenCalled();
        const state = await store.getState("LLM");
        expect(state.activeRun).toBeNull();
        expect(state.lastResult).toBeNull();
        expect(state.nextRunAt.valueOf()).toBeLessThanOrEqual(now.valueOf());
        expect(vi.getTimerCount()).toBe(0);
        await scheduler.start();
        expect(runner).toHaveBeenCalledTimes(1);
        expect((await store.getState("LLM")).activeRun).toBeNull();
        expect((await scheduler.runNowAndWait("SWAGGER_API")).status).toBe(
          "SUCCEEDED",
        );
        await scheduler.stop();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release();
        await scheduler.stop();
        vi.useRealTimers();
      }
    },
  );
  it.each(["SCHEDULED", "FORCED"] as const)(
    "stop fences an already pending %s request",
    async (source) => {
      const now = new Date("2026-10-15T01:00:00Z");
      const store = new InMemoryMonitoringScheduleStore();
      const result = {
        status: "SUCCEEDED" as const,
        code: null,
        summary: "synthetic",
      };
      const runner = vi.fn(async () => result);
      const scheduler = new IndependentMonitoringScheduler({
        store,
        clock: { now: () => now },
        runners: { LLM: runner, SWAGGER_API: async () => result },
      });
      await scheduler.start();
      await store.scheduleEarlier("LLM", new Date(now.valueOf() - 1000), now);
      const original = store.startRun.bind(store);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const claimed = new Promise<void>((resolve) => {
        entered = resolve;
      });
      store.startRun = async (input) => {
        const reservation = await original(input);
        if (input.lane === "LLM") {
          entered();
          await gate;
        }
        return reservation;
      };
      try {
        const pending =
          source === "SCHEDULED"
            ? scheduler.tick()
            : scheduler.runNowAndWait("LLM");
        const rejected = expect(pending).rejects.toThrow(
          "MONITORING_START_STOPPED",
        );
        await claimed;
        await scheduler.stop();
        release();
        await rejected;
        expect(runner).not.toHaveBeenCalled();
        expect((await store.getState("LLM")).activeRun).toBeNull();
        expect((await store.getState("LLM")).lastResult).toBeNull();
      } finally {
        release();
        await scheduler.stop();
      }
    },
  );
});

it("reservation release preserves a replacement owner, prior result and earlier retry", async () => {
  const now = new Date("2026-10-15T01:00:00Z"),
    store = new InMemoryMonitoringScheduleStore();
  await store.ensureDefaults(now);
  const prior = await store.startRun({
    lane: "LLM",
    source: "FORCED",
    now,
    leaseMs: 100,
  });
  if (prior.kind !== "STARTED") throw new Error("CONTROL_NOT_STARTED");
  await store.finishRun({
    lane: "LLM",
    runId: prior.run.runId,
    now,
    result: { status: "SUCCEEDED", code: null, summary: "prior control" },
  });
  await store.scheduleEarlier("LLM", new Date(now.valueOf() - 1), now);
  const old = await store.startRun({
    lane: "LLM",
    source: "SCHEDULED",
    now,
    leaseMs: 100,
  });
  if (old.kind !== "STARTED") throw new Error("CONTROL_NOT_STARTED");
  const later = new Date(now.valueOf() + 101);
  const replacement = await store.startRun({
    lane: "LLM",
    source: "FORCED",
    now: later,
    leaseMs: 100,
  });
  if (replacement.kind !== "STARTED") throw new Error("CONTROL_NOT_STARTED");
  const before = await store.getState("LLM");
  expect(
    await store.releaseUnstartedRun({
      lane: "LLM",
      runId: old.run.runId,
      now: later,
    }),
  ).toBe(false);
  expect(await store.getState("LLM")).toEqual(before);
  expect(
    await store.releaseUnstartedRun({
      lane: "LLM",
      runId: replacement.run.runId,
      now: later,
    }),
  ).toBe(true);
  const retry = new Date(now.valueOf() - 500);
  await store.scheduleEarlier("LLM", retry, later);
  const scheduled = await store.startRun({
    lane: "LLM",
    source: "SCHEDULED",
    now: later,
    leaseMs: 100,
  });
  if (scheduled.kind !== "STARTED") throw new Error("CONTROL_NOT_STARTED");
  await store.scheduleEarlier("LLM", retry, later);
  expect(
    await store.releaseUnstartedRun({
      lane: "LLM",
      runId: scheduled.run.runId,
      now: later,
    }),
  ).toBe(true);
  const after = await store.getState("LLM");
  expect(after.activeRun).toBeNull();
  expect(after.nextRunAt).toEqual(retry);
  expect(after.lastResult).toEqual(before.lastResult);
  expect(after.lastRunAt).toEqual(before.lastRunAt);
});
it("restart while an old claim is pending cannot dispatch the old generation", async () => {
  vi.useFakeTimers();
  const now = new Date("2026-10-15T01:00:00Z"),
    store = new InMemoryMonitoringScheduleStore();
  const original = store.startRun.bind(store);
  let release!: () => void,
    entered!: () => void,
    block = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  store.startRun = async (input) => {
    if (input.lane === "LLM" && block) {
      block = false;
      await store.scheduleEarlier("LLM", new Date(now.valueOf() - 1), now);
      const result = await original(input);
      entered();
      await gate;
      return result;
    }
    return original(input);
  };
  const result = {
    status: "SUCCEEDED" as const,
    code: null,
    summary: "synthetic",
  };
  const runner = vi.fn(async () => result);
  const scheduler = new IndependentMonitoringScheduler({
    store,
    clock: { now: () => now },
    runners: { LLM: runner, SWAGGER_API: async () => result },
  });
  try {
    const oldStart = scheduler.start(),
      rejected = expect(oldStart).rejects.toThrow("MONITORING_START_STOPPED");
    await enteredPromise;
    await scheduler.stop();
    await Promise.all([scheduler.start(), scheduler.start()]);
    expect(vi.getTimerCount()).toBe(1);
    release();
    await rejected;
    expect(runner).not.toHaveBeenCalled();
    expect((await store.getState("LLM")).activeRun).toBeNull();
    await scheduler.tick();
    expect(runner).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await scheduler.stop();
    vi.useRealTimers();
  }
});
it("failed startup invalidates another lane's still pending reservation", async () => {
  const now = new Date("2026-10-15T01:00:00Z"),
    store = new InMemoryMonitoringScheduleStore();
  const original = store.startRun.bind(store),
    originalRelease = store.releaseUnstartedRun.bind(store);
  let release!: () => void, acquired!: () => void, compensated!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const released = new Promise<void>((resolve) => {
    compensated = resolve;
  });
  store.startRun = async (input) => {
    if (input.lane === "LLM") throw new Error("SYNTHETIC_FIRST_LANE_FAILURE");
    await store.scheduleEarlier(input.lane, new Date(now.valueOf() - 1), now);
    const result = await original(input);
    acquired();
    await gate;
    return result;
  };
  store.releaseUnstartedRun = async (input) => {
    const result = await originalRelease(input);
    compensated();
    return result;
  };
  const result = {
    status: "SUCCEEDED" as const,
    code: null,
    summary: "synthetic",
  };
  const runner = vi.fn(async () => result);
  const scheduler = new IndependentMonitoringScheduler({
    store,
    clock: { now: () => now },
    runners: { LLM: runner, SWAGGER_API: runner },
  });
  try {
    const starting = scheduler.start(),
      rejected = expect(starting).rejects.toThrow(
        "SYNTHETIC_FIRST_LANE_FAILURE",
      );
    await entered;
    await rejected;
    release();
    await released;
    expect(runner).not.toHaveBeenCalled();
    expect((await store.getState("SWAGGER_API")).activeRun).toBeNull();
    expect((await store.getState("SWAGGER_API")).lastResult).toBeNull();
  } finally {
    release();
    await scheduler.stop();
  }
});
it("failed cancellation keeps the durable lease and storage error without dispatch or fake success", async () => {
  const now = new Date("2026-10-15T01:00:00Z"),
    store = new InMemoryMonitoringScheduleStore();
  const original = store.startRun.bind(store),
    originalRelease = store.releaseUnstartedRun.bind(store);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    entered = resolve;
  });
  store.startRun = async (input) => {
    if (input.lane !== "LLM") return original(input);
    await store.scheduleEarlier(input.lane, new Date(now.valueOf() - 1), now);
    const result = await original(input);
    entered();
    await gate;
    return result;
  };
  store.releaseUnstartedRun = async () => {
    throw new Error("SYNTHETIC_RELEASE_WRITE_FAILURE");
  };
  const result = {
    status: "SUCCEEDED" as const,
    code: null,
    summary: "synthetic",
  };
  const runner = vi.fn(async () => result),
    diagnostic = vi.fn();
  const scheduler = new IndependentMonitoringScheduler({
    store,
    clock: { now: () => now },
    onError: diagnostic,
    runners: { LLM: runner, SWAGGER_API: async () => result },
  });
  try {
    const starting = scheduler.start(),
      rejected = expect(starting).rejects.toThrow(
        "SYNTHETIC_RELEASE_WRITE_FAILURE",
      );
    await acquired;
    await scheduler.stop();
    release();
    await rejected;
    expect(runner).not.toHaveBeenCalled();
    const state = await store.getState("LLM");
    expect(state.activeRun).not.toBeNull();
    expect(state.lastResult).toBeNull();
    expect(diagnostic).toHaveBeenCalledWith({
      code: "MONITORING_BACKGROUND_FAILED",
      lane: "LLM",
    });
    await originalRelease({ lane: "LLM", runId: state.activeRun!.runId, now });
  } finally {
    release();
    await scheduler.stop();
  }
});
