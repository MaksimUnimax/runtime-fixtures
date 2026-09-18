import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  NoSessionPageSnapshotSchema,
  type NoSessionElementMetadata,
  type NoSessionPageSnapshot,
} from "./no-session-contracts.js";
import { type NoSessionSelectorProfile } from "./no-session-strategies.js";
import type { NoSessionTarget } from "./no-session-target-authority.js";
import type { BrowserRuntimeMetadata } from "./h2.js";

export type NoSessionBrowserErrorCode =
  | "INVALID_DRIVER_LIFECYCLE"
  | "CONTROLLED_BROWSER_UNAVAILABLE"
  | "UNSAFE_TOP_LEVEL_REDIRECT"
  | "NAVIGATION_FAILED"
  | "OBSERVATION_FAILED";

export class NoSessionBrowserError extends Error {
  public constructor(public readonly code: NoSessionBrowserErrorCode) {
    super(code);
    this.name = "NoSessionBrowserError";
  }
}

export type NoSessionNavigationResult = Readonly<{
  finalOrigin: string;
}>;

export interface NoSessionBrowserDriver {
  readonly family: "chrome";
  readonly sessionKind: "EPHEMERAL_CONTROLLED";
  start(): Promise<void>;
  open(target: NoSessionTarget): Promise<NoSessionNavigationResult>;
  observe(
    profile: NoSessionSelectorProfile,
    timeoutMs: number,
  ): Promise<NoSessionPageSnapshot>;
  getRuntimeMetadata(): BrowserRuntimeMetadata;
  getSecurityDiagnostics(): Readonly<{
    secondaryPageCount: number;
    unsafeTopLevelNavigation: boolean;
  }>;
  stop(): Promise<void>;
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;
const MAX_SELECTOR_MATCHES = 64;

function emptyElementMetadata(): NoSessionElementMetadata {
  return {
    elementCount: 0,
    visible: false,
    editable: false,
    actionable: false,
  };
}

async function observeElement(
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
): Promise<NoSessionElementMetadata> {
  for (const selector of selectors) {
    let locator;
    try {
      locator = page.locator(selector);
      const count = await locator.count();
      if (count === 0) continue;
      const first = locator.first();
      const [visible, editable, enabled, role] = await Promise.all([
        first.isVisible({ timeout: timeoutMs }).catch(() => false),
        first.isEditable({ timeout: timeoutMs }).catch(() => false),
        first.isEnabled({ timeout: timeoutMs }).catch(() => false),
        first.getAttribute("role", { timeout: timeoutMs }).catch(() => null),
      ]);
      return {
        elementCount: Math.min(MAX_SELECTOR_MATCHES, count),
        visible,
        editable,
        actionable: enabled && (role === "button" || role === null),
      };
    } catch {
      // A provider changing one selector must not expose arbitrary page data.
    }
  }
  return emptyElementMetadata();
}

async function countSelectors(
  page: Page,
  selectors: readonly string[],
): Promise<number> {
  let total = 0;
  for (const selector of selectors) {
    try {
      total = Math.min(
        MAX_SELECTOR_MATCHES,
        total + (await page.locator(selector).count()),
      );
      if (total === MAX_SELECTOR_MATCHES) return total;
    } catch {
      // Invalid or stale provider selectors are an absent signal, not content.
    }
  }
  return total;
}

async function selectorPresent(
  page: Page,
  selectors: readonly string[],
): Promise<boolean> {
  return (await countSelectors(page, selectors)) > 0;
}

export class ChromeNoSessionBrowserDriver implements NoSessionBrowserDriver {
  public readonly family = "chrome" as const;
  public readonly sessionKind = "EPHEMERAL_CONTROLLED" as const;
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #page: Page | undefined;
  #state: "NEW" | "STARTED" = "NEW";
  #activeTarget: NoSessionTarget | undefined;
  #unsafeTopLevelNavigation = false;
  #secondaryPageCount = 0;
  #runtimeMetadata: BrowserRuntimeMetadata = {
    family: "chrome",
    browserName: "chromium",
    browserVersion: "unavailable",
    headless: true,
    sessionKind: "EPHEMERAL_CONTROLLED",
  };

  public constructor(
    private readonly launchTimeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
  ) {
    if (launchTimeoutMs < 250 || launchTimeoutMs > 30_000) {
      throw new Error("INVALID_BROWSER_LAUNCH_TIMEOUT");
    }
  }

  public async start(): Promise<void> {
    if (this.#state !== "NEW")
      throw new NoSessionBrowserError("INVALID_DRIVER_LIFECYCLE");
    try {
      this.#browser = await chromium.launch({
        headless: true,
        timeout: this.launchTimeoutMs,
        ...(process.env.HEALTH_RUNNER_CHROME_PATH
          ? { executablePath: process.env.HEALTH_RUNNER_CHROME_PATH }
          : {}),
      });
      // Deliberately omit storageState, cookies, headers, extensions, and a persistent path.
      this.#context = await this.#browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      this.#context.on("page", (page) => {
        if (!this.#page) {
          this.#page = page;
          return;
        }
        if (page === this.#page) return;
        this.#secondaryPageCount += 1;
        this.#unsafeTopLevelNavigation = true;
        void page.close().catch(() => undefined);
      });
      this.#page = await this.#context.newPage();
      this.#page.on("framenavigated", (frame) => {
        if (frame.parentFrame() !== null || !this.#activeTarget) return;
        try {
          const origin = new URL(frame.url()).origin;
          if (!this.#activeTarget.allowedTopLevelOrigins.includes(origin)) {
            this.#unsafeTopLevelNavigation = true;
          }
        } catch {
          this.#unsafeTopLevelNavigation = true;
        }
      });
      this.#runtimeMetadata = {
        ...this.#runtimeMetadata,
        browserVersion: this.#browser.version(),
      };
      this.#state = "STARTED";
    } catch {
      await this.stop();
      throw new NoSessionBrowserError("CONTROLLED_BROWSER_UNAVAILABLE");
    }
  }

  public async open(
    target: NoSessionTarget,
  ): Promise<NoSessionNavigationResult> {
    if (this.#state !== "STARTED" || !this.#page) {
      throw new NoSessionBrowserError("INVALID_DRIVER_LIFECYCLE");
    }
    this.#activeTarget = target;
    this.#unsafeTopLevelNavigation = false;
    try {
      await this.#page.goto(target.startUrl, {
        timeout: target.navigationTimeoutMs,
        waitUntil: "domcontentloaded",
      });
      const finalOrigin = new URL(this.#page.url()).origin;
      if (
        !target.allowedTopLevelOrigins.includes(finalOrigin) ||
        this.#unsafeTopLevelNavigation
      ) {
        throw new NoSessionBrowserError("UNSAFE_TOP_LEVEL_REDIRECT");
      }
      return { finalOrigin };
    } catch (error) {
      if (error instanceof NoSessionBrowserError) throw error;
      if (this.#unsafeTopLevelNavigation) {
        throw new NoSessionBrowserError("UNSAFE_TOP_LEVEL_REDIRECT");
      }
      throw new NoSessionBrowserError("NAVIGATION_FAILED");
    }
  }

  public async observe(
    profile: NoSessionSelectorProfile,
    timeoutMs: number,
  ): Promise<NoSessionPageSnapshot> {
    if (this.#state !== "STARTED" || !this.#page || !this.#activeTarget) {
      throw new NoSessionBrowserError("INVALID_DRIVER_LIFECYCLE");
    }
    if (this.#unsafeTopLevelNavigation) {
      throw new NoSessionBrowserError("UNSAFE_TOP_LEVEL_REDIRECT");
    }
    try {
      const [
        identityMarkerCount,
        surfaceMarkerCount,
        composer,
        editableInput,
        sendControl,
        authWallObserved,
        loginWallObserved,
        securityCheckpointObserved,
        captchaObserved,
        accessBlockedObserved,
        maintenanceObserved,
      ] = await Promise.all([
        countSelectors(this.#page, profile.identitySelectors),
        countSelectors(this.#page, profile.surfaceSelectors),
        observeElement(this.#page, profile.composerSelectors, timeoutMs),
        observeElement(this.#page, profile.inputSelectors, timeoutMs),
        observeElement(this.#page, profile.sendSelectors, timeoutMs),
        selectorPresent(this.#page, profile.authSelectors),
        selectorPresent(this.#page, profile.loginSelectors),
        selectorPresent(this.#page, profile.securitySelectors),
        selectorPresent(this.#page, profile.captchaSelectors),
        selectorPresent(this.#page, profile.blockedSelectors),
        selectorPresent(this.#page, profile.maintenanceSelectors),
      ]);
      const snapshot = {
        profileId: profile.profileId,
        finalOrigin: new URL(this.#page.url()).origin,
        identityMarkerCount,
        surfaceMarkerCount,
        composer,
        editableInput,
        sendControl,
        authWallObserved,
        loginWallObserved,
        securityCheckpointObserved,
        captchaObserved,
        accessBlockedObserved,
        maintenanceObserved,
      };
      return NoSessionPageSnapshotSchema.parse(snapshot);
    } catch (error) {
      if (error instanceof NoSessionBrowserError) throw error;
      throw new NoSessionBrowserError("OBSERVATION_FAILED");
    }
  }

  public getRuntimeMetadata(): BrowserRuntimeMetadata {
    return { ...this.#runtimeMetadata };
  }

  public getSecurityDiagnostics() {
    return {
      secondaryPageCount: this.#secondaryPageCount,
      unsafeTopLevelNavigation: this.#unsafeTopLevelNavigation,
    } as const;
  }

  public async stop(): Promise<void> {
    const context = this.#context;
    const browser = this.#browser;
    this.#context = undefined;
    this.#browser = undefined;
    this.#page = undefined;
    this.#activeTarget = undefined;
    this.#state = "NEW";
    this.#runtimeMetadata = {
      ...this.#runtimeMetadata,
      browserVersion: "unavailable",
    };
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export function createNoSessionChromeBrowserDriver(
  launchTimeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
): ChromeNoSessionBrowserDriver {
  return new ChromeNoSessionBrowserDriver(launchTimeoutMs);
}
