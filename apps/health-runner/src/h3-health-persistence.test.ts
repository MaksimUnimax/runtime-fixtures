import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  BASELINE_HEALTH_SUITE,
  HealthSuiteDefinitionSchema,
  classifyHealth,
} from "@product/health";
import {
  createH3HealthPersistenceCommand,
  type H3HealthPersistenceContext,
} from "./h3-health-persistence.js";
import { H3ExecutionResultSchema } from "./h3-engine.js";
import {
  H3ContourObservationSchema,
  type H3ContourObservation,
} from "./h3-strategy.js";
import type { H3SafeEvidenceEvent } from "./evidence-sanitizer.js";
import type { H3BehaviorStep } from "./h3-contracts.js";

const STARTED_AT = "2026-09-15T10:00:00.000Z";
const COMPLETED_AT = "2026-09-15T10:00:01.000Z";
const RUNTIME = {
  family: "chrome" as const,
  browserName: "chromium",
  browserVersion: "120.0.0.0",
  headless: true,
  sessionKind: "EPHEMERAL_CONTROLLED" as const,
};

function suiteFor(surface: "standard" | "work", profileRevision: 1 | 2) {
  return HealthSuiteDefinitionSchema.parse({
    ...BASELINE_HEALTH_SUITE,
    scope: {
      ...BASELINE_HEALTH_SUITE.scope,
      surfaceKey: surface,
      profile: {
        ...BASELINE_HEALTH_SUITE.scope.profile,
        revision: profileRevision,
      },
    },
  });
}

function event(
  step: H3BehaviorStep,
  outcome: "PASS" | "FAIL" | "UNCERTAIN",
): H3SafeEvidenceEvent {
  const result = outcome === "PASS" ? "PASS" : outcome;
  const passObservation = (
    contourKey: string,
    strategyId: string,
    evidenceKind: "NONE" | "METADATA" | "STATE_TRANSITION_TRACE" = "NONE",
  ): H3ContourObservation =>
    H3ContourObservationSchema.parse({
      contourKey,
      observationStatus: "PRESENT",
      primaryStrategyOutcome: result,
      fallbackStrategyOutcomes: [],
      selectedStrategyId: result === "PASS" ? strategyId : null,
      structuralOutcome: result,
      behavioralOutcome: result,
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind,
    });
  const observations =
    outcome === "UNCERTAIN"
      ? []
      : step === "IDENTIFY_SURFACE"
        ? [
            passObservation(
              "C01_PAGE_IDENTITY",
              "PAGE_HOST_MARKER",
              "METADATA",
            ),
            passObservation(
              "C13_BLOCKING_STATE",
              "BLOCKING_MARKER",
              "METADATA",
            ),
          ]
        : step === "IDENTIFY_COMPOSER"
          ? [
              passObservation(
                "C03_COMPOSER_ROOT",
                "COMPOSER_CONTAINER",
                "METADATA",
              ),
            ]
          : step === "INSERT_PROMPT"
            ? [
                passObservation(
                  "C04_COMPOSER_INPUT",
                  "EDITABLE_INPUT",
                  "METADATA",
                ),
              ]
            : step === "SEND_ONCE"
              ? [
                  passObservation(
                    "C05_SEND_CONTROL",
                    "SEMANTIC_SEND_CONTROL",
                    "STATE_TRANSITION_TRACE",
                  ),
                ]
              : step === "OBSERVE_BUSY"
                ? [
                    passObservation(
                      "C06_BUSY_STOP_STATE",
                      "BUSY_INDICATOR",
                      "STATE_TRANSITION_TRACE",
                    ),
                  ]
                : step === "OBSERVE_RESPONSE"
                  ? [
                      passObservation(
                        "C02_CONVERSATION_ROOT",
                        "CONVERSATION_ANCHOR",
                        "METADATA",
                      ),
                      passObservation(
                        "C07_ASSISTANT_MESSAGE",
                        "ASSISTANT_MESSAGE_REGION",
                      ),
                    ]
                  : step === "OBSERVE_COMPLETION"
                    ? [
                        passObservation(
                          "C08_MESSAGE_COMPLETION",
                          "COMPLETION_MARKER",
                          "STATE_TRANSITION_TRACE",
                        ),
                      ]
                    : step === "VALIDATE_BRIDGE_SURFACES"
                      ? [
                          passObservation(
                            "C09_COMMAND_CODE_BLOCK_SURFACE",
                            "COMMAND_SURFACE",
                          ),
                          passObservation(
                            "C10_NATIVE_COPY_CONTROL",
                            "NATIVE_COPY_CONTROL",
                            "METADATA",
                          ),
                          passObservation(
                            "C11_CONVERSATION_IDENTITY",
                            "CONVERSATION_IDENTIFIER",
                            "METADATA",
                          ),
                          passObservation(
                            "C12_DELIVERY_INSERTION_PATH",
                            "DELIVERY_TARGET",
                            "STATE_TRANSITION_TRACE",
                          ),
                        ]
                      : [];
  return {
    step,
    outcome,
    durationMs: 4,
    markerCount: null,
    transitionObserved: null,
    observations,
  };
}

function execution(
  surface: "CHATGPT_STANDARD" | "CHATGPT_WORK",
  outcome: "PASS" | "FAIL" | "UNCERTAIN",
  events: readonly ReturnType<typeof event>[],
  failureCode:
    | "RESPONSE_OBSERVATION_FAILED"
    | "BRIDGE_SURFACE_VALIDATION_FAILED"
    | "LOGIN_REQUIRED"
    | null,
  failureStep:
    | "OBSERVE_RESPONSE"
    | "VALIDATE_BRIDGE_SURFACES"
    | "IDENTIFY_SURFACE"
    | null,
  environmentUncertainty: "LOGIN_EXPIRED" | null,
) {
  return H3ExecutionResultSchema.parse({
    level: "H3",
    targetKey:
      surface === "CHATGPT_STANDARD"
        ? "chatgpt_standard_health"
        : "chatgpt_work_health",
    surfaceProfile:
      surface === "CHATGPT_STANDARD"
        ? {
            surface,
            profileId: "CHATGPT_STANDARD_H3_V2",
            profileRevision: 2,
          }
        : {
            surface,
            profileId: "CHATGPT_WORK_H3_V1",
            profileRevision: 1,
          },
    outcome,
    completedSteps: events
      .filter((item) => item.outcome === "PASS")
      .map((item) => item.step),
    events,
    durationMs: 250,
    failureCode,
    failureStep,
    cleanupOutcome: "PASS",
    cleanupFailureCode: null,
    environmentUncertainty,
  });
}

function context(
  surface: "standard" | "work",
  profileRevision: 1 | 2,
): H3HealthPersistenceContext {
  return {
    suite: suiteFor(surface, profileRevision),
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    browserRuntime: RUNTIME,
    operatorMaintenance: false,
    operatorMaintenanceAuthority: null,
    classifierVersion: "p8.1-classifier-v1",
  };
}

for (const [surface, key, revision] of [
  ["CHATGPT_STANDARD", "standard", 2],
  ["CHATGPT_WORK", "work", 1],
] as const) {
  it(`retains ${surface} C11 bridge failure provenance`, () => {
    const failedEvents = [
      ...PASS_EVENTS.slice(0, 7),
      bridgeFailureEvent(),
      event("CLEANUP", "PASS"),
    ];
    const command = createH3HealthPersistenceCommand(
      execution(
        surface,
        "FAIL",
        failedEvents,
        "BRIDGE_SURFACE_VALIDATION_FAILED",
        "VALIDATE_BRIDGE_SURFACES",
        null,
      ),
      context(key, revision),
    );
    const results = new Map(
      command.results.map((result) => [result.contourKey, result]),
    );
    for (const contourKey of [
      "C09_COMMAND_CODE_BLOCK_SURFACE",
      "C10_NATIVE_COPY_CONTROL",
      "C11_CONVERSATION_IDENTITY",
      "C12_DELIVERY_INSERTION_PATH",
    ] as const) {
      expect(results.get(contourKey)?.observationStatus).toBe("PRESENT");
    }
    expect(results.get("C09_COMMAND_CODE_BLOCK_SURFACE")).toMatchObject({
      primaryStrategyOutcome: "PASS",
    });
    expect(results.get("C10_NATIVE_COPY_CONTROL")).toMatchObject({
      primaryStrategyOutcome: "PASS",
    });
    expect(results.get("C12_DELIVERY_INSERTION_PATH")).toMatchObject({
      primaryStrategyOutcome: "PASS",
    });
    expect(results.get("C11_CONVERSATION_IDENTITY")).toMatchObject({
      primaryStrategyOutcome: "FAIL",
      fallbackStrategyOutcomes: [
        { strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" },
      ],
      selectedStrategyId: "CONVERSATION_URL_IDENTITY",
      structuralOutcome: "FAIL",
      behavioralOutcome: "FAIL",
      fallbackQuality: "APPROVED_EQUIVALENT",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidence: [],
    });
    expect(
      classifyHealth({
        suite: command.suite,
        results: command.results,
        operatorMaintenance: command.operatorMaintenance,
      }),
    ).toBe("BROKEN");
  });
}

const TIMESTAMP_CASES = [
  {
    name: "A",
    startedAt: "2026-09-16T10:00:00+05:00",
    completedAt: "2026-09-16T06:00:00Z",
    expected: "accept",
    deltaMs: 3_600_000,
  },
  {
    name: "B",
    startedAt: "2026-09-16T06:00:00Z",
    completedAt: "2026-09-16T10:00:00+05:00",
    expected: "reject",
    deltaMs: -3_600_000,
  },
  {
    name: "C",
    startedAt: "2026-09-16T10:00:00.100+05:00",
    completedAt: "2026-09-16T05:00:00.200Z",
    expected: "accept",
    deltaMs: 100,
  },
  {
    name: "D",
    startedAt: "2026-09-16T05:00:00.200Z",
    completedAt: "2026-09-16T10:00:00.100+05:00",
    expected: "reject",
    deltaMs: -100,
  },
  {
    name: "E",
    startedAt: "2026-09-16T10:00:00+05:00",
    completedAt: "2026-09-16T05:00:00Z",
    expected: "accept",
    deltaMs: 0,
  },
  {
    name: "F",
    startedAt: "2026-09-16T06:00:00.000Z",
    completedAt: "2026-09-16T06:00:01.000Z",
    expected: "accept",
    deltaMs: 1_000,
  },
] as const;

const PASS_EVENTS = [
  event("IDENTIFY_SURFACE", "PASS"),
  event("IDENTIFY_COMPOSER", "PASS"),
  event("INSERT_PROMPT", "PASS"),
  event("SEND_ONCE", "PASS"),
  event("OBSERVE_BUSY", "PASS"),
  event("OBSERVE_RESPONSE", "PASS"),
  event("OBSERVE_COMPLETION", "PASS"),
  event("VALIDATE_BRIDGE_SURFACES", "PASS"),
  event("CLEANUP", "PASS"),
] as const;

function contourObservation(
  contourKey: string,
  primaryStrategyId: string,
  changes: Record<string, unknown> = {},
): H3ContourObservation {
  return H3ContourObservationSchema.parse({
    contourKey,
    observationStatus: "PRESENT",
    primaryStrategyOutcome: "PASS",
    fallbackStrategyOutcomes: [],
    selectedStrategyId: primaryStrategyId,
    structuralOutcome: "PASS",
    behavioralOutcome: "PASS",
    fallbackQuality: "NOT_APPLICABLE",
    environmentStatus: "VALID",
    uncertaintyReason: null,
    evidenceKind: "NONE",
    ...changes,
  });
}

function withObservations(
  observations: readonly H3ContourObservation[],
  step: H3BehaviorStep = "VALIDATE_BRIDGE_SURFACES",
): ReturnType<typeof execution> {
  const bridge = PASS_EVENTS.find((item) => item.step === step);
  const events = PASS_EVENTS.map((item) =>
    item === bridge ? { ...item, observations: [...observations] } : item,
  );
  return execution("CHATGPT_STANDARD", "PASS", events, null, null, null);
}

function bridgeFailureEvent(): H3SafeEvidenceEvent {
  const passObservation = (
    contourKey: string,
    strategyId: string,
    evidenceKind: "NONE" | "METADATA" | "STATE_TRANSITION_TRACE" = "NONE",
  ): H3ContourObservation =>
    H3ContourObservationSchema.parse({
      contourKey,
      observationStatus: "PRESENT",
      primaryStrategyOutcome: "PASS",
      fallbackStrategyOutcomes: [],
      selectedStrategyId: strategyId,
      structuralOutcome: "PASS",
      behavioralOutcome: "PASS",
      fallbackQuality: "NOT_APPLICABLE",
      environmentStatus: "VALID",
      uncertaintyReason: null,
      evidenceKind,
    });
  return {
    step: "VALIDATE_BRIDGE_SURFACES",
    outcome: "FAIL",
    durationMs: 4,
    markerCount: 4,
    transitionObserved: false,
    observations: [
      passObservation("C09_COMMAND_CODE_BLOCK_SURFACE", "COMMAND_SURFACE"),
      passObservation(
        "C10_NATIVE_COPY_CONTROL",
        "NATIVE_COPY_CONTROL",
        "METADATA",
      ),
      H3ContourObservationSchema.parse({
        contourKey: "C11_CONVERSATION_IDENTITY",
        observationStatus: "PRESENT",
        primaryStrategyOutcome: "FAIL",
        fallbackStrategyOutcomes: [
          { strategyId: "CONVERSATION_URL_IDENTITY", outcome: "FAIL" },
        ],
        selectedStrategyId: "CONVERSATION_URL_IDENTITY",
        structuralOutcome: "FAIL",
        behavioralOutcome: "FAIL",
        fallbackQuality: "APPROVED_EQUIVALENT",
        environmentStatus: "VALID",
        uncertaintyReason: null,
        evidenceKind: "NONE",
      }),
      passObservation(
        "C12_DELIVERY_INSERTION_PATH",
        "DELIVERY_TARGET",
        "STATE_TRANSITION_TRACE",
      ),
    ],
  };
}

for (const [surface, profileRevision] of [
  ["standard", 2],
  ["work", 1],
] as const) {
  describe(`B5 timestamp chronology ${surface}`, () => {
    it.each(TIMESTAMP_CASES)(
      "$name maps the real execution/context helpers",
      ({ name, startedAt, completedAt, expected, deltaMs }) => {
        const rawContext = {
          ...context(surface, profileRevision),
          startedAt,
          completedAt,
        };
        const build = () =>
          createH3HealthPersistenceCommand(
            execution(
              surface === "standard" ? "CHATGPT_STANDARD" : "CHATGPT_WORK",
              "PASS",
              PASS_EVENTS,
              null,
              null,
              null,
            ),
            rawContext,
          );

        if (expected === "accept") {
          const command = build();
          expect(command.startedAt).toBeInstanceOf(Date);
          expect(command.completedAt).toBeInstanceOf(Date);
          expect(command.startedAt.valueOf()).toBe(Date.parse(startedAt));
          expect(command.completedAt.valueOf()).toBe(Date.parse(completedAt));
          expect(
            command.completedAt.valueOf() - command.startedAt.valueOf(),
          ).toBe(deltaMs);
          return;
        }

        try {
          build();
          throw new Error(`timestamp case ${name} unexpectedly accepted`);
        } catch (error) {
          expect(error).toBeInstanceOf(ZodError);
          expect((error as ZodError).issues).toContainEqual({
            code: "custom",
            path: ["completedAt"],
            message: "completedAt must not precede startedAt",
          });
        }
      },
    );
  });
}

describe("B5 timestamp validation preservation", () => {
  it("still rejects invalid ISO and timestamps without a timezone", () => {
    expect(() =>
      createH3HealthPersistenceCommand(
        execution("CHATGPT_STANDARD", "PASS", PASS_EVENTS, null, null, null),
        {
          ...context("standard", 2),
          startedAt: "not-an-iso-timestamp",
        },
      ),
    ).toThrow(ZodError);
    expect(() =>
      createH3HealthPersistenceCommand(
        execution("CHATGPT_STANDARD", "PASS", PASS_EVENTS, null, null, null),
        {
          ...context("standard", 2),
          startedAt: "2026-09-16T06:00:00.000",
        },
      ),
    ).toThrow(ZodError);
  });

  it("allows identical UTC timestamps", () => {
    const command = createH3HealthPersistenceCommand(
      execution("CHATGPT_STANDARD", "PASS", PASS_EVENTS, null, null, null),
      {
        ...context("standard", 2),
        startedAt: "2026-09-16T06:00:00.000Z",
        completedAt: "2026-09-16T06:00:00.000Z",
      },
    );
    expect(command.completedAt.valueOf()).toBe(command.startedAt.valueOf());
  });

  it("preserves the completedAt issue for an ordinary reverse UTC interval", () => {
    try {
      createH3HealthPersistenceCommand(
        execution("CHATGPT_STANDARD", "PASS", PASS_EVENTS, null, null, null),
        {
          ...context("standard", 2),
          startedAt: "2026-09-16T06:00:01.000Z",
          completedAt: "2026-09-16T06:00:00.000Z",
        },
      );
      throw new Error("reverse UTC interval unexpectedly accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues).toContainEqual({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt",
      });
    }
  });
});

describe("B5 H3 capture-boundary Health mapper", () => {
  it("accepts only the strict bounded observation vocabulary", () => {
    expect(
      H3ContourObservationSchema.safeParse({
        ...contourObservation("C10_NATIVE_COPY_CONTROL", "NATIVE_COPY_CONTROL"),
        rawDom: "TOXIC_DOM_SENTINEL",
      }).success,
    ).toBe(false);
  });

  it("preserves a primary success as primary provenance", () => {
    const command = createH3HealthPersistenceCommand(
      withObservations([
        contourObservation("C09_COMMAND_CODE_BLOCK_SURFACE", "COMMAND_SURFACE"),
        contourObservation("C10_NATIVE_COPY_CONTROL", "NATIVE_COPY_CONTROL"),
        contourObservation(
          "C11_CONVERSATION_IDENTITY",
          "CONVERSATION_IDENTIFIER",
        ),
        contourObservation("C12_DELIVERY_INSERTION_PATH", "DELIVERY_TARGET"),
      ]),
      context("standard", 2),
    );
    const result = command.results.find(
      (item) => item.contourKey === "C10_NATIVE_COPY_CONTROL",
    );
    expect(result).toMatchObject({
      primaryStrategyOutcome: "PASS",
      selectedStrategyId: "NATIVE_COPY_CONTROL",
      fallbackQuality: "NOT_APPLICABLE",
    });
  });

  it("preserves a real packaged fallback and classifies it as DRIFT", () => {
    const command = createH3HealthPersistenceCommand(
      withObservations(
        [
          contourObservation("C05_SEND_CONTROL", "SEMANTIC_SEND_CONTROL", {
            primaryStrategyOutcome: "FAIL",
            fallbackStrategyOutcomes: [
              { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
            ],
            selectedStrategyId: "COMPOSER_ACTION_CONTROL",
            fallbackQuality: "APPROVED_EQUIVALENT",
            evidenceKind: "STATE_TRANSITION_TRACE",
          }),
        ],
        "SEND_ONCE",
      ),
      context("standard", 2),
    );
    expect(
      classifyHealth({
        suite: command.suite,
        results: command.results,
        operatorMaintenance: false,
      }),
    ).toBe("DRIFT");
    expect(
      command.results.find((item) => item.contourKey === "C05_SEND_CONTROL"),
    ).toMatchObject({
      primaryStrategyOutcome: "FAIL",
      selectedStrategyId: "COMPOSER_ACTION_CONTROL",
      fallbackStrategyOutcomes: [
        { strategyId: "COMPOSER_ACTION_CONTROL", outcome: "PASS" },
      ],
      fallbackQuality: "APPROVED_EQUIVALENT",
    });
  });

  it("keeps a C10-only failure independent and classifies it as DEGRADED", () => {
    const bridge = [
      contourObservation("C09_COMMAND_CODE_BLOCK_SURFACE", "COMMAND_SURFACE"),
      contourObservation("C10_NATIVE_COPY_CONTROL", "NATIVE_COPY_CONTROL", {
        primaryStrategyOutcome: "FAIL",
        selectedStrategyId: null,
        structuralOutcome: "FAIL",
        behavioralOutcome: "FAIL",
      }),
      contourObservation(
        "C11_CONVERSATION_IDENTITY",
        "CONVERSATION_IDENTIFIER",
      ),
      contourObservation("C12_DELIVERY_INSERTION_PATH", "DELIVERY_TARGET"),
    ];
    const command = createH3HealthPersistenceCommand(
      withObservations(bridge),
      context("standard", 2),
    );
    expect(
      command.results
        .filter(
          (item) =>
            item.contourKey.startsWith("C0") ||
            item.contourKey.startsWith("C1"),
        )
        .filter((item) =>
          [
            "C09_COMMAND_CODE_BLOCK_SURFACE",
            "C10_NATIVE_COPY_CONTROL",
            "C11_CONVERSATION_IDENTITY",
            "C12_DELIVERY_INSERTION_PATH",
          ].includes(item.contourKey),
        )
        .map((item) => [item.contourKey, item.primaryStrategyOutcome]),
    ).toEqual([
      ["C09_COMMAND_CODE_BLOCK_SURFACE", "PASS"],
      ["C10_NATIVE_COPY_CONTROL", "FAIL"],
      ["C11_CONVERSATION_IDENTITY", "PASS"],
      ["C12_DELIVERY_INSERTION_PATH", "PASS"],
    ]);
    expect(
      classifyHealth({
        suite: command.suite,
        results: command.results,
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
  });

  it("preserves structural/behavioral divergence and canonical classification", () => {
    const observations = [
      contourObservation("C09_COMMAND_CODE_BLOCK_SURFACE", "COMMAND_SURFACE"),
      contourObservation("C10_NATIVE_COPY_CONTROL", "NATIVE_COPY_CONTROL", {
        behavioralOutcome: "FAIL",
      }),
      contourObservation(
        "C11_CONVERSATION_IDENTITY",
        "CONVERSATION_IDENTIFIER",
      ),
      contourObservation("C12_DELIVERY_INSERTION_PATH", "DELIVERY_TARGET"),
    ];
    const command = createH3HealthPersistenceCommand(
      withObservations(observations),
      context("standard", 2),
    );
    expect(
      command.results.find(
        (item) => item.contourKey === "C10_NATIVE_COPY_CONTROL",
      ),
    ).toMatchObject({
      structuralOutcome: "PASS",
      behavioralOutcome: "FAIL",
    });
    expect(
      classifyHealth({
        suite: command.suite,
        results: command.results,
        operatorMaintenance: false,
      }),
    ).toBe("DEGRADED");
  });

  it("keeps required core failure BROKEN and completed H3 does not imply HEALTHY", () => {
    const command = createH3HealthPersistenceCommand(
      withObservations([
        contourObservation(
          "C09_COMMAND_CODE_BLOCK_SURFACE",
          "COMMAND_SURFACE",
          {
            primaryStrategyOutcome: "FAIL",
            selectedStrategyId: null,
            structuralOutcome: "FAIL",
            behavioralOutcome: "FAIL",
          },
        ),
        contourObservation("C10_NATIVE_COPY_CONTROL", "NATIVE_COPY_CONTROL"),
        contourObservation(
          "C11_CONVERSATION_IDENTITY",
          "CONVERSATION_IDENTIFIER",
        ),
        contourObservation("C12_DELIVERY_INSERTION_PATH", "DELIVERY_TARGET"),
      ]),
      context("standard", 2),
    );
    expect(
      command.results.every((item) => item.observationStatus === "PRESENT"),
    ).toBe(true);
    expect(
      classifyHealth({
        suite: command.suite,
        results: command.results,
        operatorMaintenance: false,
      }),
    ).toBe("BROKEN");
  });

  it.each([
    ["CHATGPT_STANDARD", "standard", 2],
    ["CHATGPT_WORK", "work", 1],
  ] as const)(
    "maps %s PASS into durable contour evidence",
    (surface, key, revision) => {
      const command = createH3HealthPersistenceCommand(
        execution(surface, "PASS", PASS_EVENTS, null, null, null),
        context(key, revision),
      );

      expect(command.results).toHaveLength(13);
      expect(
        command.results.every(
          (result) => result.observationStatus === "PRESENT",
        ),
      ).toBe(true);
      expect(
        command.results.every((result) => result.environmentStatus === "VALID"),
      ).toBe(true);
      expect(
        command.results.filter((result) => result.evidence.length === 1),
      ).toHaveLength(11);
      expect(
        command.results
          .filter(
            (result) =>
              result.contourKey === "C07_ASSISTANT_MESSAGE" ||
              result.contourKey === "C09_COMMAND_CODE_BLOCK_SURFACE",
          )
          .every((result) => result.evidence.length === 0),
      ).toBe(true);
      expect(
        classifyHealth({
          suite: command.suite,
          results: command.results,
          operatorMaintenance: command.operatorMaintenance,
        }),
      ).toBe("HEALTHY");
      expect(JSON.stringify(command.results)).not.toContain(
        "BRIDGE_COMMAND_SMOKE_V1",
      );
    },
  );

  it.each([
    ["CHATGPT_STANDARD", "standard", 2],
    ["CHATGPT_WORK", "work", 1],
  ] as const)(
    "maps %s post-Send FAIL without raw response details",
    (surface, key, revision) => {
      const failedEvents = [
        ...PASS_EVENTS.slice(0, 5),
        event("OBSERVE_RESPONSE", "FAIL"),
        event("CLEANUP", "PASS"),
      ];
      const command = createH3HealthPersistenceCommand(
        execution(
          surface,
          "FAIL",
          failedEvents,
          "RESPONSE_OBSERVATION_FAILED",
          "OBSERVE_RESPONSE",
          null,
        ),
        context(key, revision),
      );

      expect(
        command.results.find(
          (result) => result.contourKey === "C07_ASSISTANT_MESSAGE",
        )?.primaryStrategyOutcome,
      ).toBe("FAIL");
      expect(
        command.results.find(
          (result) => result.contourKey === "C08_MESSAGE_COMPLETION",
        )?.observationStatus,
      ).toBe("NOT_OBSERVED");
      expect(
        classifyHealth({
          suite: command.suite,
          results: command.results,
          operatorMaintenance: command.operatorMaintenance,
        }),
      ).toBe("BROKEN");
      expect(JSON.stringify(command.results)).not.toMatch(
        /TOXIC_PROMPT|TOXIC_RESPONSE|TOXIC_DOM|TOXIC_HTML|TOXIC_ERROR/i,
      );
    },
  );

  it.each([
    ["CHATGPT_STANDARD", "standard", 2],
    ["CHATGPT_WORK", "work", 1],
  ] as const)(
    "maps %s pre-Send environment uncertainty",
    (surface, key, revision) => {
      const uncertainEvents = [
        event("IDENTIFY_SURFACE", "UNCERTAIN"),
        event("CLEANUP", "PASS"),
      ];
      const command = createH3HealthPersistenceCommand(
        execution(
          surface,
          "UNCERTAIN",
          uncertainEvents,
          "LOGIN_REQUIRED",
          "IDENTIFY_SURFACE",
          "LOGIN_EXPIRED",
        ),
        context(key, revision),
      );

      expect(
        command.results.find(
          (result) => result.contourKey === "C13_BLOCKING_STATE",
        ),
      ).toMatchObject({
        environmentStatus: "UNCERTAIN",
        uncertaintyReason: "LOGIN_EXPIRED",
      });
      expect(
        classifyHealth({
          suite: command.suite,
          results: command.results,
          operatorMaintenance: command.operatorMaintenance,
        }),
      ).toBe("UNKNOWN");
      expect(JSON.stringify(command.results)).not.toMatch(
        /TOXIC_PROMPT|TOXIC_RESPONSE|TOXIC_DOM|TOXIC_HTML|TOXIC_COOKIE|TOXIC_TOKEN|TOXIC_STORAGE/i,
      );
    },
  );

  it("rejects unknown source fields before selecting any evidence", () => {
    const toxic = {
      ...execution("CHATGPT_STANDARD", "PASS", PASS_EVENTS, null, null, null),
      promptBody: "TOXIC_PROMPT_SENTINEL",
      assistantResponse: "TOXIC_RESPONSE_SENTINEL",
      projectId: "TOXIC_PROJECT_SENTINEL",
      conversationUuid: "TOXIC_CONVERSATION_SENTINEL",
      cookie: "TOXIC_COOKIE_SENTINEL",
      bearerToken: "TOXIC_TOKEN_SENTINEL",
      storageValue: "TOXIC_STORAGE_SENTINEL",
      sellerPayload: "TOXIC_SELLER_SENTINEL",
    };

    expect(() =>
      createH3HealthPersistenceCommand(toxic, context("standard", 2)),
    ).toThrow();
  });

  it("keeps evidence references opaque and bounded", () => {
    const command = createH3HealthPersistenceCommand(
      execution("CHATGPT_WORK", "PASS", PASS_EVENTS, null, null, null),
      context("work", 1),
    );
    const serialized = JSON.stringify(command.results);
    for (const result of command.results.filter(
      (item) => item.evidence.length > 0,
    )) {
      const reference = result.evidence[0];
      expect(reference?.evidenceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(reference?.evidenceId.length).toBe(36);
    }
    expect(serialized).not.toContain("Работа");
  });
});
