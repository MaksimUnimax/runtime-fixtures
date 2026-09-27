import { describe, expect, it } from "vitest";
import {
  assertMonitorPilotSourceFingerprint,
  MONITOR_PILOT_DEPLOYED_SOURCE,
  MONITOR_PILOT_MANIFEST_SHA256,
  monitorPilotManifestFingerprint,
} from "./monitor-pilot-authority.js";

describe("monitor pilot authority source manifest", () => {
  it("pins the deployed source and canonical nine-target manifest", () => {
    expect(MONITOR_PILOT_DEPLOYED_SOURCE).toBe(
      "69db39e795010d0f9acfc9ffcaef76b38f5f59b3",
    );
    expect(monitorPilotManifestFingerprint()).toBe(
      "01665888b04717b99ff5564f3e2eaf1f389249dae7cef83c5aa75d79d81ace7e",
    );
    expect(monitorPilotManifestFingerprint()).toBe(
      MONITOR_PILOT_MANIFEST_SHA256,
    );
  });

  it("rejects drift before provisioning can begin", () => {
    expect(() => assertMonitorPilotSourceFingerprint("0".repeat(64))).toThrow(
      "MONITOR_PILOT_SOURCE_MANIFEST_DRIFT",
    );
  });
});
