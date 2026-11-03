import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AI_RELEASE_SCOPE_BUNDLE_V1,
  AI_RELEASE_SCOPE_SHA256,
  AI_RELEASE_SCOPE_V1,
  AiReleaseScopeBundleV1Schema,
  isAiEnabledInReleaseV1,
  isAiPermissionEnabledInReleaseV1,
} from "./ai-release-scope.js";
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              canonical((value as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      : JSON.stringify(value);
describe("Bundled Alice-first release scope", () => {
  it("pins a canonical descriptor/hash and freezes all nested data", () => {
    expect(
      createHash("sha256").update(canonical(AI_RELEASE_SCOPE_V1)).digest("hex"),
    ).toBe(AI_RELEASE_SCOPE_SHA256);
    expect(Object.isFrozen(AI_RELEASE_SCOPE_BUNDLE_V1)).toBe(true);
    expect(Object.isFrozen(AI_RELEASE_SCOPE_V1.enabledAi[0])).toBe(true);
  });
  for (const family of AI_RELEASE_SCOPE_V1.retainedAiFamilies)
    it(`retains ${family} but enables only Alice`, () => {
      expect(
        isAiEnabledInReleaseV1({ family, surface: "web", variant: null }),
      ).toBe(family === "alice");
      expect(isAiPermissionEnabledInReleaseV1(`ai.${family}`)).toBe(
        family === "alice",
      );
    });
  it("rejects mismatching scope/hash and caller overrides", () => {
    for (const input of [
      null,
      {},
      { ...AI_RELEASE_SCOPE_BUNDLE_V1, sha256: "0".repeat(64) },
      {
        ...AI_RELEASE_SCOPE_BUNDLE_V1,
        descriptor: {
          ...AI_RELEASE_SCOPE_V1,
          enabledAi: [{ family: "qwen", surface: "web", variant: null }],
        },
      },
    ])
      expect(AiReleaseScopeBundleV1Schema.safeParse(input).success).toBe(false);
    expect(
      isAiEnabledInReleaseV1({
        family: "alice",
        surface: "web",
        variant: "work",
      }),
    ).toBe(false);
    expect(
      isAiEnabledInReleaseV1({
        family: "alice",
        surface: "web",
        variant: null,
        allowed: true,
      }),
    ).toBe(false);
  });
});
