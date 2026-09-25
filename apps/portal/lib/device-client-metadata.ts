export type DeviceClientMetadata =
  | { state: "WITHHELD" }
  | {
      state: "PRESENT";
      browserFamily: string;
      browserVersion: string | null;
      extensionVersion: string;
    };

export function deviceClientMetadataDisplay(metadata: DeviceClientMetadata): {
  browser: string;
  extension: string;
} {
  if (metadata.state === "WITHHELD")
    return {
      browser: "Not shared",
      extension: "Not shared",
    };
  return {
    browser: metadata.browserVersion
      ? `${metadata.browserFamily} ${metadata.browserVersion}`
      : metadata.browserFamily,
    extension: metadata.extensionVersion,
  };
}
