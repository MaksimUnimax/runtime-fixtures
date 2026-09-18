import {
  type NoSessionObservationResult,
  NoSessionObservationResultSchema,
} from "./no-session-contracts.js";
import {
  createNoSessionChromeBrowserDriver,
  NoSessionBrowserError,
  type NoSessionBrowserDriver,
} from "./no-session-browser-driver.js";
import {
  getNoSessionStrategy,
  type NoSessionProviderStrategy,
} from "./no-session-strategies.js";
import {
  NO_SESSION_TARGETS,
  type NoSessionTarget,
} from "./no-session-target-authority.js";
import {
  createNoSessionSafeEvidence,
  type NoSessionSafeEvidenceReference,
} from "./no-session-evidence.js";

const EMPTY_ELEMENT_METADATA = Object.freeze({
  elementCount: 0,
  visible: false,
  editable: false,
  actionable: false,
});

function failureResult(
  target: NoSessionTarget,
  browser: NoSessionBrowserDriver,
  blocker: NoSessionObservationResult["blocker"],
  basis: NoSessionObservationResult["classificationBasis"],
  observedAt: string,
  navigation: NoSessionObservationResult["navigation"] = "FAILED",
  finalOrigin: string | null = null,
  navigationEvidence = browser.getNavigationEvidence(),
): NoSessionObservationResult {
  const surfaceOutcome =
    blocker === "BROWSER_UNAVAILABLE"
      ? "BROWSER_FAILURE"
      : blocker === "NETWORK_FAILURE"
        ? "NETWORK_FAILURE"
        : blocker === "ACCESS_BLOCKED"
          ? "ACCESS_BLOCKED"
          : blocker === "SECURITY_CHECKPOINT" ||
              blocker === "CAPTCHA_SECURITY_CHECKPOINT"
            ? "SECURITY_CHECKPOINT"
            : blocker === "MAINTENANCE"
              ? "MAINTENANCE"
              : "IDENTITY_NOT_PROVEN";
  return NoSessionObservationResultSchema.parse({
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId: target.strategyId,
    strategyRevision: target.strategyRevision,
    browserRuntime: browser.getRuntimeMetadata(),
    navigation,
    navigationEvidence,
    finalOrigin,
    expectedOriginValid:
      finalOrigin !== null &&
      target.allowedTopLevelOrigins.includes(finalOrigin),
    identity: "NOT_PROVEN",
    publicSurface: "NOT_PROVABLE",
    composer: "NOT_PROVABLE",
    editableInput: "NOT_PROVABLE",
    sendControl: "NOT_PROVABLE",
    authentication: "NOT_PROVABLE",
    blocker,
    classification: blocker === "MAINTENANCE" ? "MAINTENANCE" : "UNKNOWN",
    classificationBasis: basis,
    surfaceOutcome,
    readiness: "NOT_OBSERVED",
    elementMetadata: {
      composer: EMPTY_ELEMENT_METADATA,
      editableInput: EMPTY_ELEMENT_METADATA,
      sendControl: EMPTY_ELEMENT_METADATA,
    },
    noInteraction: true,
    observedAt,
    evidence: [],
  });
}

function mapBrowserError(error: unknown): {
  blocker: NoSessionObservationResult["blocker"];
  basis: NoSessionObservationResult["classificationBasis"];
} {
  if (!(error instanceof NoSessionBrowserError)) {
    return { blocker: "NETWORK_FAILURE", basis: "NETWORK_FAILURE" };
  }
  switch (error.code) {
    case "CONTROLLED_BROWSER_UNAVAILABLE":
      return { blocker: "BROWSER_UNAVAILABLE", basis: "BROWSER_FAILURE" };
    case "UNSAFE_TOP_LEVEL_REDIRECT":
      return {
        blocker: "ORIGIN_POLICY_VIOLATION",
        basis: "ORIGIN_POLICY_FAILURE",
      };
    case "NAVIGATION_FAILED":
      return { blocker: "NETWORK_FAILURE", basis: "NETWORK_FAILURE" };
    case "OBSERVATION_FAILED":
      return { blocker: "UNEXPECTED_SURFACE", basis: "UNEXPECTED_SURFACE" };
    case "INVALID_DRIVER_LIFECYCLE":
      return { blocker: "BROWSER_UNAVAILABLE", basis: "BROWSER_FAILURE" };
  }
}

function attachEvidence(
  result: NoSessionObservationResult,
): NoSessionObservationResult & {
  readonly evidence: readonly NoSessionSafeEvidenceReference[];
} {
  const evidence = createNoSessionSafeEvidence(result);
  return Object.freeze({ ...result, evidence: evidence.references });
}

export async function runNoSessionProbe(
  target: NoSessionTarget,
  browser: NoSessionBrowserDriver,
  strategy: NoSessionProviderStrategy = getNoSessionStrategy(target.surfaceId),
  observedAt = new Date().toISOString(),
): Promise<
  NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  }
> {
  let result: NoSessionObservationResult;
  try {
    await browser.start();
    const navigation = await browser.open(target);
    const snapshot = await browser.observe(strategy.profile, 5_000);
    result = strategy.evaluate(
      target,
      snapshot,
      browser.getRuntimeMetadata(),
      observedAt,
      navigation,
    );
    if (navigation.finalOrigin !== result.finalOrigin) {
      result = failureResult(
        target,
        browser,
        "UNEXPECTED_SURFACE",
        "UNEXPECTED_SURFACE",
        observedAt,
        "LOADED",
        navigation.finalOrigin,
        navigation,
      );
    }
  } catch (error) {
    const mapped = mapBrowserError(error);
    result = failureResult(
      target,
      browser,
      mapped.blocker,
      mapped.basis,
      observedAt,
      "FAILED",
      null,
      browser.getNavigationEvidence(),
    );
  } finally {
    await browser.stop();
  }
  return attachEvidence(result);
}

export type NoSessionBrowserFactory = () => NoSessionBrowserDriver;

const UNAVAILABLE_BROWSER_RUNTIME = {
  family: "chrome" as const,
  browserName: "unavailable",
  browserVersion: "unavailable",
  headless: true,
  sessionKind: "EPHEMERAL_CONTROLLED" as const,
};

function unavailableBrowser(): NoSessionBrowserDriver {
  return {
    family: "chrome",
    sessionKind: "EPHEMERAL_CONTROLLED",
    start: async () => undefined,
    open: async () => {
      throw new NoSessionBrowserError("CONTROLLED_BROWSER_UNAVAILABLE");
    },
    observe: async () => {
      throw new NoSessionBrowserError("CONTROLLED_BROWSER_UNAVAILABLE");
    },
    getRuntimeMetadata: () => UNAVAILABLE_BROWSER_RUNTIME,
    getNavigationEvidence: () => ({
      requestedStartUrl: "https://invalid.example/",
      finalUrl: "https://invalid.example/",
      finalOrigin: "https://invalid.example",
      mainDocumentHttpStatus: null,
      redirectCount: 0,
      outcome: "HTTP_FAILURE" as const,
    }),
    getSecurityDiagnostics: () => ({
      secondaryPageCount: 0,
      unsafeTopLevelNavigation: false,
    }),
    stop: async () => undefined,
  };
}

export async function runNoSessionBatch(
  targets: readonly NoSessionTarget[] = NO_SESSION_TARGETS,
  createBrowser: NoSessionBrowserFactory = () =>
    createNoSessionChromeBrowserDriver(),
  observedAt = new Date().toISOString(),
): Promise<
  readonly (NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  })[]
> {
  const results: (NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  })[] = [];
  for (const target of targets) {
    let browser: NoSessionBrowserDriver;
    try {
      browser = createBrowser();
    } catch {
      const unavailable = unavailableBrowser();
      results.push(
        attachEvidence(
          failureResult(
            target,
            unavailable,
            "BROWSER_UNAVAILABLE",
            "BROWSER_FAILURE",
            observedAt,
          ),
        ),
      );
      continue;
    }
    try {
      results.push(
        await runNoSessionProbe(
          target,
          browser,
          getNoSessionStrategy(target.surfaceId),
          observedAt,
        ),
      );
    } catch {
      // A target-specific failure must not suppress the remaining provider attempts.
      const fallback = failureResult(
        target,
        browser,
        "BROWSER_UNAVAILABLE",
        "BROWSER_FAILURE",
        observedAt,
        "FAILED",
        null,
      );
      results.push(attachEvidence(fallback));
      await browser.stop();
    }
  }
  return Object.freeze(results);
}
