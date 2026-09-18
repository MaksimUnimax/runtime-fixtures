import {
  NoSessionBrowserModeMetadataSchema,
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

type NoSessionObservationMode = "HEADED" | "HEADLESS_DIAGNOSTIC";

function modeForRuntime(
  runtime: NoSessionObservationResult["browserRuntime"],
): NoSessionObservationMode {
  return runtime.headless ? "HEADLESS_DIAGNOSTIC" : "HEADED";
}

function observationSummary(
  result: NoSessionObservationResult,
  mode: NoSessionObservationMode,
) {
  return {
    mode,
    identity: result.identity,
    blocker: result.blocker,
    classification: result.classification,
    surfaceOutcome: result.surfaceOutcome,
  };
}

function withSingleMode(
  result: NoSessionObservationResult,
  mode = modeForRuntime(result.browserRuntime),
): NoSessionObservationResult {
  return NoSessionObservationResultSchema.parse({
    ...result,
    browserMode: NoSessionBrowserModeMetadataSchema.parse({
      canonicalMode: mode,
      authoritativeMode: mode,
      diagnosticMode: null,
      fallbackAttempted: false,
      fallbackReason: "NOT_REQUIRED",
      headedInfrastructure: mode === "HEADED" ? "AVAILABLE" : "NOT_CHECKED",
      environmentLimited: mode === "HEADLESS_DIAGNOSTIC",
      canonicalObservation: observationSummary(result, mode),
      diagnosticObservation: null,
    }),
  });
}

function withExecutionMetadata(
  authoritative: NoSessionObservationResult,
  canonical: NoSessionObservationResult,
  diagnostic: NoSessionObservationResult | null,
  fallbackReason: NoSessionObservationResult["browserMode"]["fallbackReason"],
  headedInfrastructure: NoSessionObservationResult["browserMode"]["headedInfrastructure"],
): NoSessionObservationResult {
  const canonicalMode = modeForRuntime(canonical.browserRuntime);
  const authoritativeMode = modeForRuntime(authoritative.browserRuntime);
  const diagnosticMode = diagnostic
    ? modeForRuntime(diagnostic.browserRuntime)
    : null;
  return NoSessionObservationResultSchema.parse({
    ...authoritative,
    browserMode: NoSessionBrowserModeMetadataSchema.parse({
      canonicalMode,
      authoritativeMode,
      diagnosticMode,
      fallbackAttempted:
        diagnosticMode === "HEADLESS_DIAGNOSTIC" &&
        authoritativeMode === "HEADED" &&
        fallbackReason !== "NOT_REQUIRED",
      fallbackReason,
      headedInfrastructure,
      environmentLimited:
        headedInfrastructure === "UNAVAILABLE" ||
        authoritativeMode === "HEADLESS_DIAGNOSTIC",
      canonicalObservation: observationSummary(canonical, canonicalMode),
      diagnosticObservation: diagnostic
        ? observationSummary(diagnostic, diagnosticMode!)
        : null,
    }),
  });
}

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
              : blocker === "UNSUPPORTED_ENVIRONMENT"
                ? "UNSUPPORTED_ENVIRONMENT"
                : "IDENTITY_NOT_PROVEN";
  const result = NoSessionObservationResultSchema.parse({
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId: target.strategyId,
    strategyRevision: target.strategyRevision,
    browserRuntime: browser.getRuntimeMetadata(),
    browserMode: withSingleMode({
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
    } as unknown as NoSessionObservationResult).browserMode,
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
  return result;
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
    result = withSingleMode(
      strategy.evaluate(
        target,
        snapshot,
        browser.getRuntimeMetadata(),
        observedAt,
        navigation,
      ),
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
    const failedNavigation = browser.getNavigationEvidence();
    result = failureResult(
      target,
      browser,
      mapped.blocker,
      mapped.basis,
      observedAt,
      "FAILED",
      failedNavigation.finalOrigin,
      failedNavigation,
    );
  } finally {
    await browser.stop();
  }
  return attachEvidence(result);
}

export type NoSessionBrowserFactory = () => NoSessionBrowserDriver;

export type NoSessionAutomaticBrowserPolicy = Readonly<{
  createHeadedBrowser: NoSessionBrowserFactory;
  createHeadlessDiagnosticBrowser?: NoSessionBrowserFactory;
  diagnosticFirst?: boolean;
}>;

function unavailableBrowser(
  mode: "HEADED" | "HEADLESS_DIAGNOSTIC" = "HEADED",
): NoSessionBrowserDriver {
  const runtime = {
    family: "chrome" as const,
    browserName: "unavailable",
    browserVersion: "unavailable",
    headless: mode === "HEADLESS_DIAGNOSTIC",
    sessionKind: "EPHEMERAL_CONTROLLED" as const,
  };
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
    getRuntimeMetadata: () => runtime,
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

function fallbackReasonFor(
  result: NoSessionObservationResult,
): NoSessionObservationResult["browserMode"]["fallbackReason"] {
  if (
    result.blocker === "SECURITY_CHECKPOINT" ||
    result.blocker === "CAPTCHA_SECURITY_CHECKPOINT"
  )
    return "SECURITY_CHECKPOINT";
  if (result.blocker === "ACCESS_BLOCKED") return "ACCESS_BLOCKED";
  if (result.identity !== "PROVEN") return "IDENTITY_NOT_PROVEN";
  if (result.readiness === "STATIC_LANDING") return "UNEXPECTED_STATIC_SURFACE";
  return "NOT_REQUIRED";
}

async function runWithFactory(
  target: NoSessionTarget,
  factory: NoSessionBrowserFactory,
  mode: "HEADED" | "HEADLESS_DIAGNOSTIC",
  observedAt: string,
): Promise<
  NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  }
> {
  try {
    return await runNoSessionProbe(
      target,
      factory(),
      getNoSessionStrategy(target.surfaceId),
      observedAt,
    );
  } catch {
    return await runNoSessionProbe(
      target,
      unavailableBrowser(mode),
      getNoSessionStrategy(target.surfaceId),
      observedAt,
    );
  }
}

export async function runNoSessionAutomaticProbe(
  target: NoSessionTarget,
  policy: NoSessionAutomaticBrowserPolicy = {
    createHeadedBrowser: () =>
      createNoSessionChromeBrowserDriver({ mode: "HEADED" }),
    createHeadlessDiagnosticBrowser: () =>
      createNoSessionChromeBrowserDriver({ mode: "HEADLESS_DIAGNOSTIC" }),
  },
  observedAt = new Date().toISOString(),
): Promise<
  NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  }
> {
  const diagnosticFactory = policy.createHeadlessDiagnosticBrowser;
  if (policy.diagnosticFirst && diagnosticFactory) {
    const diagnostic = await runWithFactory(
      target,
      diagnosticFactory,
      "HEADLESS_DIAGNOSTIC",
      observedAt,
    );
    const reason = fallbackReasonFor(diagnostic);
    const headed = await runWithFactory(
      target,
      policy.createHeadedBrowser,
      "HEADED",
      observedAt,
    );
    const headedAvailable = headed.blocker !== "BROWSER_UNAVAILABLE";
    const authoritative = headedAvailable ? headed : diagnostic;
    const canonical = headedAvailable ? headed : diagnostic;
    return attachEvidence(
      withExecutionMetadata(
        authoritative,
        canonical,
        diagnostic,
        headedAvailable ? reason : "HEADED_INFRASTRUCTURE_UNAVAILABLE",
        headedAvailable ? "AVAILABLE" : "UNAVAILABLE",
      ),
    );
  }

  const headed = await runWithFactory(
    target,
    policy.createHeadedBrowser,
    "HEADED",
    observedAt,
  );
  const headedAvailable = headed.blocker !== "BROWSER_UNAVAILABLE";
  return attachEvidence(
    withExecutionMetadata(
      headed,
      headed,
      null,
      headedAvailable ? "NOT_REQUIRED" : "HEADED_INFRASTRUCTURE_UNAVAILABLE",
      headedAvailable ? "AVAILABLE" : "UNAVAILABLE",
    ),
  );
}

export async function runNoSessionBatch(
  targets: readonly NoSessionTarget[] = NO_SESSION_TARGETS,
  createBrowser?: NoSessionBrowserFactory,
  observedAt = new Date().toISOString(),
  policy?: NoSessionAutomaticBrowserPolicy,
): Promise<
  readonly (NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  })[]
> {
  const results: (NoSessionObservationResult & {
    readonly evidence: readonly NoSessionSafeEvidenceReference[];
  })[] = [];
  if (!createBrowser) {
    for (const target of targets) {
      results.push(
        await runNoSessionAutomaticProbe(target, policy, observedAt),
      );
    }
    return Object.freeze(results);
  }
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
