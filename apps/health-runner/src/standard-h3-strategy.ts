import type { Locator, Page } from "playwright";
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
  CHATGPT_STANDARD_H3_PROFILE,
  standardAssistantMessages,
  standardCodeSurfaces,
  standardComposerRoots,
  standardCopyControls,
  standardBusySignals,
  standardInputIsInsideAssistantEditor,
  standardPromptInputs,
  standardSendControls,
  standardStopControls,
  standardSurfaceRoot,
  standardMessageId,
  resolveChatGPTConversationIdentity,
  type ChatGPTConversationIdentityResolution,
} from "./standard-h3-profile.js";
import { hasPositiveWorkSurfaceMarker } from "./standard-work-isolation.js";
import { markPackagedH3Strategy } from "./h3-strategy-authority-internal.js";

const STANDARD_PROFILE: H3SurfaceProfile = Object.freeze({
  surface: CHATGPT_STANDARD_H3_PROFILE.surface,
  profileId: CHATGPT_STANDARD_H3_PROFILE.profileId,
  profileRevision: CHATGPT_STANDARD_H3_PROFILE.profileRevision,
});
const STANDARD_TARGET = getPackagedH3Target("CHATGPT_STANDARD");
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
  observations: readonly H3ContourObservation[] = [],
): H3StrategyStepResult => {
  const safeObservations =
    observations.length > 0
      ? observations
      : [
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
        ];
  return H3StrategyStepResultSchema.parse({
    outcome: "UNCERTAIN",
    markerCount: null,
    transitionObserved: null,
    uncertaintyReason: reason,
    observations: safeObservations,
  });
};

function observation(
  contourKey: H3ContourObservation["contourKey"],
  primaryStrategyOutcome: H3ContourObservation["primaryStrategyOutcome"],
  structuralOutcome: H3ContourObservation["structuralOutcome"],
  behavioralOutcome: H3ContourObservation["behavioralOutcome"],
  selectedStrategyId: H3ContourObservation["selectedStrategyId"],
  fallbackStrategyOutcomes: H3ContourObservation["fallbackStrategyOutcomes"] = [],
  fallbackQuality: H3ContourObservation["fallbackQuality"] = "NOT_APPLICABLE",
  evidenceKind: H3ContourObservation["evidenceKind"] = "NONE",
  environmentStatus: H3ContourObservation["environmentStatus"] = "VALID",
  uncertaintyReason: H3ContourObservation["uncertaintyReason"] = null,
): H3ContourObservation {
  return createH3ContourObservation({
    contourKey,
    observationStatus: "PRESENT",
    primaryStrategyOutcome,
    fallbackStrategyOutcomes,
    selectedStrategyId,
    structuralOutcome,
    behavioralOutcome,
    fallbackQuality,
    environmentStatus,
    uncertaintyReason,
    evidenceKind,
  });
}

function boundedCount(count: number): number {
  return Math.min(64, Math.max(0, count));
}

function safeTurnId(value: string | null): string | null {
  return value !== null && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value)
    ? value
    : null;
}

type ConversationBinding =
  | Readonly<{ state: "UNBOUND_FRESH" }>
  | Readonly<{ state: "BOUND"; id: string }>;

function isExpectedChecks(checks: readonly H3BridgeSurfaceCheck[]): boolean {
  return (
    checks.length === EXPECTED_CHECKS.length &&
    checks.every((check, index) => check === EXPECTED_CHECKS[index])
  );
}

function controlToken(locator: Locator): Promise<string> {
  return Promise.all([
    locator.getAttribute("data-testid"),
    locator.getAttribute("aria-label"),
    locator.getAttribute("title"),
    locator.getAttribute("name"),
    locator.getAttribute("type"),
  ]).then((values) =>
    values
      .map((value) => value ?? "")
      .join(" ")
      .toLowerCase(),
  );
}

async function isDisabled(locator: Locator): Promise<boolean> {
  const [enabled, ariaDisabled] = await Promise.all([
    locator.isEnabled({ timeout: 1_000 }).catch(() => false),
    locator.getAttribute("aria-disabled"),
  ]);
  return !enabled || ariaDisabled === "true";
}

/** The only Standard H3 strategy, built from the immutable local profile. */
export function createChatGPTStandardH3Strategy(
  page: Page,
  target: ControlledTarget,
  closeSession: () => Promise<void>,
): H3SurfaceStrategy {
  if (target.key !== STANDARD_TARGET) {
    throw new Error("CHATGPT_STANDARD_TARGET_REQUIRED");
  }
  H3SurfaceProfileSchema.parse(STANDARD_PROFILE);
  return markPackagedH3Strategy(
    new ChatGPTStandardH3Strategy(page, target, closeSession),
  );
}

class ChatGPTStandardH3Strategy implements H3SurfaceStrategy {
  public readonly surfaceProfile = STANDARD_PROFILE;
  public readonly targetKey: ControlledTargetKey = STANDARD_TARGET;
  #page: Page | undefined;
  #target: ControlledTarget | undefined;
  #closeSession: (() => Promise<void>) | undefined;
  #surface: Locator | undefined;
  #composer: Locator | undefined;
  #input: Locator | undefined;
  #assistantMessages: Locator | undefined;
  #associatedResponse: Locator | undefined;
  #conversationBinding: ConversationBinding = { state: "UNBOUND_FRESH" };
  #baselineMessageIds = new Set<string>();
  #baselineMessageCount = 0;
  #promptInserted = false;
  #sendInvoked = false;
  #associatedResponseId: string | null = null;
  #inputStrategyId: "EDITABLE_INPUT" | "ACCESSIBILITY_TEXTBOX" =
    "EDITABLE_INPUT";
  #sendStrategyId: "SEMANTIC_SEND_CONTROL" | "COMPOSER_ACTION_CONTROL" =
    "SEMANTIC_SEND_CONTROL";

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
      if (!page || !target || !this.#isAllowedOrigin(page, target))
        return fail();
      try {
        new URL(page.url());
      } catch {
        return uncertain("NETWORK_FAILURE_BEFORE_PAGE_IDENTITY");
      }
      const surface = standardSurfaceRoot(page);
      if (
        (await surface.count()) !== 1 ||
        !(await surface.isVisible({ timeout: 1_000 }))
      ) {
        return fail(await surface.count());
      }
      // B4 isolation correction: a positively identified Work marker is not
      // allowed to satisfy the Standard strategy on shared ChatGPT DOM.
      if (await hasPositiveWorkSurfaceMarker(page)) return fail();
      const identity = await this.#resolveConversationIdentity(page);
      if (identity.kind === "CONFLICT") return fail();
      this.#surface = surface;
      this.#conversationBinding =
        identity.kind === "BOUND"
          ? { state: "BOUND", id: identity.id }
          : { state: "UNBOUND_FRESH" };
      this.#assistantMessages = standardAssistantMessages(surface);
      this.#baselineMessageCount = await this.#assistantMessages.count();
      if (this.#baselineMessageCount > 64)
        return fail(this.#baselineMessageCount);
      for (let index = 0; index < this.#baselineMessageCount; index += 1) {
        const id = safeTurnId(
          await standardMessageId(this.#assistantMessages.nth(index)),
        );
        if (!id) return fail(this.#baselineMessageCount);
        this.#baselineMessageIds.add(id);
      }
      return pass(2, false, [
        observation(
          "C01_PAGE_IDENTITY",
          "PASS",
          "PASS",
          "PASS",
          "PAGE_HOST_MARKER",
          [],
          "NOT_APPLICABLE",
          "METADATA",
        ),
        observation(
          "C13_BLOCKING_STATE",
          "PASS",
          "PASS",
          "PASS",
          "BLOCKING_MARKER",
          [],
          "NOT_APPLICABLE",
          "METADATA",
        ),
      ]);
    });
  }

  public async identifyApprovedComposer(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const surface = this.#surface;
      if (!surface) return fail();
      const composers = standardComposerRoots(surface);
      if ((await composers.count()) !== 1) return fail(await composers.count());
      const composer = composers.first();
      if (!(await composer.isVisible({ timeout: 1_000 }))) return fail();
      const input = await this.#resolveEditableInput(composer);
      if (
        !input ||
        !(await input.isVisible({ timeout: 1_000 })) ||
        !(await input.isEditable({ timeout: 1_000 }))
      ) {
        return fail();
      }
      this.#composer = composer;
      this.#input = input;
      const inputId = await input.getAttribute("id");
      const testId = await input.getAttribute("data-testid");
      this.#inputStrategyId =
        inputId === "prompt-textarea" || testId === "prompt-textarea"
          ? "EDITABLE_INPUT"
          : "ACCESSIBILITY_TEXTBOX";
      return pass(1, false, [
        observation(
          "C03_COMPOSER_ROOT",
          "PASS",
          "PASS",
          "PASS",
          "COMPOSER_CONTAINER",
          [],
          "NOT_APPLICABLE",
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
      if (!input || !H3PromptIdSchema.safeParse(promptId).success)
        return fail();
      const prompt = getPackagedH3Prompt(promptId);
      await input.fill(prompt);
      // Ephemeral boolean readback only; prompt content never enters a result.
      const inserted = (await this.#readInput(input)) === prompt;
      this.#promptInserted = inserted;
      if (!inserted) return fail();
      return pass(1, true, [
        observation(
          "C04_COMPOSER_INPUT",
          this.#inputStrategyId === "EDITABLE_INPUT" ? "PASS" : "FAIL",
          "PASS",
          "PASS",
          this.#inputStrategyId,
          this.#inputStrategyId === "EDITABLE_INPUT"
            ? []
            : [{ strategyId: "ACCESSIBILITY_TEXTBOX", outcome: "PASS" }],
          this.#inputStrategyId === "EDITABLE_INPUT"
            ? "NOT_APPLICABLE"
            : "APPROVED_EQUIVALENT",
          "METADATA",
        ),
      ]);
    });
  }

  public async sendOnce(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const composer = this.#composer;
      if (
        !composer ||
        !this.#input ||
        !this.#promptInserted ||
        this.#sendInvoked
      ) {
        return fail();
      }
      const exact = standardSendControls(composer);
      const exactCount = await exact.count();
      if (exactCount > 1) return fail(exactCount);
      let send: Locator | null = exactCount === 1 ? exact.first() : null;
      if (!send) send = await this.#resolveSemanticSend(composer);
      if (
        !send ||
        !(await send.isVisible({ timeout: 1_000 })) ||
        (await isDisabled(send))
      ) {
        return fail();
      }
      this.#sendStrategyId =
        exactCount === 1 ? "SEMANTIC_SEND_CONTROL" : "COMPOSER_ACTION_CONTROL";
      this.#sendInvoked = true;
      // Sole irreversible activation. No Enter fallback, candidate retry, or resend.
      await send.click();
      return pass(1, true, [
        observation(
          "C05_SEND_CONTROL",
          this.#sendStrategyId === "SEMANTIC_SEND_CONTROL" ? "PASS" : "FAIL",
          "PASS",
          "PASS",
          this.#sendStrategyId,
          this.#sendStrategyId === "SEMANTIC_SEND_CONTROL"
            ? []
            : [{ strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" }],
          this.#sendStrategyId === "SEMANTIC_SEND_CONTROL"
            ? "NOT_APPLICABLE"
            : "APPROVED_EQUIVALENT",
          "STATE_TRANSITION_TRACE",
        ),
      ]);
    });
  }

  public async observeBusy(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      if (!this.#sendInvoked || !this.#surface) return fail();
      const stop = standardStopControls(this.#surface);
      const deadline = Date.now() + 30_000;
      const freshBindingDeadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const identity = await this.#resolveConversationIdentity(this.#page);
        if (!this.#acceptPostSendIdentity(identity)) return fail();
        const bound = this.#conversationBinding.state === "BOUND";
        const stopVisible = await stop
          .first()
          .isVisible({ timeout: 250 })
          .catch(() => false);
        const busyPresent =
          (await standardBusySignals(this.#surface).count()) > 0;
        const messages = this.#assistantMessages;
        if (
          bound &&
          (stopVisible ||
            busyPresent ||
            (messages && (await messages.count()) > this.#baselineMessageCount))
        ) {
          const primaryBusy = stopVisible || busyPresent;
          return pass(1, true, [
            observation(
              "C06_BUSY_STOP_STATE",
              primaryBusy ? "PASS" : "FAIL",
              "PASS",
              "PASS",
              primaryBusy ? "BUSY_INDICATOR" : "RESPONSE_STATE_MARKER",
              primaryBusy
                ? []
                : [{ strategyId: "RESPONSE_STATE_MARKER", outcome: "PASS" }],
              primaryBusy ? "NOT_APPLICABLE" : "MATERIALLY_DEGRADED",
              "STATE_TRANSITION_TRACE",
            ),
          ]);
        }
        const responseObserved =
          messages && (await messages.count()) > this.#baselineMessageCount;
        if (
          !bound &&
          (stopVisible || busyPresent || responseObserved) &&
          Date.now() >= freshBindingDeadline
        )
          return fail();
        // This is a bounded observation poll, not a sleep used as identity
        // truth. Route/canonical identity is re-read on every iteration.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fail();
    });
  }

  public async observeResponse(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const messages = this.#assistantMessages;
      const conversationId = this.#boundConversationId();
      if (!this.#sendInvoked || !messages || !conversationId) return fail();
      try {
        await messages.nth(this.#baselineMessageCount).waitFor({
          state: "attached",
          timeout: 30_000,
        });
      } catch {
        return fail();
      }
      const count = await messages.count();
      for (let index = this.#baselineMessageCount; index < count; index += 1) {
        const candidate = messages.nth(index);
        const id = safeTurnId(await standardMessageId(candidate));
        if (!id || this.#baselineMessageIds.has(id)) continue;
        if (!(await this.#belongsToConversation(candidate, conversationId)))
          continue;
        this.#associatedResponse = candidate;
        this.#associatedResponseId = id;
        return pass(1, true, [
          observation(
            "C02_CONVERSATION_ROOT",
            "PASS",
            "PASS",
            "PASS",
            "CONVERSATION_ANCHOR",
            [],
            "NOT_APPLICABLE",
            "METADATA",
          ),
          observation(
            "C07_ASSISTANT_MESSAGE",
            "PASS",
            "PASS",
            "PASS",
            "ASSISTANT_MESSAGE_REGION",
            [],
            "NOT_APPLICABLE",
            "NONE",
          ),
        ]);
      }
      return fail(boundedCount(count));
    });
  }

  public async observeCompletion(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const response = this.#associatedResponse;
      const surface = this.#surface;
      if (!response || !surface) return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!(await this.#hasStableBoundIdentity())) return fail();
        if (!(await this.#associatedResponseIsAttached(response)))
          return fail();

        const generationActive = await this.#standardGenerationActive(surface);
        const responseHasContent = await this.#responseHasContent(response);
        if (!generationActive && responseHasContent)
          return pass(1, true, [
            observation(
              "C08_MESSAGE_COMPLETION",
              "FAIL",
              "PASS",
              "PASS",
              "RESPONSE_IDLE_STATE",
              [{ strategyId: "RESPONSE_IDLE_STATE", outcome: "PASS" }],
              "MATERIALLY_DEGRADED",
              "STATE_TRANSITION_TRACE",
            ),
          ]);

        // This is a bounded observation poll. Completion is established only
        // by the current response, generation signals, content, and identity.
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
      const page = this.#page;
      const target = this.#target;
      const conversationId = this.#boundConversationId();
      if (
        !response ||
        !composer ||
        !page ||
        !target ||
        !conversationId ||
        !isExpectedChecks(checks) ||
        !this.#isAllowedOrigin(page, target)
      )
        return fail();
      const codeSurface = await this.#findCodeSurface(
        standardCodeSurfaces(response),
      );
      const commandPass =
        codeSurface !== null &&
        (await codeSurface.getByText(HEALTH_TOKEN, { exact: true }).count()) ===
          1;
      const copy = codeSurface ? standardCopyControls(codeSurface) : null;
      const copyPresent =
        copy !== null &&
        (await copy.count()) === 1 &&
        (await copy.isVisible({ timeout: 1_000 }).catch(() => false));
      const copyPass = copyPresent && !(await isDisabled(copy!.first()));
      const identityPass = await this.#belongsToConversation(
        response,
        conversationId,
      );

      // C12 is the same form-owned insertion path used by the accepted
      // adapter: the active editor and Send control share one live form.
      const input = this.#input;
      const send = standardSendControls(composer);
      const deliveryPass =
        !input ||
        (await send.count()) !== 1 ||
        !(await composer.isVisible({ timeout: 1_000 }))
          ? false
          : await input.isEditable({ timeout: 1_000 });
      const observations = [
        observation(
          "C09_COMMAND_CODE_BLOCK_SURFACE",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "PASS" : "FAIL",
          commandPass ? "COMMAND_SURFACE" : null,
          [],
          "NOT_APPLICABLE",
          "NONE",
        ),
        observation(
          "C10_NATIVE_COPY_CONTROL",
          copyPass ? "PASS" : "FAIL",
          copyPresent ? "PASS" : "FAIL",
          copyPass ? "PASS" : "FAIL",
          copyPass ? "NATIVE_COPY_CONTROL" : null,
          [],
          "NOT_APPLICABLE",
          copyPresent ? "METADATA" : "NONE",
        ),
        observation(
          "C11_CONVERSATION_IDENTITY",
          "FAIL",
          identityPass ? "PASS" : "FAIL",
          identityPass ? "PASS" : "FAIL",
          "CONVERSATION_URL_IDENTITY",
          identityPass
            ? [{ strategyId: "CONVERSATION_URL_IDENTITY", outcome: "PASS" }]
            : [{ strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" }],
          "APPROVED_EQUIVALENT",
          identityPass ? "METADATA" : "NONE",
        ),
        observation(
          "C12_DELIVERY_INSERTION_PATH",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "PASS" : "FAIL",
          deliveryPass ? "DELIVERY_TARGET" : null,
          [],
          "NOT_APPLICABLE",
          deliveryPass ? "STATE_TRANSITION_TRACE" : "NONE",
        ),
      ];
      return commandPass && copyPass && identityPass && deliveryPass
        ? pass(4, true, observations)
        : fail(4, observations);
    });
  }

  public async cleanup(): Promise<void> {
    const closeSession = this.#closeSession;
    this.#page = undefined;
    this.#target = undefined;
    this.#closeSession = undefined;
    this.#surface = undefined;
    this.#composer = undefined;
    this.#input = undefined;
    this.#assistantMessages = undefined;
    this.#associatedResponse = undefined;
    this.#conversationBinding = { state: "UNBOUND_FRESH" };
    this.#baselineMessageIds.clear();
    this.#baselineMessageCount = 0;
    this.#promptInserted = false;
    this.#sendInvoked = false;
    this.#associatedResponseId = null;
    this.#inputStrategyId = "EDITABLE_INPUT";
    this.#sendStrategyId = "SEMANTIC_SEND_CONTROL";
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
    const page = this.#page;
    if (!page) return uncertain("CONTROLLED_BROWSER_UNAVAILABLE");
    let pathname = "";
    try {
      pathname = new URL(page.url()).pathname.toLowerCase();
    } catch {
      return uncertain("NETWORK_FAILURE_BEFORE_PAGE_IDENTITY");
    }
    // Login route is the only provider-specific precondition established by
    // the accepted adapter. Accessible checkpoints are fail-closed and never
    // bypassed or acted on.
    if (/^\/auth\/login(?:\/|$)/.test(pathname))
      return uncertain("LOGIN_EXPIRED");
    const checkpoint = page.getByRole("dialog");
    if (
      (await checkpoint.count()) > 0 &&
      (await checkpoint.first().isVisible({ timeout: 1_000 }))
    ) {
      const label = (
        (await checkpoint.first().getAttribute("aria-label")) ?? ""
      ).toLowerCase();
      if (!label) return null;
      if (label.includes("captcha"))
        return uncertain("CAPTCHA_SECURITY_CHECKPOINT");
      if (label.includes("blocked") || label.includes("suspend"))
        return uncertain("ACCOUNT_BLOCKED");
      return uncertain("VERIFICATION_CHECKPOINT");
    }
    return null;
  }

  async #resolveConversationIdentity(
    page: Page | undefined,
  ): Promise<ChatGPTConversationIdentityResolution> {
    if (!page) return { kind: "UNBOUND_FRESH" };
    const canonical = page.locator('link[rel="canonical"]');
    const canonicalHref =
      (await canonical.count()) === 1
        ? await canonical.getAttribute("href")
        : null;
    return resolveChatGPTConversationIdentity(page.url(), canonicalHref);
  }

  #boundConversationId(): string | null {
    return this.#conversationBinding.state === "BOUND"
      ? this.#conversationBinding.id
      : null;
  }

  #acceptPostSendIdentity(
    identity: ChatGPTConversationIdentityResolution,
  ): boolean {
    if (identity.kind === "CONFLICT") return false;
    if (this.#conversationBinding.state === "BOUND") {
      return (
        identity.kind === "BOUND" &&
        identity.id === this.#conversationBinding.id
      );
    }
    if (identity.kind === "BOUND") {
      this.#conversationBinding = { state: "BOUND", id: identity.id };
      return true;
    }
    return true;
  }

  async #resolveEditableInput(composer: Locator): Promise<Locator | null> {
    const inputs = standardPromptInputs(composer);
    const candidates: Locator[] = [];
    for (let index = 0; index < (await inputs.count()); index += 1) {
      const input = inputs.nth(index);
      if (!(await standardInputIsInsideAssistantEditor(input)))
        candidates.push(input);
    }
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  }

  async #resolveSemanticSend(composer: Locator): Promise<Locator | null> {
    const controls = composer.locator(
      'button, [role="button"], input[type="submit"]',
    );
    const candidates: Locator[] = [];
    for (let index = 0; index < (await controls.count()); index += 1) {
      const control = controls.nth(index);
      if (
        !(await control.isVisible({ timeout: 1_000 }).catch(() => false)) ||
        (await isDisabled(control))
      )
        continue;
      const token = await controlToken(control);
      if (/stop|cancel|abort|останов|отмен/.test(token)) continue;
      if (/\bsend\b|отправ/u.test(token) || /submit/i.test(token))
        candidates.push(control);
    }
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  }

  async #findCodeSurface(surfaces: Locator): Promise<Locator | null> {
    const response = this.#associatedResponse;
    if (!response) return null;
    for (let index = 0; index < (await surfaces.count()); index += 1) {
      const surface = surfaces.nth(index);
      if (!(await surface.isVisible({ timeout: 1_000 }).catch(() => false)))
        continue;
      if (
        (await surface.getByText(HEALTH_TOKEN, { exact: true }).count()) === 1
      )
        return surface;
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

  async #belongsToConversation(
    locator: Locator,
    conversationId: string,
  ): Promise<boolean> {
    const page = this.#page;
    if (!page) return false;
    const identity = await this.#resolveConversationIdentity(page);
    if (identity.kind !== "BOUND" || identity.id !== conversationId)
      return false;
    return (await standardMessageId(locator)) !== null;
  }

  async #hasStableBoundIdentity(): Promise<boolean> {
    const page = this.#page;
    const target = this.#target;
    const conversationId = this.#boundConversationId();
    if (
      !page ||
      !target ||
      !conversationId ||
      !this.#isAllowedOrigin(page, target)
    )
      return false;
    const identity = await this.#resolveConversationIdentity(page);
    return identity.kind === "BOUND" && identity.id === conversationId;
  }

  async #associatedResponseIsAttached(response: Locator): Promise<boolean> {
    if (!this.#associatedResponseId) return false;
    try {
      return (
        (await response.count()) === 1 &&
        (await standardMessageId(response)) === this.#associatedResponseId
      );
    } catch {
      return false;
    }
  }

  async #standardGenerationActive(surface: Locator): Promise<boolean> {
    const stop = standardStopControls(surface);
    for (let index = 0; index < (await stop.count()); index += 1) {
      if (
        await stop
          .nth(index)
          .isVisible({ timeout: 250 })
          .catch(() => false)
      )
        return true;
    }
    return (await standardBusySignals(surface).count()) > 0;
  }

  async #responseHasContent(response: Locator): Promise<boolean> {
    try {
      const text = await response.textContent();
      return Boolean(text?.trim());
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
}
