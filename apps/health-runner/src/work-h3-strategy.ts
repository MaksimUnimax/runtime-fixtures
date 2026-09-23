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
import { getPackagedH3Target } from "./h3-engine.js";
import {
  CHATGPT_WORK_H3_PROFILE,
  resolveWorkRoute,
  workAssistantMessages,
  workCodeSurfaces,
  workCopyControls,
  hasPositiveWorkMarker,
  workMessageId,
  workPromptInputs,
  workSendControls,
  workStopControls,
  workSurfaceRoot,
  type WorkRouteIdentity,
} from "./work-h3-profile.js";
import { markPackagedH3Strategy } from "./h3-strategy-authority-internal.js";

const WORK_PROFILE: H3SurfaceProfile = Object.freeze({
  surface: CHATGPT_WORK_H3_PROFILE.surface,
  profileId: CHATGPT_WORK_H3_PROFILE.profileId,
  profileRevision: CHATGPT_WORK_H3_PROFILE.profileRevision,
});
const WORK_TARGET = getPackagedH3Target("CHATGPT_WORK");
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
    environmentStatus: "VALID",
    uncertaintyReason: null,
    evidenceKind,
  });
}

function boundedCount(count: number): number {
  return Math.min(64, Math.max(0, count));
}

function safeMessageId(value: string | null): string | null {
  return value !== null && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value)
    ? value
    : null;
}

function isExpectedChecks(checks: readonly H3BridgeSurfaceCheck[]): boolean {
  return (
    checks.length === EXPECTED_CHECKS.length &&
    checks.every((check, index) => check === EXPECTED_CHECKS[index])
  );
}

async function disabled(locator: Locator): Promise<boolean> {
  const [enabled, ariaDisabled] = await Promise.all([
    locator.isEnabled({ timeout: 1_000 }).catch(() => false),
    locator.getAttribute("aria-disabled"),
  ]);
  return !enabled || ariaDisabled === "true";
}

async function visibleCount(locator: Locator): Promise<number> {
  let count = 0;
  for (let index = 0; index < (await locator.count()); index += 1) {
    if (
      await locator
        .nth(index)
        .isVisible({ timeout: 250 })
        .catch(() => false)
    )
      count += 1;
  }
  return count;
}

/** Distinct Work strategy; all irreversible execution remains in the B2 engine. */
export function createChatGPTWorkH3Strategy(
  page: Page,
  target: ControlledTarget,
  closeSession: () => Promise<void>,
): H3SurfaceStrategy {
  if (target.key !== WORK_TARGET)
    throw new Error("CHATGPT_WORK_TARGET_REQUIRED");
  H3SurfaceProfileSchema.parse(WORK_PROFILE);
  return markPackagedH3Strategy(
    new ChatGPTWorkH3Strategy(page, target, closeSession),
  );
}

class ChatGPTWorkH3Strategy implements H3SurfaceStrategy {
  public readonly surfaceProfile = WORK_PROFILE;
  public readonly targetKey: ControlledTargetKey = WORK_TARGET;
  #page: Page | undefined;
  #target: ControlledTarget | undefined;
  #closeSession: (() => Promise<void>) | undefined;
  #surface: Locator | undefined;
  #composer: Locator | undefined;
  #input: Locator | undefined;
  #assistantMessages: Locator | undefined;
  #associatedResponse: Locator | undefined;
  #associatedResponseId: string | null = null;
  #baselineMessageIds = new Set<string>();
  #baselineMessageCount = 0;
  #routeIdentity: WorkRouteIdentity | undefined;
  #promptInserted = false;
  #sendInvoked = false;
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
      if (!page || !target || !this.#hasApprovedOriginPolicy(target))
        return fail();
      if (!this.#isAllowedOrigin(page, target)) return fail();
      const surface = workSurfaceRoot(page);
      if (
        (await surface.count()) !== 1 ||
        !(await surface.isVisible({ timeout: 1_000 }))
      )
        return fail(await surface.count());
      if (!(await hasPositiveWorkMarker(page))) return fail();
      const route = await this.#readRoute();
      if (route.kind !== "BOUND") return fail();
      const messages = workAssistantMessages(surface);
      const baselineCount = await messages.count();
      if (baselineCount > 64) return fail(baselineCount);
      for (let index = 0; index < baselineCount; index += 1) {
        const id = safeMessageId(await workMessageId(messages.nth(index)));
        if (!id) return fail(baselineCount);
        this.#baselineMessageIds.add(id);
      }
      this.#surface = surface;
      this.#routeIdentity = route.identity;
      this.#assistantMessages = messages;
      this.#baselineMessageCount = baselineCount;
      return pass(2, false, [
        observation(
          "C01_PAGE_IDENTITY",
          "PASS",
          "PASS",
          "PASS",
          "SURFACE_MARKER",
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
      if (!(await this.#workOwnershipStable())) return fail();
      const page = this.#page;
      const surface = this.#surface;
      if (!page || !surface) return fail();
      const candidates = page.getByRole("textbox", {
        name: CHATGPT_WORK_H3_PROFILE.composerName,
        exact: true,
      });
      const valid: Locator[] = [];
      for (let index = 0; index < (await candidates.count()); index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible({ timeout: 1_000 }).catch(() => false)))
          continue;
        if (
          !(await candidate.isEditable({ timeout: 1_000 }).catch(() => false))
        )
          continue;
        if ((await candidate.locator("xpath=ancestor::form").count()) !== 1)
          continue;
        if (
          (await candidate
            .locator(
              'xpath=ancestor::*[self::section[@data-turn="assistant"] or @data-message-author-role="assistant"]',
            )
            .count()) > 0
        )
          continue;
        const placeholder = await candidate.getAttribute("placeholder");
        if (placeholder !== CHATGPT_WORK_H3_PROFILE.emptyPlaceholder) continue;
        if ((await this.#readInput(candidate)).trim() !== "") continue;
        valid.push(candidate);
      }
      if (valid.length !== 1) return fail(await candidates.count());
      const composer = valid[0]!.locator("xpath=ancestor::form");
      if ((await workPromptInputs(composer).count()) !== 1) return fail();
      this.#composer = composer;
      this.#input = valid[0]!;
      return pass(1, false, [
        observation(
          "C03_COMPOSER_ROOT",
          "FAIL",
          "PASS",
          "PASS",
          "ACTIVE_COMPOSER_REGION",
          [{ strategyId: "ACTIVE_COMPOSER_REGION", outcome: "PASS" }],
          "APPROVED_EQUIVALENT",
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
        !(await this.#workOwnershipStable()) ||
        !H3PromptIdSchema.safeParse(promptId).success
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
              "FAIL",
              "PASS",
              "PASS",
              "ACCESSIBILITY_TEXTBOX",
              [{ strategyId: "ACCESSIBILITY_TEXTBOX", outcome: "PASS" }],
              "APPROVED_EQUIVALENT",
              "METADATA",
            ),
          ])
        : fail();
    });
  }

  public async sendOnce(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const composer = this.#composer;
      const input = this.#input;
      if (!composer || !input || !this.#promptInserted || this.#sendInvoked)
        return fail();
      if (!(await this.#workOwnershipStable())) return fail();
      const prompt = getPackagedH3Prompt("BRIDGE_COMMAND_SMOKE_V1");
      if ((await this.#readInput(input)) !== prompt) return fail();
      const exact = workSendControls(composer);
      const exactCount = await exact.count();
      if (exactCount > 1) return fail(exactCount);
      const semantic = composer.getByRole("button", {
        name: CHATGPT_WORK_H3_PROFILE.sendName,
        exact: true,
      });
      if ((await semantic.count()) !== 1) return fail(await semantic.count());
      const send = semantic.first();
      if (!(await send.isVisible({ timeout: 1_000 })) || (await disabled(send)))
        return fail();
      if (exactCount === 1) {
        const exactElement = exact.first();
        if (
          (await exactElement.getAttribute("id")) !==
            "composer-submit-button" ||
          (await exactElement.getAttribute("data-testid")) !== "send-button"
        )
          return fail();
      }
      this.#sendStrategyId =
        exactCount === 1 ? "SEMANTIC_SEND_CONTROL" : "COMPOSER_ACTION_CONTROL";
      this.#sendInvoked = true;
      // Captured precedence: text-present Send wins over generation state.
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
      if (
        !this.#sendInvoked ||
        !this.#surface ||
        !this.#input ||
        !this.#composer
      )
        return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!(await this.#workOwnershipStable())) return fail();
        const composerEmpty =
          (await this.#readInput(this.#input)).trim() === "";
        const active = await this.#generationActive();
        const messages = this.#assistantMessages;
        const newMessage =
          messages && (await messages.count()) > this.#baselineMessageCount;
        if (
          composerEmpty &&
          active &&
          (newMessage || (await this.#stopIsVisible()))
        ) {
          const primaryBusy =
            (await this.#stopIsVisible()) ||
            (await this.#surface
              .locator(CHATGPT_WORK_H3_PROFILE.selectors.busySignal)
              .count()) > 0;
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
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return fail();
    });
  }

  public async observeResponse(): Promise<H3StrategyStepResult> {
    return this.#safe(async () => {
      const messages = this.#assistantMessages;
      if (!this.#sendInvoked || !messages || !(await this.#bound()))
        return fail();
      try {
        await messages
          .nth(this.#baselineMessageCount)
          .waitFor({ state: "attached", timeout: 30_000 });
      } catch {
        return fail();
      }
      const count = await messages.count();
      for (let index = this.#baselineMessageCount; index < count; index += 1) {
        const candidate = messages.nth(index);
        const id = safeMessageId(await workMessageId(candidate));
        if (!id || this.#baselineMessageIds.has(id)) continue;
        if (!(await this.#belongsToBoundRoute(candidate))) continue;
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
      if (!response || !this.#surface) return fail();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (!(await this.#workOwnershipStable())) return fail();
        if (!(await this.#associatedResponseIsAttached(response)))
          return fail();
        if (
          !(await this.#generationActive()) &&
          (await this.#responseHasContent(response))
        )
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
      if (!response || !composer || !input || !isExpectedChecks(checks))
        return fail();
      if (
        !(await this.#workOwnershipStable()) ||
        !(await this.#belongsToBoundRoute(response))
      )
        return fail();
      const codeSurface = await this.#findCodeSurface(
        workCodeSurfaces(response),
      );
      const commandPass =
        codeSurface !== null &&
        (await codeSurface.getByText(HEALTH_TOKEN, { exact: true }).count()) ===
          1;
      const copy = codeSurface ? workCopyControls(codeSurface) : null;
      const copyPresent =
        copy !== null &&
        (await copy.count()) === 1 &&
        (await copy.isVisible({ timeout: 1_000 }).catch(() => false));
      const copyPass = copyPresent && !(await disabled(copy!.first()));
      const deliveryPass =
        !(await input.isEditable({ timeout: 1_000 })) ||
        !(await composer.isVisible({ timeout: 1_000 }))
          ? false
          : (await workPromptInputs(composer).count()) === 1 &&
            (await workSendControls(composer).count()) === 1;
      const identityPass = await this.#belongsToBoundRoute(response);
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
          [
            {
              strategyId: "CONVERSATION_URL_IDENTITY",
              outcome: identityPass ? "PASS" : "FAIL",
            },
          ],
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
    const close = this.#closeSession;
    this.#page = undefined;
    this.#target = undefined;
    this.#closeSession = undefined;
    this.#surface = undefined;
    this.#composer = undefined;
    this.#input = undefined;
    this.#assistantMessages = undefined;
    this.#associatedResponse = undefined;
    this.#associatedResponseId = null;
    this.#routeIdentity = undefined;
    this.#baselineMessageIds.clear();
    this.#baselineMessageCount = 0;
    this.#promptInserted = false;
    this.#sendInvoked = false;
    this.#sendStrategyId = "SEMANTIC_SEND_CONTROL";
    await close?.();
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
    if (/^\/auth\/login(?:\/|$)/.test(pathname))
      return uncertain("LOGIN_EXPIRED");
    const dialogs = page.getByRole("dialog");
    for (let index = 0; index < (await dialogs.count()); index += 1) {
      const dialog = dialogs.nth(index);
      if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false)))
        continue;
      const label = (
        (await dialog.getAttribute("aria-label")) ?? ""
      ).toLowerCase();
      if (label.includes("captcha"))
        return uncertain("CAPTCHA_SECURITY_CHECKPOINT");
      if (label.includes("blocked") || label.includes("suspend"))
        return uncertain("ACCOUNT_BLOCKED");
      return uncertain("VERIFICATION_CHECKPOINT");
    }
    return null;
  }

  async #readRoute(): Promise<ReturnType<typeof resolveWorkRoute>> {
    const page = this.#page;
    if (!page) return { kind: "MISSING" };
    const canonical = page.locator('link[rel="canonical"]');
    const count = await canonical.count();
    if (count > 1) return { kind: "CONFLICT" };
    return resolveWorkRoute(
      page.url(),
      count === 1 ? await canonical.getAttribute("href") : null,
    );
  }

  async #workOwnershipStable(): Promise<boolean> {
    const page = this.#page;
    const target = this.#target;
    const routeIdentity = this.#routeIdentity;
    if (
      !page ||
      !target ||
      !routeIdentity ||
      !this.#hasApprovedOriginPolicy(target)
    )
      return false;
    const allowed = this.#isAllowedOrigin(page, target);
    const marker = await hasPositiveWorkMarker(page);
    const route = await this.#readRoute();
    if (!allowed || !marker) return false;
    return (
      route.kind === "BOUND" &&
      route.identity.projectRouteKey === routeIdentity.projectRouteKey &&
      route.identity.conversationId === routeIdentity.conversationId
    );
  }

  async #bound(): Promise<boolean> {
    return (
      this.#routeIdentity !== undefined && (await this.#workOwnershipStable())
    );
  }

  async #belongsToBoundRoute(locator: Locator): Promise<boolean> {
    if (!(await this.#bound())) return false;
    return (await workMessageId(locator)) !== null;
  }

  async #stopIsVisible(): Promise<boolean> {
    return Boolean(
      this.#composer &&
        (await visibleCount(workStopControls(this.#composer))) === 1 &&
        (await this.#composer
          .getByRole("button", {
            name: CHATGPT_WORK_H3_PROFILE.stopName,
            exact: true,
          })
          .count()) === 1,
    );
  }

  async #generationActive(): Promise<boolean> {
    const surface = this.#surface;
    const composer = this.#composer;
    const page = this.#page;
    if (!surface || !composer || !page) return false;
    if (await this.#stopIsVisible()) return true;
    if (
      (await surface
        .locator(CHATGPT_WORK_H3_PROFILE.selectors.busySignal)
        .count()) > 0
    )
      return true;
    // The captured string is retained in the profile as supporting evidence,
    // but arbitrary response text must never be standalone busy truth.
    const input = this.#input;
    return (
      input !== undefined &&
      (await input.getAttribute("placeholder")) ===
        CHATGPT_WORK_H3_PROFILE.generatingPlaceholder
    );
  }

  async #associatedResponseIsAttached(response: Locator): Promise<boolean> {
    if (!this.#associatedResponseId) return false;
    try {
      return (
        (await response.count()) === 1 &&
        (await workMessageId(response)) === this.#associatedResponseId
      );
    } catch {
      return false;
    }
  }

  async #responseHasContent(response: Locator): Promise<boolean> {
    try {
      return Boolean((await response.textContent())?.trim());
    } catch {
      return false;
    }
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

  #hasApprovedOriginPolicy(target: ControlledTarget): boolean {
    return target.allowedTopLevelOrigins.includes(
      CHATGPT_WORK_H3_PROFILE.approvedOrigin,
    );
  }

  #isAllowedOrigin(page: Page, target: ControlledTarget): boolean {
    try {
      return target.allowedTopLevelOrigins.includes(new URL(page.url()).origin);
    } catch {
      return false;
    }
  }
}
