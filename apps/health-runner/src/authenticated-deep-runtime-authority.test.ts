import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTHENTICATED_DEEP_RUNTIME_AUTHORITY } from "./authenticated-deep-runtime-authority.js";

function readJson(url: URL): Record<string, unknown> {
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

describe("authenticated-deep packaged runtime authority", () => {
  it("tracks the exact extension and health-runner package versions", () => {
    const extension = readJson(
      new URL("../../extension/composition.json", import.meta.url),
    );
    const healthRunner = readJson(new URL("../package.json", import.meta.url));

    expect(Object.isFrozen(AUTHENTICATED_DEEP_RUNTIME_AUTHORITY)).toBe(true);
    expect(AUTHENTICATED_DEEP_RUNTIME_AUTHORITY.extensionVersion).toBe(
      extension.version,
    );
    expect(AUTHENTICATED_DEEP_RUNTIME_AUTHORITY.adapterEngineVersion).toBe(
      healthRunner.version,
    );
  });
});
