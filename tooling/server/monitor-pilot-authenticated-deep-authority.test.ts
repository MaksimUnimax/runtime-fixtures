import { describe, expect, it } from "vitest";
import {
  assertMonitorPilotAuthenticatedDeepSourceFingerprint,
  MONITOR_PILOT_AUTHENTICATED_DEEP_MANIFEST_SHA256,
  monitorPilotAuthenticatedDeepManifestFingerprint,
} from "./monitor-pilot-authenticated-deep-authority.js";

describe("monitor pilot authenticated-deep source manifest", () => {
  it("pins current Standard/Work H3 source and P7 authority", () => {
    expect(monitorPilotAuthenticatedDeepManifestFingerprint()).toBe(
      "9f06770d0ae20f682f695729ac482b068cc94d9ecb551dd7d55a8e9d84eb6e94",
    );
    expect(monitorPilotAuthenticatedDeepManifestFingerprint()).toBe(
      MONITOR_PILOT_AUTHENTICATED_DEEP_MANIFEST_SHA256,
    );
  });

  it("rejects source-manifest drift", () => {
    expect(() =>
      assertMonitorPilotAuthenticatedDeepSourceFingerprint("0".repeat(64)),
    ).toThrow("MONITOR_PILOT_AUTHENTICATED_DEEP_SOURCE_MANIFEST_DRIFT");
  });
});
