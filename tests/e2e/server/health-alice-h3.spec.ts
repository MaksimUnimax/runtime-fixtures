import { expect, test } from "@playwright/test";
import {
  ChromeBrowserDriver,
  H3SurfaceStrategyRegistry,
  createPackagedAliceH3TargetRegistry,
  createControlledTargetRegistry,
  createH3RunPlan,
  runH3BehavioralSmoke,
  runH3BehavioralSmokeFromRegistry,
} from "@product/health-runner";
import { createAliceH3Strategy } from "../../../apps/health-runner/src/alice-h3-strategy.js";
import {
  ALICE_H3_PROFILE,
  resolveAliceConversationIdentity,
} from "../../../apps/health-runner/src/alice-h3-profile.js";
import {
  startHealthAliceH3Fixture,
  type HealthAliceH3Fixture,
  type HealthAliceH3FixtureVariant,
} from "./support/health-alice-h3-fixture.js";

const TARGET_KEY = "alice_health";

async function runVariant(
  fixture: HealthAliceH3Fixture,
  variant: HealthAliceH3FixtureVariant,
  allowedOrigin = fixture.origin,
) {
  const driver = new ChromeBrowserDriver(
    createControlledTargetRegistry([
      {
        key: TARGET_KEY,
        startUrl: fixture.startUrl(variant),
        allowedTopLevelOrigins: [allowedOrigin],
        browserFamily: "chrome",
        navigationTimeoutMs: 5_000,
      },
    ]),
  );
  try {
    await driver.start();
    await driver.open(TARGET_KEY);
    const strategy = driver.createAliceH3Strategy();
    const registry = new H3SurfaceStrategyRegistry([strategy]);
    return await runH3BehavioralSmokeFromRegistry(
      registry,
      createH3RunPlan(TARGET_KEY, "ALICE", {
        stepTimeoutMs: 5_000,
        runTimeoutMs: 30_000,
      }),
    );
  } finally {
    await driver.closeOrPersist();
  }
}

async function expectNoSend(
  fixture: HealthAliceH3Fixture,
  variant: HealthAliceH3FixtureVariant,
  failureCode: string,
) {
  const result = await runVariant(fixture, variant);
  expect(result.outcome).toBe("FAIL");
  expect(result.failureCode).toBe(failureCode);
  expect(fixture.sendActivations).toBe(0);
}

test.describe("ALICE_H3_NONLIVE_CURRENT_STREAM2_CANDIDATE", () => {
  test("runs the Alice strategy through the common H3 engine", async () => {
    const fixture = await startHealthAliceH3Fixture();
    try {
      const result = await runVariant(fixture, "VALID");
      expect(result.outcome).toBe("PASS");
      expect(result.completedSteps).toHaveLength(9);
      expect(result.surfaceProfile).toEqual({
        surface: "ALICE",
        profileId: "ALICE_H3_V1",
        profileRevision: 1,
      });
      expect(fixture.promptMatches).toBe(1);
      expect(fixture.sendActivations).toBe(1);
      expect(JSON.stringify(result)).not.toMatch(
        /Health check|BRIDGE_HEALTHCHECK_V1|selector|html|cookie/i,
      );
    } finally {
      await fixture.close();
    }
  });

  test("requires the exact packaged Alice target origin", async () => {
    expect(ALICE_H3_PROFILE.approvedOrigin).toBe("https://alice.yandex.ru");
    const target = createPackagedAliceH3TargetRegistry().resolve(TARGET_KEY);
    expect(target.startUrl).toBe("https://alice.yandex.ru/");
    expect(target.allowedTopLevelOrigins).toEqual(["https://alice.yandex.ru"]);
  });

  test("wrong page origin fails before Send", async ({ page }) => {
    const fixture = await startHealthAliceH3Fixture();
    try {
      const target = createControlledTargetRegistry([
        {
          key: TARGET_KEY,
          startUrl: fixture.startUrl("VALID"),
          allowedTopLevelOrigins: [fixture.origin],
          browserFamily: "chrome",
          navigationTimeoutMs: 5_000,
        },
      ]).resolve(TARGET_KEY);
      await page.goto("about:blank");
      const result = await runH3BehavioralSmoke(
        createAliceH3Strategy(page, target, async () => undefined),
        createH3RunPlan(TARGET_KEY, "ALICE"),
      );
      expect(result.failureCode).toBe("SURFACE_IDENTIFICATION_FAILED");
      expect(fixture.sendActivations).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  test.describe("identity and composer fail-closed cases", () => {
    for (const [variant, failureCode] of [
      ["NO_ACTIVE_HISTORY", "SURFACE_IDENTIFICATION_FAILED"],
      ["ACTIVE_HISTORY_DRIFT", "SURFACE_IDENTIFICATION_FAILED"],
      ["DUPLICATE_COMPOSER", "COMPOSER_IDENTIFICATION_FAILED"],
      ["MISSING_COMPOSER", "COMPOSER_IDENTIFICATION_FAILED"],
      ["MISSING_INPUT", "COMPOSER_IDENTIFICATION_FAILED"],
      ["NO_ACTIVE_INPUT_CONTROLS", "COMPOSER_IDENTIFICATION_FAILED"],
    ] as const) {
      test(`${variant} fails before Send`, async () => {
        const fixture = await startHealthAliceH3Fixture();
        try {
          await expectNoSend(fixture, variant, failureCode);
        } finally {
          await fixture.close();
        }
      });
    }
  });

  test.describe("Alice control state authority", () => {
    for (const variant of [
      "BLOCKED_SEND",
      "STOP_CONTROL",
      "READY_CONTROL",
      "UNKNOWN_CONTROL",
    ] as const) {
      test(`${variant} is not Send`, async () => {
        const fixture = await startHealthAliceH3Fixture();
        try {
          await expectNoSend(fixture, variant, "SEND_FAILED");
        } finally {
          await fixture.close();
        }
      });
    }
  });

  test.describe("one-shot and post-send boundaries", () => {
    for (const [variant, failureCode, failureStep] of [
      ["NO_GENERATION", "BUSY_TIMEOUT", "OBSERVE_BUSY"],
      ["OLD_RESPONSE_ONLY", "RESPONSE_TIMEOUT", "OBSERVE_RESPONSE"],
      ["RESPONSE_NO_ID", "RESPONSE_TIMEOUT", "OBSERVE_RESPONSE"],
      ["IDENTITY_DRIFT", "BUSY_OBSERVATION_FAILED", "OBSERVE_BUSY"],
      [
        "RESPONSE_REPLACED",
        "COMPLETION_OBSERVATION_FAILED",
        "OBSERVE_COMPLETION",
      ],
      ["COMPOSER_REPLACED", "SEND_FAILED", "SEND_ONCE"],
    ] as const) {
      test(`${variant} never retries`, async () => {
        const fixture = await startHealthAliceH3Fixture();
        try {
          const result = await runVariant(fixture, variant);
          expect(result.outcome).toBe("FAIL");
          expect(result.failureCode).toBe(failureCode);
          expect(result.failureStep).toBe(failureStep);
          expect(fixture.promptMatches).toBe(1);
          expect(fixture.sendActivations).toBe(
            variant === "COMPOSER_REPLACED" ? 0 : 1,
          );
        } finally {
          await fixture.close();
        }
      });
    }
  });

  test.describe("Alice-owned response and bridge surfaces", () => {
    for (const variant of [
      "EMPTY_RESPONSE",
      "CODE_MISSING",
      "COPY_MISSING",
      "EXTERNAL_COPY_ONLY",
    ] as const) {
      test(`${variant} does not satisfy completion/Copy ownership`, async () => {
        const fixture = await startHealthAliceH3Fixture();
        try {
          const result = await runVariant(fixture, variant);
          expect(result.failureCode).toBe(
            variant === "EMPTY_RESPONSE"
              ? "COMPLETION_TIMEOUT"
              : "BRIDGE_SURFACE_VALIDATION_FAILED",
          );
          expect(fixture.sendActivations).toBe(1);
        } finally {
          await fixture.close();
        }
      });
    }
  });

  test("identity resolver ignores canonical and requires Alice active-history corroboration", async ({
    page,
  }) => {
    const fixture = await startHealthAliceH3Fixture();
    try {
      await page.goto(fixture.startUrl("VALID"));
      const resolution = await resolveAliceConversationIdentity(
        page,
        fixture.origin,
      );
      expect(resolution).toEqual({
        kind: "BOUND",
        id: "00000000-0000-4000-8000-000000000001",
      });
    } finally {
      await fixture.close();
    }
  });
});
