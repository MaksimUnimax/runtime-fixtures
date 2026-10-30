import { describe, expect, it, vi } from "vitest";
import {
  WB_BUNDLE_DOCUMENT_KEY,
  WB_BUNDLE_OFFICIAL_URL,
  WB_BUNDLE_VERSION,
} from "@product/api-watch";
import {
  IndependentMonitoringScheduler,
  InMemoryMonitoringScheduleStore,
  type SwaggerHandoffService,
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

describe("Telegram Bot API response memory boundary", () => {
  it.each(["declared", "actual"] as const)(
    "rejects an oversized %s control response before any update can be dispatched",
    async (kind) => {
      const maxBytes = 8 * 1024 * 1024;
      const body =
        kind === "declared"
          ? JSON.stringify({ ok: true, result: [] })
          : JSON.stringify({
              ok: true,
              result: [],
              ignored: "x".repeat(maxBytes),
            });
      let requests = 0;
      const fetcher = (async () => {
        requests++;
        return new Response(body, {
          headers: {
            "content-length": kind === "declared" ? String(maxBytes + 1) : "17",
          },
        });
      }) as typeof fetch;
      await expect(
        createTelegramTransport("synthetic-no-network", fetcher).getUpdates(
          undefined,
        ),
      ).rejects.toThrow("TELEGRAM_API_RESPONSE_TOO_LARGE");
      expect(requests).toBe(1);
    },
  );
});

describe("Telegram Bot API read and mutating deadlines", () => {
  it("bounds polling and attaches an abort signal to the mutating transport", async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        expect(ms).toBe(30_000);
        return deadline.signal;
      });
    const requests: Array<{
      method: string;
      signal: AbortSignal | null | undefined;
      body: Record<string, unknown>;
    }> = [];
    const fetcher = (async (url, init) => {
      const method = String(url).split("/").at(-1) ?? "";
      requests.push({
        method,
        signal: init?.signal,
        body: JSON.parse(String(init?.body)),
      });
      if (method === "sendMessage") {
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 1 } }),
        );
      }
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        );
      });
    }) as typeof fetch;
    const transport = createTelegramTransport("fixture-no-network", fetcher);
    const pending = transport.getUpdates(undefined);
    try {
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("getUpdates");
      expect(requests[0]?.body).toMatchObject({ timeout: 20 });
      expect(requests[0]?.signal).toBe(deadline.signal);
      deadline.abort(new DOMException("synthetic timeout", "TimeoutError"));
      await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await transport.sendMessage("42", "fixture");
      expect(requests.map((request) => request.method)).toEqual([
        "getUpdates",
        "sendMessage",
      ]);
      expect(requests[1]?.signal).toBe(deadline.signal);
    } finally {
      deadline.abort();
      timeout.mockRestore();
      void pending.catch(() => {});
    }
  });
});

describe("Telegram mutating and binary HTTP deadlines", () => {
  it("bounds a pending send and stops without another in-process send", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        expect(ms).toBe(30_000);
        return controller.signal;
      });
    let notifySend!: () => void;
    const entered = new Promise<void>((resolve) => {
      notifySend = resolve;
    });
    let releaseSend: (() => void) | undefined;
    let sends = 0;
    const fetcher = (async (url, init) => {
      if (String(url).endsWith("/getUpdates"))
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 1,
                message: {
                  chat: { id: 42 },
                  from: { id: 8 },
                  text: "/llm_status",
                },
              },
            ],
          }),
        );
      if (!String(url).endsWith("/sendMessage"))
        throw new Error("UNEXPECTED_FIXTURE_ENDPOINT");
      sends++;
      return await new Promise<Response>((resolve, reject) => {
        releaseSend = () =>
          resolve(
            new Response(
              JSON.stringify({ ok: true, result: { message_id: 1 } }),
            ),
          );
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
        notifySend();
      });
    }) as typeof fetch;
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      transport: createTelegramTransport("fixture-no-real-network", fetcher),
      operatorIds: new Set(["7"]),
      sleep: async () => {},
    });
    let stopping: Promise<"STOPPED"> | undefined;
    try {
      await service.start();
      await Promise.race([
        entered,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("SEND_NOT_STARTED")), 1_000),
        ),
      ]);
      stopping = service.stop().then(() => "STOPPED");
      controller.abort(
        new DOMException("synthetic delivery outcome unknown", "TimeoutError"),
      );
      const observed = await Promise.race([
        stopping,
        new Promise<"PENDING">((resolve) =>
          setTimeout(() => resolve("PENDING"), 80),
        ),
      ]);
      expect(observed).toBe("STOPPED");
      expect(sends).toBe(1);
    } finally {
      controller.abort();
      releaseSend?.();
      if (stopping) await stopping;
      timeout.mockRestore();
    }
  });

  it("bounds binary file bytes without an automatic additional call", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        expect([30_000, 60_000]).toContain(ms);
        return controller.signal;
      });
    const fetcher = (async (url, init) => {
      const path = String(url).split("/").at(-1) || "";
      calls.push(path);
      if (path === "getFile")
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: "synthetic-path" } }),
        );
      expect(init?.signal).toBe(controller.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
        setTimeout(() => reject(new Error("UNBOUNDED_FIXTURE_REQUEST")), 150);
      });
    }) as typeof fetch;
    try {
      const transport = createTelegramTransport(
        "synthetic-no-network",
        fetcher,
      );
      if (!transport.downloadFile) throw new Error("DOWNLOAD_FILE_UNAVAILABLE");
      const pending = transport.downloadFile("synthetic-file");
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort(
        new DOMException("synthetic binary timeout", "TimeoutError"),
      );
      await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      expect(calls).toEqual(["getFile", "synthetic-path"]);
    } finally {
      controller.abort();
      timeout.mockRestore();
    }
  });
});

describe("TG4 binary size enforcement at HTTP and handoff boundaries", () => {
  const metadata = JSON.stringify({
    ok: true,
    result: { file_path: "synthetic-file-path" },
  });

  it("cancels the unsuccessful binary HTTP response instead of leaving a stream open", async () => {
    const calls: string[] = [];
    let pulls = 0;
    let cancels = 0;
    const rejectedBody = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls++;
        },
        cancel() {
          cancels++;
        },
      },
      { highWaterMark: 0 },
    );
    const fetcher = (async (url) => {
      const method = String(url).split("/").at(-1) ?? "";
      calls.push(method);
      return method === "getFile"
        ? new Response(metadata)
        : new Response(rejectedBody, { status: 404 });
    }) as typeof fetch;
    const transport = createTelegramTransport("synthetic-no-network", fetcher);
    await expect(
      transport.downloadFile?.("synthetic-file-id", 3),
    ).rejects.toThrow("TELEGRAM_FILE_DOWNLOAD_FAILED");
    await vi.waitFor(() => expect(cancels).toBe(1));
    expect(pulls).toBe(0);
    expect(calls).toEqual(["getFile", "synthetic-file-path"]);
  });

  it("rejects oversized binary content even if no length header is present", async () => {
    const calls: string[] = [];
    const fetcher = (async (url) => {
      const method = String(url).split("/").at(-1) ?? "";
      calls.push(method);
      return method === "getFile"
        ? new Response(metadata)
        : new Response(new Uint8Array([1, 2, 3, 4]));
    }) as typeof fetch;
    const transport = createTelegramTransport("synthetic-no-network", fetcher);
    await expect(transport.downloadFile?.("synthetic-id", 3)).rejects.toThrow(
      "TELEGRAM_FILE_TOO_LARGE",
    );
    expect(calls).toEqual(["getFile", "synthetic-file-path"]);
  });

  it("rejects declared length over the cap without reading the body", async () => {
    const fetcher = (async (url) =>
      String(url).endsWith("/getFile")
        ? new Response(metadata)
        : new Response(new Uint8Array([1, 2]), {
            headers: { "content-length": "100" },
          })) as typeof fetch;
    const transport = createTelegramTransport("synthetic-no-network", fetcher);
    await expect(transport.downloadFile?.("synthetic-id", 3)).rejects.toThrow(
      "TELEGRAM_FILE_TOO_LARGE",
    );
  });

  it("accepts the exact permitted byte count without truncation", async () => {
    const fetcher = (async (url) =>
      String(url).endsWith("/getFile")
        ? new Response(metadata)
        : new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
    const transport = createTelegramTransport("synthetic-no-network", fetcher);
    expect(
      Array.from((await transport.downloadFile?.("synthetic-id", 3)) ?? []),
    ).toEqual([1, 2, 3]);
  });

  it("copies reused one-byte stream chunks instead of retaining their mutable references", async () => {
    const length = 120_000;
    let produced = 0;
    const reusable = new Uint8Array(1);
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (produced === length) {
            controller.close();
            return;
          }
          reusable[0] = produced % 251;
          controller.enqueue(reusable);
          produced += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const fetcher = (async (url) =>
      String(url).endsWith("/getFile")
        ? new Response(metadata)
        : new Response(stream)) as typeof fetch;
    const transport = createTelegramTransport("synthetic-no-network", fetcher);
    const bytes = await transport.downloadFile?.("synthetic-id", length);
    expect(bytes?.byteLength).toBe(length);
    expect(produced).toBe(length);
    for (let i = 0; i < length; i += 997) expect(bytes?.[i]).toBe(i % 251);
    expect(bytes?.[length - 1]).toBe((length - 1) % 251);
  });

  it("rejects oversized remote downloads without storing a WB upload", async () => {
    const sent: string[] = [];
    let uploads = 0;
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      operatorIds: new Set(["7"]),
      notificationChatIds: ["42"],
      transport: {
        getUpdates: async () => ({ updates: [] }),
        sendMessage: async (_id, text) => {
          sent.push(text);
        },
        answerCallback: async () => {},
        downloadFile: async (_id, maxBytes) => {
          expect(maxBytes).toBe(3);
          throw new Error("TELEGRAM_FILE_TOO_LARGE");
        },
      },
      swaggerHandoff: {
        maxUploadBytes: 3,
        listPending: async () => [
          {
            requestId: "synthetic-request",
            status: "PENDING_OPERATOR_UPLOAD",
            sourceFamily: "WILDBERRIES",
            officialUrl: WB_BUNDLE_OFFICIAL_URL,
            documentKey: WB_BUNDLE_DOCUMENT_KEY,
            bundleVersion: WB_BUNDLE_VERSION,
            expectedArtifactType: "JSON",
          },
        ],
        upload: async () => {
          uploads++;
          return { kind: "REJECTED", code: "SHOULD_NOT_REACH_UPLOAD" };
        },
      } as unknown as SwaggerHandoffService,
    });
    await service.handleUpdate({
      updateId: 7,
      message: {
        chatId: "42",
        userId: "7",
        document: {
          fileId: "synthetic-id",
          fileName: "WB_OPENAPI_BUNDLE_V1.json",
        },
      },
    });
    expect(uploads).toBe(0);
    expect(sent).toEqual(["UPLOAD_TOO_LARGE"]);
  });

  it("passes the configured upload limit to the Telegram transport", async () => {
    const limits: Array<number | undefined> = [];
    const sent: string[] = [];
    const service = new TelegramOperatorService({
      scheduler: scheduler(),
      operatorIds: new Set(["7"]),
      notificationChatIds: ["42"],
      transport: {
        getUpdates: async () => ({ updates: [] }),
        sendMessage: async (_id, text) => {
          sent.push(text);
        },
        answerCallback: async () => {},
        downloadFile: async (_id, maxBytes) => {
          limits.push(maxBytes);
          return new Uint8Array([1, 2, 3]);
        },
      },
      swaggerHandoff: {
        maxUploadBytes: 3,
        listPending: async () => [
          {
            requestId: "synthetic-request",
            status: "PENDING_OPERATOR_UPLOAD",
            sourceFamily: "WILDBERRIES",
            officialUrl: WB_BUNDLE_OFFICIAL_URL,
            documentKey: WB_BUNDLE_DOCUMENT_KEY,
            bundleVersion: WB_BUNDLE_VERSION,
            expectedArtifactType: "JSON",
          },
        ],
        upload: async () => ({ kind: "REJECTED", code: "INVALID_DOCUMENT" }),
      } as unknown as SwaggerHandoffService,
    });
    await service.handleUpdate({
      updateId: 5,
      message: {
        chatId: "42",
        userId: "7",
        document: {
          fileId: "synthetic-file-id",
          fileName: "WB_OPENAPI_BUNDLE_V1.json",
        },
      },
    });
    expect(limits).toEqual([3]);
    expect(sent).toEqual(["INVALID_DOCUMENT"]);
  });
});

describe("review P2 Telegram polling progress", () => {
  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe next offset", Number.MAX_SAFE_INTEGER],
    ["string", "7"],
    ["missing", undefined],
  ])(
    "refuses %s update IDs before exposing any mapped commands",
    async (_name, invalidId) => {
      const valid = {
        update_id: 1,
        message: { chat: { id: 42 }, from: { id: 7 }, text: "/llm_run" },
      };
      const invalid = { ...valid, update_id: invalidId };
      const fetcher = (async () =>
        new Response(
          JSON.stringify({ ok: true, result: [valid, invalid] }),
        )) as typeof fetch;
      await expect(
        createTelegramTransport("synthetic-no-network", fetcher).getUpdates(
          undefined,
        ),
      ).rejects.toThrow("TELEGRAM_UPDATE_ID_INVALID");
    },
  );

  it.each([
    ["duplicate", [2, 2]],
    ["out of order", [3, 2]],
  ])(
    "refuses %s update IDs in one raw page before dispatch",
    async (_name, ids) => {
      const raw = ids.map((id) => ({
        update_id: id,
        message: { chat: { id: 42 }, from: { id: 7 }, text: "/llm_run" },
      }));
      const fetcher = (async () =>
        new Response(
          JSON.stringify({ ok: true, result: raw }),
        )) as typeof fetch;
      await expect(
        createTelegramTransport("synthetic-no-network", fetcher).getUpdates(
          undefined,
        ),
      ).rejects.toThrow("TELEGRAM_UPDATE_ID_ORDER_INVALID");
    },
  );

  it("ignores a previously handled update replayed by a faulty transport in the same process", async () => {
    const offsets: Array<number | undefined> = [];
    const sent: string[] = [];
    const done = deferred(),
      release = deferred();
    const transport: TelegramTransport = {
      async getUpdates(offset) {
        offsets.push(offset);
        if (offsets.length === 3) {
          done.resolve();
          await release.promise;
          return { updates: [] };
        }
        return {
          updates: [
            {
              updateId: 23,
              message: { chatId: "42", userId: "7", text: "/llm_status" },
            },
          ],
        };
      },
      async sendMessage(_chatId, message) {
        sent.push(message);
      },
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
    expect(offsets).toEqual([undefined, 24, 24]);
    expect(
      sent.filter((message) => message.includes("LLM status")),
    ).toHaveLength(1);
  });

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
