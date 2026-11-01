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
