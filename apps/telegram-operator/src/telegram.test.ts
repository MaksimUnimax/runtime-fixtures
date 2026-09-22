import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
} from "@product/monitoring-control";
import { TelegramOperatorService, type TelegramTransport } from "./telegram.js";

function fixture() {
  const messages: Array<{ chatId: string; text: string; keyboard?: unknown }> =
    [];
  const callbacks: string[] = [];
  const transport: TelegramTransport = {
    getUpdates: async () => ({ updates: [] }),
    sendMessage: async (chatId, text, keyboard) => {
      messages.push({ chatId, text, keyboard });
    },
    answerCallback: async (_id, text) => {
      callbacks.push(text);
    },
  };
  const store = new InMemoryMonitoringScheduleStore();
  const scheduler = new IndependentMonitoringScheduler({
    store,
    runners: {
      LLM: async () => ({
        status: "AUTH_REQUIRED",
        code: "AUTH_REQUIRED",
        summary: "Safe provider result.",
      }),
      SWAGGER_API: async () => ({
        status: "SOURCE_UNAVAILABLE",
        code: "SOURCE_UNAVAILABLE",
        summary: "Safe source result.",
      }),
    },
  });
  const service = new TelegramOperatorService({
    scheduler,
    transport,
    operatorIds: new Set(["7"]),
    notificationChatIds: ["42"],
  });
  return { service, messages, callbacks, scheduler };
}

describe("TG2 Telegram controls", () => {
  it("TG2-17/TG2-18 provide separate lane buttons with shared command semantics", async () => {
    const { service, messages } = fixture();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/help" },
    });
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[0]?.keyboard)).toContain("monitor:LLM:run");
    expect(JSON.stringify(messages[1]?.keyboard)).toContain(
      "monitor:SWAGGER_API:run",
    );
  });

  it("TG2-19/TG2-20 deny unauthorized commands and callbacks", async () => {
    const { service, messages, callbacks } = fixture();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "8", text: "/llm_run" },
    });
    await service.handleUpdate({
      updateId: 2,
      callbackQuery: {
        id: "c",
        chatId: "42",
        userId: "8",
        data: "monitor:LLM:run",
      },
    });
    expect(messages[0]?.text).toBe("DENIED");
    expect(callbacks).toContain("DENIED");
  });

  it("TG2-23 keeps forced acknowledgements bounded to lane and run identity", async () => {
    const { service, messages, scheduler } = fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/llm_run" },
    });
    expect(messages[0]?.text).toMatch(/^LLM run started: [0-9a-f-]{36}$/);
    expect(messages[0]?.text).not.toMatch(/token|body|payload/i);
    await scheduler.stop();
  });

  it("TG2-24 returns safe final result and rejects malformed intervals", async () => {
    const { service, messages, scheduler } = fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/swagger_interval nope" },
    });
    await service.handleUpdate({
      updateId: 2,
      message: { chatId: "42", userId: "7", text: "/swagger_status" },
    });
    expect(messages[0]?.text).toContain("INVALID_MONITORING_DURATION");
    expect(messages[1]?.text).toContain("Swagger/API status");
    await scheduler.stop();
  });
});
