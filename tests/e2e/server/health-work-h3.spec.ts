import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ChromeBrowserDriver,
  H3SurfaceStrategyRegistry,
  createControlledTargetRegistry,
  createH3RunPlan,
  runH3BehavioralSmoke,
  runH3BehavioralSmokeFromRegistry,
  type H3ExecutionResult,
  type H3SurfaceStrategy,
} from "@product/health-runner";
import { createChatGPTWorkH3Strategy } from "../../../apps/health-runner/src/work-h3-strategy.js";
import { markPackagedH3Strategy } from "../../../apps/health-runner/src/h3-strategy-authority-internal.js";
import {
  startHealthWorkH3Fixture,
  type HealthWorkH3Fixture,
  type HealthWorkH3FixtureVariant,
} from "./support/health-work-h3-fixture.js";

const WORK_TARGET = "chatgpt_work_health";
const STANDARD_TARGET = "chatgpt_standard_health";

function createScriptedPage(
  realPage: Page,
  changedUrl: string,
  changedCanonicalHref: string,
  flipAtCanonicalHrefRead: number,
): Readonly<{
  page: Page;
  arm: () => void;
  canonicalHrefReads: () => number;
  drifted: () => boolean;
}> {
  let armed = false;
  let canonicalHrefReads = 0;
  let drifted = false;

  const canonicalLocator = (realLocator: Locator): Locator =>
    new Proxy(realLocator, {
      get(target, property) {
        if (property === "getAttribute") {
          return async (...args: Parameters<Locator["getAttribute"]>) => {
            const realResult = await target.getAttribute(...args);
            const [name] = args;
            if (name !== "href" || !armed) return realResult;
            canonicalHrefReads += 1;
            if (canonicalHrefReads >= flipAtCanonicalHrefRead) drifted = true;
            return drifted ? changedCanonicalHref : realResult;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  const page = new Proxy(realPage, {
    get(target, property) {
      if (property === "url")
        return () => (drifted ? changedUrl : target.url());
      if (property === "locator") {
        return (...args: Parameters<Page["locator"]>) => {
          const locator = target.locator(...args);
          return args[0] === 'link[rel="canonical"]'
            ? canonicalLocator(locator)
            : locator;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    page,
    arm: () => {
      armed = true;
      canonicalHrefReads = 0;
      drifted = false;
    },
    canonicalHrefReads: () => canonicalHrefReads,
    drifted: () => drifted,
  };
}

function withBridgeValidationArm(
  strategy: H3SurfaceStrategy,
  scriptedPage: ReturnType<typeof createScriptedPage>,
): H3SurfaceStrategy {
  return markPackagedH3Strategy(
    new Proxy(strategy, {
      get(target, property) {
        if (property === "validateBridgeSurfaces") {
          return (
            ...args: Parameters<H3SurfaceStrategy["validateBridgeSurfaces"]>
          ) => {
            scriptedPage.arm();
            return target.validateBridgeSurfaces(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  );
}

function expectC11BridgeFailure(result: H3ExecutionResult): void {
  expect(result.outcome).toBe("FAIL");
  expect(result.failureStep).toBe("VALIDATE_BRIDGE_SURFACES");
  expect(result.failureCode).toBe("BRIDGE_SURFACE_VALIDATION_FAILED");
  const bridgeEvent = result.events.find(
    (event) => event.step === "VALIDATE_BRIDGE_SURFACES",
  );
  expect(bridgeEvent?.observations).toHaveLength(4);
  expect(bridgeEvent?.observations.map((item) => item.contourKey)).toEqual([
    "C09_COMMAND_CODE_BLOCK_SURFACE",
    "C10_NATIVE_COPY_CONTROL",
    "C11_CONVERSATION_IDENTITY",
    "C12_DELIVERY_INSERTION_PATH",
  ]);
  const observations = bridgeEvent?.observations ?? [];
  expect(observations[0]).toMatchObject({
    primaryStrategyOutcome: "PASS",
    structuralOutcome: "PASS",
    behavioralOutcome: "PASS",
  });
  expect(observations[1]).toMatchObject({
    primaryStrategyOutcome: "PASS",
    structuralOutcome: "PASS",
    behavioralOutcome: "PASS",
  });
  expect(observations[2]).toMatchObject({
    observationStatus: "PRESENT",
    primaryStrategyOutcome: "FAIL",
    fallbackStrategyOutcomes: [
      { strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" },
    ],
    selectedStrategyId: "CONVERSATION_URL_IDENTITY",
    structuralOutcome: "FAIL",
    behavioralOutcome: "FAIL",
    fallbackQuality: "APPROVED_EQUIVALENT",
    environmentStatus: "VALID",
    uncertaintyReason: null,
    evidenceKind: "NONE",
  });
  expect(observations[3]).toMatchObject({
    primaryStrategyOutcome: "PASS",
    structuralOutcome: "PASS",
    behavioralOutcome: "PASS",
  });
}

async function runVariant(
  fixture: HealthWorkH3Fixture,
  variant: HealthWorkH3FixtureVariant,
  surface: "CHATGPT_WORK" | "CHATGPT_STANDARD" = "CHATGPT_WORK",
) {
  const targetKey = surface === "CHATGPT_WORK" ? WORK_TARGET : STANDARD_TARGET;
  const driver = new ChromeBrowserDriver(
    createControlledTargetRegistry([
      {
        key: targetKey,
        startUrl: fixture.startUrl(variant),
        // The fixture origin is test-only. The approved Work origin remains
        // required by the Work strategy and is the only packaged production origin.
        allowedTopLevelOrigins: [fixture.origin, "https://chatgpt.com"],
        browserFamily: "chrome",
        navigationTimeoutMs: 5_000,
      },
    ]),
  );
  try {
    await driver.start();
    await driver.open(targetKey);
    const strategy =
      surface === "CHATGPT_WORK"
        ? driver.createChatGPTWorkH3Strategy()
        : driver.createChatGPTStandardH3Strategy();
    const registry = new H3SurfaceStrategyRegistry([strategy]);
    return await runH3BehavioralSmokeFromRegistry(
      registry,
      createH3RunPlan(targetKey, surface, {
        stepTimeoutMs: 5_000,
        runTimeoutMs: 30_000,
      }),
    );
  } finally {
    await driver.closeOrPersist();
  }
}

async function expectState(
  fixture: HealthWorkH3Fixture,
  expected: Readonly<{ promptMatches: number; sendActivations: number }>,
): Promise<void> {
  await expect
    .poll(async () => {
      const response = await fetch(`${fixture.origin}/fixture-state`);
      return response.json();
    })
    .toEqual(expected);
}

async function expectNoSend(
  variant: HealthWorkH3FixtureVariant,
  failureCode: string,
): Promise<void> {
  const fixture = await startHealthWorkH3Fixture();
  try {
    const result = await runVariant(fixture, variant);
    expect(result.failureCode).toBe(failureCode);
    await expectState(fixture, {
      promptMatches: ["MISSING_SEND", "AMBIGUOUS_SEND"].includes(variant)
        ? 1
        : 0,
      sendActivations: 0,
    });
  } finally {
    await fixture.close();
  }
}

test.describe("B4 packaged ChatGPT Work H3", () => {
  test("runs Work through the single B2 engine with one physical Send", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(fixture, "VALID");
      expect(result.outcome).toBe("PASS");
      expect(result.completedSteps).toHaveLength(9);
      expect(result.surfaceProfile).toEqual({
        surface: "CHATGPT_WORK",
        profileId: "CHATGPT_WORK_H3_V1",
        profileRevision: 1,
      });
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
      expect(JSON.stringify(result)).not.toContain("Health check");
      expect(JSON.stringify(result)).not.toContain("BRIDGE_HEALTHCHECK_V1");
      expect(JSON.stringify(result)).not.toContain("Работа");
      expect(JSON.stringify(result)).not.toContain("test-project");
    } finally {
      await fixture.close();
    }
  });

  test("retains C11 provenance when a conversation drifts at validation", async ({
    page,
  }) => {
    const fixture = await startHealthWorkH3Fixture();
    const changedUrl = `${fixture.origin}/g/g-p-test-project/c/00000000-0000-4000-8000-000000000002`;
    const target = createControlledTargetRegistry([
      {
        key: WORK_TARGET,
        startUrl: fixture.startUrl("VALID"),
        allowedTopLevelOrigins: [fixture.origin, "https://chatgpt.com"],
        browserFamily: "chrome",
        navigationTimeoutMs: 5_000,
      },
    ]).resolve(WORK_TARGET);
    const scriptedPage = createScriptedPage(page, changedUrl, changedUrl, 3);
    try {
      await page.goto(target.startUrl);
      const strategy = withBridgeValidationArm(
        createChatGPTWorkH3Strategy(
          scriptedPage.page,
          target,
          async () => undefined,
        ),
        scriptedPage,
      );
      const result = await runH3BehavioralSmoke(
        strategy,
        createH3RunPlan(WORK_TARGET, "CHATGPT_WORK", {
          stepTimeoutMs: 5_000,
          runTimeoutMs: 30_000,
        }),
      );
      expect(scriptedPage.canonicalHrefReads()).toBeGreaterThanOrEqual(3);
      expect(scriptedPage.drifted()).toBe(true);
      expectC11BridgeFailure(result);
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test("keeps Send precedence when generation is already active", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(fixture, "TEXT_PRESENT_GENERATING");
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test("accepts a semantic Work marker without header/banner markup", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(fixture, "SEMANTIC_MARKER_NO_HEADER");
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test("does not let message text make a valid Work marker ambiguous", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(
        fixture,
        "VALID_WORK_MARKER_PLUS_MESSAGE_TEXT_WORK",
      );
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test("accepts a mature code-local Copy control", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(fixture, "VALID_CODE_LOCAL_COPY");
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test("does not confuse the Stop state with Send", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(fixture, "STOP_SEND_CONFUSION");
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test.describe("surface and composer gates", () => {
    for (const [variant, failureCode] of [
      ["MISSING_WORK_MARKER", "SURFACE_IDENTIFICATION_FAILED"],
      ["WORK_MARKER_CONTENT_ONLY", "SURFACE_IDENTIFICATION_FAILED"],
      ["AMBIGUOUS_WORK_MARKER", "SURFACE_IDENTIFICATION_FAILED"],
      ["STANDARD_SURFACE", "SURFACE_IDENTIFICATION_FAILED"],
      ["NO_ROUTE_SHAPE", "SURFACE_IDENTIFICATION_FAILED"],
      ["ROUTE_CANONICAL_CONFLICT", "SURFACE_IDENTIFICATION_FAILED"],
      ["MISSING_COMPOSER", "COMPOSER_IDENTIFICATION_FAILED"],
      ["AMBIGUOUS_COMPOSER", "COMPOSER_IDENTIFICATION_FAILED"],
      ["WRONG_COMPOSER_NAME", "COMPOSER_IDENTIFICATION_FAILED"],
      ["DISABLED_INPUT", "COMPOSER_IDENTIFICATION_FAILED"],
      ["MISSING_SEND", "SEND_FAILED"],
      ["AMBIGUOUS_SEND", "SEND_FAILED"],
    ] as const) {
      test(`${variant} fails closed before Send`, async () => {
        await expectNoSend(variant, failureCode);
      });
    }
  });

  test("Work never falls back to Standard and Standard rejects Work", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const workOnStandard = await runVariant(fixture, "STANDARD_SURFACE");
      expect(workOnStandard.failureCode).toBe("SURFACE_IDENTIFICATION_FAILED");
      const standardOnWork = await runVariant(
        fixture,
        "VALID",
        "CHATGPT_STANDARD",
      );
      expect(standardOnWork.failureCode).toBe("SURFACE_IDENTIFICATION_FAILED");
      await expectState(fixture, { promptMatches: 0, sendActivations: 0 });
    } finally {
      await fixture.close();
    }
  });

  test("Standard remains valid when Работа exists only in conversation content", async () => {
    const fixture = await startHealthWorkH3Fixture();
    try {
      const result = await runVariant(
        fixture,
        "WORK_MARKER_CONTENT_ONLY",
        "CHATGPT_STANDARD",
      );
      expect(result.outcome).toBe("PASS");
      await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
    } finally {
      await fixture.close();
    }
  });

  test.describe("bounded post-Send failures never retry", () => {
    for (const [variant, failureCode] of [
      ["BUSY_TIMEOUT", "BUSY_TIMEOUT"],
      ["RESPONSE_MISSING", "RESPONSE_TIMEOUT"],
      ["OLD_RESPONSE_ONLY", "RESPONSE_TIMEOUT"],
      ["COMPLETION_MISSING", "COMPLETION_TIMEOUT"],
      ["RESPONSE_SELF_BUSY_STUCK", "COMPLETION_TIMEOUT"],
      ["STOP_CLEARS_BUT_OTHER_BUSY_REMAINS", "COMPLETION_TIMEOUT"],
      ["BUSY_CLEARS_BUT_STOP_REMAINS", "COMPLETION_TIMEOUT"],
      ["EMPTY_RESPONSE_AFTER_GENERATION", "COMPLETION_TIMEOUT"],
      ["GENERATION_TEXT_IN_COMPLETED_RESPONSE", "__PASS__"],
      ["PROJECT_ROUTE_MUTATION", "BUSY_OBSERVATION_FAILED"],
      ["CONVERSATION_MUTATION", "BUSY_OBSERVATION_FAILED"],
      ["CODE_BLOCK_MISSING", "BRIDGE_SURFACE_VALIDATION_FAILED"],
      ["NATIVE_COPY_MISSING", "BRIDGE_SURFACE_VALIDATION_FAILED"],
      ["NATIVE_COPY_MISMATCHED", "BRIDGE_SURFACE_VALIDATION_FAILED"],
      ["RESPONSE_COPY_ONLY_WITH_CODE", "BRIDGE_SURFACE_VALIDATION_FAILED"],
      ["TABLE_COPY_ONLY_WITH_CODE", "BRIDGE_SURFACE_VALIDATION_FAILED"],
      ["DELIVERY_MISSING", "BRIDGE_SURFACE_VALIDATION_FAILED"],
    ] as const) {
      test(`${variant} has exactly one Send`, async () => {
        const fixture = await startHealthWorkH3Fixture();
        try {
          const result = await runVariant(fixture, variant);
          if (variant === "GENERATION_TEXT_IN_COMPLETED_RESPONSE") {
            expect(result.outcome).toBe("PASS");
          } else {
            expect(result.failureCode).toBe(failureCode);
          }
          await expectState(fixture, { promptMatches: 1, sendActivations: 1 });
        } finally {
          await fixture.close();
        }
      });
    }
  });

  test.describe("bounded environment blockers", () => {
    for (const [variant, reason] of [
      ["LOGIN_EXPIRED", "LOGIN_EXPIRED"],
      ["CAPTCHA_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      ["VERIFICATION_CHECKPOINT", "VERIFICATION_CHECKPOINT"],
      ["ACCOUNT_BLOCKED", "ACCOUNT_BLOCKED"],
    ] as const) {
      test(`${variant} is uncertain with no Send`, async () => {
        const fixture = await startHealthWorkH3Fixture();
        try {
          const result = await runVariant(fixture, variant);
          expect(result.outcome).toBe("UNCERTAIN");
          expect(result.environmentUncertainty).toBe(reason);
          await expectState(fixture, { promptMatches: 0, sendActivations: 0 });
        } finally {
          await fixture.close();
        }
      });
    }
  });
});
