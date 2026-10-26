import { describe, expect, it } from "vitest";
import { InMemoryMonitoringScheduleStore } from "./store.js";

const start = new Date("2026-10-26T00:00:00.000Z");
const at = (seconds: number) => new Date(start.valueOf() + seconds * 1000);
const result = {
  status: "SUCCEEDED" as const,
  code: null,
  summary: "synthetic run",
};

async function initialRun() {
  const store = new InMemoryMonitoringScheduleStore();
  await store.ensureDefaults(start);
  const began = await store.startRun({
    lane: "SWAGGER_API",
    source: "FORCED",
    now: at(10),
    leaseMs: 1000,
  });
  if (began.kind !== "STARTED") throw new Error("TEST_RUN_NOT_STARTED");
  return { store, runId: began.run.runId };
}

describe("C03 lease expiry without another active owner", () => {
  it.each([11, 12])(
    "rejects finish at or after expiry (%s seconds)",
    async (seconds) => {
      const { store, runId } = await initialRun();
      await expect(
        store.finishRun({
          lane: "SWAGGER_API",
          runId,
          now: at(seconds),
          result,
        }),
      ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
      const state = await store.getState("SWAGGER_API");
      expect(state.activeRun?.runId).toBe(runId);
      expect(state.lastResult).toBeNull();
    },
  );

  it("keeps legitimate pre-expiry completion", async () => {
    const { store, runId } = await initialRun();
    const finished = await store.finishRun({
      lane: "SWAGGER_API",
      runId,
      now: at(10.5),
      result,
    });
    expect(finished.activeRun).toBeNull();
    expect(finished.lastResult?.runId).toBe(runId);
  });

  it("allows recovery by a different run after expiry", async () => {
    const { store, runId } = await initialRun();
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId,
        now: at(12),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const another = await store.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now: at(13),
      leaseMs: 5000,
    });
    expect(another.kind).toBe("STARTED");
    if (another.kind !== "STARTED") return;
    expect(another.run.runId).not.toBe(runId);
    const finished = await store.finishRun({
      lane: "SWAGGER_API",
      runId: another.run.runId,
      now: at(14),
      result,
    });
    expect(finished.lastResult?.runId).toBe(another.run.runId);
  });
});
