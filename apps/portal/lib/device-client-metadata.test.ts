import { describe, expect, it } from "vitest";
import { deviceClientMetadataDisplay } from "./device-client-metadata";

describe("privacy-neutral device metadata display", () => {
  it("does not invent client software details when metadata is withheld", () => {
    expect(deviceClientMetadataDisplay({ state: "WITHHELD" })).toEqual({
      browser: "Not shared",
      extension: "Not shared",
    });
  });

  it("preserves the identified compatibility display", () => {
    expect(
      deviceClientMetadataDisplay({
        state: "PRESENT",
        browserFamily: "opera",
        browserVersion: "136.0",
        extensionVersion: "0.2.4",
      }),
    ).toEqual({
      browser: "opera 136.0",
      extension: "0.2.4",
    });
    expect(
      deviceClientMetadataDisplay({
        state: "PRESENT",
        browserFamily: "firefox",
        browserVersion: null,
        extensionVersion: "0.2.4",
      }),
    ).toEqual({
      browser: "firefox",
      extension: "0.2.4",
    });
  });
});
