import { describe, expect, it } from "vitest";
import { IndependentMonitoringScheduler } from "./scheduler.js";
import { InMemoryMonitoringScheduleStore } from "./store.js";
import {
  admitMonitoringEffect,
  type MonitoringEffectAdmission,
} from "./run-authority.js";
const result = async () => ({
  status: "SUCCEEDED" as const,
  code: null,
  summary: "synthetic accepted result",
});
function fixture(store = new InMemoryMonitoringScheduleStore()) {
  return {
    store,
    options: {
      store,
      runners: { LLM: result, SWAGGER_API: result },
      notificationRetryDelaysMs: [0, 0, 0],
    },
  };
}
describe("whole F06 unknown external outcomes", () => {
  it("does not automatically repeat a physical effect whose acknowledgement was lost", async () => {
    const f = fixture();
    await f.store.ensureDefaults(new Date());
    let sends = 0;
    const scheduler = new IndependentMonitoringScheduler({
      ...f.options,
      notifier: (notification) =>
        admitMonitoringEffect(notification.admission, async () => {
          sends++;
          throw new Error("SYNTHETIC_ACK_LOST");
        }),
    });
    await scheduler.runNowAndWait("LLM");
    expect(sends).toBe(1);
    expect((await f.store.getState("LLM")).notificationFailureCount).toBe(1);
    await scheduler.stop();
  });
  it("does not repeat a failure-counter write after its commit acknowledgement is lost", async () => {
    let writes = 0;
    const unknown = new Error("SYNTHETIC_COUNTER_COMMIT_UNKNOWN");
    class Store extends InMemoryMonitoringScheduleStore {
      override async recordNotificationFailure(
        input: Parameters<
          InMemoryMonitoringScheduleStore["recordNotificationFailure"]
        >[0],
      ) {
        writes++;
        await super.recordNotificationFailure(input);
        throw unknown;
      }
    }
    const f = fixture(new Store());
    await f.store.ensureDefaults(new Date());
    const scheduler = new IndependentMonitoringScheduler({
      ...f.options,
      notifier: async () => {
        throw new Error("MONITORING_EFFECT_OUTCOME_UNKNOWN");
      },
    });
    await expect(scheduler.runNowAndWait("LLM")).rejects.toBe(unknown);
    expect(writes).toBe(1);
    expect((await f.store.getState("LLM")).notificationFailureCount).toBe(1);
    await scheduler.stop();
  });
  it("retains a proven pre-dispatch failure without initiating the callback", async () => {
    let sends = 0;
    const failure = new Error("MONITORING_EFFECT_OUTCOME_UNKNOWN");
    const admission: MonitoringEffectAdmission = {
      signal: new AbortController().signal,
      dispatch: async () => {
        throw failure;
      },
    };
    await expect(
      admitMonitoringEffect(admission, async () => {
        sends++;
      }),
    ).rejects.toBe(failure);
    expect(sends).toBe(0);
  });
  it("keeps successful admitted sends and accepted results", async () => {
    const f = fixture();
    await f.store.ensureDefaults(new Date());
    let sends = 0;
    const scheduler = new IndependentMonitoringScheduler({
      ...f.options,
      notifier: (notification) =>
        admitMonitoringEffect(notification.admission, async () => {
          sends++;
        }),
    });
    expect((await scheduler.runNowAndWait("LLM")).status).toBe("SUCCEEDED");
    expect(sends).toBe(1);
    expect((await f.store.getState("LLM")).notificationFailureCount).toBe(0);
    await scheduler.stop();
  });
});
