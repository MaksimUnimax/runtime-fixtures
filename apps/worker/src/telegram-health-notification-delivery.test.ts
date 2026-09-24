import { describe, expect, it, vi } from "vitest";
import { NotificationDeliveryError } from "@product/health";
import {
  formatHealthNotification,
  TelegramHealthNotificationDelivery,
} from "./telegram-health-notification-delivery.js";

const payload = {
  schemaVersion: 1,
  routeKey: "OWNER_MONITORING",
  eventKind: "INCIDENT_OPENED",
  provider: "chatgpt",
  surface: "standard",
  healthLevel: "H3",
  healthState: "BROKEN",
  severity: "CRITICAL",
  observedAt: "2026-09-23T00:00:00.000Z",
  incidentId: "00000000-0000-4000-8000-000000000001",
  healthRunId: "00000000-0000-4000-8000-000000000002",
  rawEvidence: "private conversation and token must not appear",
};

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function request() {
  return {
    intentId: "intent",
    idempotencyKey: "dedup",
    routeKey: "OWNER_MONITORING",
    payload,
  } as const;
}

describe("Telegram Health notification delivery", () => {
  it("formats only allowlisted bounded fields", () => {
    const text = formatHealthNotification(payload);
    expect(text).toContain("Health CRITICAL: BROKEN");
    expect(text).toContain(payload.incidentId);
    expect(text).not.toContain("rawEvidence");
    expect(text).not.toContain("private conversation");
    expect(text).not.toContain("token must");
    expect(text.length).toBeLessThanOrEqual(4_096);
    expect(() =>
      formatHealthNotification({ ...payload, provider: "x\ny" }),
    ).toThrow();
  });

  it("sends only the OWNER_MONITORING route and returns Telegram receipt", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        fakeResponse(200, { ok: true, result: { message_id: 91 } }),
      );
    const provider = new TelegramHealthNotificationDelivery(
      "123456:fixture_token_123456789",
      "-100123456",
      fetcher,
    );
    await expect(provider.deliver(request())).resolves.toEqual({
      providerAdapterKey: "telegram-owner-monitoring",
      providerDeliveryId: "91",
    });
    const [, init] = fetcher.mock.calls[0]!;
    expect(String(init?.body)).not.toContain("rawEvidence");
    expect(String(init?.body)).not.toContain("fixture-token");
    expect(init?.redirect).toBe("error");
    await expect(
      provider.deliver({ ...request(), routeKey: "OTHER" }),
    ).rejects.toMatchObject({ code: "DISABLED_ROUTE" });
  });

  it("classifies provider errors without exposing response bodies", async () => {
    for (const [status, body, code, delay] of [
      [429, { parameters: { retry_after: 3 } }, "RATE_LIMIT", 3_000],
      [429, { parameters: { retry_after: 99_999 } }, "RATE_LIMIT", 3_600_000],
      [503, { error: "private" }, "TRANSIENT_PROVIDER_FAILURE", undefined],
      [401, { error: "private" }, "CONFIGURATION_ERROR", undefined],
      [400, { error: "private" }, "PERMANENT_PROVIDER_REJECTION", undefined],
    ] as const) {
      const provider = new TelegramHealthNotificationDelivery(
        "123456:token_123456789",
        "123",
        vi.fn<typeof fetch>().mockResolvedValue(fakeResponse(status, body)),
      );
      const error = await provider.deliver(request()).catch((caught) => caught);
      expect(error).toBeInstanceOf(NotificationDeliveryError);
      expect(error).toMatchObject({ code, retryAfterMs: delay });
      expect(String(error)).not.toContain("private");
    }
  });

  it("classifies network errors as transient and never includes the token", async () => {
    const provider = new TelegramHealthNotificationDelivery(
      "123456:do-not-log-this",
      "123",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("socket failure")),
    );
    const error = await provider.deliver(request()).catch((caught) => caught);
    expect(error).toMatchObject({ code: "TRANSIENT_PROVIDER_FAILURE" });
    expect(String(error)).not.toContain("do-not-log-this");
  });

  it("keeps the deadline active through response-body consumption", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = new TelegramHealthNotificationDelivery(
      "123456:token_123456789",
      "123",
      fetcher,
      25,
    );
    const error = await provider.deliver(request()).catch((caught) => caught);
    expect(error).toMatchObject({ code: "TRANSIENT_PROVIDER_FAILURE" });
  });

  it("rejects oversized provider responses without retaining response content", async () => {
    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { "content-length": String(64 * 1024 + 1) },
    });
    const provider = new TelegramHealthNotificationDelivery(
      "123456:token_123456789",
      "123",
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    const error = await provider.deliver(request()).catch((caught) => caught);
    expect(error).toMatchObject({ code: "PERMANENT_PROVIDER_REJECTION" });
  });

  it("rejects malformed transport configuration", () => {
    expect(
      () =>
        new TelegramHealthNotificationDelivery(
          "token with space",
          "123",
          vi.fn<typeof fetch>(),
        ),
    ).toThrow("CONFIGURATION_ERROR");
    expect(
      () =>
        new TelegramHealthNotificationDelivery(
          "123456:token_123456789",
          "chat-name",
          vi.fn<typeof fetch>(),
        ),
    ).toThrow("CONFIGURATION_ERROR");
  });
});
