import { describe, expect, it } from "vitest";
import {
  NO_SESSION_PROVIDER_IDS,
  NO_SESSION_SURFACE_IDS,
  NO_SESSION_TARGETS,
  NoSessionTargetSchema,
  getNoSessionTargetForSurface,
} from "./no-session-target-authority.js";
import {
  NO_SESSION_STRATEGIES,
  assertNoSessionStrategySeparation,
  getNoSessionStrategy,
} from "./no-session-strategies.js";
import type { NoSessionPageSnapshot } from "./no-session-contracts.js";
import {
  createNoSessionSafeEvidence,
  validateNoSessionSafeEvidence,
} from "./no-session-evidence.js";
import type { NoSessionBrowserDriver } from "./no-session-browser-driver.js";
import { createNoSessionChromeBrowserDriver } from "./no-session-browser-driver.js";
import {
  runNoSessionAutomaticProbe,
  runNoSessionBatch,
  runNoSessionProbe,
} from "./no-session-runner.js";

const RUNTIME = {
  family: "chrome" as const,
  browserName: "chromium",
  browserVersion: "120.0.0.0",
  headless: true,
  sessionKind: "EPHEMERAL_CONTROLLED" as const,
};

function snapshotFor(
  surfaceId: (typeof NO_SESSION_SURFACE_IDS)[number],
): NoSessionPageSnapshot {
  const strategy = getNoSessionStrategy(surfaceId);
  return {
    profileId: strategy.profile.profileId,
    finalOrigin:
      getNoSessionTargetForSurface(surfaceId).allowedTopLevelOrigins[0]!,
    identityMarkerCount: 1,
    surfaceMarkerCount: 1,
    composer: {
      elementCount: 1,
      visible: true,
      editable: true,
      actionable: false,
    },
    editableInput: {
      elementCount: 1,
      visible: true,
      editable: true,
      actionable: false,
    },
    sendControl: {
      elementCount: 1,
      visible: true,
      editable: false,
      actionable: true,
    },
    authWallObserved: false,
    loginWallObserved: false,
    securityCheckpointObserved: false,
    captchaObserved: false,
    accessBlockedObserved: false,
    maintenanceObserved: false,
    unsupportedEnvironmentObserved: false,
    readiness: "APP_HYDRATED",
    providerTitleObserved: true,
    securityTitleObserved: false,
    blockedTitleObserved: false,
    unsupportedTitleObserved: false,
  };
}

class FakeNoSessionBrowser implements NoSessionBrowserDriver {
  public readonly family = "chrome" as const;
  public readonly sessionKind = "EPHEMERAL_CONTROLLED" as const;
  public startCount = 0;
  public stopCount = 0;
  private currentTargetOrigin = "https://fixture.example";
  private navigationFailed = false;
  public constructor(
    private readonly snapshots: ReadonlyMap<string, NoSessionPageSnapshot>,
    private readonly failure: "NONE" | "NAVIGATION" = "NONE",
    private readonly mode:
      | "HEADED"
      | "HEADLESS_DIAGNOSTIC" = "HEADLESS_DIAGNOSTIC",
  ) {}
  public async start(): Promise<void> {
    this.startCount += 1;
  }
  public async open(target: (typeof NO_SESSION_TARGETS)[number]) {
    this.currentTargetOrigin = target.allowedTopLevelOrigins[0]!;
    this.navigationFailed = this.failure === "NAVIGATION";
    if (this.navigationFailed) throw new Error("fake navigation failure");
    return {
      requestedStartUrl: target.startUrl,
      finalUrl: `${target.allowedTopLevelOrigins[0]!}/`,
      finalOrigin: target.allowedTopLevelOrigins[0]!,
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: this.navigationFailed
        ? ("HTTP_FAILURE" as const)
        : ("LOADED" as const),
    };
  }
  public async observe(profile: { profileId: string }) {
    const snapshot = this.snapshots.get(profile.profileId);
    if (!snapshot) throw new Error("missing fake snapshot");
    return snapshot;
  }
  public getRuntimeMetadata() {
    return { ...RUNTIME, headless: this.mode === "HEADLESS_DIAGNOSTIC" };
  }
  public getNavigationEvidence() {
    return {
      requestedStartUrl: `${this.currentTargetOrigin}/`,
      finalUrl: `${this.currentTargetOrigin}/`,
      finalOrigin: this.currentTargetOrigin,
      mainDocumentHttpStatus: 200,
      redirectCount: 0,
      outcome: this.navigationFailed
        ? ("HTTP_FAILURE" as const)
        : ("LOADED" as const),
    };
  }
  public getSecurityDiagnostics() {
    return { secondaryPageCount: 0, unsafeTopLevelNavigation: false } as const;
  }
  public async stop(): Promise<void> {
    this.stopCount += 1;
  }
}

describe("no-session target authority", () => {
  it("contains exactly eight providers and nine explicitly named surfaces", () => {
    expect(NO_SESSION_PROVIDER_IDS).toEqual([
      "chatgpt",
      "alice",
      "deepseek",
      "grok",
      "claude",
      "gemini",
      "qwen",
      "kimi",
    ]);
    expect(NO_SESSION_TARGETS).toHaveLength(9);
    expect(NO_SESSION_SURFACE_IDS).toContain("CHATGPT_STANDARD");
    expect(NO_SESSION_SURFACE_IDS).toContain("CHATGPT_WORK");
    expect(
      new Set(NO_SESSION_TARGETS.map((target) => target.providerId)).size,
    ).toBe(8);
  });

  it("keeps every start origin inside a narrow same-origin allowlist", () => {
    for (const target of NO_SESSION_TARGETS) {
      expect(new URL(target.startUrl).origin).toBe(
        target.allowedTopLevelOrigins[0],
      );
      expect(target.redirectPolicy).toBe("SAME_ORIGIN_ONLY");
      expect(target.identityRequirement).toBe(
        "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
      );
    }
  });
});

describe("provider-specific no-session strategies", () => {
  it("has one distinct profile per surface and does not use fixture hf-* markers", () => {
    assertNoSessionStrategySeparation();
    expect(NO_SESSION_STRATEGIES).toHaveLength(9);
    expect(
      NO_SESSION_STRATEGIES.flatMap((strategy) => [
        ...strategy.profile.identitySelectors,
        ...strategy.profile.surfaceSelectors,
      ]).some((selector) => selector.includes("hf-")),
    ).toBe(false);
  });

  it("fails closed when a different provider snapshot is supplied", () => {
    const chatgpt = getNoSessionStrategy("CHATGPT_STANDARD");
    const alice = getNoSessionTargetForSurface("ALICE");
    const result = chatgpt.evaluate(
      alice,
      snapshotFor("CHATGPT_STANDARD"),
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("MISMATCH");
    expect(result.classification).toBe("UNKNOWN");
  });

  it("does not use a generic textbox as identity", () => {
    const target = getNoSessionTargetForSurface("GEMINI");
    const strategy = getNoSessionStrategy("GEMINI");
    const snapshot = {
      ...snapshotFor("GEMINI"),
      profileId: "wrong-profile",
      identityMarkerCount: 0,
    };
    const result = strategy.evaluate(
      target,
      snapshot,
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.composer).toBe("NOT_PROVABLE");
    expect(result.identity).toBe("NOT_PROVEN");
    expect(result.classification).toBe("UNKNOWN");
  });

  it("keeps auth walls distinct from DOM drift", () => {
    const target = getNoSessionTargetForSurface("CLAUDE");
    const strategy = getNoSessionStrategy("CLAUDE");
    const result = strategy.evaluate(
      target,
      {
        ...snapshotFor("CLAUDE"),
        authWallObserved: true,
        composer: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        editableInput: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        sendControl: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.authentication).toBe("AUTH_REQUIRED");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.classificationBasis).toBe("AUTH_REQUIRED_BOUNDARY");
    expect(result.composer).toBe("NOT_PROVABLE");
  });

  it("classifies the expected Claude login surface as an auth boundary", () => {
    const target = getNoSessionTargetForSurface("CLAUDE");
    const result = getNoSessionStrategy("CLAUDE").evaluate(
      target,
      {
        ...snapshotFor("CLAUDE"),
        loginWallObserved: true,
        securityCheckpointObserved: false,
        securityTitleObserved: false,
        composer: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        editableInput: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        sendControl: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
      {
        requestedStartUrl: target.startUrl,
        finalUrl: "https://claude.ai/login",
        finalOrigin: "https://claude.ai",
        mainDocumentHttpStatus: 200,
        redirectCount: 1,
        outcome: "LOADED",
      },
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.authentication).toBe("LOGIN_REQUIRED");
    expect(result.surfaceOutcome).toBe("AUTH_REQUIRED");
    expect(result.classification).toBe("HEALTHY");
    expect(result.classificationBasis).toBe("PUBLIC_SURFACE_PRIMARY");
  });

  it("keeps a Claude security challenge distinct from its login surface", () => {
    const target = getNoSessionTargetForSurface("CLAUDE");
    const result = getNoSessionStrategy("CLAUDE").evaluate(
      target,
      {
        ...snapshotFor("CLAUDE"),
        securityCheckpointObserved: true,
        securityTitleObserved: true,
        loginWallObserved: false,
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.blocker).toBe("SECURITY_CHECKPOINT");
    expect(result.surfaceOutcome).toBe("SECURITY_CHECKPOINT");
    expect(result.classification).toBe("UNKNOWN");
  });

  it("does not promote a normal Claude login-page captcha to a security gate", () => {
    const target = getNoSessionTargetForSurface("CLAUDE");
    const result = getNoSessionStrategy("CLAUDE").evaluate(
      target,
      {
        ...snapshotFor("CLAUDE"),
        loginWallObserved: true,
        captchaObserved: true,
        securityCheckpointObserved: false,
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
      {
        requestedStartUrl: target.startUrl,
        finalUrl: "https://claude.ai/login",
        finalOrigin: "https://claude.ai",
        mainDocumentHttpStatus: 200,
        redirectCount: 1,
        outcome: "LOADED",
      },
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.authentication).toBe("LOGIN_REQUIRED");
    expect(result.blocker).toBe("NONE");
    expect(result.surfaceOutcome).toBe("AUTH_REQUIRED");
  });

  it("reports a proven public page with a missing required contour as drift", () => {
    const standardTarget = getNoSessionTargetForSurface("CHATGPT_STANDARD");
    const target = NoSessionTargetSchema.parse({
      ...standardTarget,
      sendControlExpected: true,
      capabilityExpectation: {
        ...standardTarget.capabilityExpectation,
        sendControl: "EXPECTED",
      },
    });
    const strategy = getNoSessionStrategy("CHATGPT_STANDARD");
    const result = strategy.evaluate(
      target,
      {
        ...snapshotFor("CHATGPT_STANDARD"),
        sendControl: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.sendControl).toBe("ABSENT");
    expect(result.classification).toBe("DRIFT");
  });

  it("does not infer ChatGPT Work from a proven Standard-shaped page", () => {
    const target = getNoSessionTargetForSurface("CHATGPT_WORK");
    const strategy = getNoSessionStrategy("CHATGPT_WORK");
    const result = strategy.evaluate(
      target,
      snapshotFor("CHATGPT_STANDARD"),
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("NOT_PROVEN");
    expect(result.surfaceOutcome).toBe("NOT_OBSERVABLE_WITHOUT_SESSION");
    expect(result.classificationBasis).toBe("NOT_OBSERVABLE_WITHOUT_SESSION");
  });

  it("treats Alice's missing optional logged-out composer as a public boundary", () => {
    const target = getNoSessionTargetForSurface("ALICE");
    const strategy = getNoSessionStrategy("ALICE");
    const result = strategy.evaluate(
      target,
      {
        ...snapshotFor("ALICE"),
        composer: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        editableInput: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        sendControl: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.classification).toBe("HEALTHY");
    expect(result.surfaceOutcome).toBe("PUBLIC_LANDING");
    expect(result.classificationBasis).toBe("PUBLIC_SURFACE_PRIMARY");
    expect(result.composer).toBe("NOT_EXPECTED");
  });

  it("recognizes a real Alice required contour regression as drift", () => {
    const aliceTarget = getNoSessionTargetForSurface("ALICE");
    const target = NoSessionTargetSchema.parse({
      ...aliceTarget,
      publicComposerExpected: true,
      capabilityExpectation: {
        ...aliceTarget.capabilityExpectation,
        publicComposer: "EXPECTED",
        editableInput: "EXPECTED",
      },
    });
    const strategy = getNoSessionStrategy("ALICE");
    const result = strategy.evaluate(
      target,
      {
        ...snapshotFor("ALICE"),
        composer: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.classification).toBe("DRIFT");
    expect(result.surfaceOutcome).toBe("DRIFT");
  });

  it("types DeepSeek 403 as an access boundary", () => {
    const target = getNoSessionTargetForSurface("DEEPSEEK");
    const strategy = getNoSessionStrategy("DEEPSEEK");
    const result = strategy.evaluate(
      target,
      snapshotFor("DEEPSEEK"),
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
      {
        requestedStartUrl: target.startUrl,
        finalUrl: target.startUrl,
        finalOrigin: target.allowedTopLevelOrigins[0]!,
        mainDocumentHttpStatus: 403,
        redirectCount: 0,
        outcome: "HTTP_FAILURE",
      },
    );
    expect(result.blocker).toBe("ACCESS_BLOCKED");
    expect(result.surfaceOutcome).toBe("ACCESS_BLOCKED");
    expect(result.classificationBasis).toBe("ACCESS_BLOCKED");
  });

  it("types a Gemini sign-in-only surface as an auth boundary", () => {
    const target = getNoSessionTargetForSurface("GEMINI");
    const strategy = getNoSessionStrategy("GEMINI");
    const result = strategy.evaluate(
      target,
      {
        ...snapshotFor("GEMINI"),
        composer: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        editableInput: {
          elementCount: 0,
          visible: false,
          editable: false,
          actionable: false,
        },
        loginWallObserved: true,
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.authentication).toBe("LOGIN_REQUIRED");
    expect(result.surfaceOutcome).toBe("AUTH_REQUIRED");
    expect(result.classificationBasis).toBe("AUTH_REQUIRED_BOUNDARY");
  });

  it.each(["GROK", "KIMI"] as const)(
    "proves the current public application shell for %s",
    (surfaceId) => {
      const target = getNoSessionTargetForSurface(surfaceId);
      const result = getNoSessionStrategy(surfaceId).evaluate(
        target,
        snapshotFor(surfaceId),
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(result.identity).toBe("PROVEN");
      expect(result.surfaceOutcome).toBe("PUBLIC_INTERACTIVE");
    },
  );

  it("uses Qwen's current root route and fails closed on its unsupported surface", () => {
    const target = getNoSessionTargetForSurface("QWEN");
    expect(target.startUrl).toBe("https://chat.qwen.ai/");
    const result = getNoSessionStrategy("QWEN").evaluate(
      target,
      {
        ...snapshotFor("QWEN"),
        identityMarkerCount: 0,
        surfaceMarkerCount: 0,
        providerTitleObserved: false,
        readiness: "STATIC_LANDING",
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("NOT_PROVEN");
    expect(result.surfaceOutcome).toBe("IDENTITY_NOT_PROVEN");
  });

  it("identifies Qwen's official unsupported-system surface as environmental", () => {
    const target = getNoSessionTargetForSurface("QWEN");
    const result = getNoSessionStrategy("QWEN").evaluate(
      target,
      {
        ...snapshotFor("QWEN"),
        unsupportedEnvironmentObserved: true,
        unsupportedTitleObserved: true,
      },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("PROVEN");
    expect(result.blocker).toBe("UNSUPPORTED_ENVIRONMENT");
    expect(result.surfaceOutcome).toBe("UNSUPPORTED_ENVIRONMENT");
    expect(result.classificationBasis).toBe("ENVIRONMENT_SUPPORT_BOUNDARY");
    expect(result.classification).toBe("UNKNOWN");
  });

  it("does not turn a pre-hydration observation into drift", () => {
    const target = getNoSessionTargetForSurface("CHATGPT_STANDARD");
    const result = getNoSessionStrategy("CHATGPT_STANDARD").evaluate(
      target,
      { ...snapshotFor("CHATGPT_STANDARD"), readiness: "STATIC_LANDING" },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.classification).toBe("HEALTHY");
    expect(result.readiness).toBe("STATIC_LANDING");
  });

  it("fails closed on an untrusted origin", () => {
    const target = getNoSessionTargetForSurface("ALICE");
    const strategy = getNoSessionStrategy("ALICE");
    const result = strategy.evaluate(
      target,
      { ...snapshotFor("ALICE"), finalOrigin: "https://evil.example" },
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.identity).toBe("MISMATCH");
    expect(result.blocker).toBe("ORIGIN_POLICY_VIOLATION");
    expect(result.classification).toBe("UNKNOWN");
  });

  it.each(NO_SESSION_TARGETS)(
    "covers the expected public fixture for $providerId/$surfaceId",
    (target) => {
      const strategy = getNoSessionStrategy(target.surfaceId);
      const result = strategy.evaluate(
        target,
        snapshotFor(target.surfaceId),
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(result.identity).toBe("PROVEN");
      expect(result.publicSurface).toBe("REACHABLE");
      expect(result.noInteraction).toBe(true);
    },
  );

  it.each(NO_SESSION_TARGETS)(
    "covers an auth wall without calling it DOM drift for $providerId/$surfaceId",
    (target) => {
      const strategy = getNoSessionStrategy(target.surfaceId);
      const result = strategy.evaluate(
        target,
        { ...snapshotFor(target.surfaceId), authWallObserved: true },
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(result.authentication).toBe("AUTH_REQUIRED");
      expect(result.classification).toBe("UNKNOWN");
      expect(result.classificationBasis).toBe("AUTH_REQUIRED_BOUNDARY");
    },
  );

  it.each(NO_SESSION_TARGETS)(
    "covers wrong-origin identity mismatch for $providerId/$surfaceId",
    (target) => {
      const strategy = getNoSessionStrategy(target.surfaceId);
      const result = strategy.evaluate(
        target,
        {
          ...snapshotFor(target.surfaceId),
          finalOrigin: "https://untrusted.example",
        },
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(result.identity).toBe("MISMATCH");
      expect(result.blocker).toBe("ORIGIN_POLICY_VIOLATION");
      expect(result.classification).toBe("UNKNOWN");
    },
  );

  it.each(NO_SESSION_TARGETS)(
    "covers checkpoint and maintenance precedence for $providerId/$surfaceId",
    (target) => {
      const strategy = getNoSessionStrategy(target.surfaceId);
      const checkpoint = strategy.evaluate(
        target,
        { ...snapshotFor(target.surfaceId), captchaObserved: true },
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(checkpoint.blocker).toBe("CAPTCHA_SECURITY_CHECKPOINT");
      expect(checkpoint.classification).toBe("UNKNOWN");
      const maintenance = strategy.evaluate(
        target,
        { ...snapshotFor(target.surfaceId), maintenanceObserved: true },
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(maintenance.blocker).toBe("MAINTENANCE");
      expect(maintenance.classification).toBe("MAINTENANCE");
    },
  );

  it.each(NO_SESSION_TARGETS.filter((target) => target.publicComposerExpected))(
    "covers missing public contour as drift for $providerId/$surfaceId",
    (target) => {
      const strategy = getNoSessionStrategy(target.surfaceId);
      const result = strategy.evaluate(
        target,
        {
          ...snapshotFor(target.surfaceId),
          composer: {
            elementCount: 0,
            visible: false,
            editable: false,
            actionable: false,
          },
        },
        RUNTIME,
        "2026-09-18T11:00:00.000Z",
      );
      expect(result.identity).toBe("PROVEN");
      expect(result.composer).toBe("ABSENT");
      expect(result.classification).toBe("DRIFT");
    },
  );
});

describe("no-session L5-safe evidence", () => {
  it("hashes semantic metadata without evidence UUIDs or page content", () => {
    const target = getNoSessionTargetForSurface("CHATGPT_STANDARD");
    const strategy = getNoSessionStrategy("CHATGPT_STANDARD");
    const result = strategy.evaluate(
      target,
      snapshotFor("CHATGPT_STANDARD"),
      RUNTIME,
      "2026-09-18T11:00:00.000Z",
    );
    const first = createNoSessionSafeEvidence(result);
    const second = createNoSessionSafeEvidence(result);
    expect(first.package.semanticHash).toBe(second.package.semanticHash);
    expect(
      first.package.artifacts.map((artifact) => artifact.evidenceId),
    ).not.toEqual(
      second.package.artifacts.map((artifact) => artifact.evidenceId),
    );
    expect(validateNoSessionSafeEvidence(first.package).semanticHash).toBe(
      first.package.semanticHash,
    );
    expect(JSON.stringify(first.package)).not.toMatch(
      /prompt|response|cookie|token|storage|password|html|screenshot/i,
    );
    expect(JSON.stringify(first.package)).toContain("HEADLESS_DIAGNOSTIC");
  });
});

describe("no-session batch isolation", () => {
  it("attempts every target and keeps one navigation blocker from aborting the batch", async () => {
    const snapshots = new Map(
      NO_SESSION_STRATEGIES.map((strategy) => [
        strategy.profile.profileId,
        snapshotFor(strategy.surfaceId),
      ]),
    );
    let browserNumber = 0;
    const results = await runNoSessionBatch(
      NO_SESSION_TARGETS,
      () => {
        browserNumber += 1;
        return new FakeNoSessionBrowser(
          snapshots,
          browserNumber === 1 ? "NAVIGATION" : "NONE",
        );
      },
      "2026-09-18T11:00:00.000Z",
    );
    expect(results).toHaveLength(9);
    expect(results[0]?.blocker).toBe("NETWORK_FAILURE");
    expect(results[0]?.navigationEvidence.outcome).toBe("HTTP_FAILURE");
    expect(results[1]?.navigationEvidence.requestedStartUrl).toMatch(
      /^https:\/\//,
    );
    expect(results[1]?.navigationEvidence.redirectCount).toBe(0);
    expect(results.slice(1).every((result) => result.noInteraction)).toBe(true);
  });

  it("always closes each ephemeral fake context", async () => {
    const target = getNoSessionTargetForSurface("CHATGPT_STANDARD");
    const fake = new FakeNoSessionBrowser(
      new Map([
        [
          getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
          snapshotFor("CHATGPT_STANDARD"),
        ],
      ]),
    );
    await runNoSessionProbe(
      target,
      fake,
      getNoSessionStrategy("CHATGPT_STANDARD"),
      "2026-09-18T11:00:00.000Z",
    );
    expect(fake.startCount).toBe(1);
    expect(fake.stopCount).toBe(1);
  });
});

describe("automatic browser-mode policy", () => {
  const target = getNoSessionTargetForSurface("CHATGPT_STANDARD");
  const snapshots = new Map([
    [
      getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
      snapshotFor("CHATGPT_STANDARD"),
    ],
  ]);

  it("keeps a successful headed observation canonical over a headless 403 diagnostic", async () => {
    let headedCalls = 0;
    let headlessCalls = 0;
    const result = await runNoSessionAutomaticProbe(
      target,
      {
        diagnosticFirst: true,
        createHeadlessDiagnosticBrowser: () => {
          headlessCalls += 1;
          return new FakeNoSessionBrowser(
            new Map([
              [
                getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
                {
                  ...snapshotFor("CHATGPT_STANDARD"),
                  identityMarkerCount: 0,
                  surfaceMarkerCount: 0,
                  securityCheckpointObserved: true,
                  readiness: "SECURITY_GATE",
                },
              ],
            ]),
            "NONE",
            "HEADLESS_DIAGNOSTIC",
          );
        },
        createHeadedBrowser: () => {
          headedCalls += 1;
          return new FakeNoSessionBrowser(snapshots, "NONE", "HEADED");
        },
      },
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.classification).toBe("HEALTHY");
    expect(result.browserMode.authoritativeMode).toBe("HEADED");
    expect(result.browserMode.canonicalMode).toBe("HEADED");
    expect(result.browserMode.fallbackAttempted).toBe(true);
    expect(result.browserMode.fallbackReason).toBe("SECURITY_CHECKPOINT");
    expect(result.browserMode.diagnosticObservation?.surfaceOutcome).toBe(
      "SECURITY_CHECKPOINT",
    );
    expect(headedCalls).toBe(1);
    expect(headlessCalls).toBe(1);
  });

  it("runs fallback at most once and makes headed identity authoritative", async () => {
    let headedCalls = 0;
    const result = await runNoSessionAutomaticProbe(
      target,
      {
        diagnosticFirst: true,
        createHeadlessDiagnosticBrowser: () =>
          new FakeNoSessionBrowser(
            new Map([
              [
                getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
                {
                  ...snapshotFor("CHATGPT_STANDARD"),
                  identityMarkerCount: 0,
                  securityCheckpointObserved: true,
                },
              ],
            ]),
            "NONE",
            "HEADLESS_DIAGNOSTIC",
          ),
        createHeadedBrowser: () => {
          headedCalls += 1;
          return new FakeNoSessionBrowser(snapshots, "NONE", "HEADED");
        },
      },
      "2026-09-18T11:00:00.000Z",
    );
    expect(headedCalls).toBe(1);
    expect(result.identity).toBe("PROVEN");
    expect(result.browserMode.fallbackAttempted).toBe(true);
  });

  it("keeps both blocked modes as a precise headed access result", async () => {
    const result = await runNoSessionAutomaticProbe(
      target,
      {
        diagnosticFirst: true,
        createHeadlessDiagnosticBrowser: () =>
          new FakeNoSessionBrowser(
            new Map([
              [
                getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
                {
                  ...snapshotFor("CHATGPT_STANDARD"),
                  identityMarkerCount: 0,
                  securityCheckpointObserved: true,
                },
              ],
            ]),
            "NONE",
            "HEADLESS_DIAGNOSTIC",
          ),
        createHeadedBrowser: () =>
          new FakeNoSessionBrowser(
            new Map([
              [
                getNoSessionStrategy("CHATGPT_STANDARD").profile.profileId,
                {
                  ...snapshotFor("CHATGPT_STANDARD"),
                  identityMarkerCount: 0,
                  surfaceMarkerCount: 0,
                  accessBlockedObserved: true,
                  readiness: "ACCESS_GATE",
                },
              ],
            ]),
            "NONE",
            "HEADED",
          ),
      },
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.blocker).toBe("ACCESS_BLOCKED");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.browserMode.authoritativeMode).toBe("HEADED");
    expect(result.browserMode.diagnosticObservation?.blocker).toBe(
      "SECURITY_CHECKPOINT",
    );
  });

  it("reports missing headed infrastructure as environment/browser uncertainty", async () => {
    const result = await runNoSessionAutomaticProbe(
      target,
      {
        createHeadedBrowser: () => {
          throw new Error("NO_DISPLAY");
        },
      },
      "2026-09-18T11:00:00.000Z",
    );
    expect(result.blocker).toBe("BROWSER_UNAVAILABLE");
    expect(result.classification).toBe("UNKNOWN");
    expect(result.surfaceOutcome).toBe("BROWSER_FAILURE");
    expect(result.browserMode.headedInfrastructure).toBe("UNAVAILABLE");
    expect(result.browserMode.environmentLimited).toBe(true);
  });

  it("uses standard ephemeral sessionless Chromium modes without stealth or auth state", () => {
    const headed = createNoSessionChromeBrowserDriver({ mode: "HEADED" });
    const diagnostic = createNoSessionChromeBrowserDriver({
      mode: "HEADLESS_DIAGNOSTIC",
    });
    expect(headed.mode).toBe("HEADED");
    expect(headed.getRuntimeMetadata().headless).toBe(false);
    expect(diagnostic.mode).toBe("HEADLESS_DIAGNOSTIC");
    expect(diagnostic.getRuntimeMetadata().headless).toBe(true);
    expect(headed.sessionKind).toBe("EPHEMERAL_CONTROLLED");
    expect(
      Object.keys(headed).some((key) =>
        /storageState|cookie|header|persistent|stealth|fingerprint/i.test(key),
      ),
    ).toBe(false);
  });
});
