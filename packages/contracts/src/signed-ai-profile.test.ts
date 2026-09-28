import { describe, expect, it } from "vitest";
import {
  SignedAiProfileRequestV1Schema,
  SignedAiProfileResponseV1Schema,
  SignedAiProfileReceiptV1Schema,
} from "./index.js";

const request = {
  messageType: "OZ_REQUEST_SIGNED_AI_PROFILE",
  protocolVersion: "signed_ai_profile_consumer_v1",
  requestId: "00000000-0000-4000-8000-000000000001",
  ai: { family: "chatgpt", surface: "web", variant: null },
};
function plan(strategy: string, reference: string) {
  return {
    strategy,
    primary: { kind: "packaged_selector_reference", reference },
    fallbacks: [],
    timeoutMs: 1_000,
    observationMode: "polling",
  };
}
const response = {
  ...request,
  messageType: "OZ_SIGNED_AI_PROFILE",
  status: "AVAILABLE",
  authority: { authGeneration: 2, bootstrapSnapshotSha256: "a".repeat(64) },
  profile: {
    profileKey: "chatgpt-standard",
    revision: 2,
    scopeVariant: null,
    schemaVersion: "adapter_profile_v1",
    contentSha256: "b".repeat(64),
    content: {
      schemaVersion: "adapter_profile_v1",
      page: {
        identityStrategy: "page_identity",
        conversationStrategy: "conversation_root",
        composerStrategy: "composer_root",
      },
      selectors: {
        conversation: plan("conversation_root", "conversation-root"),
        composer: plan("composer_root", "composer-root"),
        send: plan("send_control", "send-control"),
        assistantResponse: plan("assistant_response", "assistant-response"),
      },
      observation: { mode: "polling", intervalMs: 500 },
      contours: [
        {
          key: "page_identity",
          strategy: "page_identity",
          required: true,
          expectedState: "PRESENT",
        },
        {
          key: "conversation_root",
          strategy: "conversation_root",
          required: true,
          expectedState: "PRESENT",
        },
        {
          key: "composer_root",
          strategy: "composer_root",
          required: true,
          expectedState: "INTERACTIVE",
        },
        {
          key: "send_control",
          strategy: "send_control",
          required: true,
          expectedState: "INTERACTIVE",
        },
      ],
    },
    compatibility: {
      schemaVersion: "profile_compatibility_v1",
      contractVersion: "control_plane_v2",
      browserFamilies: ["chrome"],
      minimumBrowserVersions: [],
      minimumExtensionVersion: "0.2.6",
    },
  },
};
function changed(path: string, value: unknown) {
  const candidate = structuredClone(response) as Record<string, unknown>;
  const keys = path.split(".");
  let target = candidate;
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]!] = value;
  return candidate;
}

describe("verified profile consumer wire boundary", () => {
  it("carries only supported scope and full fingerprint material", () => {
    expect(SignedAiProfileRequestV1Schema.parse(request)).toEqual(request);
    expect(SignedAiProfileResponseV1Schema.parse(response)).toEqual(response);
    const partial = structuredClone(response.profile) as Record<
      string,
      unknown
    >;
    delete partial.compatibility;
    expect(
      SignedAiProfileResponseV1Schema.safeParse({
        ...response,
        profile: partial,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["accessToken", "secret"],
    ["authority.accountId", "private-account"],
    ["authority.authGeneration", 0],
    ["authority.authGeneration", Number.MAX_SAFE_INTEGER + 1],
    ["authority.bootstrapSnapshotSha256", "unverified"],
    ["profile.revision", 0],
    ["profile.revision", Number.MAX_SAFE_INTEGER + 1],
    ["profile.contentSha256", "unverified"],
    ["profile.content.javascript", "alert(1)"],
    ["profile.content.selectors.send.primary.css", "button"],
    ["profile.content.selectors.send.primary.reference", "remote-selector"],
    ["profile.content.selectors.send.primary.kind", "javascript"],
    ["profile.content.selectors.send.strategy", "composer_root"],
    ["profile.content.selectors.send.timeoutMs", 30_001],
    ["profile.content.selectors.send.timeoutMs", 250],
    [
      "profile.content.selectors.send.fallbacks",
      Array(4).fill({
        kind: "packaged_selector_reference",
        reference: "send-control",
      }),
    ],
    ["profile.content.selectors.copy", plan("copy_control", "copy-control")],
    ["profile.content.observation.intervalMs", 5_001],
    ["profile.compatibility.url", "https://example.test/remote.js"],
    ["profile.compatibility.browserFamilies", ["chrome", "chrome"]],
    [
      "profile.compatibility.minimumBrowserVersions",
      [{ browserFamily: "firefox", minimumVersion: "120" }],
    ],
    ["profile.scopeVariant", "not-supported"],
    ["ai.family", "not-supported"],
    ["ai.variant", "work"],
    ["requestId", "not-a-request-nonce"],
    ["protocolVersion", "signed_ai_profile_consumer_v2"],
  ])("rejects unsafe or unsupported material at %s", (path, value) => {
    expect(
      SignedAiProfileResponseV1Schema.safeParse(changed(path as string, value))
        .success,
    ).toBe(false);
  });

  it("permits an earlier revision as rollback material, without treating revision as a delivery sequence", () => {
    expect(
      SignedAiProfileResponseV1Schema.safeParse(changed("profile.revision", 1))
        .success,
    ).toBe(true);
  });

  it("represents unavailable authority without leaking the previous material", () => {
    const unavailable = {
      ...request,
      messageType: "OZ_SIGNED_AI_PROFILE",
      status: "UNAVAILABLE",
      reason: "WORK_NOT_ALLOWED",
    };
    expect(SignedAiProfileResponseV1Schema.parse(unavailable)).toEqual(
      unavailable,
    );
    expect(
      SignedAiProfileResponseV1Schema.safeParse({
        ...unavailable,
        profile: response.profile,
      }).success,
    ).toBe(false);
    expect(
      SignedAiProfileResponseV1Schema.safeParse({
        ...unavailable,
        reason: "arbitrary error text",
      }).success,
    ).toBe(false);
  });

  it("acknowledges exact identities without echoing content or accepting deferred as applied", () => {
    const { profileKey, revision, scopeVariant, contentSha256 } =
      response.profile;
    const receipt = {
      ...request,
      messageType: "OZ_SIGNED_AI_PROFILE_RECEIPT",
      authority: response.authority,
      profile: { profileKey, revision, scopeVariant, contentSha256 },
      status: "DEFERRED",
      reason: "WORK_IN_FLIGHT",
    };
    expect(SignedAiProfileReceiptV1Schema.parse(receipt)).toEqual(receipt);
    expect(
      SignedAiProfileReceiptV1Schema.safeParse({
        ...receipt,
        status: "APPLIED",
      }).success,
    ).toBe(false);
    expect(
      SignedAiProfileReceiptV1Schema.safeParse({
        ...receipt,
        profile: response.profile,
      }).success,
    ).toBe(false);
    expect(
      SignedAiProfileReceiptV1Schema.safeParse({
        ...request,
        messageType: receipt.messageType,
        status: "CLEARED",
        reason: "WORK_NOT_ALLOWED",
      }).success,
    ).toBe(true);
  });
});
