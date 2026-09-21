import { describe, expect, it } from "vitest";
import { resolveCompatibility } from "./index.js";

const now = new Date("2026-09-21T09:00:00.000Z");
const policyId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";

function resolve(
  input: Partial<Parameters<typeof resolveCompatibility>[0]> = {},
) {
  return resolveCompatibility({
    contractVersion: "control_plane_v1",
    extensionVersion: "0.2.4",
    browserFamily: "chrome",
    browserVersion: "147.0.0.0",
    release: {
      id: releaseId,
      version: "0.2.4",
      releaseChannel: "free-beta",
      artifactSha256: "a".repeat(64),
      releasedAt: now,
      createdAt: now,
    },
    releaseContracts: [{ releaseId, contractVersion: "control_plane_v1" }],
    releaseBrowsers: [{ releaseId, browserFamily: "chrome" }],
    policies: [
      {
        id: policyId,
        policyKey: "compatibility.chrome",
        revision: 1,
        contractVersion: "control_plane_v1",
        browserFamily: "chrome",
        minimumExtensionVersion: "0.2.4",
        recommendedExtensionVersion: "0.2.4",
        minimumBrowserVersion: "136",
        maintenanceMode: false,
        maintenanceCode: null,
        publishedAt: now,
        createdAt: now,
      },
    ],
    blockedVersions: new Map(),
    ...input,
  });
}

describe("B1 free-beta compatibility matrix", () => {
  it("accepts the supported RC", () => {
    expect(resolve()).toMatchObject({
      extension: "SUPPORTED",
      browser: "SUPPORTED",
      minimumVersion: "0.2.4",
    });
  });

  it("maps too-old and blocked extensions to UPDATE_REQUIRED", () => {
    expect(resolve({ extensionVersion: "0.2.3" })).toMatchObject({
      extension: "UPDATE_REQUIRED",
    });
    expect(
      resolve({
        blockedVersions: new Map([
          [
            policyId,
            [{ policyRevisionId: policyId, extensionVersion: "0.2.4" }],
          ],
        ]),
      }),
    ).toMatchObject({ extension: "UPDATE_REQUIRED" });
  });

  it("keeps a newer semver forward-compatible when its contract is supported", () => {
    expect(resolve({ extensionVersion: "0.2.5" })).toMatchObject({
      extension: "SUPPORTED",
    });
  });

  it("fails closed for an incompatible server contract", () => {
    expect(
      resolve({
        contractVersion: "control_plane_v2",
        releaseContracts: [{ releaseId, contractVersion: "control_plane_v1" }],
        policies: [],
      }),
    ).toMatchObject({ extension: "UPDATE_REQUIRED" });
  });
});
