import { describe, expect, it } from "vitest";
import {
  compareBrowserVersionV1,
  CompatibilityPolicyRevisionSchema,
  ExtensionReleaseSchema,
} from "./index.js";

const now = new Date("2026-09-04T00:00:00.000Z");
describe("P3.2 compatibility persistence validation", () => {
  it("accepts bounded typed records", () => {
    expect(
      ExtensionReleaseSchema.safeParse({
        id: "7b68acb6-51d4-4cbe-ab59-b3942b5e776c",
        version: "1.2.3-beta.1+build.7",
        releaseChannel: "stable",
        artifactSha256: "a".repeat(64),
        releasedAt: now,
        createdAt: now,
      }).success,
    ).toBe(true);
  });
  it("rejects corrupt semver, machine identifiers, and arbitrary fields", () => {
    const policy = {
      id: "7b68acb6-51d4-4cbe-ab59-b3942b5e776c",
      policyKey: "compatibility.chrome",
      revision: 1,
      contractVersion: "control_plane_v1",
      browserFamily: "chrome",
      minimumExtensionVersion: "1.2.3",
      recommendedExtensionVersion: null,
      minimumBrowserVersion: "128",
      maintenanceMode: false,
      maintenanceCode: null,
      publishedAt: now,
      createdAt: now,
    };
    expect(
      CompatibilityPolicyRevisionSchema.safeParse({
        ...policy,
        minimumExtensionVersion: "v1",
      }).success,
    ).toBe(false);
    expect(
      CompatibilityPolicyRevisionSchema.safeParse({
        ...policy,
        policyKey: "https://bad",
      }).success,
    ).toBe(false);
    expect(
      CompatibilityPolicyRevisionSchema.safeParse({ ...policy, anything: {} })
        .success,
    ).toBe(false);
  });
});

describe("P3.3 version comparison", () => {
  it("pads browser versions and rejects malformed versions", () => {
    expect(compareBrowserVersionV1("151", "151.0.0.0")).toBe(0);
    expect(compareBrowserVersionV1("151.0.7922.34", "151.0.7922.35")).toBe(-1);
    expect(compareBrowserVersionV1("01", "1")).toBeUndefined();
    expect(compareBrowserVersionV1("1.2.3.4.5", "1")).toBeUndefined();
  });
});
