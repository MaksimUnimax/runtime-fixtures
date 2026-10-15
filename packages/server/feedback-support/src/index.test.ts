import { describe, expect, it } from "vitest";
import {
  FEEDBACK_TRANSITIONS,
  FeedbackSupportService,
  redactAccidentalSecrets,
  retentionConfig,
  sanitizeDiagnostics,
  sanitizeFeedbackText,
  statusTransitionAllowed,
  type FeedbackRepository,
} from "./index.js";

describe("B2 feedback/support safety foundation", () => {
  it("uses only the finite category/status/event contracts", () => {
    expect(Object.keys(FEEDBACK_TRANSITIONS)).toEqual([
      "NEW",
      "TRIAGED",
      "NEEDS_INFO",
      "RESOLVED",
      "CLOSED",
    ]);
    expect(statusTransitionAllowed("NEW", "TRIAGED")).toBe(true);
    expect(statusTransitionAllowed("NEW", "CLOSED")).toBe(false);
    expect(statusTransitionAllowed("CLOSED", "NEEDS_INFO")).toBe(false);
  });

  it("normalizes text, removes control characters, and redacts obvious secrets", () => {
    const value = sanitizeFeedbackText(
      "  Ошибка\u0000\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz123456\npassword=do-not-store  ",
    );
    expect(value).toContain("Ошибка");
    expect(value).not.toContain("do-not-store");
    expect(value).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(value).not.toContain("\u0000");
  });

  it.each([
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-value",
    "cookie: session=secret-value",
    "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----",
    "ozon_api_key=marketplace-secret",
  ])("does not persist a common accidental secret pattern: %s", (value) => {
    const redacted = redactAccidentalSecrets(value);
    expect(redacted).not.toBe(value);
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("marketplace-secret");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it.each([
    ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
    ["Proxy-Authorization: Basic cHJveHk6c2VjcmV0", "cHJveHk6c2VjcmV0"],
    [
      'Authorization: Digest username="synthetic", response="deadbeefcafebabe"',
      "deadbeefcafebabe",
    ],
  ])("redacts synthetic credential values in %s", (header, value) => {
    const sanitized = sanitizeFeedbackText(`diagnostic: ${header}`);
    expect(sanitized).not.toContain(value);
    expect(sanitized).toContain("[REDACTED_AUTHORIZATION]");
  });

  it.each([
    [
      "Authorization: Basic dXNlcjpwYXNz\r\n d29yZA==\nX-Trace: retained",
      "d29yZA==",
    ],
    [
      'Proxy-Authorization: Digest username="synthetic",\n\tresponse="cafebabe"\nX-Trace: retained',
      "cafebabe",
    ],
    [
      "Authorization: Basic dXNlcg==\r\tOnN5bnRoZXRpYw==\nX-Trace: retained",
      "OnN5bnRoZXRpYw==",
    ],
  ])("redacts synthetic folded HTTP auth header %s", (header, foldedValue) => {
    const sanitized = sanitizeFeedbackText(`diagnostic: ${header}`);
    expect(sanitized).not.toContain(foldedValue);
    expect(sanitized).toContain("[REDACTED_AUTHORIZATION]");
    expect(sanitized).toContain("X-Trace: retained");
  });

  it.each([
    [
      "Authorization:\r\n Basic c3ludGhldGlj\nX-Trace: retained",
      "c3ludGhldGlj",
    ],
    [
      "Authorization:   \n\tBasic dGVzdC1vbmx5\nX-Trace: retained",
      "dGVzdC1vbmx5",
    ],
    [
      'Proxy-Authorization:\r Digest response="cafecafe"\nX-Trace: retained',
      "cafecafe",
    ],
  ])(
    "redacts auth headers with an empty first value line: %s",
    (header, value) => {
      const sanitized = sanitizeFeedbackText(`diagnostic: ${header}`);
      expect(sanitized).not.toContain(value);
      expect(sanitized).toContain("[REDACTED_AUTHORIZATION]");
      expect(sanitized).toContain("X-Trace: retained");
    },
  );

  it.each([
    ["password", "synthetic-password-private-001"],
    ["access_token", "synthetic-access-token-private-002"],
    ["refresh_token", "synthetic-refresh-token-private-003"],
    ["apiKey", "synthetic-api-key-private-004"],
    ["clientSecret", "synthetic-client-secret-private-005"],
  ])(
    "redacts quoted JSON credential field %s without losing safe metadata",
    (key, value) => {
      const text = `report: {"${key}":"${value}","requestId":"request-99"}`;
      const sanitized = sanitizeFeedbackText(text);
      expect(sanitized).not.toContain(value);
      expect(sanitized).toContain(`"${key}":"[REDACTED_SECRET]"`);
      expect(sanitized).toContain('"requestId":"request-99"');
    },
  );

  it("fails closed for invalid JSON key escapes without removing safe metadata", () => {
    const raw =
      '{"access_token\\q":"synthetic-malformed-key-private","requestId":"request-kept"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("synthetic-malformed-key-private");
    expect(sanitized).toContain('"access_token\\q":"[REDACTED_SECRET]"');
    expect(sanitized).toContain('"requestId":"request-kept"');
  });

  it("redacts JSON credential keys encoded with Unicode escapes", () => {
    const raw =
      '{"access\\u005ftoken":"synthetic-escaped-key-secret","requestId":"request-escaped"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("synthetic-escaped-key-secret");
    expect(sanitized).toContain('"access\\u005ftoken":"[REDACTED_SECRET]"');
    expect(sanitized).toContain('"requestId":"request-escaped"');
  });

  it("redacts escaped JSON credential strings without leaking a suffix", () => {
    const raw =
      '{"access_token":"synthetic-head\\"synthetic-tail","status":"ok"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("synthetic-head");
    expect(sanitized).not.toContain("synthetic-tail");
    expect(sanitized).toContain('"access_token":"[REDACTED_SECRET]"');
    expect(sanitized).toContain('"status":"ok"');
  });

  it("redacts JSON credentials before the user case repository call", async () => {
    const secret = "synthetic-private-credential-value";
    let forwarded: { description: string } | undefined;
    const repo = {
      createCase: async (input: { description: string }) => {
        forwarded = input;
        throw new Error("SYNTHETIC_REPOSITORY_SENTINEL");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repo);
    await expect(
      service.createCase("00000000-0000-4000-8000-000000000001", {
        accountId: "00000000-0000-4000-8000-000000000002",
        category: "OTHER",
        description: `support: {"access_token":"${secret}","requestId":"r-1"}`,
      }),
    ).rejects.toThrow("SYNTHETIC_REPOSITORY_SENTINEL");
    expect(forwarded?.description).not.toContain(secret);
    expect(forwarded?.description).toContain(
      '"access_token":"[REDACTED_SECRET]"',
    );
    expect(forwarded?.description).toContain('"requestId":"r-1"');
  });

  it("keeps ordinary support text that is not an auth header", () => {
    expect(sanitizeFeedbackText("authorization failed for test browser")).toBe(
      "authorization failed for test browser",
    );
  });

  it("accepts only the safe diagnostic allowlist", () => {
    expect(
      sanitizeDiagnostics({
        productVersion: "0.2.4",
        extensionVersion: "0.2.4",
        browserFamily: "opera",
        requestId: "request-1",
      }),
    ).toEqual({
      productVersion: "0.2.4",
      extensionVersion: "0.2.4",
      browserFamily: "opera",
      requestId: "request-1",
    });
    expect(sanitizeDiagnostics({ storageState: "forbidden" })).toBeNull();
    expect(sanitizeDiagnostics({ reportBody: "forbidden" })).toBeNull();
    expect(sanitizeDiagnostics({ cookies: "forbidden" })).toBeNull();
  });

  it("keeps retention configurable with reversible defaults", () => {
    expect(retentionConfig({})).toEqual({ closedDays: 90, signalDays: 180 });
    expect(
      retentionConfig({
        FEEDBACK_CLOSED_RETENTION_DAYS: "30",
        FEEDBACK_SIGNAL_RETENTION_DAYS: "365",
      }),
    ).toEqual({ closedDays: 30, signalDays: 365 });
    expect(() =>
      retentionConfig({ FEEDBACK_CLOSED_RETENTION_DAYS: "0" }),
    ).toThrow();
  });

  it("never forwards invalid or empty case text to the repository", async () => {
    const calls: unknown[] = [];
    const repository = {
      createCase: async (input: unknown) => {
        calls.push(input);
        throw new Error("should not be called");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    expect(
      await service.createCase("00000000-0000-4000-8000-000000000001", {
        accountId: "00000000-0000-4000-8000-000000000002",
        category: "OTHER",
        description: "   \u0000   ",
      }),
    ).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(calls).toHaveLength(0);
  });

  it("does not let public clients forge server-generated feedback aggregates", async () => {
    let event: string | undefined;
    const repository = {
      recordSignal: async (input: { body: { event: string } }) => {
        event = input.body.event;
        return "ACCEPTED" as const;
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    expect(
      await service.recordSignal("00000000-0000-4000-8000-000000000001", {
        event: "feedback_case_created",
      }),
    ).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(event).toBeUndefined();
    expect(
      await service.recordSignal("00000000-0000-4000-8000-000000000001", {
        event: "first_start",
        accountId: "00000000-0000-4000-8000-000000000002",
        idempotencyKey: "first-start-test-0001",
        productVersion: "0.2.4",
      }),
    ).toEqual({ ok: true, value: { accepted: true } });
    expect(event).toBe("first_start");
  });
});
