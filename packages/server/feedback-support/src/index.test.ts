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
    [
      "bare object",
      'diagnostic password: { credential: "SYNTHETIC_B06_PRIVATE_OBJECT_01", note: "visible" }',
      "SYNTHETIC_B06_PRIVATE_OBJECT_01",
    ],
    [
      "bare array",
      'diagnostic token = [ "SYNTHETIC_B06_PRIVATE_ARRAY_02", "visible" ]',
      "SYNTHETIC_B06_PRIVATE_ARRAY_02",
    ],
    [
      "nested object",
      'diagnostic password: { nested: { value: "SYNTHETIC_B06_PRIVATE_NESTED_03" } }',
      "SYNTHETIC_B06_PRIVATE_NESTED_03",
    ],
    [
      "multiline object",
      'diagnostic clientSecret: {\n  credential: "SYNTHETIC_B06_PRIVATE_MULTILINE_04"\n}',
      "SYNTHETIC_B06_PRIVATE_MULTILINE_04",
    ],
    [
      "embedded JSON string",
      '{"message":"diagnostic password: { credential: \\"SYNTHETIC_B06_PRIVATE_EMBEDDED_05\\" }","requestId":"safe-id-05"}',
      "SYNTHETIC_B06_PRIVATE_EMBEDDED_05",
    ],
  ])(
    "fails closed on bare object/array credential diagnostics: %s",
    (_kind, input, canary) => {
      const redacted = sanitizeFeedbackText(input);
      expect(redacted).toBe("[REDACTED_SECRET]");
      expect(redacted).not.toContain(canary);
    },
  );

  it("does not discard nonsensitive bare structures or valid quoted JSON siblings", () => {
    const safe = 'diagnostic labels: { mode: "normal", values: ["one"] }';
    expect(sanitizeFeedbackText(safe)).toBe(safe);
    const valid =
      '{"password":{"credential":"SYNTHETIC_B06_QUOTED_PRIVATE_06"},"requestId":"safe-06"}';
    expect(JSON.parse(sanitizeFeedbackText(valid))).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-06",
    });
  });

  it.each([
    [
      "ZWSP after colon",
      "diagnostic password: \u200B{ credential: 'SYNTH_B06_UNICODE_PRIVATE_01' }",
      "SYNTH_B06_UNICODE_PRIVATE_01",
    ],
    [
      "word joiner after colon",
      "diagnostic token: \u2060[ 'SYNTH_B06_UNICODE_PRIVATE_02' ]",
      "SYNTH_B06_UNICODE_PRIVATE_02",
    ],
    [
      "ZWSP before colon",
      "diagnostic password\u200B: { credential: 'SYNTH_B06_UNICODE_PRIVATE_03' }",
      "SYNTH_B06_UNICODE_PRIVATE_03",
    ],
    [
      "word joiner before equals",
      "diagnostic apiKey\u2060= { credential: 'SYNTH_B06_UNICODE_PRIVATE_04' }",
      "SYNTH_B06_UNICODE_PRIVATE_04",
    ],
    [
      "ZWNJ after colon",
      "diagnostic clientSecret: \u200C{ credential: 'SYNTH_B06_UNICODE_PRIVATE_05' }",
      "SYNTH_B06_UNICODE_PRIVATE_05",
    ],
    [
      "ZWJ before colon",
      "diagnostic accessToken\u200D: [ 'SYNTH_B06_UNICODE_PRIVATE_06' ]",
      "SYNTH_B06_UNICODE_PRIVATE_06",
    ],
    [
      "ZWSP inside key",
      "diagnostic pass\u200Bword: { credential: 'SYNTH_B06_UNICODE_PRIVATE_07' }",
      "SYNTH_B06_UNICODE_PRIVATE_07",
    ],
    [
      "word joiner inside key",
      "diagnostic to\u2060ken: [ 'SYNTH_B06_UNICODE_PRIVATE_08' ]",
      "SYNTH_B06_UNICODE_PRIVATE_08",
    ],
    [
      "hyphenated api-key",
      "diagnostic api-key: { credential: 'SYNTH_B06_DASH_PRIVATE_01' }",
      "SYNTH_B06_DASH_PRIVATE_01",
    ],
    [
      "hyphenated api-key with zero-width joiner",
      "diagnostic api-\u200Bkey: { credential: 'SYNTH_B06_DASH_PRIVATE_02' }",
      "SYNTH_B06_DASH_PRIVATE_02",
    ],
  ])(
    "fails closed on zero-width credential structure %s",
    (_kind, text, canary) => {
      const redacted = sanitizeFeedbackText(text);
      expect(redacted).toBe("[REDACTED_SECRET]");
      expect(redacted).not.toContain(canary);
    },
  );

  it("preserves Unicode joiners in ordinary noncredential text and valid JSON", () => {
    const ordinary = "Описание: обычный\u200Cтекст";
    const noncredential = "diagnostic note: \u200B{ value: 'safe-text' }";
    expect(sanitizeFeedbackText(ordinary)).toBe(ordinary);
    expect(sanitizeFeedbackText(noncredential)).toBe(noncredential);
    const valid =
      '{"password":{"credential":"SYNTH_B06_UNICODE_PRIVATE_09"},"requestId":"safe-09"}';
    expect(JSON.parse(sanitizeFeedbackText(valid))).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-09",
    });
  });

  it.each([
    [
      "quoted JSON password with zero-width space",
      '{"pass\u200Bword":{"credential":"SYNTH_B06_QUOTED_PRIVATE_01"},"requestId":"safe-01"}',
      "pass\u200Bword",
      "SYNTH_B06_QUOTED_PRIVATE_01",
      "safe-01",
    ],
    [
      "quoted JSON API key with word joiner",
      '{"api\u2060Key":["SYNTH_B06_QUOTED_PRIVATE_02"],"requestId":"safe-02"}',
      "api\u2060Key",
      "SYNTH_B06_QUOTED_PRIVATE_02",
      "safe-02",
    ],
    [
      "quoted JSON token with zero-width non-joiner",
      '{"to\u200Cken":{"nested":"SYNTH_B06_QUOTED_PRIVATE_03"},"requestId":"safe-03"}',
      "to\u200Cken",
      "SYNTH_B06_QUOTED_PRIVATE_03",
      "safe-03",
    ],
    [
      "JSON-escaped invisible character in API key",
      '{"api\\u200BKey":{"value":"SYNTH_B06_QUOTED_PRIVATE_04"},"requestId":"safe-04"}',
      "api\u200BKey",
      "SYNTH_B06_QUOTED_PRIVATE_04",
      "safe-04",
    ],
  ])(
    "redacts invisible characters inside quoted secret keys: %s",
    (_kind, original, key, canary, requestId) => {
      const cleaned = sanitizeFeedbackText(original);
      expect(cleaned).not.toContain(canary);
      expect(JSON.parse(cleaned)).toEqual({
        [key]: "[REDACTED_SECRET]",
        requestId,
      });
    },
  );

  it("redacts a zero-width secret key inside single-quoted pseudo-JSON", () => {
    const raw =
      "diagnostic 'pass\u200Bword': { credential: 'SYNTH_B06_QUOTED_PRIVATE_05' }";
    const cleaned = sanitizeFeedbackText(raw);
    expect(cleaned).not.toContain("SYNTH_B06_QUOTED_PRIVATE_05");
    expect(cleaned).toContain("[REDACTED_SECRET]");
  });

  it.each([
    ['{"api key":"SYNTH_SPACE_01","requestId":"safe"}', "string"],
    ['{"api key":{"value":"SYNTH_SPACE_02"},"requestId":"safe"}', "nested"],
    ['{"api\\u0020key":["SYNTH_SPACE_03"],"requestId":"safe"}', "escaped"],
  ])("redacts spaced quoted API key (%s)", (raw) => {
    expect(JSON.parse(sanitizeFeedbackText(raw))).toEqual({
      "api key": "[REDACTED_SECRET]",
      requestId: "safe",
    });
  });

  it.each([
    "diagnostic API key: SYNTH_SPACE_04",
    "diagnostic api key: { value: 'SYNTH_SPACE_05' }",
    "diagnostic api key: 'SYNTH_SPACE_06\nSYNTH_SPACE_06_TAIL'",
  ])("fails closed on spaced bare API key", (raw) => {
    expect(sanitizeFeedbackText(raw)).toBe("[REDACTED_SECRET]");
  });

  it.each([
    ["ZWSP between words", "diagnostic api \u200Bkey: SYNTH_SPACED_DI_01"],
    ["ZWSP after API", "diagnostic api\u200B key: SYNTH_SPACED_DI_02"],
    ["word joiner", "diagnostic api\u2060 key: SYNTH_SPACED_DI_03"],
    ["soft hyphen inside key", "diagnostic api k\u00ADey: SYNTH_SPACED_DI_04"],
    ["no-break space", "diagnostic api\u00A0key: SYNTH_SPACED_DI_05"],
    ["thin space", "diagnostic api\u2009key: SYNTH_SPACED_DI_06"],
    ["raw CR", "diagnostic api\rkey: SYNTH_SPACED_DI_07"],
    ["raw LF", "diagnostic api\nkey: SYNTH_SPACED_DI_08"],
    ["fullwidth colon", "diagnostic api key： SYNTH_SPACED_DI_09"],
  ])(
    "fails closed on Unicode or multiline bare spaced API key: %s",
    (_case, raw) => {
      expect(sanitizeFeedbackText(raw)).toBe("[REDACTED_SECRET]");
    },
  );

  it("redacts Unicode-spaced API keys at all feedback persistence boundaries", async () => {
    const captured: string[] = [];
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        captured.push(input.description, input.body.description);
        throw new Error("SYNTH_DI_CASE_CAPTURE");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        captured.push(input.body);
        throw new Error("SYNTH_DI_FOLLOWUP_CAPTURE");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const raw = "api \u200Bkey: { value: 'SYNTH_DI_REPOSITORY_PRIVATE' }";
    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: raw,
      }),
    ).rejects.toThrow("SYNTH_DI_CASE_CAPTURE");
    await expect(
      service.addUserFollowup(userId, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_DI_FOLLOWUP_CAPTURE");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_DI_FOLLOWUP_CAPTURE");
    expect(captured).toEqual(Array(4).fill("[REDACTED_SECRET]"));
    for (const field of captured) {
      expect(field).not.toContain("SYNTH_DI_REPOSITORY_PRIVATE");
    }
  });

  it.each([
    [
      "quoted JSON NBSP",
      '{"api\u00A0key":"SYNTH_B06_QUOTED_UW_01","requestId":"safe"}',
      "api\u00A0key",
      "SYNTH_B06_QUOTED_UW_01",
    ],
    [
      "quoted JSON THIN",
      '{"api\u2009key":"SYNTH_B06_QUOTED_UW_02","requestId":"safe"}',
      "api\u2009key",
      "SYNTH_B06_QUOTED_UW_02",
    ],
    [
      "JSON escaped NBSP",
      '{"api\\u00a0key":"SYNTH_B06_QUOTED_UW_03","requestId":"safe"}',
      "api\u00A0key",
      "SYNTH_B06_QUOTED_UW_03",
    ],
    [
      "nested JSON NBSP",
      '{"api\u00A0key":{"value":"SYNTH_B06_QUOTED_UW_04"},"requestId":"safe"}',
      "api\u00A0key",
      "SYNTH_B06_QUOTED_UW_04",
    ],
    [
      "mixed Unicode/DICP/dash",
      '{"api \u200B-\u2009key":"SYNTH_B06_QUOTED_UW_05","requestId":"safe"}',
      "api \u200B-\u2009key",
      "SYNTH_B06_QUOTED_UW_05",
    ],
  ])(
    "redacts quoted spaced API credentials and preserves safe siblings: %s",
    (_label, input, key, secret) => {
      const result = sanitizeFeedbackText(input);
      expect(result).not.toContain(secret);
      expect(JSON.parse(result)).toEqual({
        [key]: "[REDACTED_SECRET]",
        requestId: "safe",
      });
    },
  );

  it("redacts pseudo-JSON spaced NBSP credentials and preserves benign labels", () => {
    const sensitive = "diagnostic 'api\u00A0key': 'SYNTH_B06_PSEUDO_UW_06'";
    const output = sanitizeFeedbackText(sensitive);
    expect(output).toContain("[REDACTED_SECRET]");
    expect(output).not.toContain("SYNTH_B06_PSEUDO_UW_06");
    const harmlessJson =
      '{"api\u2009label":"SYNTH_B06_SAFE_UW_07","requestId":"safe"}';
    const harmlessPseudo =
      "diagnostic 'api\u00A0label': 'SYNTH_B06_SAFE_UW_08'";
    expect(sanitizeFeedbackText(harmlessJson)).toBe(harmlessJson);
    expect(sanitizeFeedbackText(harmlessPseudo)).toBe(harmlessPseudo);
  });

  it("never persists Unicode-spaced quoted or pseudo-JSON secrets through the four feedback sinks", async () => {
    const captured: string[] = [];
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        captured.push(input.description, input.body.description);
        throw new Error("SYNTH_UW_CASE_CAPTURE");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        captured.push(input.body);
        throw new Error("SYNTH_UW_FOLLOWUP_CAPTURE");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const inputs = [
      [
        '{"api\u00A0key":"SYNTH_UW_SINK_01","requestId":"safe"}',
        "SYNTH_UW_SINK_01",
      ],
      [
        '{"api\u2009key":{"value":"SYNTH_UW_SINK_02"},"requestId":"safe"}',
        "SYNTH_UW_SINK_02",
      ],
      [
        '{"api\\u00a0key":["SYNTH_UW_SINK_03"],"requestId":"safe"}',
        "SYNTH_UW_SINK_03",
      ],
      ["diagnostic 'api\u00A0key': 'SYNTH_UW_SINK_04'", "SYNTH_UW_SINK_04"],
      [
        '{"api \u200B-\u2009key":"SYNTH_UW_SINK_05","requestId":"safe"}',
        "SYNTH_UW_SINK_05",
      ],
    ] as const;
    for (const [raw, secret] of inputs) {
      const prior = captured.length;
      await expect(
        service.createCase(userId, {
          accountId,
          category: "OTHER",
          description: raw,
        }),
      ).rejects.toThrow("SYNTH_UW_CASE_CAPTURE");
      await expect(
        service.addUserFollowup(userId, caseId, { description: raw }),
      ).rejects.toThrow("SYNTH_UW_FOLLOWUP_CAPTURE");
      await expect(
        service.addAdminFollowup("SUPPORT", userId, caseId, {
          description: raw,
        }),
      ).rejects.toThrow("SYNTH_UW_FOLLOWUP_CAPTURE");
      const stored = captured.slice(prior);
      expect(stored).toHaveLength(4);
      for (const value of stored) {
        expect(value).not.toContain(secret);
        expect(value).toContain("[REDACTED_SECRET]");
        if (raw.startsWith("{")) {
          expect(JSON.parse(value).requestId).toBe("safe");
        }
      }
    }
  });

  it("preserves ordinary API labels and masks pseudo-JSON spaced keys", () => {
    const safe = "diagnostic api label: { value: 'SYNTH_SAFE_07' }";
    expect(sanitizeFeedbackText(safe)).toBe(safe);
    const raw = "diagnostic 'api key': { value: 'SYNTH_SPACE_08' }";
    expect(sanitizeFeedbackText(raw)).toContain("[REDACTED_SECRET]");
    expect(sanitizeFeedbackText(raw)).not.toContain("SYNTH_SPACE_08");
  });

  it("redacts spaced API keys before case and followup repository writes", async () => {
    const captured: string[] = [];
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        captured.push(input.description, input.body.description);
        throw new Error("SYNTH_SPACED_CASE_CAPTURE");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        captured.push(input.body);
        throw new Error("SYNTH_SPACED_FOLLOWUP_CAPTURE");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const raw = "api key: { value: 'SYNTH_SPACED_PERSIST_SECRET' }";
    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: raw,
      }),
    ).rejects.toThrow("SYNTH_SPACED_CASE_CAPTURE");
    await expect(
      service.addUserFollowup(userId, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_SPACED_FOLLOWUP_CAPTURE");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_SPACED_FOLLOWUP_CAPTURE");
    expect(captured).toEqual(Array(4).fill("[REDACTED_SECRET]"));
    expect(captured.join("|")).not.toContain("SYNTH_SPACED_PERSIST_SECRET");
  });

  it.each([
    [
      "CGJ bare object",
      "diagnostic pass\u034Fword: { value: 'SYNTH_DICP_PRIVATE_01' }",
      "SYNTH_DICP_PRIVATE_01",
      null,
    ],
    [
      "soft hyphen quoted JSON",
      '{"pass\u00ADword":{"value":"SYNTH_DICP_PRIVATE_02"},"requestId":"safe"}',
      "SYNTH_DICP_PRIVATE_02",
      "pass\u00ADword",
    ],
    [
      "VS16 bare array",
      "diagnostic to\uFE0Fken: ['SYNTH_DICP_PRIVATE_03']",
      "SYNTH_DICP_PRIVATE_03",
      null,
    ],
    [
      "RLO quoted JSON",
      '{"api\u202EKey":{"value":"SYNTH_DICP_PRIVATE_04"},"requestId":"safe"}',
      "SYNTH_DICP_PRIVATE_04",
      "api\u202EKey",
    ],
    [
      "BOM bare object",
      "diagnostic pass\uFEFFword: { value: 'SYNTH_DICP_PRIVATE_05' }",
      "SYNTH_DICP_PRIVATE_05",
      null,
    ],
    [
      "CGJ bare scalar",
      "diagnostic pass\u034Fword: SYNTH_DICP_PRIVATE_06",
      "SYNTH_DICP_PRIVATE_06",
      null,
    ],
    [
      "RLO bare quoted multiline",
      "diagnostic pass\u202Eword: 'SYNTH_DICP_PRIVATE_HEAD_07\nSYNTH_DICP_PRIVATE_TAIL_07'",
      "SYNTH_DICP_PRIVATE_TAIL_07",
      null,
    ],
  ])(
    "redacts default-ignorable secret key %s",
    (_kind, raw, marker, jsonKey) => {
      const redacted = sanitizeFeedbackText(raw);
      expect(redacted).not.toContain(marker);
      if (jsonKey === null) {
        expect(redacted).toBe("[REDACTED_SECRET]");
      } else {
        expect(JSON.parse(redacted)).toEqual({
          [jsonKey]: "[REDACTED_SECRET]",
          requestId: "safe",
        });
      }
    },
  );

  it("preserves default-ignorable characters in harmless text and JSON", () => {
    const ordinary =
      "diagnostic note\u034FKey: { value: 'SYNTH_DICP_SAFE_08' }";
    const valid =
      '{"note\u00ADLabel":{"value":"SYNTH_DICP_SAFE_09"},"requestId":"safe"}';
    expect(sanitizeFeedbackText(ordinary)).toBe(ordinary);
    expect(sanitizeFeedbackText(valid)).toBe(valid);
  });

  it("keeps default-ignorable secret values out of all feedback repository sinks", async () => {
    const captured: string[] = [];
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        captured.push(input.description, input.body.description);
        throw new Error("SYNTH_DICP_CASE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        captured.push(input.body);
        throw new Error("SYNTH_DICP_FOLLOWUP_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const user = "00000000-0000-4000-8000-000000000001";
    const account = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const raw =
      "diagnostic pass\u034Fword: { value: 'SYNTH_DICP_PERSIST_PRIVATE_10' }";
    await expect(
      service.createCase(user, {
        accountId: account,
        category: "OTHER",
        description: raw,
      }),
    ).rejects.toThrow("SYNTH_DICP_CASE_CAPTURED");
    await expect(
      service.addUserFollowup(user, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_DICP_FOLLOWUP_CAPTURED");
    await expect(
      service.addAdminFollowup("SUPPORT", user, caseId, { description: raw }),
    ).rejects.toThrow("SYNTH_DICP_FOLLOWUP_CAPTURED");
    expect(captured).toEqual(Array(4).fill("[REDACTED_SECRET]"));
    for (const value of captured)
      expect(value).not.toContain("SYNTH_DICP_PERSIST_PRIVATE_10");
  });

  it("preserves ordinary quoted keys with invisible Unicode joiners", () => {
    const safeJson =
      '{"note\u200BLabel":{"value":"SYNTH_B06_PUBLIC_SAFE_06"},"requestId":"safe-06"}';
    const safePseudo =
      "diagnostic 'note\u200BLabel': { value: 'SYNTH_B06_PUBLIC_SAFE_07' }";
    expect(sanitizeFeedbackText(safeJson)).toBe(safeJson);
    expect(sanitizeFeedbackText(safePseudo)).toBe(safePseudo);
  });

  it("never sends quoted invisible-key secrets through the case or followup repository", async () => {
    const forwarded: string[] = [];
    const repository = {
      createCase: async (input: {
        description: string;
        body: { description: string };
      }) => {
        forwarded.push(input.description, input.body.description);
        throw new Error("SYNTH_B06_CASE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        forwarded.push(input.body);
        throw new Error("SYNTH_B06_FOLLOWUP_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const description =
      "diagnostic 'pass\u200Bword': { credential: 'SYNTH_B06_BOUNDARY_PRIVATE_08' }";
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description,
      }),
    ).rejects.toThrow("SYNTH_B06_CASE_CAPTURED");
    await expect(
      service.addUserFollowup(userId, caseId, { description }),
    ).rejects.toThrow("SYNTH_B06_FOLLOWUP_CAPTURED");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, { description }),
    ).rejects.toThrow("SYNTH_B06_FOLLOWUP_CAPTURED");
    expect(forwarded).toEqual(
      Array(4).fill("diagnostic 'pass\u200Bword': '[REDACTED_SECRET]'"),
    );
    expect(JSON.stringify(forwarded)).not.toContain(
      "SYNTH_B06_BOUNDARY_PRIVATE_08",
    );
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

  it.each([
    [
      "JSON cookie string",
      '{"cookie":"SYNTHETIC_COOKIE_JSON_SECRET_01","requestId":"safe-cookie"}',
      "SYNTHETIC_COOKIE_JSON_SECRET_01",
      "safe-cookie",
    ],
    [
      "JSON Set-Cookie string",
      '{"setCookie":"SYNTHETIC_SET_COOKIE_SECRET_02","requestId":"safe-set"}',
      "SYNTHETIC_SET_COOKIE_SECRET_02",
      "safe-set",
    ],
    [
      "JSON password array",
      '{"password":["SYNTHETIC_PASSWORD_ARRAY_SECRET_03"],"requestId":"safe-array"}',
      "SYNTHETIC_PASSWORD_ARRAY_SECRET_03",
      "safe-array",
    ],
    [
      "nested JSON cookie object",
      '{"cookies":{"session":["SYNTHETIC_COOKIE_OBJECT_SECRET_04"]},"requestId":"safe-nested"}',
      "SYNTHETIC_COOKIE_OBJECT_SECRET_04",
      "safe-nested",
    ],
    [
      "nested JSON clientSecret object",
      '{"clientSecret":{"credential":{"value":"SYNTHETIC_CLIENT_OBJECT_SECRET_05"}},"requestId":"safe-client"}',
      "SYNTHETIC_CLIENT_OBJECT_SECRET_05",
      "safe-client",
    ],
    [
      "single-quoted diagnostic token array",
      "{'token':['SYNTHETIC_PSEUDO_ARRAY_SECRET_06'],'requestId':'safe-pseudo'}",
      "SYNTHETIC_PSEUDO_ARRAY_SECRET_06",
      "safe-pseudo",
    ],
  ])(
    "redacts JSON composite credential and cookie fields: %s",
    (_label, raw, secret, safe) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("[REDACTED_SECRET]");
      expect(sanitized).toContain(safe);
      if (raw.startsWith('{"'))
        expect(() => JSON.parse(sanitized)).not.toThrow();
    },
  );

  it("preserves a nonsensitive JSON array unchanged", () => {
    const raw = '{"labels":["safe-1","safe-2"],"requestId":"safe-3"}';
    expect(sanitizeFeedbackText(raw)).toBe(raw);
  });

  it("handles quoted delimiters inside sensitive structured values", () => {
    const raw = JSON.stringify({
      password: ['SYNTHETIC_BRACKET_SECRET_07 including ] } and " quote'],
      requestId: "safe-bracket",
    });
    expect(JSON.parse(sanitizeFeedbackText(raw))).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-bracket",
    });
  });

  it("masks multiple sensitive siblings but retains nonsensitive JSON arrays", () => {
    const raw = JSON.stringify({
      cookie: "SYNTHETIC_COOKIE_SECRET_08",
      labels: ["safe-label"],
      password: [{ token: "SYNTHETIC_PASSWORD_SECRET_09" }],
      requestId: "safe-multiple",
    });
    expect(JSON.parse(sanitizeFeedbackText(raw))).toEqual({
      cookie: "[REDACTED_SECRET]",
      labels: ["safe-label"],
      password: "[REDACTED_SECRET]",
      requestId: "safe-multiple",
    });
  });

  it("redacts a structured JSON key with escaped characters", () => {
    const raw =
      '{"pass\\u0077ord":["SYNTHETIC_ESCAPED_KEY_SECRET_10"],"requestId":"safe-escaped"}';
    expect(JSON.parse(sanitizeFeedbackText(raw))).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-escaped",
    });
  });

  it("fails closed on an unterminated credential array", () => {
    const raw = '{"password":["SYNTHETIC_TRUNCATED_ARRAY_SECRET_11"';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("SYNTHETIC_TRUNCATED_ARRAY_SECRET_11");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it("masks double-serialized diagnostic JSON while preserving safe metadata", () => {
    const raw = JSON.stringify({
      error: JSON.stringify({
        password: ["SYNTHETIC_EMBEDDED_PASSWORD_101"],
        trace: "safe-trace-101",
      }),
      requestId: "safe-outer-101",
    });
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("SYNTHETIC_EMBEDDED_PASSWORD_101");
    const parsed = JSON.parse(sanitized);
    expect(parsed.requestId).toBe("safe-outer-101");
    expect(JSON.parse(parsed.error)).toEqual({
      password: "[REDACTED_SECRET]",
      trace: "safe-trace-101",
    });
  });

  it("masks pasted JSON cookie within a JSON text field without dropping other fields", () => {
    const raw = JSON.stringify({
      message:
        "Error: " + JSON.stringify({ cookie: "SYNTHETIC_PASTED_COOKIE_102" }),
      requestId: "safe-outer-102",
    });
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("SYNTHETIC_PASTED_COOKIE_102");
    const parsed = JSON.parse(sanitized);
    expect(parsed.requestId).toBe("safe-outer-102");
    expect(parsed.message).toContain("[REDACTED_SECRET]");
  });

  it("redacts multiple nested serializations without leaking a credential", () => {
    let embedded = JSON.stringify({
      password: ["SYNTHETIC_TRIPLE_JSON_SECRET_104"],
    });
    for (let depth = 0; depth < 3; depth++) {
      embedded = JSON.stringify({
        message: embedded,
        requestId: "safe-nested-104",
      });
    }
    const sanitized = sanitizeFeedbackText(embedded);
    expect(sanitized).not.toContain("SYNTHETIC_TRIPLE_JSON_SECRET_104");
    expect(JSON.parse(sanitized).requestId).toBe("safe-nested-104");
  });

  it("keeps a large integer lexical value intact while redacting an embedded credential", () => {
    const raw =
      '{"count":9007199254740993,"message":' +
      JSON.stringify(
        JSON.stringify({ password: ["SYNTHETIC_LARGE_INTEGER_SECRET_401"] }),
      ) +
      ',"requestId":"safe-numeric-401"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("SYNTHETIC_LARGE_INTEGER_SECRET_401");
    expect(sanitized).toContain('"count":9007199254740993');
    expect(sanitized).toContain('"requestId":"safe-numeric-401"');
  });

  it("retains deeply nested safe JSON content beyond the embedded-string depth limit", () => {
    let raw = '{"leaf":"safe-leaf-402"}';
    for (let depth = 0; depth < 30; depth++) {
      raw = '{"wrapper":' + raw + "}";
    }
    expect(sanitizeFeedbackText(raw)).toBe(raw);
  });

  it("preserves pseudo-JSON single quotes when masking structured secrets", () => {
    const raw =
      "{'password':['SYNTHETIC_PSEUDO_SECRET_403'],'requestId':'safe-pseudo-403'}";
    expect(sanitizeFeedbackText(raw)).toBe(
      "{'password':'[REDACTED_SECRET]','requestId':'safe-pseudo-403'}",
    );
  });

  it("does not alter harmless embedded JSON diagnostics", () => {
    const raw = JSON.stringify({
      detail: JSON.stringify({ count: 2, labels: ["safe-1", "safe-2"] }),
      requestId: "safe-outer-103",
    });
    expect(sanitizeFeedbackText(raw)).toBe(raw);
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

  it("keeps a separate safe line after a truncated numeric secret", () => {
    const raw = '{"password":123\nX-Trace: preserved';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("123");
    expect(sanitized).toContain("[REDACTED_SECRET]");
    expect(sanitized).toContain("X-Trace: preserved");
  });

  it("fails closed when an unterminated sensitive quote crosses a raw line break", () => {
    const raw = "{'clientSecret':'synthetic-line-secret\nX-Trace: preserved";
    // The content after the LF might be the credential itself. The parser
    // cannot prove a separate safe line without a terminating value quote.
    expect(sanitizeFeedbackText(raw)).toBe("[REDACTED_SECRET]");
  });

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
      // With a raw LF/CR inside an unterminated quoted credential, even an
      // apparent header-like continuation has no provably safe boundary.
      if (following) expect(sanitized).toBe("[REDACTED_SECRET]");
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

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
  ])(
    "masks the entire sensitive quoted JSON value containing an actual %s",
    (_label, linebreak) => {
      const raw =
        '{"password":"SYNTHETIC_MULTILINE_HEAD_501' +
        linebreak +
        'SYNTHETIC_MULTILINE_TAIL_502","requestId":"safe-multiline"}';
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain("SYNTHETIC_MULTILINE_HEAD_501");
      expect(sanitized).not.toContain("SYNTHETIC_MULTILINE_TAIL_502");
      expect(sanitized).toContain("[REDACTED_SECRET]");
    },
  );

  it.each(["cookie", "setCookie", "clientSecret", "access_token"])(
    "masks the raw-LF suffix of the sensitive %s field",
    (key) => {
      const raw =
        '{"' +
        key +
        '":"SYNTHETIC_MULTILINE_HEAD_503\nSYNTHETIC_MULTILINE_TAIL_504","requestId":"safe"}';
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).not.toContain("SYNTHETIC_MULTILINE_HEAD_503");
      expect(sanitized).not.toContain("SYNTHETIC_MULTILINE_TAIL_504");
      expect(sanitized).toContain("[REDACTED_SECRET]");
    },
  );

  it("masks a sensitive quoted value even if it never closes after raw LF", () => {
    const raw =
      '{"password":"SYNTHETIC_UNTERMINATED_HEAD_505\nSYNTHETIC_UNTERMINATED_TAIL_506';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).not.toContain("SYNTHETIC_UNTERMINATED_HEAD_505");
    expect(sanitized).not.toContain("SYNTHETIC_UNTERMINATED_TAIL_506");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it.each(["[ERROR] ", "[WARN] ", "[INFO] "])(
    "preserves a recognized harmless log-level prefix %s when the following JSON is verifiably safe",
    (prefix) => {
      const raw =
        prefix +
        '{"password":"SYNTHETIC_LOG_HEAD_521\nSYNTHETIC_LOG_TAIL_522","requestId":"safe-log-521"}';
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).toContain(prefix);
      expect(sanitized).toContain('"requestId":"safe-log-521"');
      expect(sanitized).not.toContain("SYNTHETIC_LOG_HEAD_521");
      expect(sanitized).not.toContain("SYNTHETIC_LOG_TAIL_522");
    },
  );

  it("does not treat an arbitrary malformed prefix as a trusted JSON boundary", () => {
    const raw =
      '[unknown] {"password":"SYNTHETIC_UNTRUSTED_HEAD_523\nSYNTHETIC_UNTRUSTED_TAIL_524","requestId":"safe"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).toBe("[REDACTED_SECRET]");
  });

  it("preserves a safe large-number lexeme in a verified multiline redaction", () => {
    const raw =
      '{"id":9007199254740993,"password":"SYNTHETIC_LONG_HEAD_525\nSYNTHETIC_LONG_TAIL_526"}';
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).toContain('"id":9007199254740993');
    expect(sanitized).not.toContain("SYNTHETIC_LONG_HEAD_525");
    expect(sanitized).not.toContain("SYNTHETIC_LONG_TAIL_526");
  });

  it("preserves harmless raw multiline feedback and valid escaped newlines", () => {
    const prose = "Support details on one line\nand useful details on the next";
    expect(sanitizeFeedbackText(prose)).toBe(prose);
    const benign = '{"note":"safe-first\nsafe-second","requestId":"safe-note"}';
    expect(sanitizeFeedbackText(benign)).toBe(benign);
    const credential = JSON.stringify({
      password: "SYNTHETIC_ESCAPED_HEAD_507\nSYNTHETIC_ESCAPED_TAIL_508",
      requestId: "safe-escaped",
    });
    const sanitized = sanitizeFeedbackText(credential);
    expect(sanitized).not.toContain("SYNTHETIC_ESCAPED_HEAD_507");
    expect(sanitized).not.toContain("SYNTHETIC_ESCAPED_TAIL_508");
    expect(JSON.parse(sanitized)).toEqual({
      password: "[REDACTED_SECRET]",
      requestId: "safe-escaped",
    });
  });

  it.each([
    ["LF", "\n", "password"],
    ["CR", "\r", "access_token"],
    ["CRLF", "\r\n", "clientSecret"],
  ])(
    "fails closed when a bare log-style %s credential contains a raw line break",
    (_kind, linebreak, key) => {
      const raw =
        "[WARN] " +
        key +
        ': "SYNTHETIC_BARE_CREDENTIAL_HEAD_601' +
        linebreak +
        'SYNTHETIC_BARE_CREDENTIAL_TAIL_602" requestId=safe';
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).toBe("[REDACTED_SECRET]");
      expect(sanitized).not.toContain("SYNTHETIC_BARE_CREDENTIAL_HEAD_601");
      expect(sanitized).not.toContain("SYNTHETIC_BARE_CREDENTIAL_TAIL_602");
    },
  );

  it.each([
    [
      "unterminated double quote",
      'password: "SYNTHETIC_BARE_QUOTE_HEAD_701 SYNTHETIC_BARE_QUOTE_TAIL_702',
    ],
    [
      "unterminated single quote",
      "access_token = 'SYNTHETIC_BARE_QUOTE_HEAD_703 SYNTHETIC_BARE_QUOTE_TAIL_704",
    ],
    [
      "quoted whitespace",
      'clientSecret: "SYNTHETIC_BARE_QUOTE_HEAD_705 SYNTHETIC_BARE_QUOTE_TAIL_706" requestId=safe',
    ],
    [
      "quoted comma",
      'password: "SYNTHETIC_BARE_QUOTE_HEAD_707,SYNTHETIC_BARE_QUOTE_TAIL_708" requestId=safe',
    ],
    [
      "quoted semicolon",
      'token: "SYNTHETIC_BARE_QUOTE_HEAD_709;SYNTHETIC_BARE_QUOTE_TAIL_710" requestId=safe',
    ],
  ])(
    "fails closed on a %s credential whose value could be partially masked",
    (_case, raw) => {
      const sanitized = sanitizeFeedbackText(raw);
      expect(sanitized).toBe("[REDACTED_SECRET]");
      expect(sanitized).not.toContain("SYNTHETIC_BARE_QUOTE_HEAD_");
      expect(sanitized).not.toContain("SYNTHETIC_BARE_QUOTE_TAIL_");
    },
  );

  it.each([
    [
      "log-escaped opening double quote with LF",
      'password: \\"SYNTHETIC_UNSAFE_HEAD_821\nSYNTHETIC_UNSAFE_TAIL_822\\"',
    ],
    [
      "log-escaped opening single quote with CR",
      "access_token = \\'SYNTHETIC_UNSAFE_HEAD_823\rSYNTHETIC_UNSAFE_TAIL_824\\'",
    ],
    [
      "non-breaking space after delimiter",
      'clientSecret:\u00a0"SYNTHETIC_UNSAFE_HEAD_825\nSYNTHETIC_UNSAFE_TAIL_826"',
    ],
    [
      "non-breaking space before and after delimiter",
      'password\u00a0:\u00a0"SYNTHETIC_UNSAFE_HEAD_827\r\nSYNTHETIC_UNSAFE_TAIL_828"',
    ],
  ])("fails closed for a %s sensitive value", (_case, raw) => {
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).toBe("[REDACTED_SECRET]");
    expect(sanitized).not.toContain("SYNTHETIC_UNSAFE_HEAD_");
    expect(sanitized).not.toContain("SYNTHETIC_UNSAFE_TAIL_");
  });

  it.each([
    [
      "LF between delimiter and opening quote",
      'password:\n"SYNTHETIC_PREFIX_HEAD_841\nSYNTHETIC_PREFIX_TAIL_842"',
    ],
    [
      "CR before the delimiter",
      'access_token\r=\r"SYNTHETIC_PREFIX_HEAD_843\rSYNTHETIC_PREFIX_TAIL_844"',
    ],
    [
      "long key with sensitive suffix",
      "x".repeat(100) +
        '_password: "SYNTHETIC_PREFIX_HEAD_845\nSYNTHETIC_PREFIX_TAIL_846"',
    ],
  ])("fails closed on a %s in a bare credential", (_case, raw) => {
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).toBe("[REDACTED_SECRET]");
    expect(sanitized).not.toContain("SYNTHETIC_PREFIX_HEAD_");
    expect(sanitized).not.toContain("SYNTHETIC_PREFIX_TAIL_");
  });

  it.each([
    [
      "ZWSP before delimiter",
      'diagnostic password\u200B: "SYNTH_B06_JOINER_LF_HEAD_A\nSYNTH_B06_JOINER_LF_TAIL_A" requestId=safe',
    ],
    [
      "word joiner within key",
      'diagnostic pass\u2060word: "SYNTH_B06_JOINER_LF_HEAD_B\nSYNTH_B06_JOINER_LF_TAIL_B" requestId=safe',
    ],
    [
      "ZWNJ within hyphenated key",
      'diagnostic api\u200C-key: "SYNTH_B06_JOINER_LF_HEAD_C\rSYNTH_B06_JOINER_LF_TAIL_C" requestId=safe',
    ],
    [
      "ZWJ before equals",
      'diagnostic clientSecret\u200D= "SYNTH_B06_JOINER_LF_HEAD_D\nSYNTH_B06_JOINER_LF_TAIL_D" requestId=safe',
    ],
  ])("fails closed on invisible bare %s multiline credential", (_kind, raw) => {
    const sanitized = sanitizeFeedbackText(raw);
    expect(sanitized).toBe("[REDACTED_SECRET]");
    expect(sanitized).not.toContain("SYNTH_B06_JOINER_LF_HEAD_");
    expect(sanitized).not.toContain("SYNTH_B06_JOINER_LF_TAIL_");
  });

  it("preserves noncredential joiner text with a multiline quoted value", () => {
    const safe =
      'diagnostic note\u200D: "ordinary first\nordinary second" requestId=safe';
    expect(sanitizeFeedbackText(safe)).toBe(safe);
  });

  it("preserves harmless bare-key multiline text and masks single-line credentials", () => {
    const safe = 'message: "safe first line\nsafe second line"';
    expect(sanitizeFeedbackText(safe)).toBe(safe);
    const credential = 'password: "SYNTHETIC_BARE_INLINE_603"';
    const sanitized = sanitizeFeedbackText(credential);
    expect(sanitized).not.toContain("SYNTHETIC_BARE_INLINE_603");
    expect(sanitized).toContain("[REDACTED_SECRET]");
  });

  it("passes only the sanitized description through both create-case repository fields", async () => {
    let forwarded: Parameters<FeedbackRepository["createCase"]>[0] | undefined;
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        forwarded = input;
        throw new Error("SYNTHETIC_SAFE_REPOSITORY_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const original =
      'password: "SYNTHETIC_RAW_BODY_HEAD_711 SYNTHETIC_RAW_BODY_TAIL_712"';
    await expect(
      service.createCase("00000000-0000-4000-8000-000000000001", {
        accountId: "00000000-0000-4000-8000-000000000002",
        category: "OTHER",
        description: original,
        diagnostics: { productVersion: "0.2.37" },
      }),
    ).rejects.toThrow("SYNTHETIC_SAFE_REPOSITORY_CAPTURED");
    expect(forwarded?.description).toBe("[REDACTED_SECRET]");
    expect(forwarded?.body.description).toBe("[REDACTED_SECRET]");
    expect(forwarded?.body.diagnostics).toEqual({
      productVersion: "0.2.37",
    });
    expect(forwarded?.body.diagnostics).toEqual(forwarded?.diagnostics);
    expect(JSON.stringify(forwarded)).not.toContain(
      "SYNTHETIC_RAW_BODY_HEAD_711",
    );
    expect(JSON.stringify(forwarded)).not.toContain(
      "SYNTHETIC_RAW_BODY_TAIL_712",
    );
  });

  it.each([
    [
      "zero-width before the delimiter",
      "diagnostic password\u200B: { credential: 'SYNTHETIC_B06_SINK_PRIVATE_01' }",
      "[REDACTED_SECRET]",
    ],
    [
      "word joiner after the delimiter",
      "diagnostic token: \u2060['SYNTHETIC_B06_SINK_PRIVATE_02']",
      "[REDACTED_SECRET]",
    ],
    [
      "zero-width within the credential key",
      "diagnostic pass\u200Bword: { credential: 'SYNTHETIC_B06_SINK_PRIVATE_03' }",
      "[REDACTED_SECRET]",
    ],
    [
      "word joiner inside multiline bare password before all writes",
      'diagnostic pass\u2060word: "SYNTHETIC_B06_SINK_PRIVATE_06\nSYNTHETIC_B06_SINK_PRIVATE_07" requestId=safe',
      "[REDACTED_SECRET]",
    ],
    [
      "harmless noncredential joiner",
      "diagnostic note: \u200B{ value: 'safe-text' }",
      "diagnostic note: \u200B{ value: 'safe-text' }",
    ],
    [
      "hyphenated api-key before case and followup writes",
      "diagnostic api-key: { credential: 'SYNTHETIC_B06_SINK_PRIVATE_04' }",
      "[REDACTED_SECRET]",
    ],
    [
      "zero-width within hyphenated api-key before case and followup writes",
      "diagnostic api-\u200Bkey: { credential: 'SYNTHETIC_B06_SINK_PRIVATE_05' }",
      "[REDACTED_SECRET]",
    ],
  ])(
    "masks %s before all support repository writes",
    async (_case, raw, expected) => {
      const forwarded: string[] = [];
      const repository = {
        createCase: async (
          input: Parameters<FeedbackRepository["createCase"]>[0],
        ) => {
          forwarded.push(input.description, input.body.description);
          throw new Error("SYNTHETIC_B06_SINK_CASE_CAPTURED");
        },
        getOwnCase: async () => ({}),
        addFollowup: async (
          input: Parameters<FeedbackRepository["addFollowup"]>[0],
        ) => {
          forwarded.push(input.body);
          throw new Error("SYNTHETIC_B06_SINK_FOLLOWUP_CAPTURED");
        },
      } as unknown as FeedbackRepository;
      const service = new FeedbackSupportService(repository);
      const userId = "00000000-0000-4000-8000-000000000001";
      const accountId = "00000000-0000-4000-8000-000000000002";
      const caseId = "00000000-0000-4000-8000-000000000003";
      await expect(
        service.createCase(userId, {
          accountId,
          category: "OTHER",
          description: raw,
        }),
      ).rejects.toThrow("SYNTHETIC_B06_SINK_CASE_CAPTURED");
      await expect(
        service.addUserFollowup(userId, caseId, { description: raw }),
      ).rejects.toThrow("SYNTHETIC_B06_SINK_FOLLOWUP_CAPTURED");
      await expect(
        service.addAdminFollowup("SUPPORT", userId, caseId, {
          description: raw,
        }),
      ).rejects.toThrow("SYNTHETIC_B06_SINK_FOLLOWUP_CAPTURED");
      expect(forwarded).toEqual([expected, expected, expected, expected]);
      if (expected === "[REDACTED_SECRET]") {
        expect(JSON.stringify(forwarded)).not.toContain(
          "SYNTHETIC_B06_SINK_PRIVATE_",
        );
      }
    },
  );

  it("never forwards a bare-key multiline credential to feedback case/followup sinks", async () => {
    const writes: string[] = [];
    const repo = {
      createCase: async (input: { description: string }) => {
        writes.push(input.description);
        throw new Error("SYNTHETIC_CASE_WRITE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        writes.push(input.body);
        throw new Error("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repo);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const text = 'password: "SYNTHETIC_BARE_HEAD_611\nSYNTHETIC_BARE_TAIL_612"';
    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: text,
      }),
    ).rejects.toThrow("SYNTHETIC_CASE_WRITE_CAPTURED");
    await expect(
      service.addUserFollowup(userId, caseId, { description: text }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, {
        description: text,
      }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
    expect(writes).toEqual([
      "[REDACTED_SECRET]",
      "[REDACTED_SECRET]",
      "[REDACTED_SECRET]",
    ]);
  });

  it.each([
    [
      "escaped opening quote",
      'password: \\"SYNTHETIC_SINK_HEAD_831\nSYNTHETIC_SINK_TAIL_832\\"',
    ],
    [
      "Unicode whitespace",
      'access_token:\u00a0"SYNTHETIC_SINK_HEAD_833\rSYNTHETIC_SINK_TAIL_834"',
    ],
    [
      "LF before quote",
      'password:\n"SYNTHETIC_SINK_HEAD_835\nSYNTHETIC_SINK_TAIL_836"',
    ],
    [
      "long suffix key",
      "z".repeat(100) +
        '_password: "SYNTHETIC_SINK_HEAD_837\nSYNTHETIC_SINK_TAIL_838"',
    ],
  ])("blocks %s secret in repository sinks", async (_case, text) => {
    const forwarded: string[] = [];
    const repository = {
      createCase: async (
        input: Parameters<FeedbackRepository["createCase"]>[0],
      ) => {
        forwarded.push(input.description, input.body.description);
        throw new Error("SYNTHETIC_CASE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        forwarded.push(input.body);
        throw new Error("SYNTHETIC_FOLLOWUP_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";

    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: text,
      }),
    ).rejects.toThrow("SYNTHETIC_CASE_CAPTURED");
    await expect(
      service.addUserFollowup(userId, caseId, { description: text }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_CAPTURED");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, {
        description: text,
      }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_CAPTURED");
    expect(forwarded).toEqual([
      "[REDACTED_SECRET]",
      "[REDACTED_SECRET]",
      "[REDACTED_SECRET]",
      "[REDACTED_SECRET]",
    ]);
  });

  it("masks raw LF/CR sensitive tails before all feedback repository writes", async () => {
    const captured: string[] = [];
    const repo = {
      createCase: async (input: { description: string }) => {
        captured.push(input.description);
        throw new Error("SYNTHETIC_CASE_WRITE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        captured.push(input.body);
        throw new Error("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repo);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";
    const rawLF =
      '{"password":"SYNTHETIC_CASE_HEAD_511\nSYNTHETIC_CASE_TAIL_512","requestId":"safe-511"}';
    const rawCR =
      '{"cookie":"SYNTHETIC_USER_HEAD_513\rSYNTHETIC_USER_TAIL_514","requestId":"safe-513"}';
    const rawAdmin =
      '{"clientSecret":"SYNTHETIC_ADMIN_HEAD_515\nSYNTHETIC_ADMIN_TAIL_516","requestId":"safe-515"}';
    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: rawLF,
      }),
    ).rejects.toThrow("SYNTHETIC_CASE_WRITE_CAPTURED");
    await expect(
      service.addUserFollowup(userId, caseId, { description: rawCR }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
    await expect(
      service.addAdminFollowup("SUPPORT", userId, caseId, {
        description: rawAdmin,
      }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_WRITE_CAPTURED");
    expect(captured).toHaveLength(3);
    for (const entry of captured) {
      expect(entry).not.toContain("SYNTHETIC_CASE_TAIL_512");
      expect(entry).not.toContain("SYNTHETIC_USER_TAIL_514");
      expect(entry).not.toContain("SYNTHETIC_ADMIN_TAIL_516");
      expect(entry).toContain("[REDACTED_SECRET]");
    }
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

  it("scrubs double-encoded JSON before both repository writes", async () => {
    const caseMarker = "SYNTHETIC_CASE_REPOSITORY_SECRET_201";
    const followupMarker = "SYNTHETIC_FOLLOWUP_REPOSITORY_SECRET_202";
    const persisted: string[] = [];
    const repository = {
      createCase: async (input: { description: string }) => {
        persisted.push(input.description);
        throw new Error("SYNTHETIC_CASE_CAPTURED");
      },
      getOwnCase: async () => ({}),
      addFollowup: async (input: { body: string }) => {
        persisted.push(input.body);
        throw new Error("SYNTHETIC_FOLLOWUP_CAPTURED");
      },
    } as unknown as FeedbackRepository;
    const service = new FeedbackSupportService(repository);
    const userId = "00000000-0000-4000-8000-000000000001";
    const accountId = "00000000-0000-4000-8000-000000000002";
    const caseId = "00000000-0000-4000-8000-000000000003";

    await expect(
      service.createCase(userId, {
        accountId,
        category: "OTHER",
        description: JSON.stringify({
          error: JSON.stringify({ password: [caseMarker] }),
          requestId: "safe-case-201",
        }),
      }),
    ).rejects.toThrow("SYNTHETIC_CASE_CAPTURED");
    await expect(
      service.addUserFollowup(userId, caseId, {
        description: JSON.stringify({
          message: "Error: " + JSON.stringify({ cookie: followupMarker }),
          requestId: "safe-followup-202",
        }),
      }),
    ).rejects.toThrow("SYNTHETIC_FOLLOWUP_CAPTURED");

    expect(persisted).toHaveLength(2);
    expect(persisted[0]).not.toContain(caseMarker);
    expect(persisted[0]).toContain("safe-case-201");
    expect(persisted[1]).not.toContain(followupMarker);
    expect(persisted[1]).toContain("safe-followup-202");
    expect(persisted.join(" ")).toContain("[REDACTED_SECRET]");
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
