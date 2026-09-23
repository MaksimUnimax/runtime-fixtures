import {
  AdapterProfileContentV1Schema,
  PersistedProfileRevisionSchema,
  validateProfileContent,
} from "@product/adapter-registry";
import { describe, expect, it } from "vitest";
import {
  BASELINE_CONTOUR_CATALOG,
  BASELINE_CONTOUR_KEYS,
  BASELINE_HEALTH_SUITE,
  HealthContourResultSchema,
  HealthLevelSchema,
  HealthStateSchema,
  HealthSuiteDefinitionSchema,
  HealthSuiteRegistry,
  classifyHealthDetailed,
  classifyHealth,
  createBaselineHealthSuite,
  healthSuiteFingerprint,
  validateH0ProfileCandidate,
  validateHealthSuiteDefinition,
} from "./index.js";
import type {
  HealthContourDefinition,
  HealthContourResult,
  HealthSuiteDefinition,
} from "./index.js";

const UUIDS = {
  adapter: "00000000-0000-4000-8000-000000000011",
  surface: "00000000-0000-4000-8000-000000000012",
  variant: "00000000-0000-4000-8000-000000000013",
  profile: "00000000-0000-4000-8000-000000000014",
  principal: "00000000-0000-4000-8000-000000000015",
};

function definitionFor(
  key: HealthContourDefinition["key"],
): HealthContourDefinition {
  return BASELINE_HEALTH_SUITE.contours.find(
    (definition) => definition.key === key,
  )!;
}

function resultFor(
  key: HealthContourDefinition["key"],
  overrides: Partial<HealthContourResult> = {},
): HealthContourResult {
  const definition = definitionFor(key);
  return HealthContourResultSchema.parse({
    contourKey: key,
    required: definition.required,
    failureSeverity: definition.failureSeverity,
    observationStatus: "PRESENT",
    primaryStrategyId: definition.primaryStrategyId,
    primaryStrategyOutcome: "PASS",
    fallbackStrategyOutcomes: [],
    selectedStrategyId: definition.primaryStrategyId,
    structuralOutcome: "PASS",
    behavioralOutcome: "PASS",
    fallbackQuality: "NOT_APPLICABLE",
    environmentStatus: "VALID",
    uncertaintyReason: null,
    evidence: [],
    ...overrides,
  });
}

function passedResults(
  suite: HealthSuiteDefinition = BASELINE_HEALTH_SUITE,
): HealthContourResult[] {
  return suite.contours.map((definition) => resultFor(definition.key));
}

function replaceResult(
  results: readonly HealthContourResult[],
  replacement: HealthContourResult,
): HealthContourResult[] {
  const matchingIndexes = results.reduce<number[]>((indexes, result, index) => {
    if (result.contourKey === replacement.contourKey) indexes.push(index);
    return indexes;
  }, []);
  if (matchingIndexes.length !== 1) {
    throw new Error("TEST_FIXTURE_REPLACEMENT_REQUIRES_ONE_EXISTING_RESULT");
  }
  const [matchingIndex] = matchingIndexes;
  return results.map((result, index) =>
    index === matchingIndex ? replacement : result,
  );
}

function suiteWith(
  changes: Partial<HealthSuiteDefinition["scope"]> = {},
  contourChanges: Record<string, Partial<HealthContourDefinition>> = {},
): HealthSuiteDefinition {
  return validateHealthSuiteDefinition({
    ...BASELINE_HEALTH_SUITE,
    scope: { ...BASELINE_HEALTH_SUITE.scope, ...changes },
    contours: BASELINE_HEALTH_SUITE.contours.map((definition) => ({
      ...definition,
      ...(contourChanges[definition.key] ?? {}),
    })),
  });
}

function environmentUncertainResult(
  reason: HealthContourResult["uncertaintyReason"],
): HealthContourResult {
  if (reason === null) throw new Error("TEST_UNCERTAINTY_REASON_REQUIRED");
  return resultFor("C13_BLOCKING_STATE", {
    primaryStrategyOutcome: "UNCERTAIN",
    fallbackStrategyOutcomes: [],
    selectedStrategyId: null,
    structuralOutcome: "UNCERTAIN",
    behavioralOutcome: "UNCERTAIN",
    environmentStatus: "UNCERTAIN",
    uncertaintyReason: reason,
  });
}

function notObservedResult(
  key: HealthContourDefinition["key"],
): HealthContourResult {
  return resultFor(key, {
    observationStatus: "NOT_OBSERVED",
    primaryStrategyOutcome: "NOT_ATTEMPTED",
    fallbackStrategyOutcomes: [],
    selectedStrategyId: null,
    structuralOutcome: "NOT_RUN",
    behavioralOutcome: "NOT_RUN",
    fallbackQuality: "NOT_APPLICABLE",
    environmentStatus: "VALID",
    uncertaintyReason: null,
  });
}

function preIdentityResults(
  reason: HealthContourResult["uncertaintyReason"],
): HealthContourResult[] {
  return BASELINE_HEALTH_SUITE.contours.map((contour) =>
    contour.key === "C13_BLOCKING_STATE"
      ? environmentUncertainResult(reason)
      : notObservedResult(contour.key),
  );
}

describe("P8.1 health contracts", () => {
  it("represents exactly the six health states and six normative levels", () => {
    expect(HealthStateSchema.options).toEqual([
      "HEALTHY",
      "DRIFT",
      "DEGRADED",
      "BROKEN",
      "UNKNOWN",
      "MAINTENANCE",
    ]);
    expect(HealthLevelSchema.options).toEqual([
      "H0",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
    ]);
    expect(HealthStateSchema.safeParse("UNHEALTHY").success).toBe(false);
  });

  it("keeps Standard and Work scope identity independent", () => {
    const standard = BASELINE_HEALTH_SUITE.scope;
    const work = {
      ...standard,
      surfaceId: UUIDS.surface,
      surfaceKey: "work",
      variant: { id: UUIDS.variant, machineKey: "work" },
    };
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        scope: standard,
      }).success,
    ).toBe(true);
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        scope: {
          ...work,
          healthSuite: BASELINE_HEALTH_SUITE.scope.healthSuite,
        },
      }).success,
    ).toBe(true);
    expect(standard.surfaceKey).not.toBe(work.surfaceKey);
    expect(standard.variant).not.toEqual(work.variant);
  });

  it.each([
    ["bad UUID", { adapterFamilyId: "not-a-uuid" }],
    [
      "non-positive profile revision",
      { profile: { id: UUIDS.profile, revision: 0 } },
    ],
    ["bad extension version", { extensionVersion: "v1" }],
    ["bad browser version", { browserVersion: "chrome-latest" }],
  ])("rejects %s in the strict health scope", (_label, change) => {
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        scope: { ...BASELINE_HEALTH_SUITE.scope, ...change },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown definition keys and all adversarial executable expansion fields", () => {
    const forbidden = [
      "script",
      "javascript",
      "eval",
      "wasm",
      "module",
      "command",
      "shell",
      "filesystemPath",
      "url",
      "headers",
      "credentials",
      "providerOperation",
      "arbitrarySelectorScript",
    ];
    for (const field of forbidden) {
      expect(
        HealthSuiteDefinitionSchema.safeParse({
          ...BASELINE_HEALTH_SUITE,
          [field]: "blocked",
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("rejects duplicate contour keys, invalid timeouts, and empty primary strategies", () => {
    const duplicate = [
      ...BASELINE_HEALTH_SUITE.contours,
      BASELINE_HEALTH_SUITE.contours[0]!,
    ];
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        contours: duplicate,
      }).success,
    ).toBe(false);
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        contours: BASELINE_HEALTH_SUITE.contours.map((definition, index) =>
          index === 0 ? { ...definition, timeoutMs: 249 } : definition,
        ),
      }).success,
    ).toBe(false);
    expect(
      HealthSuiteDefinitionSchema.safeParse({
        ...BASELINE_HEALTH_SUITE,
        contours: BASELINE_HEALTH_SUITE.contours.map((definition, index) =>
          index === 0 ? { ...definition, primaryStrategyId: "" } : definition,
        ),
      }).success,
    ).toBe(false);
  });

  it("keeps fallback strategy ordering and accepts only packaged vocabulary", () => {
    const definition = definitionFor("C05_SEND_CONTROL");
    expect(definition.fallbackStrategyIds).toEqual(["COMPOSER_ACTION_CONTROL"]);
    expect(
      HealthContourResultSchema.safeParse({
        ...resultFor("C05_SEND_CONTROL"),
        fallbackStrategyOutcomes: [
          { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
        ],
      }).success,
    ).toBe(true);
    expect(
      HealthContourResultSchema.safeParse({
        ...resultFor("C05_SEND_CONTROL"),
        fallbackStrategyOutcomes: [
          { strategyId: "arbitrary_script", outcome: "PASS" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an uncertainty reason without UNCERTAIN status and vice versa", () => {
    expect(
      HealthContourResultSchema.safeParse({
        ...resultFor("C13_BLOCKING_STATE"),
        uncertaintyReason: "LOGIN_EXPIRED",
      }).success,
    ).toBe(false);
    expect(
      HealthContourResultSchema.safeParse({
        ...resultFor("C13_BLOCKING_STATE"),
        environmentStatus: "UNCERTAIN",
        uncertaintyReason: null,
      }).success,
    ).toBe(false);
  });

  it("validates the exact C01-C13 baseline catalog", () => {
    expect(BASELINE_CONTOUR_KEYS).toHaveLength(13);
    expect(
      BASELINE_CONTOUR_CATALOG.map((definition) => definition.key),
    ).toEqual(BASELINE_CONTOUR_KEYS);
    expect(
      new Set(BASELINE_CONTOUR_CATALOG.map((definition) => definition.key))
        .size,
    ).toBe(13);
    expect(createBaselineHealthSuite().contours).toHaveLength(13);
    expect(BASELINE_HEALTH_SUITE.description).toContain(
      "no current provider selectors",
    );
  });
});

describe("deterministic suite registry and fingerprints", () => {
  it("rejects duplicate machine-key/revision entries and retrieves deterministically", () => {
    expect(
      () =>
        new HealthSuiteRegistry([BASELINE_HEALTH_SUITE, BASELINE_HEALTH_SUITE]),
    ).toThrow("DUPLICATE_HEALTH_SUITE_KEY_REVISION");
    const revised = validateHealthSuiteDefinition({
      ...BASELINE_HEALTH_SUITE,
      revision: 2,
      scope: {
        ...BASELINE_HEALTH_SUITE.scope,
        healthSuite: {
          machineKey: BASELINE_HEALTH_SUITE.machineKey,
          revision: 2,
        },
      },
    });
    const registry = new HealthSuiteRegistry([BASELINE_HEALTH_SUITE, revised]);
    expect(registry.get(BASELINE_HEALTH_SUITE.machineKey, 1)).toEqual(
      BASELINE_HEALTH_SUITE,
    );
    expect(registry.get(BASELINE_HEALTH_SUITE.machineKey, 2)).toEqual(revised);
    expect(registry.get(BASELINE_HEALTH_SUITE.machineKey, 3)).toBeUndefined();
  });

  it("uses canonical server SHA-256 fingerprinting", () => {
    const sameDefinitionWithDifferentKeyOrder = JSON.parse(
      JSON.stringify(BASELINE_HEALTH_SUITE),
    ) as Record<string, unknown>;
    const first = healthSuiteFingerprint(BASELINE_HEALTH_SUITE);
    const second = healthSuiteFingerprint({
      scope: sameDefinitionWithDifferentKeyOrder.scope,
      contours: sameDefinitionWithDifferentKeyOrder.contours,
      description: sameDefinitionWithDifferentKeyOrder.description,
      displayName: sameDefinitionWithDifferentKeyOrder.displayName,
      suiteKind: sameDefinitionWithDifferentKeyOrder.suiteKind,
      revision: sameDefinitionWithDifferentKeyOrder.revision,
      machineKey: sameDefinitionWithDifferentKeyOrder.machineKey,
    });
    expect(first).toBe(second);
    expect(
      healthSuiteFingerprint({
        ...BASELINE_HEALTH_SUITE,
        description: "material definition change",
      }),
    ).not.toBe(first);
  });
});

describe("deterministic health classifier", () => {
  it("returns MAINTENANCE before any product or environment finding", () => {
    const result = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (item) => item.contourKey !== result.contourKey,
          ),
          result,
        ],
        operatorMaintenance: true,
      }),
    ).toBe("MAINTENANCE");
  });

  it("returns UNKNOWN for controlled-environment uncertainty, distinct from BROKEN", () => {
    const uncertain = environmentUncertainResult("LOGIN_EXPIRED");
    const broken = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    const uncertainResults = replaceResult(passedResults(), uncertain);
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: uncertainResults,
        operatorMaintenance: false,
      }),
    ).toBe("UNKNOWN");
    const brokenResults = replaceResult(passedResults(), broken);
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: brokenResults,
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
  });

  it("returns BROKEN for a required core hard failure after all fallbacks", () => {
    const failed = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (item) => item.contourKey !== failed.contourKey,
          ),
          failed,
        ],
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
  });

  it("returns DRIFT for primary failure with an approved equivalent fallback", () => {
    const drift = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (item) => item.contourKey !== drift.contourKey,
          ),
          drift,
        ],
        operatorMaintenance: false,
      }),
    ).toBe("DRIFT");
  });

  it("returns DEGRADED for an important non-core failure or materially degraded fallback", () => {
    const failed = resultFor("C10_NATIVE_COPY_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COPY_ANCHOR_ASSOCIATION", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (item) => item.contourKey !== failed.contourKey,
          ),
          failed,
        ],
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
    const degradedFallback = resultFor("C10_NATIVE_COPY_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COPY_ANCHOR_ASSOCIATION", outcome: "PASS" },
      ],
      selectedStrategyId: "COPY_ANCHOR_ASSOCIATION",
      fallbackQuality: "MATERIALLY_DEGRADED",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (item) => item.contourKey !== degradedFallback.contourKey,
          ),
          degradedFallback,
        ],
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
    expect(
      classifyHealthDetailed({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), degradedFallback),
        operatorMaintenance: false,
      }),
    ).toMatchObject({
      state: "DEGRADED",
      basis: "DEGRADED_MATERIAL_FALLBACK",
      findingContourKeys: ["C10_NATIVE_COPY_CONTROL"],
    });
  });

  it("never promotes a failing selected fallback to DRIFT from favorable quality", () => {
    const contradictory = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), contradictory),
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
  });

  it("rejects duplicate contour results before environment uncertainty precedence", () => {
    const uncertain = resultFor("C13_BLOCKING_STATE", {
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "LOGIN_EXPIRED",
    });
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [...passedResults(), uncertain],
        operatorMaintenance: false,
      }),
    ).toThrow("DUPLICATE_CONTOUR_RESULT");
  });

  it("rejects unexpected contour results before maintenance precedence", () => {
    const suite = validateHealthSuiteDefinition({
      ...BASELINE_HEALTH_SUITE,
      contours: BASELINE_HEALTH_SUITE.contours.filter(
        (definition) => definition.key !== "C13_BLOCKING_STATE",
      ),
    });
    expect(() =>
      classifyHealth({
        suite,
        results: [...passedResults(suite), resultFor("C13_BLOCKING_STATE")],
        operatorMaintenance: true,
      }),
    ).toThrow("UNKNOWN_CONTOUR_RESULT");
  });

  it("rejects missing required contours before uncertainty precedence", () => {
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: passedResults().filter(
          (result) => result.contourKey !== "C05_SEND_CONTROL",
        ),
        operatorMaintenance: true,
      }),
    ).toThrow("MISSING_REQUIRED_CONTOUR_RESULT");
  });

  it("returns UNKNOWN for complete valid uncertainty with product hard failure", () => {
    const uncertain = environmentUncertainResult(
      "CONTROLLED_BROWSER_UNAVAILABLE",
    );
    const hardFailure = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(
          replaceResult(passedResults(), uncertain),
          hardFailure,
        ),
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
  });

  it("L4-RED-02 does not collapse contradictory environment reasons into UNKNOWN", () => {
    const first = resultFor("C13_BLOCKING_STATE", {
      primaryStrategyOutcome: "UNCERTAIN",
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "CONTROLLED_BROWSER_UNAVAILABLE",
    });
    const second = resultFor("C12_DELIVERY_INSERTION_PATH", {
      primaryStrategyOutcome: "UNCERTAIN",
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
    });
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(replaceResult(passedResults(), first), second),
        operatorMaintenance: false,
      }),
    ).toThrow("INCOHERENT_ENVIRONMENT_OBSERVATION");
  });

  it("L4-RED-03 does not accept pre-identity uncertainty after confident identity", () => {
    const uncertain = resultFor("C13_BLOCKING_STATE", {
      primaryStrategyOutcome: "UNCERTAIN",
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
    });
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), uncertain),
        operatorMaintenance: false,
      }),
    ).toThrow("INCOHERENT_ENVIRONMENT_OBSERVATION");
  });

  it("L4-RED-04 exposes a bounded detailed classification authority", () => {
    expect(typeof classifyHealthDetailed).toBe("function");
  });

  it("returns MAINTENANCE for complete valid maintenance with product failure", () => {
    const hardFailure = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), hardFailure),
        operatorMaintenance: true,
      }),
    ).toBe("MAINTENANCE");
  });

  it("returns DRIFT only for a selected passing approved fallback with passing assertions", () => {
    const passingFallback = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
    });
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), passingFallback),
        operatorMaintenance: false,
      }),
    ).toBe("DRIFT");
  });

  it("rejects a selected fallback that is not declared by the contour", () => {
    const invalid: unknown = {
      ...resultFor("C05_SEND_CONTROL"),
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "CODE_BLOCK_DISCOVERY", outcome: "PASS" },
      ],
      selectedStrategyId: "CODE_BLOCK_DISCOVERY",
      fallbackQuality: "APPROVED_EQUIVALENT",
    };
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (result) => result.contourKey !== "C05_SEND_CONTROL",
          ),
          invalid,
        ],
        operatorMaintenance: false,
      }),
    ).toThrow("SELECTED_FALLBACK_NOT_DECLARED");
  });

  it("rejects a declared selected fallback with no corresponding result", () => {
    const invalid: unknown = {
      ...resultFor("C05_SEND_CONTROL"),
      primaryStrategyOutcome: "FAIL",
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    };
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: [
          ...passedResults().filter(
            (result) => result.contourKey !== "C05_SEND_CONTROL",
          ),
          invalid,
        ],
        operatorMaintenance: false,
      }),
    ).toThrow();
  });

  it("returns HEALTHY when required primary and behavioral expectations pass", () => {
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: passedResults(),
        operatorMaintenance: false,
      }),
    ).toBe("HEALTHY");
  });

  it("applies BROKEN > DEGRADED > DRIFT product precedence", () => {
    const drift = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
    const degraded = resultFor("C10_NATIVE_COPY_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COPY_ANCHOR_ASSOCIATION", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    const broken = resultFor("C09_COMMAND_CODE_BLOCK_SURFACE", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "CODE_BLOCK_DISCOVERY", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    const brokenResults = replaceResult(
      replaceResult(replaceResult(passedResults(), drift), degraded),
      broken,
    );
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: brokenResults,
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
    const degradedResults = replaceResult(
      replaceResult(passedResults(), drift),
      degraded,
    );
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: degradedResults,
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
  });

  it("permits optional absence only when the suite explicitly allows it", () => {
    const withoutOptional = passedResults().filter(
      (item) => item.contourKey !== "C10_NATIVE_COPY_CONTROL",
    );
    expect(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: withoutOptional,
        operatorMaintenance: false,
      }),
    ).toBe("HEALTHY");
    expect(
      classifyHealthDetailed({
        suite: BASELINE_HEALTH_SUITE,
        results: withoutOptional,
        operatorMaintenance: false,
      }).basis,
    ).toBe("HEALTHY_ALLOWED_OPTIONAL_ABSENCE");
    const notPermitted = suiteWith(
      {},
      {
        C10_NATIVE_COPY_CONTROL: {
          absencePolicy: { mode: "ALLOWED_FOR_VARIANTS", variantIds: ["work"] },
        },
      },
    );
    expect(() =>
      classifyHealth({
        suite: notPermitted,
        results: passedResults().filter(
          (item) => item.contourKey !== "C10_NATIVE_COPY_CONTROL",
        ),
        operatorMaintenance: false,
      }),
    ).toThrow("MISSING_REQUIRED_CONTOUR_RESULT");
  });

  it("treats an optional contour required for the active variant as a real failure", () => {
    const suite = suiteWith(
      { variant: { id: UUIDS.variant, machineKey: "work" } },
      {
        C10_NATIVE_COPY_CONTROL: {
          requiredForVariantIds: ["work"],
        },
      },
    );
    const absent = HealthContourResultSchema.parse({
      ...resultFor("C10_NATIVE_COPY_CONTROL"),
      required: true,
      observationStatus: "ABSENT",
      primaryStrategyOutcome: "NOT_ATTEMPTED",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: null,
      structuralOutcome: "NOT_RUN",
      behavioralOutcome: "NOT_RUN",
    });
    expect(
      classifyHealth({
        suite,
        results: [
          ...passedResults(suite).filter(
            (item) => item.contourKey !== absent.contourKey,
          ),
          absent,
        ],
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
  });

  it("is deterministic under repeated input and has no clock/random/network dependency", () => {
    const input = {
      suite: BASELINE_HEALTH_SUITE,
      results: passedResults(),
      operatorMaintenance: false,
    };
    expect(Array.from({ length: 20 }, () => classifyHealth(input))).toEqual(
      Array.from({ length: 20 }, () => "HEALTHY"),
    );
  });

  it.each([
    "CONTROLLED_BROWSER_UNAVAILABLE",
    "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
  ] as const)("L4 pre-identity %s is UNKNOWN", (reason) => {
    const input = {
      suite: BASELINE_HEALTH_SUITE,
      results: preIdentityResults(reason),
      operatorMaintenance: false,
    };
    expect(classifyHealth(input)).toBe("UNKNOWN");
    expect(classifyHealthDetailed(input)).toMatchObject({
      state: "UNKNOWN",
      basis: "UNKNOWN_PRE_IDENTITY_ENVIRONMENT",
      environmentUncertaintyReasons: [reason],
    });
  });

  it.each([
    "LOGIN_EXPIRED",
    "VERIFICATION_CHECKPOINT",
    "CAPTCHA_SECURITY_CHECKPOINT",
    "ACCOUNT_BLOCKED",
  ] as const)("L4 coherent %s is UNKNOWN", (reason) => {
    const input = {
      suite: BASELINE_HEALTH_SUITE,
      results: preIdentityResults(reason),
      operatorMaintenance: false,
    };
    expect(classifyHealth(input)).toBe("UNKNOWN");
    expect(classifyHealthDetailed(input).basis).toBe(
      "UNKNOWN_AUTH_OR_SECURITY_BLOCKER",
    );
  });

  it.each([
    ["C03_COMPOSER_ROOT", "BROKEN"],
    ["C04_COMPOSER_INPUT", "BROKEN"],
    ["C05_SEND_CONTROL", "BROKEN"],
    ["C09_COMMAND_CODE_BLOCK_SURFACE", "BROKEN"],
  ] as const)(
    "L4 independent %s failure remains visible beside pre-identity uncertainty",
    (key, expected) => {
      const definition = definitionFor(key);
      const failure = resultFor(key, {
        primaryStrategyOutcome: "FAIL",
        fallbackStrategyOutcomes: definition.fallbackStrategyIds.map(
          (strategyId) => ({ strategyId, outcome: "FAIL" as const }),
        ),
        selectedStrategyId: null,
        structuralOutcome: "FAIL",
        behavioralOutcome: "FAIL",
      });
      const input = {
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(
          replaceResult(
            passedResults(),
            environmentUncertainResult("CONTROLLED_BROWSER_UNAVAILABLE"),
          ),
          failure,
        ),
        operatorMaintenance: false,
      };
      expect(classifyHealth(input)).toBe(expected);
      expect(classifyHealthDetailed(input).findingContourKeys).toContain(key);
    },
  );

  it("rejects a pre-identity marker after identity when no independent product finding exists", () => {
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(
          passedResults(),
          environmentUncertainResult("CONTROLLED_BROWSER_UNAVAILABLE"),
        ),
        operatorMaintenance: false,
      }),
    ).toThrow("INCOHERENT_ENVIRONMENT_OBSERVATION");
  });

  it("preserves MAINTENANCE only after structural and coherence validation", () => {
    const input = {
      suite: BASELINE_HEALTH_SUITE,
      results: preIdentityResults("LOGIN_EXPIRED"),
      operatorMaintenance: true,
    };
    expect(classifyHealth(input)).toBe("MAINTENANCE");
    expect(classifyHealthDetailed(input)).toMatchObject({
      state: "MAINTENANCE",
      basis: "MAINTENANCE_OPERATOR",
      operatorMaintenance: true,
    });
  });

  it("rejects uncertainty on a non-C13 contour and conflicting reasons", () => {
    const invalid = resultFor("C12_DELIVERY_INSERTION_PATH", {
      primaryStrategyOutcome: "UNCERTAIN",
      selectedStrategyId: null,
      structuralOutcome: "UNCERTAIN",
      behavioralOutcome: "UNCERTAIN",
      environmentStatus: "UNCERTAIN",
      uncertaintyReason: "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY",
    });
    expect(() =>
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), invalid),
        operatorMaintenance: false,
      }),
    ).toThrow("INCOHERENT_ENVIRONMENT_OBSERVATION");
  });

  it("keeps detailed state equal to simple state and uses a bounded basis", () => {
    const fallback = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
    const detailed = classifyHealthDetailed({
      suite: BASELINE_HEALTH_SUITE,
      results: replaceResult(passedResults(), fallback),
      operatorMaintenance: false,
    });
    expect(detailed.state).toBe(
      classifyHealth({
        suite: BASELINE_HEALTH_SUITE,
        results: replaceResult(passedResults(), fallback),
        operatorMaintenance: false,
      }),
    );
    expect(detailed).toMatchObject({
      state: "DRIFT",
      basis: "DRIFT_APPROVED_FALLBACK",
      findingContourKeys: ["C05_SEND_CONTROL"],
      productFindings: [{ contourKey: "C05_SEND_CONTROL", finding: "DRIFT" }],
    });
    expect(Object.isFrozen(detailed)).toBe(true);
    expect(Object.isFrozen(detailed.productFindings)).toBe(true);
  });

  it("orders detailed findings by suite order regardless of input order", () => {
    const drift = resultFor("C05_SEND_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
    const degraded = resultFor("C10_NATIVE_COPY_CONTROL", {
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "COPY_ANCHOR_ASSOCIATION", outcome: "FAIL" },
      ],
      selectedStrategyId: null,
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
    });
    const detailed = classifyHealthDetailed({
      suite: BASELINE_HEALTH_SUITE,
      results: replaceResult(
        replaceResult(passedResults(), drift),
        degraded,
      ).reverse(),
      operatorMaintenance: false,
    });
    expect(detailed.findingContourKeys).toEqual([
      "C05_SEND_CONTROL",
      "C10_NATIVE_COPY_CONTROL",
    ]);
  });

  it("never copies evidence or provider content into detailed output", () => {
    const result = resultFor("C05_SEND_CONTROL", {
      evidence: [
        {
          evidenceId: UUIDS.principal,
          ruleId: "SAFE_ELEMENT_METADATA",
          classification: "METADATA",
          sha256: "a".repeat(64),
          sizeBytes: 12,
        },
      ],
    });
    const detailed = classifyHealthDetailed({
      suite: BASELINE_HEALTH_SUITE,
      results: replaceResult(passedResults(), result),
      operatorMaintenance: false,
    });
    expect(JSON.stringify(detailed)).not.toContain("evidenceId");
    expect(JSON.stringify(detailed)).not.toContain(UUIDS.principal);
    expect(Object.keys(detailed).sort()).toEqual([
      "basis",
      "environmentUncertaintyReasons",
      "findingContourKeys",
      "operatorMaintenance",
      "productFindings",
      "state",
    ]);
  });

  it("is byte-equivalent for repeated identical input and has no clock dependency", () => {
    const input = {
      suite: BASELINE_HEALTH_SUITE,
      results: passedResults(),
      operatorMaintenance: false,
    };
    const serialized = JSON.stringify(classifyHealthDetailed(input));
    expect(
      Array.from({ length: 20 }, () =>
        JSON.stringify(classifyHealthDetailed(input)),
      ),
    ).toEqual(Array.from({ length: 20 }, () => serialized));
  });

  it.each(["standard", "work", "alice"] as const)(
    "keeps shared classification semantics target-neutral for %s",
    (surfaceKey) => {
      const suite = suiteWith({ surfaceKey });
      const detailed = classifyHealthDetailed({
        suite,
        results: passedResults(suite),
        operatorMaintenance: false,
      });
      expect(detailed).toMatchObject({
        state: "HEALTHY",
        basis: "HEALTHY_PRIMARY",
      });
    },
  );
});

function validP7Candidate(): unknown {
  const selectorPlan = {
    strategy: "composer_root",
    primary: {
      kind: "packaged_selector_reference",
      reference: "composer-root",
    },
    fallbacks: [],
    timeoutMs: 1_000,
    observationMode: "polling",
  } as const;
  const content = AdapterProfileContentV1Schema.parse({
    schemaVersion: "adapter_profile_v1",
    page: {
      identityStrategy: "page_identity",
      conversationStrategy: "conversation_root",
      composerStrategy: "composer_root",
    },
    selectors: {
      conversation: { ...selectorPlan, strategy: "conversation_root" },
      composer: selectorPlan,
      send: { ...selectorPlan, strategy: "send_control" },
      assistantResponse: { ...selectorPlan, strategy: "assistant_response" },
    },
    observation: { mode: "polling", intervalMs: 500 },
    contours: [
      {
        key: "page_identity",
        required: true,
        expectedState: "PRESENT",
        strategy: "page_identity",
      },
      {
        key: "conversation_root",
        required: true,
        expectedState: "PRESENT",
        strategy: "conversation_root",
      },
      {
        key: "composer_root",
        required: true,
        expectedState: "PRESENT",
        strategy: "composer_root",
      },
      {
        key: "send_control",
        required: true,
        expectedState: "INTERACTIVE",
        strategy: "send_control",
      },
    ],
  });
  const compatibility = {
    schemaVersion: "profile_compatibility_v1",
    contractVersion: "control_plane_v1",
    browserFamilies: ["chrome"],
    minimumBrowserVersions: [
      { browserFamily: "chrome", minimumVersion: "120.0.0.0" },
    ],
    minimumExtensionVersion: "1.0.0",
  } as const;
  const validated = validateProfileContent({ content, compatibility });
  return PersistedProfileRevisionSchema.parse({
    id: UUIDS.profile,
    profileId: "00000000-0000-4000-8000-000000000016",
    adapterId: UUIDS.adapter,
    surfaceId: UUIDS.surface,
    variantId: null,
    revision: 1,
    schemaVersion: "adapter_profile_v1",
    state: "CANDIDATE",
    content,
    compatibility,
    contentSha256: validated.contentSha256,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    publishedAt: null,
    createdByAdminPrincipalId: UUIDS.principal,
    publishedByAdminPrincipalId: null,
  });
}

describe("H0 static profile foundation", () => {
  it("reuses the strict P7 candidate schema and canonical validator", () => {
    const evidence = validateH0ProfileCandidate(validP7Candidate());
    expect(evidence.schemaVersion).toBe("adapter_profile_v1");
    expect(evidence.remoteExecutableCapability).toBe(false);
    expect(evidence.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      evidence.deterministicFingerprintInputs.compatibility.contractVersion,
    ).toBe("control_plane_v1");
  });

  it("rejects P7 executable fields and non-candidate lifecycle states", () => {
    const candidate = validP7Candidate() as Record<string, unknown>;
    expect(
      PersistedProfileRevisionSchema.safeParse({
        ...candidate,
        command: "shell",
      }).success,
    ).toBe(false);
    expect(
      PersistedProfileRevisionSchema.safeParse({
        ...candidate,
        content: { ...(candidate.content as object), script: "eval('x')" },
      }).success,
    ).toBe(false);
    expect(() =>
      validateH0ProfileCandidate({ ...candidate, state: "DRAFT" }),
    ).toThrow("H0_PROFILE_NOT_CANDIDATE");
    expect(() =>
      validateH0ProfileCandidate({
        ...candidate,
        contentSha256: "0".repeat(64),
      }),
    ).toThrow("H0_PROFILE_FINGERPRINT_MISMATCH");
  });
});
