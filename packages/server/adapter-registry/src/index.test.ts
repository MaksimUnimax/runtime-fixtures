import { describe, expect, it } from "vitest";
import {
  AdapterKeySchema,
  AdapterProfileContentV1Schema,
  PROFILE_MAX_SERIALIZED_BYTES,
  ProfileCompatibilityConstraintsV1Schema,
  ProfileKeySchema,
  ProfileRevisionInputSchema,
  SurfaceKeySchema,
  VariantKeySchema,
  assertProfileRevisionTransition,
  profileRevisionFingerprint,
  validateProfileContent,
} from "./index.js";

const ids = {
  profile: "00000000-0000-4000-8000-000000000001",
  adapter: "00000000-0000-4000-8000-000000000002",
  surface: "00000000-0000-4000-8000-000000000003",
};
const primitive = {
  kind: "packaged_selector_reference" as const,
  reference: "composer-root" as const,
};
const plan = {
  strategy: "composer_root" as const,
  primary: primitive,
  fallbacks: [],
  timeoutMs: 1_000,
  observationMode: "polling" as const,
};
const content = {
  schemaVersion: "adapter_profile_v1" as const,
  page: {
    identityStrategy: "page_identity" as const,
    conversationStrategy: "conversation_root" as const,
    composerStrategy: "composer_root" as const,
  },
  selectors: {
    conversation: { ...plan, strategy: "conversation_root" as const },
    composer: plan,
    send: { ...plan, strategy: "send_control" as const },
    assistantResponse: { ...plan, strategy: "assistant_response" as const },
  },
  observation: { mode: "polling" as const, intervalMs: 100 },
  contours: [
    {
      key: "page_identity" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "page_identity" as const,
    },
    {
      key: "conversation_root" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "conversation_root" as const,
    },
    {
      key: "composer_root" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "composer_root" as const,
    },
    {
      key: "send_control" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "send_control" as const,
    },
  ],
};
const compatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome", "yandex_chromium"] as const,
  minimumBrowserVersions: [
    { browserFamily: "chrome" as const, minimumVersion: "120.0" },
  ],
  minimumExtensionVersion: "1.0.0",
};

function validRevision() {
  return {
    id: ids.profile,
    profileId: ids.profile,
    adapterId: ids.adapter,
    surfaceId: ids.surface,
    variantId: null,
    revision: 1,
    schemaVersion: "adapter_profile_v1" as const,
    state: "DRAFT" as const,
    content,
    compatibility,
    createdAt: new Date("2026-09-09T00:00:00.000Z"),
    publishedAt: null,
    createdByAdminPrincipalId: null,
    publishedByAdminPrincipalId: null,
  };
}

describe("adapter registry identifiers and profile schema", () => {
  it("accepts normalized bounded identity keys and rejects unsafe keys", () => {
    expect(AdapterKeySchema.parse("chatgpt")).toBe("chatgpt");
    expect(SurfaceKeySchema.parse("standard")).toBe("standard");
    expect(VariantKeySchema.parse("work-composer-v3")).toBe("work-composer-v3");
    expect(ProfileKeySchema.safeParse("ChatGPT").success).toBe(false);
    expect(AdapterKeySchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(AdapterKeySchema.safeParse("chat gpt").success).toBe(false);
  });

  it("accepts only the strict known declarative profile shape", () => {
    expect(AdapterProfileContentV1Schema.parse(content)).toEqual(content);
    expect(
      ProfileCompatibilityConstraintsV1Schema.parse(compatibility),
    ).toEqual(compatibility);
    expect(
      AdapterProfileContentV1Schema.safeParse({ ...content, unknown: true })
        .success,
    ).toBe(false);
  });

  it("rejects every remote-code and provider-transport field", () => {
    const forbidden = [
      "javascript",
      "eval",
      "moduleUrl",
      "url",
      "method",
      "headers",
      "auth",
      "providerOperation",
      "shellCommand",
      "function",
      "wasm",
      "cookie",
      "filesystem",
    ] as const;
    let rejected = 0;
    for (const field of forbidden) {
      if (
        !AdapterProfileContentV1Schema.safeParse({
          ...content,
          [field]: "forbidden",
        }).success
      )
        rejected++;
    }
    expect(rejected).toBe(forbidden.length);
  });

  it("rejects the explicit negative profile matrix fail-closed", () => {
    const cases: unknown[] = [
      { ...content, javascript: "alert(1)" },
      { ...content, eval: "x => x" },
      { ...content, moduleUrl: "https://example.test/module.js" },
      { ...content, url: "https://example.test" },
      { ...content, method: "POST" },
      { ...content, headers: { authorization: "secret" } },
      { ...content, auth: { token: "secret" } },
      { ...content, providerOperation: "ozon.orders.list" },
      { ...content, shellCommand: "sh -c id" },
      { ...content, function: "function forbidden() {}" },
      { ...content, wasm: "AGFzbQEAAA==" },
      { ...content, cookie: "session=secret" },
      { ...content, filesystem: "/etc/passwd" },
      {
        ...content,
        selectors: {
          ...content.selectors,
          composer: {
            ...content.selectors.composer,
            primary: {
              kind: "packaged_selector_reference",
              reference: "x".repeat(65),
            },
          },
        },
      },
      {
        ...content,
        selectors: {
          ...content.selectors,
          composer: {
            ...content.selectors.composer,
            fallbacks: [primitive, primitive, primitive, primitive],
          },
        },
      },
      {
        ...content,
        selectors: {
          ...content.selectors,
          composer: { ...content.selectors.composer, strategy: "unknown" },
        },
      },
      { ...content, unknownTopLevel: true },
      {
        ...content,
        selectors: {
          ...content.selectors,
          composer: {
            ...content.selectors.composer,
            primary: { ...primitive, unknownNested: true },
          },
        },
      },
      {
        ...content,
        selectors: {
          ...content.selectors,
          composer: {
            ...content.selectors.composer,
            primary: { kind: "executable", command: "run" },
          },
        },
      },
    ];
    const rejected = cases.filter(
      (candidate) =>
        !AdapterProfileContentV1Schema.safeParse(candidate).success,
    ).length;
    expect(rejected).toBe(cases.length);
    expect(cases.length).toBe(19);
  });

  it("bounds arrays, strings, timeouts, compatibility, and serialized content", () => {
    expect(
      AdapterProfileContentV1Schema.safeParse({
        ...content,
        contours: [...content.contours, ...content.contours],
      }).success,
    ).toBe(false);
    expect(
      AdapterProfileContentV1Schema.safeParse({
        ...content,
        selectors: {
          ...content.selectors,
          composer: { ...content.selectors.composer, timeoutMs: 31_000 },
        },
      }).success,
    ).toBe(false);
    expect(
      ProfileCompatibilityConstraintsV1Schema.safeParse({
        ...compatibility,
        browserFamilies: ["chrome", "chrome"],
      }).success,
    ).toBe(false);
    expect(PROFILE_MAX_SERIALIZED_BYTES).toBe(65_536);
  });

  it("validates revision lifecycle fields and transitions", () => {
    expect(ProfileRevisionInputSchema.parse(validRevision()).state).toBe(
      "DRAFT",
    );
    expect(() =>
      ProfileRevisionInputSchema.parse({
        ...validRevision(),
        contentSha256: "a".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      ProfileRevisionInputSchema.parse({
        ...validRevision(),
        state: "PUBLISHED",
      }),
    ).toThrow();
    expect(() =>
      assertProfileRevisionTransition("DRAFT", "PUBLISHED"),
    ).toThrow();
    expect(() =>
      assertProfileRevisionTransition("CANDIDATE", "PUBLISHED"),
    ).not.toThrow();
    expect(() =>
      assertProfileRevisionTransition("PUBLISHED", "DRAFT"),
    ).toThrow();
  });

  it("fingerprints semantic content deterministically", () => {
    const first = validateProfileContent({ content, compatibility });
    expect(first.contentSha256).toBe(
      "f6c4f3c64e820b39fae26f903c0f56e0a0a53930d533c2f2d62fe9045d6aac39",
    );
    const reordered = {
      ...content,
      selectors: {
        assistantResponse: content.selectors.assistantResponse,
        send: content.selectors.send,
        composer: content.selectors.composer,
        conversation: content.selectors.conversation,
      },
    };
    expect(
      profileRevisionFingerprint({
        content: reordered,
        compatibility: { ...compatibility },
      }),
    ).toBe(first.contentSha256);
    expect(first.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      profileRevisionFingerprint({
        content: {
          ...content,
          observation: { ...content.observation, intervalMs: 101 },
        },
        compatibility,
      }),
    ).not.toBe(first.contentSha256);
    expect(
      profileRevisionFingerprint({
        content,
        compatibility: {
          ...compatibility,
          minimumExtensionVersion: "1.0.1",
        },
      }),
    ).not.toBe(first.contentSha256);

    const fallbackA = {
      kind: "accessibility_role_name" as const,
      role: "button" as const,
      reference: "send-control" as const,
    };
    const withOrderedFallbacks = {
      ...content,
      selectors: {
        ...content.selectors,
        composer: {
          ...content.selectors.composer,
          fallbacks: [primitive, fallbackA],
        },
      },
    };
    const withReversedFallbacks = {
      ...withOrderedFallbacks,
      selectors: {
        ...withOrderedFallbacks.selectors,
        composer: {
          ...withOrderedFallbacks.selectors.composer,
          fallbacks: [fallbackA, primitive],
        },
      },
    };
    expect(
      profileRevisionFingerprint({
        content: withReversedFallbacks,
        compatibility,
      }),
    ).not.toBe(
      profileRevisionFingerprint({
        content: withOrderedFallbacks,
        compatibility,
      }),
    );
  });
});
