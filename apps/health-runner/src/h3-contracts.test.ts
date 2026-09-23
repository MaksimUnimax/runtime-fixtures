import { describe, expect, it } from "vitest";
import {
  H3_BEHAVIOR_STEP_ORDER,
  createH3RunPlan,
  getPackagedH3Prompt,
  parseH3RunPlan,
} from "./h3-contracts.js";
import {
  sanitizeH3EvidenceBundle,
  sanitizeH3EvidenceEvent,
} from "./evidence-sanitizer.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("P8.4 H3 contract foundation", () => {
  it("builds only the packaged behavioral order", () => {
    const plan = createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD");
    expect(plan.level).toBe("H3");
    expect(plan.steps).toEqual(H3_BEHAVIOR_STEP_ORDER);
  });

  it("rejects remote raw prompt, selector, URL and script authority", () => {
    const plan = createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD");
    for (const extra of [
      { promptText: "arbitrary" },
      { selector: "#arbitrary" },
      { url: "https://example.invalid" },
      { script: "document.body" },
    ]) {
      expect(() => parseH3RunPlan({ ...plan, ...extra })).toThrow();
    }
  });

  it("rejects reordered or repeated behavior steps", () => {
    const plan = createH3RunPlan("chatgpt_work_health", "CHATGPT_WORK");
    expect(() =>
      parseH3RunPlan({
        ...plan,
        steps: [...plan.steps].reverse(),
      }),
    ).toThrow("H3 steps must match the packaged behavioral order");
    expect(() =>
      parseH3RunPlan({
        ...plan,
        steps: plan.steps.map((step, index) =>
          index === 3 ? "INSERT_PROMPT" : step,
        ),
      }),
    ).toThrow("H3 steps must match the packaged behavioral order");
  });

  it("maps the only prompt id to a local benign fixed prompt", () => {
    const prompt = getPackagedH3Prompt("BRIDGE_COMMAND_SMOKE_V1");
    expect(prompt).toContain("BRIDGE_HEALTHCHECK_V1");
    expect(prompt).toContain("Do not call tools");
    expect(prompt).not.toContain("OZON_API_V1");
  });

  it("accepts only bounded metadata evidence", () => {
    const event = sanitizeH3EvidenceEvent({
      step: "OBSERVE_COMPLETION",
      outcome: "PASS",
      durationMs: 12,
      markerCount: 1,
      transitionObserved: true,
      observations: [],
    });
    expect(event).toEqual({
      step: "OBSERVE_COMPLETION",
      outcome: "PASS",
      durationMs: 12,
      markerCount: 1,
      transitionObserved: true,
      observations: [],
    });
  });

  it.each(["text", "html", "prompt", "selector", "screenshotBytes"])(
    "rejects unsafe evidence field %s",
    (unsafeField) => {
      expect(() =>
        sanitizeH3EvidenceEvent({
          step: "OBSERVE_RESPONSE",
          outcome: "PASS",
          durationMs: 1,
          markerCount: 1,
          transitionObserved: true,
          [unsafeField]: "sensitive-content",
        }),
      ).toThrow();
    },
  );

  it("rejects raw conversation data at bundle level", () => {
    const valid = {
      schemaVersion: 1 as const,
      runId: RUN_ID,
      surface: "CHATGPT_STANDARD" as const,
      startedAt: "2026-09-14T00:00:00.000Z",
      completedAt: "2026-09-14T00:00:01.000Z",
      events: [
        {
          step: "CLEANUP" as const,
          outcome: "PASS" as const,
          durationMs: 1,
          markerCount: null,
          transitionObserved: null,
        },
      ],
    };
    expect(sanitizeH3EvidenceBundle(valid).events).toHaveLength(1);
    expect(() =>
      sanitizeH3EvidenceBundle({
        ...valid,
        conversation: "customer conversation must never be stored",
      }),
    ).toThrow();
  });
});
