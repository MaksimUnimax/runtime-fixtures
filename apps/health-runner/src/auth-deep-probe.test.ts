import { describe, expect, it } from "vitest";
import {
  AuthProbeResultSchema,
  runAuthenticatedDeepProbe,
} from "./auth-deep-probe.js";
import {
  AUTH_SURFACE_AUTHORITIES,
  AuthSessionSourceSchema,
  createNoAuthSessionSource,
  createRuntimeAuthSessionReference,
  getAuthSurfaceAuthority,
} from "./auth-session-authority.js";
import { loadAuthSessionSourceFromEnvironment } from "./auth-session-runtime.js";
import {
  createAuthenticatedFixtureAdapter,
  type AuthFixtureFault,
} from "./auth-deep-probe-fixtures.js";

const standard = getAuthSurfaceAuthority("CHATGPT_STANDARD");
const work = getAuthSurfaceAuthority("CHATGPT_WORK");
const alice = getAuthSurfaceAuthority("ALICE_CHAT");

const source = createRuntimeAuthSessionReference("fixture-session-r1");

describe("S2-L5B authenticated authority", () => {
  it("RED: represents all eight providers and keeps ChatGPT Standard/Work distinct", () => {
    expect(AUTH_SURFACE_AUTHORITIES).toHaveLength(9);
    expect(new Set(AUTH_SURFACE_AUTHORITIES.map((entry) => entry.providerId))).toEqual(
      new Set(["CHATGPT", "ALICE", "DEEPSEEK", "GROK", "CLAUDE", "GEMINI", "QWEN", "KIMI"]),
    );
    expect(standard.surfaceId).not.toBe(work.surfaceId);
    expect(standard.strategy.strategyId).not.toBe(work.strategy.strategyId);
    expect(work.strategy.surfaceIdentitySignals).toContain("POSITIVE_WORKSPACE_MARKER");
    expect(work.strategy.conversationIdentityRule).toContain("URL-only identity is rejected");
    expect(alice.strategy.conversationIdentityRule).toContain("active-history corroboration");
  });

  it("RED: keeps runtime session references opaque and out of diagnostics", () => {
    const parsed = AuthSessionSourceSchema.parse(source);
    expect(parsed.sourceType).toBe("OUT_OF_REPOSITORY_RUNTIME_HANDLE");
    expect(JSON.stringify(parsed)).not.toContain("cookie");
    expect(JSON.stringify(parsed)).not.toContain("storageState");
    expect(JSON.stringify(parsed)).not.toContain("/tmp");
    expect(() =>
      loadAuthSessionSourceFromEnvironment("CHATGPT_STANDARD", {
        HEALTH_AUTH_SESSION_REF_CHATGPT_STANDARD: "profile path",
      }),
    ).toThrow("AUTH_SESSION_REFERENCE_MUST_BE_OPAQUE");
    expect(
      loadAuthSessionSourceFromEnvironment("CHATGPT_STANDARD", {}).state,
    ).toBe("NO_SESSION_CONFIGURED");
  });
});

describe("S2-L5B provider-neutral authenticated deep-probe shell", () => {
  it("RED: no session blocks before adapter interaction and never sends", async () => {
    const fixture = createAuthenticatedFixtureAdapter(standard);
    const result = await runAuthenticatedDeepProbe(
      standard,
      createNoAuthSessionSource(),
      fixture.adapter,
      { observedAt: "2026-09-18T10:00:00.000Z" },
    );
    expect(result.executionOutcome).toBe("BLOCKED");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.classificationBasis).toBe("AUTH_SESSION_NOT_PROVISIONED");
    expect(result.failureCode).toBe("SESSION_NOT_PROVISIONED");
    expect(result.sendActionCount).toBe(0);
    expect(fixture.trace()).toEqual({ calls: [], sendCalls: 0, cleanupCalls: 0 });
  });

  it.each([
    ["EXPIRED_SESSION", "SESSION_EXPIRED"],
    ["INVALID_SESSION", "SESSION_INVALID"],
    ["VERIFICATION_REQUIRED", "VERIFICATION_REQUIRED"],
    ["CAPTCHA", "CAPTCHA_SECURITY_CHECKPOINT"],
    ["ACCOUNT_BLOCKED", "ACCOUNT_BLOCKED"],
    ["ENVIRONMENT_UNAVAILABLE", "SESSION_ENVIRONMENT_UNAVAILABLE"],
  ] as const)("keeps %s separate from product drift", async (fault, failureCode) => {
    const fixture = createAuthenticatedFixtureAdapter(standard, fault);
    const result = await runAuthenticatedDeepProbe(standard, source, fixture.adapter);
    expect(result.classification).toBe("UNKNOWN");
    expect(result.failureCode).toBe(failureCode);
    expect(result.sendActionCount).toBe(0);
    expect(fixture.trace().sendCalls).toBe(0);
  });

  it.each([
    ["WRONG_PROVIDER_ACCOUNT", "WRONG_PROVIDER_ACCOUNT"],
    ["WRONG_SURFACE", "WRONG_SURFACE"],
    ["WRONG_CONVERSATION", "WRONG_CONVERSATION"],
  ] as const)("fails closed for %s", async (fault, failureCode) => {
    const fixture = createAuthenticatedFixtureAdapter(standard, fault);
    const result = await runAuthenticatedDeepProbe(standard, source, fixture.adapter);
    expect(result.classification).toBe("DRIFT");
    expect(result.failureCode).toBe(failureCode);
    expect(result.sendActionCount).toBe(0);
    expect(fixture.trace().sendCalls).toBe(0);
  });

  it("RED: proves one successful send, associated response, completion, and cleanup", async () => {
    const fixture = createAuthenticatedFixtureAdapter(standard);
    const result = await runAuthenticatedDeepProbe(standard, source, fixture.adapter, {
      observedAt: "2026-09-18T10:00:00.000Z",
    });
    expect(result.executionOutcome).toBe("PASS");
    expect(result.classification).toBe("HEALTHY");
    expect(result.failureCode).toBeNull();
    expect(result.sendActionCount).toBe(1);
    expect(result.evidence.promptInserted).toBe(true);
    expect(result.evidence.sendTransition).toBe("PROVEN");
    expect(result.evidence.responseAssociation).toBe("PROVEN");
    expect(result.evidence.completion).toBe("PROVEN");
    expect(result.evidence.assistantMessageCountDelta).toBe(1);
    expect(fixture.trace().sendCalls).toBe(1);
    expect(fixture.trace().cleanupCalls).toBe(1);
  });

  it.each([
    ["DUPLICATE_SEND", "SEND_COUNT_NOT_ONE"],
    ["SEND_UNCERTAIN", "SEND_UNCERTAIN"],
    ["RESPONSE_ASSOCIATION_FAILURE", "RESPONSE_ASSOCIATION_FAILED"],
    ["COMPLETION_TIMEOUT", "COMPLETION_TIMEOUT"],
  ] as const)("does not retry Send after %s", async (fault, failureCode) => {
    const fixture = createAuthenticatedFixtureAdapter(standard, fault);
    const result = await runAuthenticatedDeepProbe(standard, source, fixture.adapter);
    expect(result.failureCode).toBe(failureCode);
    expect(result.sendActionCount).toBe(fault === "DUPLICATE_SEND" ? 0 : 1);
    expect(fixture.trace().sendCalls).toBe(1);
    expect(fixture.trace().calls.filter((call) => call === "sendOnce")).toHaveLength(1);
    expect(fixture.trace().cleanupCalls).toBe(1);
  });

  it.each([
    ["MISSING_COMPOSER", "COMPOSER_IDENTIFICATION_FAILED"],
    ["MISSING_CODE_SURFACE", "COMMAND_SURFACE_FAILED"],
    ["MISSING_COPY_SURFACE", "COPY_SURFACE_FAILED"],
    ["MISSING_DELIVERY_TARGET", "DELIVERY_TARGET_FAILED"],
  ] as const)("classifies required/optional surface failure %s", async (fault, failureCode) => {
    const fixture = createAuthenticatedFixtureAdapter(standard, fault);
    const result = await runAuthenticatedDeepProbe(standard, source, fixture.adapter);
    expect(result.failureCode).toBe(failureCode);
    expect(result.sendActionCount).toBe(fault === "MISSING_COMPOSER" ? 0 : 1);
    expect(fixture.trace().cleanupCalls).toBe(1);
  });

  it("does not send for a provider whose live-readiness status is still blocked", async () => {
    const deepseek = getAuthSurfaceAuthority("DEEPSEEK_CHAT");
    const fixture = createAuthenticatedFixtureAdapter(deepseek);
    const result = await runAuthenticatedDeepProbe(deepseek, source, fixture.adapter);
    expect(result.executionOutcome).toBe("BLOCKED");
    expect(result.failureCode).toBe("PROVIDER_NOT_LIVE_READY");
    expect(result.classification).toBe("UNKNOWN");
    expect(fixture.trace().sendCalls).toBe(0);
  });

  it("keeps provider-specific strategy identities from cross-contaminating", async () => {
    const fixture = createAuthenticatedFixtureAdapter(standard);
    const result = await runAuthenticatedDeepProbe(work, source, fixture.adapter);
    expect(result.failureCode).toBe("WRONG_SURFACE");
    expect(result.classification).toBe("DRIFT");
    expect(fixture.trace().sendCalls).toBe(0);
  });

  it("covers the three existing authenticated foundations with the common shell", async () => {
    for (const authority of [standard, work, alice]) {
      const fixture = createAuthenticatedFixtureAdapter(authority);
      const result = await runAuthenticatedDeepProbe(authority, source, fixture.adapter);
      expect(AuthProbeResultSchema.parse(result).classification).toBe("HEALTHY");
      expect(result.sendActionCount).toBe(1);
      expect(fixture.trace().sendCalls).toBe(1);
    }
  });

  it("provides a deterministic fixture boundary for every authenticated surface", async () => {
    for (const authority of AUTH_SURFACE_AUTHORITIES) {
      const fixture = createAuthenticatedFixtureAdapter(authority);
      const result = await runAuthenticatedDeepProbe(
        authority,
        createNoAuthSessionSource(),
        fixture.adapter,
      );
      expect(result.providerId).toBe(authority.providerId);
      expect(result.surfaceId).toBe(authority.surfaceId);
      expect(result.failureCode).toBe("SESSION_NOT_PROVISIONED");
      expect(fixture.trace().sendCalls).toBe(0);
    }
  });

  it("contains no live fixture fault vocabulary in durable evidence", async () => {
    const faults: AuthFixtureFault[] = ["HEALTHY", "SEND_UNCERTAIN", "CAPTCHA"];
    for (const fault of faults) {
      const fixture = createAuthenticatedFixtureAdapter(alice, fault);
      const result = await runAuthenticatedDeepProbe(alice, source, fixture.adapter);
      expect(JSON.stringify(result.evidence)).not.toContain("cookie");
      expect(JSON.stringify(result.evidence)).not.toContain("storageState");
      expect(JSON.stringify(result.evidence)).not.toContain("fixture-session-r1");
    }
  });
});
