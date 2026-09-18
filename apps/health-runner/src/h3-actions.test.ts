import { describe, expect, it } from "vitest";
import {
  H3PackagedActionSchema,
  H3_PACKAGED_ACTION_KIND_ORDER,
  compileH3PackagedActions,
  getPackagedH3Profile,
  parseH3PackagedAction,
} from "./h3-actions.js";
import { createH3RunPlan } from "./h3-contracts.js";

const unsafeKeys = [
  "url",
  "href",
  "startUrl",
  "selector",
  "css",
  "xpath",
  "locator",
  "script",
  "javascript",
  "evaluate",
  "functionBody",
  "promptText",
  "text",
  "message",
  "rawPrompt",
] as const;

describe("B1 safe packaged H3 action vocabulary", () => {
  it("admits only the closed packaged action kinds", () => {
    const plan = createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD");
    const actions = compileH3PackagedActions(plan);

    expect(actions.map((action) => action.kind)).toEqual(
      H3_PACKAGED_ACTION_KIND_ORDER,
    );
    expect(H3PackagedActionSchema.safeParse({ kind: "CLICK" }).success).toBe(
      false,
    );
    expect(
      H3PackagedActionSchema.safeParse({
        kind: "RETRY_SEND",
        sendMode: "SINGLE_IRREVERSIBLE",
      }).success,
    ).toBe(false);
  });

  it("compiles from safe plan authority and rejects injected action input", () => {
    const plan = createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD");
    expect(() =>
      compileH3PackagedActions({
        ...plan,
        actions: [{ kind: "CLICK", selector: "#send" }],
      }),
    ).toThrow();
    expect(() =>
      compileH3PackagedActions({
        ...plan,
        steps: ["IDENTIFY_SURFACE"],
      }),
    ).toThrow();
  });

  it.each(unsafeKeys)("rejects unsafe action field %s", (unsafeKey) => {
    const action = compileH3PackagedActions(
      createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD"),
    )[0];
    expect(() =>
      parseH3PackagedAction({
        ...action,
        [unsafeKey]: "caller-controlled authority",
      }),
    ).toThrow();
  });

  it("keeps target authority outside actions and only uses the packaged prompt id", () => {
    const plan = createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD");
    const actions = compileH3PackagedActions(plan);
    const actionKeys = new Set(
      actions.flatMap((action) => Object.keys(action)),
    );

    expect(actionKeys.has("targetKey")).toBe(false);
    expect(actionKeys.has("url")).toBe(false);
    expect(actionKeys.has("promptText")).toBe(false);
    expect(actions[2]).toMatchObject({
      kind: "INSERT_PROMPT",
      promptId: "BRIDGE_COMMAND_SMOKE_V1",
    });
  });

  it("models exactly one irreversible send and no retry primitive", () => {
    const actions = compileH3PackagedActions(
      createH3RunPlan("chatgpt_standard_health", "CHATGPT_STANDARD"),
    );
    const sendActions = actions.filter((action) => action.kind === "SEND_ONCE");

    expect(sendActions).toHaveLength(1);
    expect(sendActions[0]).toMatchObject({
      kind: "SEND_ONCE",
      sendMode: "SINGLE_IRREVERSIBLE",
    });
    const actionKinds: readonly string[] = actions.map((action) => action.kind);
    expect(actionKinds).not.toContain("RETRY_SEND");
    expect(actionKinds).not.toContain("RESEND");
  });

  it("keeps cleanup terminal and the sequence immutable", () => {
    const actions = compileH3PackagedActions(
      createH3RunPlan("chatgpt_work_health", "CHATGPT_WORK"),
    );

    expect(actions.at(-1)?.kind).toBe("CLEANUP");
    expect(actions.at(-1)).toMatchObject({
      cleanupMode: "EPHEMERAL_SESSION_CLOSE",
    });
    expect(Object.isFrozen(actions)).toBe(true);
    expect(actions.every((action) => Object.isFrozen(action))).toBe(true);
    const validation = actions[7];
    expect(validation.kind).toBe("VALIDATE_BRIDGE_SURFACES");
    if (validation.kind === "VALIDATE_BRIDGE_SURFACES") {
      expect(Object.isFrozen(validation.checks)).toBe(true);
    }
  });

  it("accepts only distinct packaged Standard and Work identities", () => {
    const standard = getPackagedH3Profile("CHATGPT_STANDARD");
    const work = getPackagedH3Profile("CHATGPT_WORK");

    expect(standard).toEqual({
      surface: "CHATGPT_STANDARD",
      profileId: "CHATGPT_STANDARD_H3_V2",
      profileRevision: 2,
    });
    expect(work).toEqual({
      surface: "CHATGPT_WORK",
      profileId: "CHATGPT_WORK_H3_V1",
      profileRevision: 1,
    });
    expect(standard.profileId).not.toBe(work.profileId);
    expect(() =>
      parseH3PackagedAction({
        kind: "IDENTIFY_SURFACE",
        surfaceProfile: {
          surface: "CHATGPT_WORK",
          profileId: "CHATGPT_STANDARD_H3_V2",
          profileRevision: 2,
        },
      }),
    ).toThrow();
  });

  it("contains the fixed Bridge-shaped validation set", () => {
    const actions = compileH3PackagedActions(
      createH3RunPlan("chatgpt_work_health", "CHATGPT_WORK"),
    );
    const validation = actions.find(
      (action) => action.kind === "VALIDATE_BRIDGE_SURFACES",
    );

    expect(validation).toEqual({
      kind: "VALIDATE_BRIDGE_SURFACES",
      surfaceProfile: {
        surface: "CHATGPT_WORK",
        profileId: "CHATGPT_WORK_H3_V1",
        profileRevision: 1,
      },
      checks: [
        "COMMAND_CODE_BLOCK_SURFACE",
        "NATIVE_COPY_CONTROL",
        "CONVERSATION_IDENTITY",
        "DELIVERY_INSERTION_PATH",
      ],
    });
  });
});
