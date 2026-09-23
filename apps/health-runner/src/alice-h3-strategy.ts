import type { ElementHandle, Locator, Page } from "playwright";
import { type EnvironmentUncertaintyReason } from "@product/health";
import {
  H3SurfaceProfileSchema,
  type H3BridgeSurfaceCheck,
  type H3SurfaceProfile,
} from "./h3-actions.js";
import {
  getPackagedH3Prompt,
  H3PromptIdSchema,
  type H3PromptId,
} from "./h3-contracts.js";
import { getPackagedH3Target } from "./h3-engine.js";
import {
  createH3ContourObservation,
  H3StrategyStepResultSchema,
  type H3ContourObservation,
  type H3StrategyStepResult,
  type H3SurfaceStrategy,
} from "./h3-strategy.js";
import type {
  ControlledTarget,
  ControlledTargetKey,
} from "./target-registry.js";
import {
  ALICE_H3_PROFILE,
  aliceAssistantMessages,
  aliceCodeBlocks,
  aliceCodeContents,
  aliceComposerRoots,
  aliceCopyControls,
  aliceInputCandidates,
  aliceMessageId,
  aliceOknyxControls,
  aliceStopControls,
  aliceSurfaceRoot,
  resolveAliceConversationIdentity,
  type AliceConversationIdentityResolution,
} from "./alice-h3-profile.js";
import { markPackagedH3Strategy } from "./h3-strategy-authority-internal.js";

const ALICE_PROFILE: H3SurfaceProfile = Object.freeze({
  surface: ALICE_H3_PROFILE.surface,
  profileId: ALICE_H3_PROFILE.profileId,
  profileRevision: ALICE_H3_PROFILE.profileRevision,
});
const ALICE_TARGET = getPackagedH3Target("ALICE");
const HEALTH_TOKEN = "BRIDGE_HEALTHCHECK_V1";
const EXPECTED_CHECKS: readonly H3BridgeSurfaceCheck[] = Object.freeze([
  "COMMAND_CODE_BLOCK_SURFACE",
  "NATIVE_COPY_CONTROL",
  "CONVERSATION_IDENTITY",
  "DELIVERY_INSERTION_PATH",
]);

const pass = (
  markerCount: number,
  transitionObserved: boolean,
  observations: readonly H3ContourObservation[] = [],
): H3StrategyStepResult =>
  H3StrategyStepResultSchema.parse({
    outcome: "PASS",
    markerCount: Math.min(64, Math.max(0, markerCount)),
    transitionObserved,
    uncertaintyReason: null,
    observations,
  });

const fail = (
  markerCount = 0,
  observations: readonly H3ContourObservation[] = [],
): H3StrategyStepResult =>
  H3StrategyStepResultSchema.parse({
    outcome: "FAIL",
    markerCount: Math.min(64, Math.max(0, markerCount)),
    transitionObserved: false,
    uncertaintyReason: null,
    observations,
  });

const uncertain = (
  reason: EnvironmentUncertaintyReason,
): H3StrategyStepResult =>
  H3StrategyStepResultSchema.parse({
    outcome: "UNCERTAIN",
    markerCount: null,
    transitionObserved: null,
    uncertaintyReason: reason,
    observations: [
      createH3ContourObservation({
        contourKey: "C13_BLOCKING_STATE",
        observationStatus: "PRESENT",
        primaryStrategyOutcome: "UNCERTAIN",
        fallbackStrategyOutcomes: [],
        selectedStrategyId: null,
        structuralOutcome: "UNCERTAIN",
        behavioralOutcome: "UNCERTAIN",
        fallbackQuality: "NOT_APPLICABLE",
        environmentStatus: "UNCERTAIN",
        uncertaintyReason: reason,
        evidenceKind: "NONE",
      }),
    ],
  });

function observation(
  contourKey: H3ContourObservation["contourKey"],
  outcome: H3ContourObservation["primaryStrategyOutcome"],
  structuralOutcome: H3ContourObservation["structuralOutcome"],
  behavioralOutcome: H3ContourObservation["behavioralOutcome"],
  selectedStrategyId: H3ContourObservation["selectedStrategyId"],
  evidenceKind: H3ContourObservation["evidenceKind"] = "NONE",
): H3ContourObservation {
  return createH3ContourObservation({
    contourKey,
    observationStatus: "PRESENT",
    primaryStrategyOutcome: outcome,
    fallbackStrategyOutcomes: [],
    selectedStrategyId,
    structuralOutcome,
    behavioralOutcome,
    fallbackQuality: "NOT_APPLICABLE",
    environmentStatus: "VALID",
    uncertaintyReason: null,
    evidenceKind,
  });
}

function boundedCount(value: number): number {
  return Math.min(64, Math.max(0, value));
}

function safeMessageId(value: string | null): string | null {
  return value !== null && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
    ? value
    : null;
}

function isExpectedChecks(checks: readonly H3BridgeSurfaceCheck[]): boolean {
  return (
    checks.length === EXPECTED_CHECKS.length &&
    checks.every((check, index) => check === EXPECTED_CHECKS[index])
  );
}

async function isDisabled(locator: Locator): Promise<boolean> {
  const [enabled, ariaDisabled] = await Promise.all([
    locator.isEnabled({ timeout: 1_000 }).catch(() => false),
    locator.getAttribute("aria-disabled"),
  ]);
  return !enabled || ariaDisabled === "true";
}

async function sameElement(
  stored: ElementHandle<HTMLElement | SVGElement> | null,
  current: Locator,
): Promise<boolean> {
  if (!stored) return false;
  const currentHandle = await current.elementHandle().catch(() => null);
  if (!currentHandle) return false;
  try {
    return await stored.evaluate(
      (node, other) => node === other,
      currentHandle,
    );
  } catch {
    return false;
  } finally {
    await currentHandle.dispose().catch(() => undefined);
  }
}

export function createAliceH3Strategy(
  page: Page,
  target: ControlledTarget,
  closeSession: () => Promise<void>,
): H3SurfaceStrategy {
  if (target.key !== ALICE_TARGET) throw new Error("ALICE_TARGET_REQUIRED");
  H3SurfaceProfileSchema.parse(ALICE_PROFILE);
  return markPackagedH3Strategy(
    new AliceH3Strategy(page, target, closeSession),
  );
}

class AliceH3Strategy implements H3SurfaceStrategy {
  public readonly surfaceProfile = ALICE_PROFILE;
  public readonly targetKey: ControlledTargetKey = ALICE_TARGET;
  #page: Page | undefined;
  #target: ControlledTarget | undefined;
  #closeSession: (() => Promise<void>) | undefined;
  #surface: Locator | undefined;
  #composer: Locator | undefined;
  #input: Locator | undefined;
  #assistantMessages: Locator | undefined;
  #associatedResponse: Locator | undefined;
  #inputHandle: ElementHandle<HTMLElement | SVGElement> | null = null;
  #composerHandle: ElementHandle<HTMLElement | SVGElement> | null = null;
  #responseHandle: ElementHandle<HTMLElement | SVGElement> | null = null;
  #conversationId: string | null = null;
  #baselineMessageIds = new Set<string>();
  #baselineMessageCount = 0;
  #promptInserted = false;
  #sendInvoked = false;
  #observedGenerating = false;

  public constructor(
    page: Page,
    target: ControlledTarget,
    closeSession: () => Promise<void>,
  ) {
    this.#page = page;
    this.#target = target;
    this.#closeSession = closeSession;
  }

  public async identifyApprovedSurface(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const blocker = await this.#environmentBlocker();
      if (blocker) return blocker;
      const page = this.#page;
      const target = this.#target;
      if (
        !page ||
        !target ||
        !this.#isAllowedOrigin(page, target) ||
        !this.#isAliceSurfaceOrigin(target)
      )
        return fail();
      const surface = aliceSurfaceRoot(page);
      if (
        (await surface.count()) !== 1 ||
        !(await surface.isVisible({ timeout: 1_000 }))
      )
        return fail(await surface.count());

      const identity = await this.#resolveIdentity();
      if (identity.kind !== "BOUND") return fail();
      const assistantMessages = aliceAssistantMessages(surface);
      const count = await assistantMessages.count();
      if (count > 64) return fail(count);
      this.#baselineMessageIds.clear();
      for (let index = 0; index < count; index += 1) {
        const id = safeMessageId(
          await aliceMessageId(assistantMessages.nth(index)),
        );
        if (!id) return fail(count);
        this.#baselineMessageIds.add(id);
      }
      this.#surface = surface;
      this.#assistantMessages = assistantMessages;
      this.#baselineMessageCount = count;
      this.#conversationId = identity.id;
      return pass(3, false, [
        observation(
          "C01_PAGE_IDENTITY",
          "PASS",
          "PASS",
          "PASS",
          "PAGE_HOST_MARKER",
          "METADATA",
        ),
        observation(
          "C02_CONVERSATION_ROOT",
          "PASS",
          "PASS",
          "PASS",
          "CONVERSATION_ANCHOR",
          "METADATA",
        ),
        observation(
          "C11_CONVERSATION_IDENTITY",
          "PASS",
          "PASS",
          "PASS",
          "CONVERSATION_URL_IDENTITY",
          "METADATA",
        ),
      ]);
    });
  }

  public async identifyApprovedComposer(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const surface = this.#surface;
      if (!surface) return fail();
      const roots = aliceComposerRoots(surface);
      const valid: Array<{ root: Locator; input: Locator }> = [];
      for (let index = 0; index < (await roots.count()); index += 1) {
        const root = roots.nth(index);
        const inputs = aliceInputCandidates(root);
        if ((await inputs.count()) !== 1) continue;
        const input = inputs.first();
        if (
          !(await root.isVisible({ timeout: 1_000 }).catch(() => false)) ||
          !(await input.isVisible({ timeout: 1_000 }).catch(() => false)) ||
          !(await input.isEditable({ timeout: 1_000 }).catch(() => false))
        )
          continue;
        valid.push({ root, input });
      }
      if (valid.length !== 1) return fail(valid.length);
      const selected = valid[0];
      if (!selected) return fail();
      const controls = aliceOknyxControls(selected.root);
      if ((await controls.count()) !== 1) return fail();
      if (
        (await selected.root
          .locator(ALICE_H3_PROFILE.selectors.inputControlsRoot)
          .count()) !== 1
      )
        return fail();
      this.#composer = selected.root;
      this.#input = selected.input;
      this.#composerHandle = await selected.root.elementHandle();
      this.#inputHandle = await selected.input.elementHandle();
      if (!this.#composerHandle || !this.#inputHandle) return fail();
      return pass(2, false, [
        observation(
          "C03_COMPOSER_ROOT",
          "PASS",
          "PASS",
          "PASS",
          "COMPOSER_CONTAINER",
          "METADATA",
        ),
        observation(
          "C04_COMPOSER_INPUT",
          "PASS",
          "PASS",
          "PASS",
          "EDITABLE_INPUT",
          "METADATA",
        ),
        observation(
          "C12_DELIVERY_INSERTION_PATH",
          "PASS",
          "PASS",
          "PASS",
          "DELIVERY_TARGET",
          "METADATA",
        ),
      ]);
    });
  }

  public async insertPackagedPrompt(
    promptId: H3PromptId,
  ): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const input = this.#input;
      if (
        !input ||
        !this.#inputHandle ||
        !H3PromptIdSchema.safeParse(promptId).success ||
        !(await sameElement(this.#inputHandle, input))
      )
        return fail();
      const prompt = getPackagedH3Prompt(promptId);
      await input.fill(prompt);
      const inserted = (await this.#readInput(input)) === prompt;
      this.#promptInserted = inserted;
      return inserted
        ? pass(1, true, [
            observation(
              "C04_COMPOSER_INPUT",
              "PASS",
              "PASS",
              "PASS",
              "EDITABLE_INPUT",
              "STATE_TRANSITION_TRACE",
            ),
          ])
        : fail();
    });
  }

  public async sendOnce(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const composer = this.#composer;
      const input = this.#input;
      if (
        !composer ||
        !input ||
        !this.#promptInserted ||
        this.#sendInvoked ||
        !this.#composerHandle ||
        !this.#inputHandle ||
        !(await sameElement(this.#composerHandle, composer)) ||
        !(await sameElement(this.#inputHandle, input))
      )
        return fail();
      const controls = aliceOknyxControls(composer);
      if ((await controls.count()) !== 1) return fail(await controls.count());
      const control = controls.first();
      if (!(await control.isVisible({ timeout: 1_000 }))) return fail();
      const aria = (await control.getAttribute("aria-label"))?.trim() ?? "";
      if (aria === "Алиса, стоп" || aria === "Алиса, начни слушать")
        return fail();
      if (aria !== "Отправить") return fail();
      if (
        (await isDisabled(control)) ||
        (await control.getAttribute("class"))
          ?.split(/\s+/)
          .includes("StandaloneOknyx_error")
      )
        return fail();
      // Set before the click. A thrown/uncertain click is never retried.
      this.#sendInvoked = true;
      await control.click();
      return pass(1, true, [
        observation(
          "C05_SEND_CONTROL",
          "PASS",
          "PASS",
          "PASS",
          "COMPOSER_ACTION_CONTROL",
          "STATE_TRANSITION_TRACE",
        ),
      ]);
    });
  }

  public async observeBusy(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      if (!this.#sendInvoked || !this.#surface || !this.#composer)
        return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!(await this.#hasStableIdentity())) return fail();
        const stop = aliceStopControls(this.#composer);
        if (
          (await stop.count()) === 1 &&
          (await stop.isVisible({ timeout: 250 }).catch(() => false))
        ) {
          this.#observedGenerating = true;
          return pass(1, true, [
            observation(
              "C06_BUSY_STOP_STATE",
              "PASS",
              "PASS",
              "PASS",
              "BUSY_INDICATOR",
              "STATE_TRANSITION_TRACE",
            ),
          ]);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fail();
    });
  }

  public async observeResponse(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const messages = this.#assistantMessages;
      if (
        !this.#sendInvoked ||
        !this.#observedGenerating ||
        !messages ||
        !this.#conversationId
      )
        return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!(await this.#hasStableIdentity())) return fail();
        const count = await messages.count();
        for (
          let index = this.#baselineMessageCount;
          index < count;
          index += 1
        ) {
          const candidate = messages.nth(index);
          const id = safeMessageId(await aliceMessageId(candidate));
          if (!id || this.#baselineMessageIds.has(id)) continue;
          this.#associatedResponse = candidate;
          this.#responseHandle = await candidate.elementHandle();
          if (!this.#responseHandle) return fail();
          return pass(1, true, [
            observation(
              "C07_ASSISTANT_MESSAGE",
              "PASS",
              "PASS",
              "PASS",
              "ASSISTANT_MESSAGE_REGION",
              "METADATA",
            ),
            observation(
              "C02_CONVERSATION_ROOT",
              "PASS",
              "PASS",
              "PASS",
              "MESSAGE_ASSOCIATION_MARKER",
              "METADATA",
            ),
          ]);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fail(boundedCount(await messages.count()));
    });
  }

  public async observeCompletion(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const response = this.#associatedResponse;
      if (!response || !this.#responseHandle) return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (
          !(await this.#hasStableIdentity()) ||
          !(await sameElement(this.#responseHandle, response))
        )
          return fail();
        const generationActive = await this.#generationActive();
        const responseHasContent = await this.#responseHasContent(response);
        if (!generationActive && responseHasContent)
          return pass(1, true, [
            observation(
              "C08_MESSAGE_COMPLETION",
              "PASS",
              "PASS",
              "PASS",
              "RESPONSE_IDLE_STATE",
              "STATE_TRANSITION_TRACE",
            ),
          ]);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fail();
    });
  }

  public async validateBridgeSurfaces(
    checks: readonly H3BridgeSurfaceCheck[],
  ): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const response = this.#associatedResponse;
      const composer = this.#composer;
      const input = this.#input;
      const page = this.#page;
      const target = this.#target;
      if (
        !response ||
        !this.#responseHandle ||
        !composer ||
        !input ||
        !page ||
        !target ||
        !this.#conversationId ||
        !isExpectedChecks(checks) ||
        !this.#isAllowedOrigin(page, target) ||
        !(await this.#hasStableIdentity()) ||
        !(await sameElement(this.#responseHandle, response)) ||
        !(await sameElement(this.#composerHandle, composer)) ||
        !(await sameElement(this.#inputHandle, input))
      )
        return fail();

      const block = await this.#findCommandBlock(response);
      const commandPass = block !== null;
      const copy = block ? aliceCopyControls(block) : null;
      const copyPass =
        copy !== null &&
        (await copy.count()) === 1 &&
        (await copy.isVisible({ timeout: 1_000 }).catch(() => false)) &&
        !(await isDisabled(copy.first()));
      const identityPass = await this.#hasStableIdentity();
      const deliveryPass =
        (await aliceInputCandidates(composer).count()) === 1 &&
        (await composer
          .locator(ALICE_H3_PROFILE.selectors.inputControlsRoot)
          .count()) === 1 &&
        (await aliceOknyxControls(composer).count()) === 1 &&
        (await input.isEditable({ timeout: 1_000 }).catch(() => false));
      const observations = [
        observation(
          "C09_COMMAND_CODE_BLOCK_SURFACE",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "COMMAND_SURFACE" : null,
          "METADATA",
        ),
        observation(
          "C10_NATIVE_COPY_CONTROL",
          copyPass ? "PASS" : "FAIL",
          copyPass ? "PASS" : "FAIL",
          copyPass ? "PASS" : "FAIL",
          copyPass ? "NATIVE_COPY_CONTROL" : null,
          copy ? "METADATA" : "NONE",
        ),
        observation(
          "C11_CONVERSATION_IDENTITY",
          identityPass ? "PASS" : "FAIL",
          identityPass ? "PASS" : "FAIL",
          identityPass ? "PASS" : "FAIL",
          identityPass ? "CONVERSATION_URL_IDENTITY" : null,
          identityPass ? "METADATA" : "NONE",
        ),
        observation(
          "C12_DELIVERY_INSERTION_PATH",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "DELIVERY_TARGET" : null,
          deliveryPass ? "STATE_TRANSITION_TRACE" : "NONE",
        ),
      ];
      return commandPass && copyPass && identityPass && deliveryPass
        ? pass(4, true, observations)
        : fail(4, observations);
    });
  }

  public async cleanup(): Promise<void> {
    await this.#inputHandle?.dispose().catch(() => undefined);
    await this.#composerHandle?.dispose().catch(() => undefined);
    await this.#responseHandle?.dispose().catch(() => undefined);
    const closeSession = this.#closeSession;
    this.#page = undefined;
    this.#target = undefined;
    this.#closeSession = undefined;
    this.#surface = undefined;
    this.#composer = undefined;
    this.#input = undefined;
    this.#assistantMessages = undefined;
    this.#associatedResponse = undefined;
    this.#inputHandle = null;
    this.#composerHandle = null;
    this.#responseHandle = null;
    this.#conversationId = null;
    this.#baselineMessageIds.clear();
    this.#baselineMessageCount = 0;
    this.#promptInserted = false;
    this.#sendInvoked = false;
    this.#observedGenerating = false;
    await closeSession?.();
  }

  async #safe(
    operation: () => Promise<H3StrategyStepResult>,
  ): Promise<H3StrategyStepResult> {
    try {
      return await operation();
    } catch {
      return fail();
    }
  }

  async #environmentBlocker(): Promise<H3StrategyStepResult | null> {
    if (!this.#page) return uncertain("CONTROLLED_BROWSER_UNAVAILABLE");
    try {
      new URL(this.#page.url());
    } catch {
      return uncertain("NETWORK_FAILURE_BEFORE_PAGE_IDENTITY");
    }
    return null;
  }

  async #resolveIdentity(): Promise<AliceConversationIdentityResolution> {
    const page = this.#page;
    const target = this.#target;
    if (!page || !target || target.allowedTopLevelOrigins.length !== 1)
      return { kind: "CONFLICT" };
    return resolveAliceConversationIdentity(
      page,
      target.allowedTopLevelOrigins[0],
    );
  }

  async #hasStableIdentity(): Promise<boolean> {
    const identity = await this.#resolveIdentity();
    return identity.kind === "BOUND" && identity.id === this.#conversationId;
  }

  async #generationActive(): Promise<boolean> {
    const composer = this.#composer;
    if (!composer) return false;
    const stop = aliceStopControls(composer);
    return (
      (await stop.count()) === 1 &&
      (await stop.isVisible({ timeout: 250 }).catch(() => false))
    );
  }

  async #findCommandBlock(response: Locator): Promise<Locator | null> {
    const blocks = aliceCodeBlocks(response);
    for (let index = 0; index < (await blocks.count()); index += 1) {
      const block = blocks.nth(index);
      const code = aliceCodeContents(block);
      const copy = aliceCopyControls(block);
      if ((await code.count()) !== 1 || (await copy.count()) !== 1) continue;
      if ((await code.first().textContent())?.trim() === HEALTH_TOKEN)
        return block;
    }
    return null;
  }

  async #readInput(input: Locator): Promise<string> {
    try {
      return await input.inputValue();
    } catch {
      return (await input.textContent()) ?? "";
    }
  }

  async #responseHasContent(response: Locator): Promise<boolean> {
    try {
      return Boolean((await response.textContent())?.trim());
    } catch {
      return false;
    }
  }

  #isAllowedOrigin(page: Page, target: ControlledTarget): boolean {
    try {
      return target.allowedTopLevelOrigins.includes(new URL(page.url()).origin);
    } catch {
      return false;
    }
  }

  #isAliceSurfaceOrigin(target: ControlledTarget): boolean {
    const origin = target.allowedTopLevelOrigins[0];
    return (
      origin === ALICE_H3_PROFILE.approvedOrigin ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")
    );
  }
}
