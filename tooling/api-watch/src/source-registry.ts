import {
  SwaggerSourceFamilySchema,
  type SwaggerSourceFamily,
} from "@product/monitoring-control";
import {
  API_WATCH_MAX_ARTIFACT_BYTES,
  type SourceRegistry,
  type SourceRegistryEntry,
} from "./types.js";

const SOURCE_FAMILIES = SwaggerSourceFamilySchema.options;

const productionEntries: readonly SourceRegistryEntry[] = SOURCE_FAMILIES.map(
  (sourceFamily) => ({
    sourceFamily,
    officialUrl: null,
    expectedArtifactTypes: ["JSON", "YAML", "YML"],
    maximumBytes: API_WATCH_MAX_ARTIFACT_BYTES,
    acquisitionPolicy: "SOURCE_URL_AUTHORITY_MISSING",
    operatorAcceptancePolicy: "REVIEW_REQUIRED",
  }),
);

function cloneEntry(entry: SourceRegistryEntry): SourceRegistryEntry {
  return {
    ...entry,
    expectedArtifactTypes: [...entry.expectedArtifactTypes],
    acceptedHosts: entry.acceptedHosts ? [...entry.acceptedHosts] : undefined,
  };
}

export function createSourceRegistry(
  overrides: Partial<Record<SwaggerSourceFamily, Partial<SourceRegistryEntry>>> = {},
): SourceRegistry {
  const entries = productionEntries.map((base) => {
    const override = overrides[base.sourceFamily];
    const merged = { ...base, ...override };
    if (merged.officialUrl && !merged.acceptedHosts) {
      merged.acceptedHosts = [new URL(merged.officialUrl).hostname];
    }
    return cloneEntry(merged);
  });
  const byFamily = new Map(entries.map((entry) => [entry.sourceFamily, entry]));
  return {
    get(sourceFamily) {
      const parsed = SwaggerSourceFamilySchema.parse(sourceFamily);
      const entry = byFamily.get(parsed);
      if (!entry) throw new Error("SOURCE_FAMILY_NOT_REGISTERED");
      return cloneEntry(entry);
    },
    list() {
      return entries.map(cloneEntry);
    },
  };
}

export const productionSourceRegistry = createSourceRegistry();
