import { describe, expect, it } from "vitest";
import {
  BootstrapRequestV2Schema,
  DeviceAuthorizationStartBodyV1Schema,
} from "./index";

const families = [
  "chrome",
  "opera",
  "yandex_chromium",
  "firefox",
  "safari",
] as const;

describe("browser-family public contracts", () => {
  for (const browserFamily of families) {
    it(`accepts ${browserFamily} for activation and bootstrap`, () => {
      expect(
        DeviceAuthorizationStartBodyV1Schema.safeParse({
          clientType: "browser_extension",
          browserFamily,
          browserVersion: "156.0",
          extensionVersion: "0.2.4",
        }).success,
      ).toBe(true);
      expect(
        BootstrapRequestV2Schema.safeParse({
          contractVersion: "control_plane_v2",
          extensionVersion: "0.2.4",
          browser: { family: browserFamily, version: "156.0" },
          deviceId: "22222222-2222-4222-8222-222222222222",
          lastConfigVersion: null,
        }).success,
      ).toBe(true);
    });
  }

  it("rejects an unmodeled browser family", () => {
    expect(
      DeviceAuthorizationStartBodyV1Schema.safeParse({
        clientType: "browser_extension",
        browserFamily: "edge",
        browserVersion: "156.0",
        extensionVersion: "0.2.4",
      }).success,
    ).toBe(false);
  });
});
