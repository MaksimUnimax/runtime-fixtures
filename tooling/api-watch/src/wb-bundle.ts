import { createHash } from "node:crypto";
import {
  validateSwaggerBytes,
  type SwaggerSourceRequest,
  type SwaggerUploadValidation,
} from "@product/monitoring-control";
import { buildCompleteOperationInventory } from "./inventory.js";
import { productionSourceRegistry } from "./source-registry.js";
import { promoteAcceptedSnapshot } from "./snapshot.js";
import type {
  ApiWatchStore,
  AuthorityRecord,
  OperationInventory,
  SnapshotMetadata,
} from "./types.js";

export const WB_BUNDLE_VERSION = "wb_openapi_bundle_v1" as const;
export const WB_BUNDLE_DOCUMENT_KEY = "WB_OPENAPI_BUNDLE" as const;
export const WB_BUNDLE_OFFICIAL_ORIGIN = "https://dev.wildberries.ru" as const;
export const WB_BUNDLE_OFFICIAL_URL = `${WB_BUNDLE_OFFICIAL_ORIGIN}/`;

export type WbBundleDocumentValidation = {
  documentKey: string;
  filename: string;
  officialUrl: string;
  httpStatus: 200;
  content: string;
  sha256: string;
  byteLength: number;
  specVersion: string;
  pathCount: number;
  operationCount: number;
};

export type WbBundleValidation = {
  bundleVersion: typeof WB_BUNDLE_VERSION;
  sourceFamily: "WILDBERRIES";
  capturedAt: string;
  origin: typeof WB_BUNDLE_OFFICIAL_ORIGIN;
  documents: WbBundleDocumentValidation[];
  familyManifestSha256: string;
  outerSha256: string;
};

type BundleInputDocument = {
  documentKey?: unknown;
  filename?: unknown;
  officialUrl?: unknown;
  httpStatus?: unknown;
  content?: unknown;
};

function expectedDocuments() {
  const entry = productionSourceRegistry.get("WILDBERRIES");
  return [...(entry.documents ?? [])].sort((a, b) =>
    a.documentKey.localeCompare(b.documentKey),
  );
}

function fail(code: string): never {
  throw new Error(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("WB_BUNDLE_ROOT_NOT_OBJECT");
  return value as Record<string, unknown>;
}

function canonicalManifest(
  documents: readonly WbBundleDocumentValidation[],
): string {
  const canonical = [...documents]
    .sort((a, b) => a.documentKey.localeCompare(b.documentKey))
    .map(
      (document) =>
        `${document.documentKey}\t${document.sha256}\t${document.byteLength}\t${document.specVersion}`,
    )
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateWbBundle(
  bytes: Uint8Array,
  filename: string,
): WbBundleValidation {
  if (!filename.toLowerCase().endsWith(".json"))
    fail("WB_BUNDLE_EXTENSION_INVALID");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  const root = object(parsed);
  if (root.bundleVersion !== WB_BUNDLE_VERSION)
    fail("WB_BUNDLE_VERSION_INVALID");
  if (root.sourceFamily !== "WILDBERRIES")
    fail("WB_BUNDLE_SOURCE_FAMILY_INVALID");
  if (root.origin !== WB_BUNDLE_OFFICIAL_ORIGIN)
    fail("WB_BUNDLE_ORIGIN_INVALID");
  if (typeof root.capturedAt !== "string" || !root.capturedAt)
    fail("WB_BUNDLE_CAPTURE_TIME_INVALID");
  if (!Array.isArray(root.documents) || root.documents.length !== 13)
    fail("WB_BUNDLE_DOCUMENT_COUNT_INVALID");

  const expected = expectedDocuments();
  const expectedByKey = new Map(
    expected.map((document) => [document.documentKey, document]),
  );
  const seenKeys = new Set<string>();
  const seenFilenames = new Set<string>();
  const seenUrls = new Set<string>();
  const documents: WbBundleDocumentValidation[] = [];
  for (const raw of root.documents as BundleInputDocument[]) {
    const document = object(raw);
    const documentKey = document.documentKey;
    const filename = document.filename;
    const officialUrl = document.officialUrl;
    const content = document.content;
    if (
      typeof documentKey !== "string" ||
      typeof filename !== "string" ||
      typeof officialUrl !== "string" ||
      typeof content !== "string" ||
      !content.trim()
    )
      fail("WB_BUNDLE_DOCUMENT_METADATA_INVALID");
    if (document.httpStatus !== 200) fail("WB_BUNDLE_HTTP_STATUS_INVALID");
    if (seenKeys.has(documentKey)) fail("WB_BUNDLE_DUPLICATE_DOCUMENT_KEY");
    if (seenFilenames.has(filename)) fail("WB_BUNDLE_DUPLICATE_FILENAME");
    if (seenUrls.has(officialUrl)) fail("WB_BUNDLE_DUPLICATE_OFFICIAL_URL");
    seenKeys.add(documentKey);
    seenFilenames.add(filename);
    seenUrls.add(officialUrl);
    const expectedDocument = expectedByKey.get(documentKey);
    if (!expectedDocument) fail("WB_BUNDLE_UNEXPECTED_DOCUMENT_KEY");
    if (expectedDocument.officialUrl !== officialUrl)
      fail("WB_BUNDLE_OFFICIAL_URL_MISMATCH");
    if (expectedDocument.documentKey !== documentKey)
      fail("WB_BUNDLE_DOCUMENT_KEY_MISMATCH");
    if (
      filename !==
      expectedDocument.documentKey.replace(/^WB_\d+_/, "").toLowerCase()
    ) {
      const expectedFilename = expected.find(
        (candidate) => candidate.documentKey === documentKey,
      )?.officialUrl;
      if (
        !expectedFilename ||
        !new URL(expectedFilename).pathname.endsWith(`/${filename}`)
      )
        fail("WB_BUNDLE_FILENAME_MISMATCH");
    }
    const documentBytes = new TextEncoder().encode(content);
    let validation: ReturnType<typeof validateSwaggerBytes>;
    try {
      validation = validateSwaggerBytes(documentBytes, filename);
    } catch {
      fail("WB_BUNDLE_DOCUMENT_OPENAPI_INVALID");
    }
    const paths = validation.document.root.paths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths))
      fail("WB_BUNDLE_PATHS_INVALID");
    if (Object.keys(paths).length === 0) fail("WB_BUNDLE_PATHS_EMPTY");
    const sha256 = createHash("sha256").update(documentBytes).digest("hex");
    const inventory = buildCompleteOperationInventory({
      sourceFamily: "WILDBERRIES",
      documentKey,
      snapshotSha256: sha256,
      bytes: documentBytes,
      filename,
    });
    documents.push({
      documentKey,
      filename,
      officialUrl,
      httpStatus: 200,
      content,
      sha256,
      byteLength: documentBytes.byteLength,
      specVersion: validation.detectedSpecVersion,
      pathCount: inventory.pathCount,
      operationCount: inventory.operationCount,
    });
  }
  if (seenKeys.size !== expected.length)
    fail("WB_BUNDLE_DOCUMENT_SET_INCOMPLETE");
  const outerSha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bundleVersion: WB_BUNDLE_VERSION,
    sourceFamily: "WILDBERRIES",
    capturedAt: root.capturedAt as string,
    origin: WB_BUNDLE_OFFICIAL_ORIGIN,
    documents: documents.sort((a, b) =>
      a.documentKey.localeCompare(b.documentKey),
    ),
    familyManifestSha256: canonicalManifest(documents),
    outerSha256,
  };
}

export function validateWbBundleUpload(input: {
  bytes: Uint8Array;
  originalFilename: string;
  request: SwaggerSourceRequest;
}): SwaggerUploadValidation | undefined {
  if (
    input.request.sourceFamily !== "WILDBERRIES" ||
    input.request.documentKey !== WB_BUNDLE_DOCUMENT_KEY
  )
    return undefined;
  if (input.request.bundleVersion !== WB_BUNDLE_VERSION)
    return { accepted: false, code: "WB_BUNDLE_VERSION_INVALID" };
  try {
    const bundle = validateWbBundle(input.bytes, input.originalFilename);
    return {
      accepted: true,
      parserResult: {
        parsed: true,
        format: "JSON",
        bundleVersion: bundle.bundleVersion,
        documentCount: bundle.documents.length,
        outerSha256: bundle.outerSha256,
      },
      validationResult: {
        valid: true,
        sourceFamily: bundle.sourceFamily,
        origin: bundle.origin,
        familyManifestSha256: bundle.familyManifestSha256,
        documents: bundle.documents.map(
          ({ content: _content, ...metadata }) => metadata,
        ),
      },
      detectedSpecVersion: WB_BUNDLE_VERSION,
    };
  } catch (error) {
    return {
      accepted: false,
      code: error instanceof Error ? error.message : "WB_BUNDLE_INVALID",
    };
  }
}

export function createWbBundle(
  documents: Array<{
    documentKey: string;
    filename: string;
    content: string;
  }>,
  capturedAt = new Date().toISOString(),
): string {
  const expected = expectedDocuments();
  const byKey = new Map(
    documents.map((document) => [document.documentKey, document]),
  );
  return JSON.stringify({
    bundleVersion: WB_BUNDLE_VERSION,
    sourceFamily: "WILDBERRIES",
    capturedAt,
    origin: WB_BUNDLE_OFFICIAL_ORIGIN,
    documents: expected.map((document) => ({
      documentKey: document.documentKey,
      filename: new URL(document.officialUrl).pathname.split("/").pop(),
      officialUrl: document.officialUrl,
      httpStatus: 200,
      content: byKey.get(document.documentKey)?.content ?? "",
    })),
  });
}

export async function promoteAcceptedWbBundle(input: {
  bundle: WbBundleValidation;
  records: readonly AuthorityRecord[];
  store: ApiWatchStore;
  snapshotRoot: string;
  now?: () => Date;
}): Promise<{
  snapshots: SnapshotMetadata[];
  inventories: OperationInventory[];
  familyInventory: OperationInventory;
  familyManifestSha256: string;
}> {
  if (input.bundle.documents.length !== 13 || input.records.length !== 13)
    fail("WB_BUNDLE_ATOMIC_SET_INCOMPLETE");
  const recordsByKey = new Map(
    input.records.map((record) => [
      String(record.safeProvenance.documentKey),
      record,
    ]),
  );
  if (recordsByKey.size !== 13) fail("WB_BUNDLE_ATOMIC_SET_INCOMPLETE");
  const plannedInventories: OperationInventory[] = [];
  const plannedByKey = new Map<string, OperationInventory>();
  for (const document of input.bundle.documents) {
    const record = recordsByKey.get(document.documentKey);
    if (!record || record.authorityStatus !== "AUTHORITY_ACCEPTED")
      fail("WB_BUNDLE_AUTHORITY_NOT_ACCEPTED");
    const bytes = new TextEncoder().encode(document.content);
    const inventory = buildCompleteOperationInventory({
      sourceFamily: "WILDBERRIES",
      documentKey: document.documentKey,
      snapshotSha256: document.sha256,
      bytes,
      filename: document.filename,
    });
    if (
      record.sourceFamily !== "WILDBERRIES" ||
      String(record.safeProvenance.documentKey) !== document.documentKey ||
      record.sha256 !== document.sha256 ||
      record.sizeBytes !== document.byteLength
    )
      fail("WB_BUNDLE_AUTHORITY_PROVENANCE_MISMATCH");
    plannedInventories.push(inventory);
    plannedByKey.set(document.documentKey, inventory);
  }
  const operations = plannedInventories.flatMap(
    (inventory) => inventory.operations,
  );
  const identities = new Set<string>();
  for (const operation of operations) {
    if (identities.has(operation.identity))
      fail("DUPLICATE_SOURCE_OPERATION_IDENTITY");
    identities.add(operation.identity);
  }
  const inventories: OperationInventory[] = [];
  const snapshots: SnapshotMetadata[] = [];
  for (const document of input.bundle.documents) {
    const record = recordsByKey.get(document.documentKey)!;
    const bytes = new TextEncoder().encode(document.content);
    const snapshot = await promoteAcceptedSnapshot({
      record,
      bytes,
      store: input.store,
      snapshotRoot: input.snapshotRoot,
      documentKey: document.documentKey,
      now: input.now,
    });
    const inventory = plannedByKey.get(document.documentKey)!;
    await input.store.saveInventory(inventory);
    snapshots.push(snapshot);
    inventories.push(inventory);
  }
  const operationsByMethod: Record<string, number> = {};
  for (const operation of operations)
    operationsByMethod[operation.method] =
      (operationsByMethod[operation.method] ?? 0) + 1;
  const familyInventory: OperationInventory = {
    sourceFamily: "WILDBERRIES",
    snapshotSha256: input.bundle.familyManifestSha256,
    pathCount: new Set(operations.map((operation) => operation.path)).size,
    operationCount: operations.length,
    operationsByMethod,
    deprecatedCount: operations.filter((operation) => operation.deprecated)
      .length,
    operationIdPresentCount: operations.filter(
      (operation) => operation.operationId !== null,
    ).length,
    operationIdMissingCount: operations.filter(
      (operation) => operation.operationId === null,
    ).length,
    operations,
  };
  return {
    snapshots,
    inventories,
    familyInventory,
    familyManifestSha256: input.bundle.familyManifestSha256,
  };
}
