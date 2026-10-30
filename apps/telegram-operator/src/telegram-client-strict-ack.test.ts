import { describe, expect, it } from "vitest";
import { createTelegramTransport } from "./telegram-client.js";

// Every network answer is synthetic; these tests never reach Telegram.
function transportFor(payload: unknown) {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return {
    transport: createTelegramTransport("synthetic-no-network", fetcher),
    getCalls: () => calls,
  };
}

describe("Telegram transport must not invent delivery ACK", () => {
  it.each([
    { ok: true, result: null },
    { ok: "false", result: { message_id: 7 } },
    { ok: 1, result: { message_id: 7 } },
    { ok: true, result: {} },
    { ok: true, result: { message_id: "7" } },
    { ok: true, result: { message_id: 0 } },
    { ok: true, result: { message_id: -1 } },
    { ok: true, result: true },
  ])(
    "rejects invalid sendMessage success %# without retry",
    async (payload) => {
      const fixture = transportFor(payload);
      await expect(
        fixture.transport.sendMessage("42", "synthetic"),
      ).rejects.toThrow("TELEGRAM_SENDMESSAGE_FAILED");
      expect(fixture.getCalls()).toBe(1);
    },
  );

  it("accepts a strictly confirmed Message once", async () => {
    const fixture = transportFor({ ok: true, result: { message_id: 7 } });
    await expect(
      fixture.transport.sendMessage("42", "synthetic"),
    ).resolves.toBeUndefined();
    expect(fixture.getCalls()).toBe(1);
  });

  it.each([
    { ok: true, result: null },
    { ok: "false", result: true },
    { ok: true, result: { acknowledged: true } },
    { ok: true, result: false },
  ])("rejects invalid callback acknowledgement %#", async (payload) => {
    const fixture = transportFor(payload);
    await expect(
      fixture.transport.answerCallback("synthetic", "answer"),
    ).rejects.toThrow("TELEGRAM_ANSWERCALLBACKQUERY_FAILED");
    expect(fixture.getCalls()).toBe(1);
  });

  it("accepts explicit successful callback Boolean", async () => {
    const fixture = transportFor({ ok: true, result: true });
    await expect(
      fixture.transport.answerCallback("synthetic", "answer"),
    ).resolves.toBeUndefined();
    expect(fixture.getCalls()).toBe(1);
  });

  it("preserves the valid empty update page", async () => {
    const fixture = transportFor({ ok: true, result: [] });
    await expect(fixture.transport.getUpdates(undefined)).resolves.toEqual({
      updates: [],
      nextOffset: undefined,
    });
    expect(fixture.getCalls()).toBe(1);
  });

  it("rejects a non-string file path instead of constructing a download URL", async () => {
    const fixture = transportFor({ ok: true, result: { file_path: 42 } });
    await expect(
      fixture.transport.downloadFile?.("synthetic-id"),
    ).rejects.toThrow("TELEGRAM_FILE_PATH_MISSING");
    expect(fixture.getCalls()).toBe(1);
  });

  it("never retries a rejected mutating request", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw new TypeError("synthetic network disconnect");
    }) as typeof fetch;
    await expect(
      createTelegramTransport("synthetic-no-network", fetcher).sendMessage(
        "42",
        "synthetic",
      ),
    ).rejects.toThrow("synthetic network disconnect");
    expect(calls).toBe(1);
  });
});
