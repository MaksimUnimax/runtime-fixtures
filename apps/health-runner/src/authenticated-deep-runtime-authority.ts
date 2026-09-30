import { SemVerV1Schema } from "@product/shared";

export const AUTHENTICATED_DEEP_RUNTIME_AUTHORITY = Object.freeze({
  extensionVersion: SemVerV1Schema.parse("0.2.11"),
  adapterEngineVersion: SemVerV1Schema.parse("0.1.0"),
});
