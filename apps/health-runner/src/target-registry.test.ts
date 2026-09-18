import { describe, expect, it } from "vitest";
import { createPackagedStandardH3TargetRegistry } from "./target-registry.js";

describe("packaged Standard H3 target authority", () => {
  it("contains only the credential-free ChatGPT Standard target", () => {
    const registry = createPackagedStandardH3TargetRegistry();
    const target = registry.resolve("chatgpt_standard_health");
    expect(target.startUrl).toBe("https://chatgpt.com/");
    expect(target.allowedTopLevelOrigins).toEqual(["https://chatgpt.com"]);
    expect(target.browserFamily).toBe("chrome");
    expect(() => registry.resolve("chatgpt_work_health")).toThrow(
      "CONTROLLED_TARGET_NOT_REGISTERED",
    );
  });
});
