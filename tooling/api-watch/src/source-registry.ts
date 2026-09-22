import {
  SwaggerSourceFamilySchema,
  type SwaggerSourceFamily,
} from "@product/monitoring-control";
import {
  API_WATCH_MAX_ARTIFACT_BYTES,
  type SourceDocument,
  type SourceRegistry,
  type SourceRegistryEntry,
} from "./types.js";

const OZON_SELLER_URL = "https://docs.ozon.ru/api/seller/swagger.json";
const OZON_PERFORMANCE_URL =
  "https://docs.ozon.ru/api/performance/swagger.json";
const WB_BASE = "https://dev.wildberries.ru/api/swagger/yaml/ru";
const WB_DOCUMENTS = [
  ["WB_01_GENERAL", "01-general.yaml"],
  ["WB_02_ITEMS", "02-items.yaml"],
  ["WB_03_ORDERS_FBS", "03-orders-fbs.yaml"],
  ["WB_04_ORDERS_DBW", "04-orders-dbw.yaml"],
  ["WB_05_DBS", "05-dbs.yaml"],
  ["WB_06_IN_STORE_PICKUP", "06-in-store-pickup.yaml"],
  ["WB_07_ORDERS_FBW", "07-orders-fbw.yaml"],
  ["WB_08_PROMOTION", "08-promotion.yaml"],
  ["WB_09_COMMUNICATIONS", "09-communications.yaml"],
  ["WB_10_RATES", "10-rates.yaml"],
  ["WB_11_ANALYTICS", "11-analytics.yaml"],
  ["WB_12_REPORTS", "12-reports.yaml"],
  ["WB_13_FINANCES", "13-finances.yaml"],
] as const;

function documentFor(
  documentKey: string,
  officialUrl: string,
  expectedArtifactTypes: SourceRegistryEntry["expectedArtifactTypes"],
): SourceDocument {
  return {
    documentKey,
    officialUrl,
    expectedArtifactTypes: [...expectedArtifactTypes],
  };
}

const productionEntries: readonly SourceRegistryEntry[] = [
  {
    sourceFamily: "OZON_SELLER",
    officialUrl: OZON_SELLER_URL,
    documents: [documentFor("OZON_SELLER", OZON_SELLER_URL, ["JSON"])],
    expectedArtifactTypes: ["JSON"],
    maximumBytes: API_WATCH_MAX_ARTIFACT_BYTES,
    acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
    operatorAcceptancePolicy: "REVIEW_REQUIRED",
    acceptedHosts: ["docs.ozon.ru"],
    requiredServerIdentity: "https://api-seller.ozon.ru",
    titlePattern: /seller/i,
  },
  {
    sourceFamily: "OZON_PERFORMANCE",
    officialUrl: OZON_PERFORMANCE_URL,
    documents: [
      documentFor("OZON_PERFORMANCE", OZON_PERFORMANCE_URL, ["JSON"]),
    ],
    expectedArtifactTypes: ["JSON"],
    maximumBytes: API_WATCH_MAX_ARTIFACT_BYTES,
    acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
    operatorAcceptancePolicy: "REVIEW_REQUIRED",
    acceptedHosts: ["docs.ozon.ru"],
    requiredServerIdentity: "https://api-performance.ozon.ru",
    titlePattern: /performance/i,
  },
  {
    sourceFamily: "WILDBERRIES",
    officialUrl: null,
    documents: WB_DOCUMENTS.map(([documentKey, file]) =>
      documentFor(documentKey, `${WB_BASE}/${file}?region=ru`, ["YAML"]),
    ),
    expectedArtifactTypes: ["YAML"],
    maximumBytes: API_WATCH_MAX_ARTIFACT_BYTES,
    acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
    operatorAcceptancePolicy: "REVIEW_REQUIRED",
    acceptedHosts: ["dev.wildberries.ru"],
  },
];

function cloneEntry(entry: SourceRegistryEntry): SourceRegistryEntry {
  const documents =
    entry.documents?.map((document) => ({
      ...document,
      expectedArtifactTypes: [...document.expectedArtifactTypes],
    })) ??
    (entry.officialUrl
      ? [
          documentFor(
            entry.sourceFamily,
            entry.officialUrl,
            entry.expectedArtifactTypes,
          ),
        ]
      : []);
  return {
    ...entry,
    documents,
    expectedArtifactTypes: [...entry.expectedArtifactTypes],
    acceptedHosts: entry.acceptedHosts ? [...entry.acceptedHosts] : undefined,
    titlePattern: entry.titlePattern
      ? new RegExp(entry.titlePattern.source, entry.titlePattern.flags)
      : undefined,
  };
}

export function createSourceRegistry(
  overrides: Partial<
    Record<SwaggerSourceFamily, Partial<SourceRegistryEntry>>
  > = {},
): SourceRegistry {
  const entries = productionEntries.map((base) => {
    const override = overrides[base.sourceFamily];
    const merged = { ...base, ...override };
    const documents =
      override?.documents ??
      (merged.officialUrl
        ? [
            documentFor(
              merged.sourceFamily,
              merged.officialUrl,
              merged.expectedArtifactTypes,
            ),
          ]
        : (merged.documents ?? []));
    if (merged.officialUrl && !merged.acceptedHosts)
      merged.acceptedHosts = [new URL(merged.officialUrl).hostname];
    return cloneEntry({ ...merged, documents });
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
export const productionSourceUrls = {
  OZON_SELLER_URL,
  OZON_PERFORMANCE_URL,
  WB_BASE,
} as const;
