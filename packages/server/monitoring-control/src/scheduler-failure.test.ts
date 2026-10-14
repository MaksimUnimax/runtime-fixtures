import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
