import { describe, expect, it } from "vitest";
import {
  healthIncidentKeySha256,
  healthIncidentScopeSha256,
  selectRootContour,
} from "./incident.js";

const scope = {
  adapterFamilyId: "00000000-0000-4000-8000-000000000001",
  adapterFamilyKey: "fixture-ai",
  surfaceId: "00000000-0000-4000-8000-000000000002",
  surfaceKey: "contract",
  variant: null,
  browserFamily: "chrome" as const,
  browserVersion: "120.0.0.0",
  extensionVersion: "1.0.0",
  adapterEngineVersion: "1.0.0",
  profile: {
    id: "00000000-0000-4000-8000-000000000003",
    revision: 1,
  },
  healthSuite: { machineKey: "baseline-contract-fixture", revision: 1 },
};

describe("Health incident identity", () => {
  it("is deterministic and excludes run/evidence/time values", () => {
    const first = healthIncidentKeySha256(scope, "H3", "C05_SEND_CONTROL");
    const second = healthIncidentKeySha256(
      {
        ...scope,
        browserVersion: "121.0.0.0",
        extensionVersion: "9.9.9",
        adapterEngineVersion: "8.8.8",
        profile: { ...scope.profile, revision: 9 },
        healthSuite: { ...scope.healthSuite, revision: 9 },
      },
      "H3",
      "C05_SEND_CONTROL",
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates provider, surface, target, Health layer, and root contour", () => {
    const base = healthIncidentScopeSha256(scope, "H3");
    expect(
      healthIncidentScopeSha256({ ...scope, adapterFamilyKey: "other" }, "H3"),
    ).not.toBe(base);
    expect(
      healthIncidentScopeSha256({ ...scope, surfaceKey: "other" }, "H3"),
    ).not.toBe(base);
    expect(
      healthIncidentScopeSha256(
        { ...scope, variant: { id: scope.surfaceId, machineKey: "work" } },
        "H3",
      ),
    ).not.toBe(base);
    expect(healthIncidentScopeSha256(scope, "H4")).not.toBe(base);
    expect(healthIncidentKeySha256(scope, "H3", "C04_COMPOSER_INPUT")).not.toBe(
      healthIncidentKeySha256(scope, "H3", "C05_SEND_CONTROL"),
    );
  });

  it("selects one root independent of result insertion order", () => {
    const first = selectRootContour({
      productFindings: [
        { contourKey: "C05_SEND_CONTROL", finding: "DEGRADED" },
        { contourKey: "C04_COMPOSER_INPUT", finding: "BROKEN" },
      ],
    });
    const second = selectRootContour({
      productFindings: [
        { contourKey: "C04_COMPOSER_INPUT", finding: "BROKEN" },
        { contourKey: "C05_SEND_CONTROL", finding: "DEGRADED" },
      ],
    });
    expect(first).toBe("C04_COMPOSER_INPUT");
    expect(second).toBe(first);
  });
});
