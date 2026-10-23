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

  it.each([
    [
      '{"password":123456,"requestId":"safe-101"}',
      "123456",
      '"requestId":"safe-101"',
    ],
    [
      '{"clientSecret":-12.5e3,"requestId":"safe-102"}',
      "-12.5e3",
      '"requestId":"safe-102"',
    ],
    [
      "{'access_token':'synthetic-private-B456','requestId':'safe-103'}",
      "synthetic-private-B456",
      "'requestId':'safe-103'",
    ],
    [
      "{'clientSecret':'synthetic-private-C789','requestId':'safe-104'}",
      "synthetic-private-C789",
      "'requestId':'safe-104'",
    ],
  ])(
    "redacts scalar or single-quoted diagnostic secret while preserving safe metadata: %s",
    (raw, secret, safe) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_SECRET]");
      expect(sanitized).toContain(safe);
    },
  );

  it("preserves valid JSON structure after masking numeric credential values", () => {
    const raw = '{"password":123456,"requestId":"safe-105"}';
    expect(JSON.parse(sanitizeFeedbackText(raw))).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-105",
    });
  });

  it("preserves both pseudo-JSON quote delimiters around a masked value", () => {
    const raw = "{'clientSecret':'synthetic-private-C789'}";
    expect(sanitizeFeedbackText(raw)).toBe(
      "{'clientSecret':'[REDACTED_SECRET]'}",
    );
  });

  it.each([
    [
      "{'access_token':123456,'requestId':'safe-301'}",
      "123456",
      "'requestId':'safe-301'",
    ],
    [
      "{'clientSecret':-12.5e3,'requestId':'safe-302'}",
      "-12.5e3",
      "'requestId':'safe-302'",
    ],
    [
      "{'password':true,'requestId':'safe-303'}",
      "true",
      "'requestId':'safe-303'",
    ],
    [
      "{'refresh_token':null,'requestId':'safe-304'}",
      "null",
      "'requestId':'safe-304'",
    ],
    [
      String.raw`{'access\u005ftoken':678901,'requestId':'safe-305'}`,
      "678901",
      "'requestId':'safe-305'",
    ],
  ])(
    "redacts single-quoted scalar credentials while preserving safe metadata: %s",
    (raw, secret, safe) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("'[REDACTED_SECRET]'");
      expect(sanitized).toContain(safe);
    },
  );

  it("preserves nonsensitive single-quoted scalar metadata unchanged", () => {
    const raw = "{'attempts':123,'requestId':'safe-306'}";
    expect(sanitizeFeedbackText(raw)).toBe(raw);
  });

  it.each([
    ['{"password":123', "123"],
    ["{'password':123", "123"],
    ['{"clientSecret":-12.5e3', "-12.5e3"],
    ["{'refresh_token':true", "true"],
    [
      '{"access_token":"synthetic-truncated-double',
      "synthetic-truncated-double",
    ],
    [
      "{'clientSecret':'synthetic-truncated-single",
      "synthetic-truncated-single",
    ],
  ])("redacts a secret in a truncated diagnostic field: %s", (raw, secret) => {
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it.each([
    '{"requestId":123',
    "{'attempts':123",
    '{"requestId":"safe-truncated-metadata',
    "{'requestId':'safe-truncated-metadata",
  ])("preserves a nonsensitive truncated field: %s", (raw) => {
    expect(sanitizeFeedbackText(raw)).toBe(raw);
  });

  it.each([
    ['{"password":123\nX-Trace: preserved', "123"],
    [
      "{'clientSecret':'synthetic-line-secret\nX-Trace: preserved",
      "synthetic-line-secret",
    ],
  ])(
    "redacts truncated line-scoped credentials without consuming the next line: %s",
    (raw, secret) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_SECRET]");
      expect(sanitized).toContain("X-Trace: preserved");
    },
  );

  it.each([
    [
      '{"password":\'synthetic-mixed-401\',"requestId":"safe-401"}',
      "synthetic-mixed-401",
      '"requestId":"safe-401"',
      ":'[REDACTED_SECRET]'",
    ],
    [
      "{'clientSecret':\"synthetic-mixed-402\",'requestId':'safe-402'}",
      "synthetic-mixed-402",
      "'requestId':'safe-402'",
      ':"[REDACTED_SECRET]"',
    ],
    [
      '{"access\\u005ftoken":\'synthetic-mixed-403\',"requestId":"safe-403"}',
      "synthetic-mixed-403",
      '"requestId":"safe-403"',
      ":'[REDACTED_SECRET]'",
    ],
  ])(
    "redacts mixed-quote diagnostic credentials without losing metadata: %s",
    (raw, secret, safe, quotedMarker) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain(safe);
      expect(sanitized).toContain(quotedMarker);
    },
  );

  it.each([
    "{'refresh_token':\"synthetic-mixed-404",
    '{"password":\'synthetic-mixed-405',
  ])("redacts truncated mixed-quote credentials: %s", (raw) => {
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("synthetic-mixed-");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it.each([
    [
      '{"password":"synthetic-dangling-double-' + "\\",
      "synthetic-dangling-double-",
      "",
    ],
    [
      "{'clientSecret':'synthetic-dangling-single-" + "\\",
      "synthetic-dangling-single-",
      "",
    ],
    [
      '{"access_token":"synthetic-dangling-line-' +
        "\\" +
        "\nX-Trace: preserved",
      "synthetic-dangling-line-",
      "X-Trace: preserved",
    ],
    [
      "{'refresh_token':\"synthetic-dangling-crlf-" +
        "\\" +
        "\r\nX-Request: safe",
      "synthetic-dangling-crlf-",
      "X-Request: safe",
    ],
  ])(
    "redacts a sensitive truncated quoted value with a final backslash: %s",
    (raw, secret, following) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_SECRET]");
      if (following) expect(sanitized).toContain(following);
    },
  );

  it("keeps safe mixed-quote metadata unchanged", () => {
    const raw = '{"requestId":\'safe-value\',"attempts":1}';
    expect(sanitizeFeedbackText(raw)).toBe(raw);
  });

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
