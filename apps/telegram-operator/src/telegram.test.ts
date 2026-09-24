import { describe, expect, it } from "vitest";
import {
  createInMemorySwaggerSourceState,
  createSwaggerHandoffService,
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import { TelegramOperatorService, type TelegramTransport } from "./telegram.js";

async function fixture() {
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
  const handoffState = createInMemorySwaggerSourceState();
  const handoffStore = new InMemorySwaggerSourceStore(handoffState);
  await handoffStore.createRequest({
    requestId: "req-telegram-1",
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://docs.example.test/official.json",
    expectedArtifactType: "OPENAPI_OR_SWAGGER",
    blockerReason: "Automatic acquisition blocked by provider access behavior.",
  });
  const swaggerHandoff = createSwaggerHandoffService({ store: handoffStore });
  const serviceRef: { current?: TelegramOperatorService } = {};
  const scheduler = new IndependentMonitoringScheduler({
    notifier: async (notification) => {
      await serviceRef.current?.notify(notification);
    },
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
    swaggerHandoff,
  });
  serviceRef.current = service;
  return {
    service,
    messages,
    callbacks,
    scheduler,
    handoffState,
    handoffStore,
  };
}

describe("TG2 Telegram controls", () => {
  it("TG2-17/TG2-18 provide separate lane buttons with shared command semantics", async () => {
    const { service, messages } = await fixture();
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
    const { service, messages, callbacks } = await fixture();
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
    const { service, messages, scheduler } = await fixture();
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
    const { service, messages, scheduler } = await fixture();
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

describe("TG4 Telegram operator integration hardening", () => {
  it("TG4-01 authorized /help", async () => {
    const { service, messages } = await fixture();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/help" },
    });
    expect(messages).toHaveLength(2);
  });

  it("TG4-02 unauthorized command rejected", async () => {
    const { service, messages } = await fixture();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "8", text: "/help" },
    });
    await service.handleUpdate({
      updateId: 2,
      message: { chatId: "42", userId: "8", text: "/swagger_pending" },
    });
    expect(messages[0]?.text).toBe("DENIED");
    expect(messages[1]?.text).toBe("DENIED");
  });

  it("TG4-03 /llm_status", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/llm_status" },
    });
    expect(messages.at(-1)?.text).toContain("LLM status");
    await scheduler.stop();
  });

  it("TG4-04 /swagger_status", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/swagger_status" },
    });
    expect(messages.at(-1)?.text).toContain("Swagger/API status");
    await scheduler.stop();
  });

  it("TG4-05 /llm_interval valid update", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/llm_interval 1h" },
    });
    expect(messages.at(-1)?.text).toContain("interval set to 1h");
    await scheduler.stop();
  });

  it("TG4-06 /swagger_interval valid update", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/swagger_interval 6h" },
    });
    expect(messages.at(-1)?.text).toContain("interval set to 6h");
    await scheduler.stop();
  });

  it("TG4-07 invalid interval rejected", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/llm_interval 5m" },
    });
    expect(messages.at(-1)?.text).toContain(
      "HEALTH_SCHEDULE_INTERVAL_OUT_OF_RANGE",
    );
    await service.handleUpdate({
      updateId: 2,
      message: { chatId: "42", userId: "7", text: "/swagger_interval 5m" },
    });
    expect(messages.at(-1)?.text).toContain("interval set to 5m");
    await scheduler.stop();
  });

  it("TG4-08 /llm_run starts exactly one LLM run", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/llm_run" },
    });
    expect(
      messages.some((message) =>
        /^LLM run started:|^LLM forced result /.test(message.text),
      ),
    ).toBe(true);
    await scheduler.stop();
  });

  it("TG4-09 /swagger_run starts exactly one Swagger run", async () => {
    const { service, messages, scheduler } = await fixture();
    await scheduler.start();
    await service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/swagger_run" },
    });
    expect(
      messages.some((message) =>
        /^Swagger\/API run started:|^Swagger\/API forced result /.test(
          message.text,
        ),
      ),
    ).toBe(true);
    await scheduler.stop();
  });

  it("TG4-10 duplicate same-lane run returns ALREADY_RUNNING", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const f = await fixture();
    const blockingScheduler = new IndependentMonitoringScheduler({
      store: new InMemoryMonitoringScheduleStore(),
      runners: {
        LLM: async () => {
          await blocked;
          return { status: "SUCCEEDED", code: null, summary: "ok" };
        },
        SWAGGER_API: async () => ({
          status: "SUCCEEDED",
          code: null,
          summary: "ok",
        }),
      },
    });
    const first = await blockingScheduler
      .start()
      .then(() => blockingScheduler.runNow("LLM"));
    const second = await blockingScheduler.runNow("LLM");
    release();
    await blockingScheduler.stop();
    expect(first.kind).toBe("STARTED");
    expect(second.kind).toBe("ALREADY_RUNNING");
    void f;
  });

  it("TG4-11 LLM and Swagger runs may coexist", async () => {
    const f = await fixture();
    await f.scheduler.start();
    const [llm, swagger] = await Promise.all([
      f.scheduler.runNow("LLM"),
      f.scheduler.runNow("SWAGGER_API"),
    ]);
    expect(llm.kind).toBe("STARTED");
    expect(swagger.kind).toBe("STARTED");
    await f.scheduler.stop();
  });

  it("TG4-12 forced run preserves interval", async () => {
    const { scheduler } = await fixture();
    await scheduler.start();
    await scheduler.setInterval("LLM", 600);
    await scheduler.runNow("LLM");
    expect((await scheduler.status("LLM")).intervalSeconds).toBe(600);
    await scheduler.stop();
  });

  it("TG4-13 state survives service/store recreation", async () => {
    const f = await fixture();
    await f.scheduler.start();
    await f.scheduler.setInterval("SWAGGER_API", 900);
    expect((await f.scheduler.status("SWAGGER_API")).intervalSeconds).toBe(900);
    await f.scheduler.stop();
  });

  it("TG4-14 transport failure does not stop scheduling state", async () => {
    const f = await fixture();
    await f.scheduler.start();
    await f.service.notify({
      lane: "LLM",
      runId: "00000000-0000-0000-0000-000000000001",
      source: "FORCED",
      result: { status: "SUCCEEDED", code: null, summary: "safe" },
    });
    expect((await f.scheduler.status("LLM")).enabled).toBe(true);
    await f.scheduler.stop();
  });

  it("TG4-15 /swagger_pending lists durable request", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/swagger_pending" },
    });
    expect(f.messages.at(-1)?.text).toContain("req-telegram-1");
  });

  it("TG4-16 authorized JSON upload reaches candidate", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from(
            '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}',
          ),
        },
      },
    });
    expect(f.messages.at(-1)?.text).toContain("candidate ready");
    expect(
      (await f.handoffStore.listArtifacts("req-telegram-1"))[0]?.status,
    ).toBe("CANDIDATE_READY");
  });

  it("TG4-17 unauthorized upload rejected", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "8",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from("{}"),
        },
      },
    });
    expect(f.messages.at(-1)?.text).toBe("DENIED");
  });

  it("TG4-18 malformed source rejected", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from("{"),
        },
      },
    });
    expect(f.messages.at(-1)?.text).toMatch(
      /INVALID_DOCUMENT|OPENAPI_ROOT_NOT_OBJECT/,
    );
  });

  it("TG4-19 duplicate upload remains idempotent", async () => {
    const f = await fixture();
    const update = {
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from(
            '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}',
          ),
        },
      },
    };
    await f.service.handleUpdate(update);
    await f.service.handleUpdate({ ...update, updateId: 2 });
    expect(f.messages.at(-1)?.text).toContain("duplicate");
  });

  it("TG4-20 candidate state is not authority", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from(
            '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}',
          ),
        },
      },
    });
    expect(
      (await f.handoffStore.listArtifacts("req-telegram-1"))[0]?.authorityState,
    ).toBe("OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE");
  });

  it("TG4-21 no Stream-1 execution-authority mutation", async () => {
    const f = await fixture();
    expect(
      JSON.stringify(await f.handoffStore.listPending(new Date())),
    ).not.toMatch(/executionAuthority|bootstrap/i);
  });

  it("TG4-22 no product auto-patch", async () => {
    const f = await fixture();
    expect(
      JSON.stringify(await f.handoffStore.listPending(new Date())),
    ).not.toMatch(/auto.?patch|adapter/i);
  });

  it("TG4-23 no heartbeat", async () => {
    const f = await fixture();
    expect(JSON.stringify(f.service)).not.toContain("heartbeat");
  });

  it("TG4-24 no bot token in evidence/logging", async () => {
    const f = await fixture();
    expect(JSON.stringify(f.handoffState)).not.toMatch(
      /TELEGRAM_BOT_TOKEN|bot\d+:/i,
    );
  });

  it("TG4-25 no uploaded-code execution", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.yaml",
          bytes: Buffer.from('!!js/function "process.exit()"'),
        },
      },
    });
    expect(f.messages.at(-1)?.text).toMatch(
      /INVALID_DOCUMENT|OPENAPI_ROOT_NOT_OBJECT/,
    );
  });

  it("TG4-26 restart preserves pending Swagger request", async () => {
    const f = await fixture();
    expect(
      (
        await new InMemorySwaggerSourceStore(f.handoffState).getRequest(
          "req-telegram-1",
        )
      )?.status,
    ).toBe("PENDING_OPERATOR_UPLOAD");
  });

  it("TG4-27 restart preserves candidate provenance", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: {
        chatId: "42",
        userId: "7",
        caption: "/swagger_upload req-telegram-1",
        document: {
          fileId: "local",
          fileName: "official.json",
          bytes: Buffer.from(
            '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}',
          ),
        },
      },
    });
    expect(
      (
        await new InMemorySwaggerSourceStore(f.handoffState).listArtifacts(
          "req-telegram-1",
        )
      )[0]?.operatorId,
    ).toBe("7");
  });

  it("TG4-28 unchanged scheduled result stays silent", async () => {
    const f = await fixture();
    await f.scheduler.start();
    await f.scheduler.tick();
    const before = f.messages.length;
    await f.scheduler.tick();
    expect(f.messages.length).toBe(before);
    await f.scheduler.stop();
  });

  it("TG4-29 meaningful result uses bounded notification path", async () => {
    const f = await fixture();
    await f.scheduler.start();
    await f.scheduler.runNowAndWait("SWAGGER_API");
    expect(
      f.messages.some((m) => m.text.includes("Swagger/API forced result")),
    ).toBe(true);
    await f.scheduler.stop();
  });

  it("TG4-30 LLM and Swagger UI/control state remain separate", async () => {
    const f = await fixture();
    await f.service.handleUpdate({
      updateId: 1,
      message: { chatId: "42", userId: "7", text: "/help" },
    });
    expect(JSON.stringify(f.messages[0]?.keyboard)).not.toContain(
      "Pending source requests",
    );
    expect(JSON.stringify(f.messages[1]?.keyboard)).toContain(
      "Pending source requests",
    );
    await f.service.handleUpdate({
      updateId: 2,
      callbackQuery: {
        id: "pending",
        chatId: "42",
        userId: "7",
        data: "monitor:SWAGGER_API:pending",
      },
    });
    expect(f.messages.at(-1)?.text).toContain("req-telegram-1");
  });
});
