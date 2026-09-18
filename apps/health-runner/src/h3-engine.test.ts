import { describe, expect, it } from "vitest";
import {
  H3SurfaceStrategyRegistry,
  runH3BehavioralSmoke,
  runH3BehavioralSmokeFromRegistry,
} from "./h3-engine.js";
import {
  H3_BEHAVIOR_STEP_ORDER,
  createH3RunPlan,
  type H3PromptId,
} from "./h3-contracts.js";
import { getPackagedH3Profile } from "./h3-actions.js";
import type { H3BridgeSurfaceCheck, H3SurfaceProfile } from "./h3-actions.js";
import {
  parseH3StrategyStepResult,
  type H3StrategyStepResult,
  type H3SurfaceStrategy,
} from "./h3-strategy.js";
import type { H3Clock } from "./h3-engine.js";

const STANDARD_TARGET = "chatgpt_standard_health";
const WORK_TARGET = "chatgpt_work_health";

const pass = (): H3StrategyStepResult =>
  parseH3StrategyStepResult({
    outcome: "PASS",
    markerCount: 1,
    transitionObserved: true,
    uncertaintyReason: null,
  });

const fail = (): H3StrategyStepResult =>
  parseH3StrategyStepResult({
    outcome: "FAIL",
    markerCount: 0,
    transitionObserved: false,
    uncertaintyReason: null,
  });

const uncertain = (): H3StrategyStepResult =>
  parseH3StrategyStepResult({
    outcome: "UNCERTAIN",
    markerCount: null,
    transitionObserved: null,
    uncertaintyReason: null,
  });

class ControlledClock implements H3Clock {
  #now = 0;
  #nextId = 1;
  #timers = new Map<number, { at: number; callback: () => void }>();

  public now(): number {
    return this.#now;
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + Math.max(0, delayMs), callback });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.#timers.delete(handle);
  }

  public advanceBy(delayMs: number): void {
    this.#now += delayMs;
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= this.#now)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) return;
      this.#timers.delete(due[0]);
      due[1].callback();
    }
  }
}

type FailurePoint =
  | "identifySurface"
  | "identifyComposer"
  | "insertPrompt"
  | "sendOnce"
  | "observeBusy"
  | "observeResponse"
  | "observeCompletion"
  | "validateBridgeSurfaces"
  | "cleanup";

class FakeH3Strategy implements H3SurfaceStrategy {
  public readonly calls: string[] = [];
  public readonly insertedPromptIds: H3PromptId[] = [];
  public readonly surfaceProfile: H3SurfaceProfile;
  public readonly targetKey: string;
  public failurePoint: FailurePoint | null = null;
  public failureMode: "RESULT" | "UNCERTAIN" | "THROW" = "RESULT";
  public delayMs = 0;
  public cleanupCalls = 0;

  public constructor(
    profileSurface: "CHATGPT_STANDARD" | "CHATGPT_WORK",
    targetSurface: "CHATGPT_STANDARD" | "CHATGPT_WORK" = profileSurface,
  ) {
    this.surfaceProfile = getPackagedH3Profile(profileSurface);
    this.targetKey =
      targetSurface === "CHATGPT_STANDARD" ? STANDARD_TARGET : WORK_TARGET;
  }

  public identifyApprovedSurface(): Promise<H3StrategyStepResult> {
    return this.respond("identifySurface");
  }

  public identifyApprovedComposer(): Promise<H3StrategyStepResult> {
    return this.respond("identifyComposer");
  }

  public insertPackagedPrompt(
    promptId: H3PromptId,
  ): Promise<H3StrategyStepResult> {
    this.insertedPromptIds.push(promptId);
    return this.respond("insertPrompt");
  }

  public sendOnce(): Promise<H3StrategyStepResult> {
    return this.respond("sendOnce");
  }

  public observeBusy(): Promise<H3StrategyStepResult> {
    return this.respond("observeBusy");
  }

  public observeResponse(): Promise<H3StrategyStepResult> {
    return this.respond("observeResponse");
  }

  public observeCompletion(): Promise<H3StrategyStepResult> {
    return this.respond("observeCompletion");
  }

  public validateBridgeSurfaces(
    checks: readonly H3BridgeSurfaceCheck[],
  ): Promise<H3StrategyStepResult> {
    expect(checks).toEqual([
      "COMMAND_CODE_BLOCK_SURFACE",
      "NATIVE_COPY_CONTROL",
      "CONVERSATION_IDENTITY",
      "DELIVERY_INSERTION_PATH",
    ]);
    return this.respond("validateBridgeSurfaces");
  }

  public async cleanup(): Promise<void> {
    this.cleanupCalls += 1;
    this.calls.push("cleanup");
    if (this.failurePoint === "cleanup" && this.failureMode === "THROW") {
      throw new Error("raw cleanup detail must not escape");
    }
  }

  private respond(
    point: Exclude<FailurePoint, "cleanup">,
  ): Promise<H3StrategyStepResult> {
    this.calls.push(point);
    const result =
      this.failurePoint === point && this.failureMode === "RESULT"
        ? fail()
        : this.failurePoint === point && this.failureMode === "UNCERTAIN"
          ? uncertain()
          : pass();
    if (this.failurePoint === point && this.failureMode === "THROW") {
      return Promise.reject(new Error("raw browser detail must not escape"));
    }
    const delayMs = this.failurePoint === point ? this.delayMs : 0;
    if (delayMs === 0) return Promise.resolve(result);
    return new Promise((resolve) => {
      // The test-only controlled clock makes timeout behavior deterministic.
      const clock = this.clock;
      clock.setTimeout(() => resolve(result), delayMs);
    });
  }

  private clock: ControlledClock = new ControlledClock();

  public useClock(clock: ControlledClock): void {
    this.clock = clock;
  }
}

function plan(
  surface: "CHATGPT_STANDARD" | "CHATGPT_WORK" = "CHATGPT_STANDARD",
  options: Readonly<{ stepTimeoutMs?: number; runTimeoutMs?: number }> = {},
) {
  return createH3RunPlan(
    surface === "CHATGPT_STANDARD" ? STANDARD_TARGET : WORK_TARGET,
    surface,
    options,
  );
}

async function settle(
  promise: Promise<unknown>,
  clock: ControlledClock,
  advanceMs = 0,
): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    await Promise.resolve();
  }
  if (advanceMs > 0) clock.advanceBy(advanceMs);
  for (let index = 0; index < 32; index += 1) {
    await Promise.resolve();
  }
  await promise;
}

describe("B2 common H3 execution engine", () => {
  it("executes the accepted packaged sequence in order with one send", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    const result = await runH3BehavioralSmoke(strategy, plan());

    expect(result.outcome).toBe("PASS");
    expect(strategy.calls).toEqual([
      "identifySurface",
      "identifyComposer",
      "insertPrompt",
      "sendOnce",
      "observeBusy",
      "observeResponse",
      "observeCompletion",
      "validateBridgeSurfaces",
      "cleanup",
    ]);
    expect(strategy.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );
    expect(strategy.insertedPromptIds).toEqual(["BRIDGE_COMMAND_SMOKE_V1"]);
    expect(result.completedSteps).toEqual(H3_BEHAVIOR_STEP_ORDER);
  });

  it("fails before send and still cleans up exactly once", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    strategy.failurePoint = "identifyComposer";

    const result = await runH3BehavioralSmoke(strategy, plan());

    expect(result.failureCode).toBe("COMPOSER_IDENTIFICATION_FAILED");
    expect(strategy.calls).not.toContain("sendOnce");
    expect(strategy.cleanupCalls).toBe(1);
    expect(result.cleanupOutcome).toBe("PASS");
  });

  it("does not retry a failed or uncertain send", async () => {
    const failed = new FakeH3Strategy("CHATGPT_STANDARD");
    failed.failurePoint = "sendOnce";
    const failedResult = await runH3BehavioralSmoke(failed, plan());
    expect(failedResult.failureCode).toBe("SEND_FAILED");
    expect(failed.calls.filter((call) => call === "sendOnce")).toHaveLength(1);

    const uncertain = new FakeH3Strategy("CHATGPT_STANDARD");
    uncertain.failurePoint = "sendOnce";
    uncertain.failureMode = "THROW";
    const uncertainResult = await runH3BehavioralSmoke(uncertain, plan());
    expect(uncertainResult.failureCode).toBe("SEND_FAILED");
    expect(uncertain.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );

    const ambiguous = new FakeH3Strategy("CHATGPT_STANDARD");
    ambiguous.failurePoint = "sendOnce";
    ambiguous.failureMode = "UNCERTAIN";
    const ambiguousResult = await runH3BehavioralSmoke(ambiguous, plan());
    expect(ambiguousResult.outcome).toBe("UNCERTAIN");
    expect(ambiguousResult.failureCode).toBe("SEND_UNCERTAIN");
    expect(ambiguous.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );
  });

  it("does not resend after a post-send failure", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    strategy.failurePoint = "observeResponse";

    const result = await runH3BehavioralSmoke(strategy, plan());

    expect(result.failureCode).toBe("RESPONSE_OBSERVATION_FAILED");
    expect(strategy.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );
    expect(strategy.cleanupCalls).toBe(1);
  });

  it.each([
    ["observeBusy", "BUSY_TIMEOUT"],
    ["observeResponse", "RESPONSE_TIMEOUT"],
    ["observeCompletion", "COMPLETION_TIMEOUT"],
  ] as const)("does not resend after %s timeout", async (point, code) => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    const clock = new ControlledClock();
    strategy.useClock(clock);
    strategy.failurePoint = point;
    strategy.delayMs = 500;
    const run = runH3BehavioralSmoke(
      strategy,
      plan("CHATGPT_STANDARD", { stepTimeoutMs: 250, runTimeoutMs: 5_000 }),
      { clock },
    );

    await settle(run, clock, 250);
    const result = await run;
    expect(result.failureCode).toBe(code);
    expect(strategy.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );
    expect(strategy.cleanupCalls).toBe(1);
  });

  it("reports cleanup failure and preserves both primary and cleanup failures", async () => {
    const cleanupOnly = new FakeH3Strategy("CHATGPT_STANDARD");
    cleanupOnly.failurePoint = "cleanup";
    cleanupOnly.failureMode = "THROW";
    const cleanupResult = await runH3BehavioralSmoke(cleanupOnly, plan());
    expect(cleanupResult.failureCode).toBe("CLEANUP_FAILED");
    expect(cleanupResult.cleanupFailureCode).toBe("CLEANUP_FAILED");

    const both = new FakeH3Strategy("CHATGPT_STANDARD");
    both.failurePoint = "observeCompletion";
    both.failureMode = "THROW";
    const originalCleanup = both.cleanup.bind(both);
    both.cleanup = async () => {
      await originalCleanup();
      throw new Error("raw cleanup detail must not escape");
    };
    const bothResult = await runH3BehavioralSmoke(both, plan());
    expect(bothResult.failureCode).toBe("COMPLETION_OBSERVATION_FAILED");
    expect(bothResult.cleanupFailureCode).toBe("CLEANUP_FAILED");
    expect(
      bothResult.events.every((event) => !Object.hasOwn(event, "text")),
    ).toBe(true);
  });

  it("enforces the total run budget without retrying send", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    const clock = new ControlledClock();
    strategy.useClock(clock);
    strategy.failurePoint = "observeBusy";
    strategy.delayMs = 1_500;
    const run = runH3BehavioralSmoke(
      strategy,
      plan("CHATGPT_STANDARD", { stepTimeoutMs: 5_000, runTimeoutMs: 1_000 }),
      { clock },
    );

    await settle(run, clock, 1_000);
    const result = await run;
    expect(result.failureCode).toBe("RUN_TIMEOUT");
    expect(strategy.calls.filter((call) => call === "sendOnce")).toHaveLength(
      1,
    );
    expect(strategy.cleanupCalls).toBe(1);
  });

  it("rejects injected/reordered actions before strategy execution", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    const valid = plan();
    await expect(
      runH3BehavioralSmoke(strategy, {
        ...valid,
        actions: [{ kind: "CLICK", selector: "#send" }],
      }),
    ).rejects.toThrow();
    await expect(
      runH3BehavioralSmoke(strategy, {
        ...valid,
        steps: [...valid.steps].reverse(),
      }),
    ).rejects.toThrow();
    expect(strategy.calls).toEqual([]);
  });

  it("isolates Standard and Work strategies through one registry and rejects mismatches", async () => {
    const standard = new FakeH3Strategy("CHATGPT_STANDARD");
    const work = new FakeH3Strategy("CHATGPT_WORK");
    const registry = new H3SurfaceStrategyRegistry([standard, work]);

    const standardResult = await runH3BehavioralSmokeFromRegistry(
      registry,
      plan("CHATGPT_STANDARD"),
    );
    const workResult = await runH3BehavioralSmokeFromRegistry(
      registry,
      plan("CHATGPT_WORK"),
    );
    expect(standardResult.surfaceProfile.profileId).toBe(
      "CHATGPT_STANDARD_H3_V2",
    );
    expect(workResult.surfaceProfile.profileId).toBe("CHATGPT_WORK_H3_V1");
    expect(standard.calls).toContain("sendOnce");
    expect(work.calls).toContain("sendOnce");

    const mismatched = new FakeH3Strategy("CHATGPT_WORK");
    await expect(
      runH3BehavioralSmoke(mismatched, plan("CHATGPT_STANDARD")),
    ).rejects.toMatchObject({
      code: "TARGET_SURFACE_MISMATCH",
    });
    expect(mismatched.calls).toEqual([]);

    const mismatchedProfile = new FakeH3Strategy(
      "CHATGPT_WORK",
      "CHATGPT_STANDARD",
    );
    await expect(
      runH3BehavioralSmoke(mismatchedProfile, plan("CHATGPT_STANDARD")),
    ).rejects.toMatchObject({ code: "STRATEGY_PROFILE_MISMATCH" });
    expect(mismatchedProfile.calls).toEqual([]);
  });

  it("rejects a target that is not packaged for the selected surface", async () => {
    const strategy = new FakeH3Strategy("CHATGPT_STANDARD");
    await expect(
      runH3BehavioralSmoke(
        strategy,
        createH3RunPlan(WORK_TARGET, "CHATGPT_STANDARD"),
      ),
    ).rejects.toMatchObject({ code: "TARGET_SURFACE_MISMATCH" });
  });

  it("keeps the exported engine surface semantic and bounded", () => {
    expect("click" in (runH3BehavioralSmoke as object)).toBe(false);
    expect("fill" in (runH3BehavioralSmoke as object)).toBe(false);
    expect("evaluate" in (runH3BehavioralSmoke as object)).toBe(false);
  });
});
