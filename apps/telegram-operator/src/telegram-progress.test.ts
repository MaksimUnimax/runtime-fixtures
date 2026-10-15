import { describe, expect, it } from "vitest";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
} from "@product/monitoring-control";
import { createTelegramTransport } from "./telegram-client.js";
import { TelegramOperatorService, type TelegramTransport } from "./telegram.js";

function scheduler() {
  const result = {
    status: "SUCCEEDED" as const,
    code: null,
    summary: "synthetic",
  };
  return new IndependentMonitoringScheduler({
    store: new InMemoryMonitoringScheduleStore(),
    runners: { LLM: async () => result, SWAGGER_API: async () => result },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("review P2 Telegram polling progress", () => {
  it("acknowledges a complete raw page of 100 unsupported updates and reaches the operator command", async () => {
    const offsets: Array<number | undefined> = [];
    const messages: string[] = [];
    const updates = Array.from({ length: 100 }, (_, i) => ({
      update_id: i + 1,
      message: { chat: { id: 42 }, from: { id: 8 }, sticker: {} },
    }));
    const queue: unknown[] = [
      ...updates,
      {
        update_id: 101,
        message: { chat: { id: 42 }, from: { id: 7 }, text: "/llm_status" },
      },
    ];
    const done = deferred(),
      release = deferred();
    const fetcher = (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      let result: unknown = true;
      if (String(url).endsWith("/getUpdates")) {
        offsets.push(body.offset);
        if (offsets.length === 3) {
          done.resolve();
          await release.promise;
        }
        result = queue
          .filter(
            (update) =>
              (update as { update_id: number }).update_id >= (body.offset ?? 0),
          )
          .slice(0, 100);
      } else if (String(url).endsWith("/sendMessage")) messages.push(body.text);
      return new Response(JSON.stringify({ ok: true, result }));
    }) as typeof fetch;
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      transport: createTelegramTransport("synthetic-no-network", fetcher),
      operatorIds: new Set(["7"]),
    });
    try {
      await service.start();
      await done.promise;
    } finally {
      const stopped = service.stop();
      release.resolve();
      await stopped;
    }
    expect(offsets).toEqual([undefined, 101, 102]);
    expect(messages.filter((text) => text.includes("LLM status"))).toHaveLength(
      1,
    );
  });

  it("uses explicit empty-page progress without moving backwards", async () => {
    const offsets: Array<number | undefined> = [];
    const done = deferred(),
      release = deferred();
    const transport: TelegramTransport = {
      async getUpdates(offset) {
        offsets.push(offset);
        if (offsets.length === 3) {
          done.resolve();
          await release.promise;
        }
        return { updates: [], nextOffset: offsets.length === 1 ? 101 : 50 };
      },
      async sendMessage() {},
      async answerCallback() {},
    };
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      transport,
      operatorIds: new Set(["7"]),
    });
    try {
      await service.start();
      await done.promise;
    } finally {
      const stopped = service.stop();
      release.resolve();
      await stopped;
    }
    expect(offsets).toEqual([undefined, 101, 101]);
  });

  it("keeps mapped authorized and denied messages while advancing across unsupported trailing updates", async () => {
    const raw = [
      {
        update_id: 1,
        message: { chat: { id: 42 }, from: { id: 8 }, text: "/llm_run" },
      },
      {
        update_id: 2,
        message: { chat: { id: 42 }, from: { id: 7 }, text: "/llm_status" },
      },
      {
        update_id: 3,
        message: { chat: { id: 42 }, from: { id: 8 }, photo: [] },
      },
    ];
    const fetcher = (async () =>
      new Response(JSON.stringify({ ok: true, result: raw }))) as typeof fetch;
    const response = await createTelegramTransport(
      "synthetic-no-network",
      fetcher,
    ).getUpdates(undefined);
    expect(response.updates.map((update) => update.updateId)).toEqual([1, 2]);
    expect(response.nextOffset).toBe(4);
    const messages: string[] = [];
    const monitoring = scheduler();
    await monitoring.start();
    try {
      const service = new TelegramOperatorService({
        scheduler: monitoring,
        operatorIds: new Set(["7"]),
        transport: {
          getUpdates: async () => ({ updates: [] }),
          sendMessage: async (_, text) => {
            messages.push(text);
          },
          answerCallback: async () => {},
        },
      });
      for (const update of response.updates) await service.handleUpdate(update);
    } finally {
      await monitoring.stop();
    }
    expect(messages[0]).toBe("DENIED");
    expect(messages[1]).toContain("LLM status");
  });

  it("does not acknowledge the unprocessed tail when a handler fails or repeat an ambiguous handled command", async () => {
    const offsets: Array<number | undefined> = [];
    const done = deferred(),
      release = deferred();
    let sends = 0;
    const transport: TelegramTransport = {
      async getUpdates(offset) {
        offsets.push(offset);
        if (offsets.length === 2) {
          done.resolve();
          await release.promise;
          return { updates: [] };
        }
        return {
          updates: [
            {
              updateId: 1,
              message: { chatId: "42", userId: "7", text: "/llm_status" },
            },
            {
              updateId: 2,
              message: { chatId: "42", userId: "7", text: "/llm_status" },
            },
          ],
          nextOffset: 101,
        };
      },
      async sendMessage() {
        sends++;
        throw new Error("synthetic ambiguous send failure");
      },
      async answerCallback() {},
    };
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      transport,
      operatorIds: new Set(["7"]),
      sleep: async () => {},
    });
    try {
      await service.start();
      await done.promise;
    } finally {
      const stopped = service.stop();
      release.resolve();
      await stopped;
    }
    expect(offsets).toEqual([undefined, 2]);
    expect(sends).toBe(1);
  });
});
