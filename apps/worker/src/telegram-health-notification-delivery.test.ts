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
    expect(text).toContain("ChatGPT — обычный чат");
    expect(text).toContain(
      "Обязательная часть проверяемого сценария не прошла проверку",
    );
    expect(text).not.toContain(payload.incidentId);
    expect(text).not.toContain(payload.healthRunId);
    expect(text).toContain("23.09.2026 05:00 (+05)");
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
  it.each([
    ["H0", "без открытия сайта"],
    ["H1", "сохранённый пример страницы"],
    ["H2", "Получение ответа ИИ этим уровнем не подтверждается"],
    ["H3", "контрольный сценарий общения с ИИ"],
    ["H4", "Ручное одобрение и выпуск"],
    ["H5", "Работа у всех пользователей"],
  ] as const)(
    "describes the %s evidence boundary in Russian",
    (healthLevel, expected) => {
      const text = formatHealthNotification({ ...payload, healthLevel });
      expect(text).toContain(expected);
      expect(text).toContain(
        "не полная проверка всех функций установленного расширения",
      );
      expect(text).not.toContain("Level/event");
    },
  );

  it.each([
    ["DRIFT", "Структура страницы изменилась"],
    ["DEGRADED", "работает хуже или недоступна"],
    ["BROKEN", "не прошла проверку"],
  ] as const)(
    "explains %s without announcing a delivered fix",
    (healthState, expected) => {
      const text = formatHealthNotification({
        ...payload,
        healthState,
        rootContourKey: "C10_NATIVE_COPY_CONTROL",
      });
      expect(text).toContain(expected);
      expect(text).toContain("Участок проверки: копирование кода");
      expect(text).toContain(
        "Сведения об одобрении и доставке исправления пользователям",
      );
      expect(text).not.toContain("C10_NATIVE_COPY_CONTROL");
    },
  );

  it("reports recovery of the checked scope without claiming a released patch", () => {
    const text = formatHealthNotification({
      ...payload,
      eventKind: "INCIDENT_RECOVERED",
      healthState: "HEALTHY",
    });
    expect(text).toContain("больше не воспроизводится в этой проверке");
    expect(text).toContain("Сведения об одобрении и доставке");
    expect(text).not.toContain("исправление выпущено");
  });

  it.each([
    ["INCIDENT_RECOVERED", "BROKEN"],
    ["INCIDENT_OPENED", "HEALTHY"],
    ["MAINTENANCE_ENTERED", "HEALTHY"],
    ["MAINTENANCE_EXITED", "MAINTENANCE"],
  ] as const)(
    "does not overclaim for contradictory %s/%s",
    (eventKind, healthState) => {
      const text = formatHealthNotification({
        ...payload,
        eventKind,
        healthState,
      });
      expect(text).toContain("противоречивые данные");
      expect(text).not.toContain("больше не воспроизводится");
      expect(text).not.toContain("ошибок не обнаружено");
    },
  );

  it("explains escalation and maintenance transitions", () => {
    expect(
      formatHealthNotification({ ...payload, eventKind: "INCIDENT_ESCALATED" }),
    ).toContain("Проблема усилилась");
    expect(
      formatHealthNotification({
        ...payload,
        eventKind: "MAINTENANCE_ENTERED",
        healthState: "MAINTENANCE",
      }),
    ).toContain("временно отключён оператором");
    expect(
      formatHealthNotification({
        ...payload,
        eventKind: "MAINTENANCE_EXITED",
        healthState: "UNKNOWN",
      }),
    ).toContain("Работоспособность определить не удалось");
  });

  it("keeps the +05 date correct across a UTC day boundary", () => {
    expect(
      formatHealthNotification({
        ...payload,
        observedAt: "2026-09-28T22:45:00.000Z",
      }),
    ).toContain("29.09.2026 03:45 (+05)");
    expect(
      formatHealthNotification({
        ...payload,
        observedAt: "2026-02-30T00:00:00.000Z",
      }),
    ).toContain("Время проверки не распознано");
  });

  it("does not forward unknown labels or prototype property names", () => {
    const text = formatHealthNotification({
      ...payload,
      provider: "constructor",
      surface: "private-surface",
      healthLevel: "XX",
      eventKind: "private-event",
      rootContourKey: "private-contour",
      observedAt: "private-time",
    });
    expect(text).toContain("название не распознано");
    expect(text).toContain("режим не распознан");
    expect(text).toContain("не распознан; её полнота неизвестна");
    for (const secret of [
      "private",
      "constructor",
      "XX",
      payload.incidentId,
      payload.healthRunId,
    ])
      expect(text).not.toContain(secret);
  });

  it("does not assign a known mode from another provider", () => {
    const text = formatHealthNotification({
      ...payload,
      provider: "alice",
      surface: "CHATGPT_WORK",
    });
    expect(text).toContain("Алиса — режим не распознан");
    expect(text).not.toContain("рабочий режим");
  });
});
