import { describe, expect, it } from "vitest";
import {
  createPackagedH3TargetRegistry,
  createPackagedAliceH3TargetRegistry,
  createPackagedStandardH3TargetRegistry,
  createPackagedWorkH3TargetRegistry,
} from "./target-registry.js";

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

  it("packages Work separately and packages both surfaces together", () => {
    const work = createPackagedWorkH3TargetRegistry().resolve(
      "chatgpt_work_health",
    );
    expect(work.startUrl).toBe("https://chatgpt.com/");
    expect(work.allowedTopLevelOrigins).toEqual(["https://chatgpt.com"]);
    expect(work.browserFamily).toBe("chrome");
    expect(
      createPackagedH3TargetRegistry().resolve("chatgpt_work_health"),
    ).toEqual(work);
  });

  it("packages Alice separately and keeps dedicated ChatGPT registries filtered", () => {
    const alice = createPackagedAliceH3TargetRegistry().resolve("alice_health");
    expect(alice.startUrl).toBe("https://alice.yandex.ru/");
    expect(alice.allowedTopLevelOrigins).toEqual(["https://alice.yandex.ru"]);
    expect(() =>
      createPackagedStandardH3TargetRegistry().resolve("alice_health"),
    ).toThrow("CONTROLLED_TARGET_NOT_REGISTERED");
    expect(() =>
      createPackagedWorkH3TargetRegistry().resolve("alice_health"),
    ).toThrow("CONTROLLED_TARGET_NOT_REGISTERED");
  });
});
