import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
} from "@product/monitoring-control";
import { createTelegramTransport } from "./telegram-client.js";
import { TelegramOperatorService } from "./telegram.js";
describe("whole F06 real Telegram consumer unknown acknowledgement", () => {
  for (const failureAt of [1, 2])
    it(`never automatically replays recipient ACKs after physical send ${failureAt} rejects`, async () => {
      const sends: string[] = [],
        store = new InMemoryMonitoringScheduleStore();
      await store.ensureDefaults(new Date());
      const transport = createTelegramTransport(
        "SYNTHETIC_NO_REAL_TOKEN",
        async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { chat_id: string };
          sends.push(body.chat_id);
          if (sends.length === failureAt)
            throw new Error("SYNTHETIC_SEND_ACK_LOST");
          return new Response(
            JSON.stringify({ ok: true, result: { message_id: sends.length } }),
          );
        },
      );
      const complete = async () => ({
        status: "SUCCEEDED" as const,
        code: null,
        summary: "synthetic accepted",
      });
      const scheduler: IndependentMonitoringScheduler =
        new IndependentMonitoringScheduler({
          store,
          runners: { LLM: complete, SWAGGER_API: complete },
          notificationRetryDelaysMs: [0, 0, 0],
          notifier: (notification) => service.notify(notification),
        });
      const service: TelegramOperatorService = new TelegramOperatorService({
        scheduler,
        transport,
        operatorIds: new Set(["7"]),
        notificationChatIds: ["41", "42"],
      });
      expect((await scheduler.runNowAndWait("LLM")).status).toBe("SUCCEEDED");
      expect(sends).toEqual(failureAt === 1 ? ["41"] : ["41", "42"]);
      expect((await store.getState("LLM")).notificationFailureCount).toBe(1);
      await scheduler.stop();
    });
});

describe("F06 whole notifier retry after recipient admission failure", () => {
  for (const failAfterAcknowledgements of [0, 1])
    it(`does not replay acknowledged recipients after ${failAfterAcknowledgements} ACKs`, async () => {
      const store = new InMemoryMonitoringScheduleStore();
      await store.ensureDefaults(new Date());
      const sends: string[] = [];
      let rejected = false;
      const originalAdmission = store.withCompletedRun.bind(store);
      store.withCompletedRun = async (run, operation) => {
        if (!rejected && sends.length === failAfterAcknowledgements) {
          rejected = true;
          throw new Error("SYNTHETIC_PREDISPATCH_ADMISSION_UNAVAILABLE");
        }
        return originalAdmission(run, operation);
      };
      const transport = createTelegramTransport(
        "SYNTHETIC_NO_REAL_TOKEN",
        async (_url, init) => {
          sends.push(
            (JSON.parse(String(init?.body)) as { chat_id: string }).chat_id,
          );
          return new Response(
            JSON.stringify({ ok: true, result: { message_id: sends.length } }),
          );
        },
      );
      const completed = async () => ({
        status: "SUCCEEDED" as const,
        code: null,
        summary: "synthetic",
      });
      const scheduler: IndependentMonitoringScheduler =
        new IndependentMonitoringScheduler({
          store,
          runners: { LLM: completed, SWAGGER_API: completed },
          notificationRetryDelaysMs: [0, 0, 0],
          notifier: (notification) => service.notify(notification),
        });
      const service: TelegramOperatorService = new TelegramOperatorService({
        scheduler,
        transport,
        operatorIds: new Set(["7"]),
        notificationChatIds: ["41", "42"],
      });
      try {
        expect((await scheduler.runNowAndWait("LLM")).status).toBe("SUCCEEDED");
        expect(rejected).toBe(true);
        expect(sends).toEqual(
          failAfterAcknowledgements === 0 ? ["41", "42"] : ["41"],
        );
        const state = await store.getState("LLM");
        expect(state.notificationFailureCount).toBe(
          failAfterAcknowledgements === 0 ? 0 : 1,
        );
        expect(state.lastNotificationError).toBe(
          failAfterAcknowledgements === 0
            ? null
            : "SYNTHETIC_PREDISPATCH_ADMISSION_UNAVAILABLE",
        );
      } finally {
        await scheduler.stop();
      }
    });
});
