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
