import {
  EnvironmentUncertaintyReasonSchema,
  HealthClassificationInputSchema,
  HealthClassificationResultSchema,
  type HealthClassificationBasis,
  type HealthClassificationResult,
  type HealthContourDefinition,
  type HealthContourResult,
  type HealthProductFinding,
  type HealthState,
  type HealthSuiteDefinition,
} from "./types.js";

type ProductFinding = HealthProductFinding["finding"];

const PRE_IDENTITY_ENVIRONMENT_REASONS: ReadonlySet<string> = new Set([
  "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
  "CONTROLLED_BROWSER_UNAVAILABLE",
] as const);

const AUTH_OR_SECURITY_ENVIRONMENT_REASONS: ReadonlySet<string> = new Set([
  "LOGIN_EXPIRED",
  "VERIFICATION_CHECKPOINT",
  "CAPTCHA_SECURITY_CHECKPOINT",
  "ACCOUNT_BLOCKED",
] as const);

export class HealthClassificationError extends Error {
  public readonly code = "INCOHERENT_ENVIRONMENT_OBSERVATION" as const;

  public constructor() {
    super("INCOHERENT_ENVIRONMENT_OBSERVATION");
    this.name = "HealthClassificationError";
  }
}

function absenceAllowed(
  contour: HealthContourDefinition,
  suite: HealthSuiteDefinition,
): boolean {
  const required = isRequiredForScope(contour, suite);
  if (required || contour.absencePolicy.mode === "FORBIDDEN") return false;
  if (contour.absencePolicy.mode === "ALLOWED_FOR_SCOPE") return true;
  const variantKey = suite.scope.variant?.machineKey;
  return (
    variantKey !== undefined &&
    contour.absencePolicy.variantIds.includes(variantKey)
  );
}

function isRequiredForScope(
  contour: HealthContourDefinition,
  suite: HealthSuiteDefinition,
): boolean {
  const variantKey = suite.scope.variant?.machineKey;
  return (
    contour.required ||
    (variantKey !== undefined &&
      contour.requiredForVariantIds.includes(variantKey))
  );
}

function validateResultsAgainstSuite(
  suite: HealthSuiteDefinition,
  results: readonly HealthContourResult[],
): Map<string, HealthContourResult> {
  const definitions = new Map(
    suite.contours.map((contour) => [contour.key, contour]),
  );
  const byKey = new Map<string, HealthContourResult>();
  for (const result of results) {
    if (byKey.has(result.contourKey))
      throw new Error("DUPLICATE_CONTOUR_RESULT");
    const definition = definitions.get(result.contourKey);
    if (!definition) throw new Error("UNKNOWN_CONTOUR_RESULT");
    if (
      result.required !== isRequiredForScope(definition, suite) ||
      result.failureSeverity !== definition.failureSeverity ||
      result.primaryStrategyId !== definition.primaryStrategyId
    ) {
      throw new Error("CONTOUR_RESULT_DEFINITION_MISMATCH");
    }
    if (
      result.selectedStrategyId !== null &&
      result.selectedStrategyId !== result.primaryStrategyId
    ) {
      if (!definition.fallbackStrategyIds.includes(result.selectedStrategyId)) {
        throw new Error("SELECTED_FALLBACK_NOT_DECLARED");
      }
      const selectedFallbackResults = result.fallbackStrategyOutcomes.filter(
        (attempt) => attempt.strategyId === result.selectedStrategyId,
      );
      if (selectedFallbackResults.length !== 1) {
        throw new Error("SELECTED_FALLBACK_RESULT_MISSING");
      }
    }
    const fallbackIds = result.fallbackStrategyOutcomes.map(
      (attempt) => attempt.strategyId,
    );
    if (
      fallbackIds.some((id) => !definition.fallbackStrategyIds.includes(id))
    ) {
      throw new Error("CONTOUR_RESULT_UNKNOWN_FALLBACK");
    }
    byKey.set(result.contourKey, result);
  }
  for (const contour of suite.contours) {
    if (!byKey.has(contour.key) && !absenceAllowed(contour, suite)) {
      throw new Error("MISSING_REQUIRED_CONTOUR_RESULT");
    }
  }
  return byKey;
}

function contourFinding(
  contour: HealthContourDefinition,
  required: boolean,
  result: HealthContourResult,
): ProductFinding | undefined {
  if (result.observationStatus !== "PRESENT") {
    if (!required) return undefined;
    return contour.failureSeverity === "CORE" ? "BROKEN" : "DEGRADED";
  }
  const structuralPass = result.structuralOutcome === "PASS";
  const behavioralPass = result.behavioralOutcome === "PASS";
  const primaryPass = result.primaryStrategyOutcome === "PASS";
  if (primaryPass && structuralPass && behavioralPass) return undefined;
  const selectedFallback =
    result.selectedStrategyId !== null &&
    result.selectedStrategyId !== result.primaryStrategyId
      ? result.fallbackStrategyOutcomes.find(
          (attempt) => attempt.strategyId === result.selectedStrategyId,
        )
      : undefined;
  if (
    !primaryPass &&
    selectedFallback?.outcome === "PASS" &&
    result.fallbackQuality === "APPROVED_EQUIVALENT" &&
    structuralPass &&
    behavioralPass
  ) {
    return "DRIFT";
  }
  if (
    !primaryPass &&
    selectedFallback?.outcome === "PASS" &&
    result.fallbackQuality === "MATERIALLY_DEGRADED" &&
    structuralPass &&
    behavioralPass
  ) {
    return "DEGRADED";
  }
  if (required && contour.failureSeverity === "CORE") return "BROKEN";
  return "DEGRADED";
}

function productFindings(
  suite: HealthSuiteDefinition,
  byKey: ReadonlyMap<string, HealthContourResult>,
): HealthProductFinding[] {
  return suite.contours.flatMap((contour) => {
    const result = byKey.get(contour.key);
    // C13 is an environment observation. Its uncertainty must never become
    // a product failure simply because the raw contour is required.
    if (!result || result.environmentStatus === "UNCERTAIN") return [];
    const finding = contourFinding(
      contour,
      isRequiredForScope(contour, suite),
      result,
    );
    return finding ? [{ contourKey: contour.key, finding }] : [];
  });
}

function confidentPageIdentity(
  byKey: ReadonlyMap<string, HealthContourResult>,
): boolean {
  const identity = byKey.get("C01_PAGE_IDENTITY");
  if (!identity || identity.observationStatus !== "PRESENT") return false;
  if (
    identity.primaryStrategyOutcome === "PASS" &&
    identity.structuralOutcome === "PASS" &&
    identity.behavioralOutcome === "PASS"
  ) {
    return true;
  }
  const selectedFallback =
    identity.selectedStrategyId !== null &&
    identity.selectedStrategyId !== identity.primaryStrategyId
      ? identity.fallbackStrategyOutcomes.find(
          (attempt) => attempt.strategyId === identity.selectedStrategyId,
        )
      : undefined;
  return (
    selectedFallback?.outcome === "PASS" &&
    identity.fallbackQuality === "APPROVED_EQUIVALENT" &&
    identity.structuralOutcome === "PASS" &&
    identity.behavioralOutcome === "PASS"
  );
}

function permittedOptionalAbsence(
  suite: HealthSuiteDefinition,
  byKey: ReadonlyMap<string, HealthContourResult>,
): boolean {
  return suite.contours.some((contour) => {
    if (!absenceAllowed(contour, suite)) return false;
    const result = byKey.get(contour.key);
    return !result || result.observationStatus !== "PRESENT";
  });
}

function throwIncoherentEnvironment(): never {
  throw new HealthClassificationError();
}

type EnvironmentAssessment = Readonly<{
  reasons: readonly HealthContourResult["uncertaintyReason"][];
  unknownBasis:
    | "UNKNOWN_PRE_IDENTITY_ENVIRONMENT"
    | "UNKNOWN_AUTH_OR_SECURITY_BLOCKER"
    | null;
  productPrecedence: boolean;
}>;

function assessEnvironment(
  results: readonly HealthContourResult[],
  byKey: ReadonlyMap<string, HealthContourResult>,
  findings: readonly HealthProductFinding[],
): EnvironmentAssessment {
  const uncertainResults = results.filter(
    (result) => result.environmentStatus === "UNCERTAIN",
  );
  if (uncertainResults.length === 0) {
    return { reasons: [], unknownBasis: null, productPrecedence: false };
  }

  const reasons = uncertainResults.map((result) => result.uncertaintyReason);
  const uniqueReasons = Array.from(
    new Set(
      reasons.filter(
        (reason): reason is NonNullable<typeof reason> => reason !== null,
      ),
    ),
  );
  if (
    uncertainResults.length !== 1 ||
    uniqueReasons.length !== 1 ||
    uncertainResults[0]?.contourKey !== "C13_BLOCKING_STATE" ||
    uncertainResults[0]?.observationStatus !== "PRESENT" ||
    uncertainResults[0]?.uncertaintyReason === null
  ) {
    return throwIncoherentEnvironment();
  }

  const reason = uncertainResults[0].uncertaintyReason;
  if (!EnvironmentUncertaintyReasonSchema.safeParse(reason).success) {
    return throwIncoherentEnvironment();
  }
  if (
    uncertainResults[0].primaryStrategyOutcome !== "UNCERTAIN" ||
    uncertainResults[0].fallbackStrategyOutcomes.length !== 0 ||
    uncertainResults[0].selectedStrategyId !== null ||
    uncertainResults[0].structuralOutcome !== "UNCERTAIN" ||
    uncertainResults[0].behavioralOutcome !== "UNCERTAIN" ||
    uncertainResults[0].fallbackQuality !== "NOT_APPLICABLE"
  ) {
    return throwIncoherentEnvironment();
  }
  const pageIdentityIsConfident = confidentPageIdentity(byKey);
  const independentFindings = findings.filter(
    (finding) =>
      finding.contourKey !== "C01_PAGE_IDENTITY" &&
      finding.contourKey !== "C13_BLOCKING_STATE" &&
      byKey.get(finding.contourKey)?.observationStatus === "PRESENT",
  );

  if (PRE_IDENTITY_ENVIRONMENT_REASONS.has(reason)) {
    if (pageIdentityIsConfident && independentFindings.length > 0) {
      return { reasons, unknownBasis: null, productPrecedence: true };
    }
    if (pageIdentityIsConfident || independentFindings.length > 0) {
      return throwIncoherentEnvironment();
    }
    return {
      reasons,
      unknownBasis: "UNKNOWN_PRE_IDENTITY_ENVIRONMENT",
      productPrecedence: false,
    };
  }

  if (!AUTH_OR_SECURITY_ENVIRONMENT_REASONS.has(reason)) {
    return throwIncoherentEnvironment();
  }
  if (!pageIdentityIsConfident && independentFindings.length > 0) {
    return throwIncoherentEnvironment();
  }
  return {
    reasons,
    unknownBasis:
      independentFindings.length > 0
        ? null
        : "UNKNOWN_AUTH_OR_SECURITY_BLOCKER",
    productPrecedence: independentFindings.length > 0,
  };
}

function basisForFindings(findings: readonly HealthProductFinding[]): {
  state: HealthState;
  basis: HealthClassificationBasis;
} {
  if (findings.some((finding) => finding.finding === "BROKEN")) {
    return {
      state: "BROKEN",
      basis: "BROKEN_REQUIRED_CORE_FAILURE",
    };
  }
  if (findings.some((finding) => finding.finding === "DEGRADED")) {
    return {
      state: "DEGRADED",
      basis: "DEGRADED_NON_CORE_FAILURE",
    };
  }
  if (findings.some((finding) => finding.finding === "DRIFT")) {
    return { state: "DRIFT", basis: "DRIFT_APPROVED_FALLBACK" };
  }
  return { state: "HEALTHY", basis: "HEALTHY_PRIMARY" };
}

function materialFallbackPresent(
  findings: readonly HealthProductFinding[],
  byKey: ReadonlyMap<string, HealthContourResult>,
): boolean {
  return findings.some(
    ({ contourKey, finding }) =>
      finding === "DEGRADED" &&
      byKey.get(contourKey)?.fallbackQuality === "MATERIALLY_DEGRADED",
  );
}

function immutableResult(
  result: HealthClassificationResult,
): HealthClassificationResult {
  const parsed = HealthClassificationResultSchema.parse(result);
  Object.freeze(parsed.findingContourKeys);
  Object.freeze(parsed.productFindings);
  Object.freeze(parsed.environmentUncertaintyReasons);
  for (const finding of parsed.productFindings) Object.freeze(finding);
  return Object.freeze(parsed);
}

export function classifyHealthDetailed(
  input: unknown,
): HealthClassificationResult {
  const parsed = HealthClassificationInputSchema.parse(input);
  const byKey = validateResultsAgainstSuite(parsed.suite, parsed.results);
  const findings = productFindings(parsed.suite, byKey);
  const environment = assessEnvironment(parsed.results, byKey, findings);

  if (parsed.operatorMaintenance) {
    return immutableResult({
      state: "MAINTENANCE",
      basis: "MAINTENANCE_OPERATOR",
      findingContourKeys: findings.map(({ contourKey }) => contourKey),
      productFindings: findings,
      environmentUncertaintyReasons: environment.reasons.filter(
        (reason): reason is NonNullable<typeof reason> => reason !== null,
      ),
      operatorMaintenance: true,
    });
  }

  if (environment.unknownBasis !== null && !environment.productPrecedence) {
    return immutableResult({
      state: "UNKNOWN",
      basis: environment.unknownBasis,
      findingContourKeys: [],
      productFindings: [],
      environmentUncertaintyReasons: environment.reasons.filter(
        (reason): reason is NonNullable<typeof reason> => reason !== null,
      ),
      operatorMaintenance: false,
    });
  }

  const classification = basisForFindings(findings);
  const basis =
    classification.state === "HEALTHY" &&
    permittedOptionalAbsence(parsed.suite, byKey)
      ? "HEALTHY_ALLOWED_OPTIONAL_ABSENCE"
      : classification.state === "DEGRADED" &&
          materialFallbackPresent(findings, byKey)
        ? "DEGRADED_MATERIAL_FALLBACK"
        : classification.basis;
  return immutableResult({
    state: classification.state,
    basis,
    findingContourKeys: findings.map(({ contourKey }) => contourKey),
    productFindings: findings,
    environmentUncertaintyReasons: environment.reasons.filter(
      (reason): reason is NonNullable<typeof reason> => reason !== null,
    ),
    operatorMaintenance: false,
  });
}

export function classifyHealth(input: unknown): HealthState {
  return classifyHealthDetailed(input).state;
}

export function isHealthState(value: unknown): value is HealthState {
  return (
    value === "HEALTHY" ||
    value === "DRIFT" ||
    value === "DEGRADED" ||
    value === "BROKEN" ||
    value === "UNKNOWN" ||
    value === "MAINTENANCE"
  );
}
