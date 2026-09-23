import { describe, expect, test } from "vitest";
import {
  H3SurfaceProfileSchema,
  compileH3PackagedActions,
  getPackagedH3Profile,
} from "./h3-actions.js";
import { createH3RunPlan } from "./h3-contracts.js";
import { createPackagedH3TargetRegistry } from "./target-registry.js";

describe("Alice H3 packaged contract", () => {
  test("packages Alice surface/profile/target", () => {
    expect(getPackagedH3Profile("ALICE")).toEqual({
      surface: "ALICE",
      profileId: "ALICE_H3_V1",
      profileRevision: 1,
    });
    expect(
      H3SurfaceProfileSchema.parse({
        surface: "ALICE",
        profileId: "ALICE_H3_V1",
        profileRevision: 1,
      }),
    ).toEqual({
      surface: "ALICE",
      profileId: "ALICE_H3_V1",
      profileRevision: 1,
    });
    expect(
      createPackagedH3TargetRegistry().resolve("alice_health"),
    ).toMatchObject({
      startUrl: "https://alice.yandex.ru/",
      allowedTopLevelOrigins: ["https://alice.yandex.ru"],
      browserFamily: "chrome",
    });
  });

  test("compiles the common one-send sequence for Alice", () => {
    const plan = createH3RunPlan("alice_health", "ALICE");
    const actions = compileH3PackagedActions(plan);
    expect(actions.map((action) => action.surfaceProfile)).toHaveLength(9);
    expect(
      actions.filter((action) => action.kind === "SEND_ONCE"),
    ).toHaveLength(1);
    expect(
      actions.every((action) => action.surfaceProfile.surface === "ALICE"),
    ).toBe(true);
  });

  test("keeps cross-surface plans target-fenced", () => {
    expect(() =>
      createH3RunPlan("alice_health", "CHATGPT_STANDARD"),
    ).not.toThrow();
    expect(() => createH3RunPlan("alice_health", "CHATGPT_WORK")).not.toThrow();
    expect(() =>
      createH3RunPlan("chatgpt_standard_health", "ALICE"),
    ).not.toThrow();
    expect(() => createH3RunPlan("chatgpt_work_health", "ALICE")).not.toThrow();
  });
});
