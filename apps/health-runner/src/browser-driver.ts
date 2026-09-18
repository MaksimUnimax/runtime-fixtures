import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import {
  PackagedStrategyIdSchema,
  type PackagedStrategyId,
} from "@product/health";
import type { BrowserRuntimeMetadata } from "./h2.js";
import {
  executePackagedStrategy,
  type SafeStructuralObservation,
} from "./strategies.js";
import {
  ControlledTargetRegistry,
  type ControlledTarget,
} from "./target-registry.js";
import type { BrowserFamily } from "@product/shared";
import { shouldBlockPrimaryDocumentRequest } from "./navigation-policy.js";
import { createChatGPTStandardH3Strategy } from "./standard-h3-strategy.js";
import type { H3SurfaceStrategy } from "./h3-strategy.js";

export type BrowserDriverErrorCode =
  | "INVALID_DRIVER_LIFECYCLE"
  | "CONTROLLED_BROWSER_UNAVAILABLE"
  | "CONTROLLED_TARGET_NOT_REGISTERED"
  | "UNSAFE_TOP_LEVEL_REDIRECT"
  | "NAVIGATION_FAILED"
  | "OBSERVATION_TIMEOUT"
  | "OBSERVATION_FAILED";

export class BrowserDriverError extends Error {
  public constructor(public readonly code: BrowserDriverErrorCode) {
    super(code);
    this.name = "BrowserDriverError";
  }
}

export interface BrowserDriver {
  readonly family: BrowserFamily;
  readonly sessionKind: "EPHEMERAL_CONTROLLED";
  prepareSession(): Promise<void>;
  launch(): Promise<void>;
  start(): Promise<void>;
  open(targetKey: string): Promise<ControlledNavigationResult>;
  getRuntimeMetadata(): BrowserRuntimeMetadata;
  getSecurityDiagnostics(): BrowserDriverSecurityDiagnostics;
  observeStrategy(
    strategyId: PackagedStrategyId,
    timeoutMs: number,
  ): Promise<SafeStructuralObservation>;
  closeOrPersist(): Promise<void>;
  stop(): Promise<void>;
}

export type BrowserDriverSecurityDiagnostics = Readonly<{
  secondaryPageCount: number;
  unsafeTopLevelNavigation: boolean;
}>;

export type ControlledNavigationResult = Readonly<{
  targetKey: string;
  finalOrigin: string;
}>;

const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;
const NAVIGATION_STABILIZATION_MS = 350;

type FetchRequestPausedEvent = Readonly<{
  requestId: string;
  request: Readonly<{ url: string }>;
  resourceType?: string;
  frameId?: string;
}>;

export class ChromeBrowserDriver implements BrowserDriver {
  public readonly family = "chrome" as const;
  public readonly sessionKind = "EPHEMERAL_CONTROLLED" as const;
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #page: Page | undefined;
  #state: "NEW" | "PREPARED" | "LAUNCHED" = "NEW";
  #activeTarget: ControlledTarget | undefined;
  #runtimeMetadata: BrowserRuntimeMetadata = {
    family: "chrome",
    browserName: "chromium",
    browserVersion: "unavailable",
    headless: true,
    sessionKind: "EPHEMERAL_CONTROLLED",
  };
  #primaryNavigationStarted = false;
  #unsafeTopLevelNavigation = false;
  #secondaryPageCount = 0;
  #creatingPrimaryPage = false;
  #cdpSession: CDPSession | undefined;
  #primaryFrameId: string | undefined;
  #cdpRequestTasks = new Set<Promise<void>>();
  #cdpRequestPausedListener:
    | ((event: FetchRequestPausedEvent) => void)
    | undefined;

  public constructor(
    private readonly targets: ControlledTargetRegistry,
    private readonly launchTimeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
  ) {
    if (
      !Number.isInteger(launchTimeoutMs) ||
      launchTimeoutMs < 250 ||
      launchTimeoutMs > 30_000
    ) {
      throw new Error("INVALID_BROWSER_LAUNCH_TIMEOUT");
    }
  }

  public async prepareSession(): Promise<void> {
    if (this.#state !== "NEW")
      throw new BrowserDriverError("INVALID_DRIVER_LIFECYCLE");
    this.#unsafeTopLevelNavigation = false;
    this.#secondaryPageCount = 0;
    this.#state = "PREPARED";
  }

  public async launch(): Promise<void> {
    if (this.#state !== "PREPARED")
      throw new BrowserDriverError("INVALID_DRIVER_LIFECYCLE");
    try {
      const browser = await chromium.launch({
        headless: true,
        timeout: this.launchTimeoutMs,
      });
      const context = await browser.newContext({
        acceptDownloads: false,
      });
      this.#browser = browser;
      this.#context = context;
      await this.#installContextNavigationGuard(context);
      this.#creatingPrimaryPage = true;
      const page = await context.newPage();
      this.#creatingPrimaryPage = false;
      this.#page ??= page;
      this.#attachMainFrameNavigationDefense(page);
      await this.#installChromeNavigationFirewall(context, page);
      this.#runtimeMetadata = {
        ...this.#runtimeMetadata,
        browserVersion: browser.version(),
      };
      this.#state = "LAUNCHED";
    } catch {
      await this.closeOrPersist();
      throw new BrowserDriverError("CONTROLLED_BROWSER_UNAVAILABLE");
    }
  }

  public async start(): Promise<void> {
    await this.prepareSession();
    await this.launch();
  }

  public async open(targetKey: string): Promise<ControlledNavigationResult> {
    if (this.#state !== "LAUNCHED" || !this.#page)
      throw new BrowserDriverError("INVALID_DRIVER_LIFECYCLE");
    this.#throwIfUnsafeTopLevelNavigation();
    let target: ControlledTarget;
    try {
      target = this.targets.resolve(targetKey);
    } catch {
      throw new BrowserDriverError("CONTROLLED_TARGET_NOT_REGISTERED");
    }
    if (target.browserFamily !== this.family)
      throw new BrowserDriverError("CONTROLLED_TARGET_NOT_REGISTERED");
    this.#activeTarget = target;
    this.#primaryNavigationStarted = false;
    try {
      await this.#page.goto(target.startUrl, {
        timeout: target.navigationTimeoutMs,
        waitUntil: "domcontentloaded",
      });
      if (!this.#isAllowedTopLevelUrl(this.#page.url(), target)) {
        this.#recordUnsafeTopLevelNavigation();
      }
      await this.#waitForNavigationStabilization();
      this.#throwIfUnsafeTopLevelNavigation();
      return {
        targetKey: target.key,
        finalOrigin: new URL(this.#page.url()).origin,
      };
    } catch (error) {
      if (error instanceof BrowserDriverError) throw error;
      this.#throwIfUnsafeTopLevelNavigation();
      throw new BrowserDriverError("NAVIGATION_FAILED");
    }
  }

  public getRuntimeMetadata(): BrowserRuntimeMetadata {
    return { ...this.#runtimeMetadata };
  }

  public getSecurityDiagnostics(): BrowserDriverSecurityDiagnostics {
    return {
      secondaryPageCount: this.#secondaryPageCount,
      unsafeTopLevelNavigation: this.#unsafeTopLevelNavigation,
    };
  }

  public createChatGPTStandardH3Strategy(): H3SurfaceStrategy {
    if (this.#state !== "LAUNCHED" || !this.#page || !this.#activeTarget) {
      throw new BrowserDriverError("INVALID_DRIVER_LIFECYCLE");
    }
    return createChatGPTStandardH3Strategy(this.#page, this.#activeTarget, () =>
      this.closeOrPersist(),
    );
  }

  public async observeStrategy(
    strategyId: PackagedStrategyId,
    timeoutMs: number,
  ): Promise<SafeStructuralObservation> {
    if (this.#state !== "LAUNCHED" || !this.#page || !this.#activeTarget)
      throw new BrowserDriverError("INVALID_DRIVER_LIFECYCLE");
    this.#throwIfUnsafeTopLevelNavigation();
    const parsedStrategyId = PackagedStrategyIdSchema.parse(strategyId);
    try {
      const result = await executePackagedStrategy(
        this.#page,
        parsedStrategyId,
        timeoutMs,
      );
      this.#throwIfUnsafeTopLevelNavigation();
      return result;
    } catch (error) {
      this.#throwIfUnsafeTopLevelNavigation();
      if (error instanceof Error && error.name === "TimeoutError")
        throw new BrowserDriverError("OBSERVATION_TIMEOUT");
      throw new BrowserDriverError("OBSERVATION_FAILED");
    }
  }

  public async closeOrPersist(): Promise<void> {
    const context = this.#context;
    const browser = this.#browser;
    await this.#disposeChromeNavigationFirewall();
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    this.#activeTarget = undefined;
    this.#state = "NEW";
    this.#creatingPrimaryPage = false;
    this.#runtimeMetadata = {
      ...this.#runtimeMetadata,
      browserVersion: "unavailable",
    };
    try {
      await context?.close();
    } catch {
      // Ephemeral cleanup is best effort after a browser failure.
    }
    try {
      await browser?.close();
    } catch {
      // Ephemeral cleanup is best effort after a browser failure.
    }
    this.#secondaryPageCount = 0;
  }

  public async stop(): Promise<void> {
    await this.closeOrPersist();
  }

  async #installContextNavigationGuard(context: BrowserContext): Promise<void> {
    context.on("page", (page) => this.#handleNewPage(page));
    context.on("request", (request) => {
      if (!this.#isTopLevelNavigationRequest(request)) return;
      try {
        const requestPage = request.frame().page();
        const target = this.#activeTarget;
        if (
          requestPage !== this.#page ||
          !target ||
          !this.#isAllowedTopLevelUrl(request.url(), target)
        ) {
          this.#recordUnsafeTopLevelNavigation();
        }
      } catch {
        this.#recordUnsafeTopLevelNavigation();
      }
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!this.#isTopLevelNavigationRequest(request)) {
        await route.continue();
        return;
      }
      let requestPage: Page;
      try {
        requestPage = request.frame().page();
      } catch {
        this.#recordUnsafeTopLevelNavigation();
        await route.abort();
        return;
      }
      if (requestPage !== this.#page) {
        this.#recordUnsafeTopLevelNavigation();
        await route.abort();
        return;
      }
      const target = this.#activeTarget;
      if (!target || !this.#isAllowedTopLevelUrl(request.url(), target)) {
        this.#recordUnsafeTopLevelNavigation();
        await route.abort();
        return;
      }
      this.#primaryNavigationStarted = true;
      await route.continue();
    });
  }

  async #installChromeNavigationFirewall(
    context: BrowserContext,
    page: Page,
  ): Promise<void> {
    const cdp = await context.newCDPSession(page);
    this.#cdpSession = cdp;
    await cdp.send("Page.enable");
    const frameTree = await cdp.send("Page.getFrameTree");
    this.#primaryFrameId = frameTree.frameTree.frame.id;
    const listener = (event: FetchRequestPausedEvent): void => {
      const task = this.#handleFetchRequestPaused(cdp, event);
      this.#cdpRequestTasks.add(task);
      void task.then(
        () => this.#cdpRequestTasks.delete(task),
        () => this.#cdpRequestTasks.delete(task),
      );
    };
    this.#cdpRequestPausedListener = listener;
    cdp.on("Fetch.requestPaused", listener);
    await cdp.send("Fetch.enable", {
      patterns: [{ requestStage: "Request" }],
    });
  }

  async #handleFetchRequestPaused(
    cdp: CDPSession,
    event: FetchRequestPausedEvent,
  ): Promise<void> {
    const isPrimaryDocument =
      event.resourceType === "Document" && this.#primaryFrameId !== undefined;
    const target = this.#activeTarget;
    if (
      isPrimaryDocument &&
      shouldBlockPrimaryDocumentRequest(
        event.request.url,
        event.frameId,
        this.#primaryFrameId as string,
        target?.allowedTopLevelOrigins ?? [],
      )
    ) {
      this.#recordUnsafeTopLevelNavigation();
      await cdp.send("Fetch.failRequest", {
        requestId: event.requestId,
        errorReason: "BlockedByClient",
      });
      return;
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  }

  async #disposeChromeNavigationFirewall(): Promise<void> {
    const cdp = this.#cdpSession;
    const listener = this.#cdpRequestPausedListener;
    this.#cdpSession = undefined;
    this.#cdpRequestPausedListener = undefined;
    this.#primaryFrameId = undefined;
    if (!cdp) return;
    if (listener) cdp.off("Fetch.requestPaused", listener);
    await cdp.send("Fetch.disable").catch(() => undefined);
    await Promise.allSettled([...this.#cdpRequestTasks]);
    this.#cdpRequestTasks.clear();
  }

  #handleNewPage(page: Page): void {
    if (!this.#page && this.#creatingPrimaryPage) {
      this.#page = page;
      return;
    }
    if (page === this.#page) return;
    this.#secondaryPageCount += 1;
    this.#recordUnsafeTopLevelNavigation();
    page.once("close", () => {
      this.#secondaryPageCount = Math.max(0, this.#secondaryPageCount - 1);
    });
    void page.close().catch(() => undefined);
  }

  #attachMainFrameNavigationDefense(page: Page): void {
    page.on("framenavigated", (frame) => {
      if (frame.parentFrame() !== null) return;
      if (page !== this.#page) {
        this.#recordUnsafeTopLevelNavigation();
        void page.close().catch(() => undefined);
        return;
      }
      const target = this.#activeTarget;
      if (frame.url() === "about:blank" && !this.#primaryNavigationStarted) {
        return;
      }
      if (!target || !this.#isAllowedTopLevelUrl(frame.url(), target)) {
        this.#recordUnsafeTopLevelNavigation();
      }
    });
  }

  #isAllowedTopLevelUrl(url: string, target: ControlledTarget): boolean {
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        target.allowedTopLevelOrigins.includes(parsed.origin)
      );
    } catch {
      return false;
    }
  }

  #isTopLevelNavigationRequest(request: import("playwright").Request): boolean {
    if (!request.isNavigationRequest()) return false;
    try {
      return request.frame().parentFrame() === null;
    } catch {
      return true;
    }
  }

  #recordUnsafeTopLevelNavigation(): void {
    this.#unsafeTopLevelNavigation = true;
  }

  #throwIfUnsafeTopLevelNavigation(): void {
    if (this.#unsafeTopLevelNavigation)
      throw new BrowserDriverError("UNSAFE_TOP_LEVEL_REDIRECT");
  }

  async #waitForNavigationStabilization(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, NAVIGATION_STABILIZATION_MS);
    });
  }
}
