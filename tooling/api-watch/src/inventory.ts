import { createHash } from "node:crypto";
import {
  parseSwaggerDocument,
  type SwaggerSourceFamily,
} from "@product/monitoring-control";
import type {
  ApiWatchStore,
  OperationInventory,
  OperationInventoryItem,
  SnapshotMetadata,
} from "./types.js";
import { readAcceptedSnapshot } from "./snapshot.js";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "TRACE",
] as const;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedPath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.replace(/\/{2,}/g, "/") || "/";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string"),
    ),
  ].sort();
}

function securityReferences(
  operation: Record<string, unknown>,
  root: Record<string, unknown>,
): string[] {
  const security =
    operation.security === undefined ? root.security : operation.security;
  if (!Array.isArray(security)) return [];
  return [
    ...new Set(
      security.flatMap((requirement) => Object.keys(asObject(requirement))),
    ),
  ].sort();
}

function hasRequestBody(
  operation: Record<string, unknown>,
  pathParameters: unknown[],
): boolean {
  if (operation.requestBody && typeof operation.requestBody === "object")
    return true;
  const operationParameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  return [...pathParameters, ...operationParameters].some(
    (parameter) =>
      parameter &&
      typeof parameter === "object" &&
      !Array.isArray(parameter) &&
      (parameter as Record<string, unknown>).in === "body",
  );
}

export function buildCompleteOperationInventory(input: {
  sourceFamily: SwaggerSourceFamily;
  snapshotSha256: string;
  bytes: Uint8Array;
  filename: string;
}): OperationInventory {
  const document = parseSwaggerDocument(input.bytes, input.filename);
  const paths = asObject(document.root.paths);
  const operations: OperationInventoryItem[] = [];
  for (const path of Object.keys(paths).sort()) {
    const pathItem = asObject(paths[path]);
    const pathParameterValues = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];
    const pathParameters = pathParameterValues.length;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method.toLowerCase()];
      if (
        !operation ||
        typeof operation !== "object" ||
        Array.isArray(operation)
      )
        continue;
      const op = operation as Record<string, unknown>;
      const normalized = normalizedPath(path);
      const summary = typeof op.summary === "string" ? op.summary : null;
      const responses = asObject(op.responses);
      const operationPath = `${input.sourceFamily}:${method}:${normalized}`;
      operations.push({
        sourceFamily: input.sourceFamily,
        snapshotSha256: input.snapshotSha256,
        identity: operationPath,
        method,
        path: normalized,
        operationId: typeof op.operationId === "string" ? op.operationId : null,
        tags: stringList(op.tags),
        deprecated: op.deprecated === true,
        summaryHash:
          summary === null
            ? null
            : createHash("sha256").update(summary).digest("hex"),
        securitySchemeReferences: securityReferences(op, document.root),
        requestBodyPresent: hasRequestBody(op, pathParameterValues),
        parameterCount:
          pathParameters +
          (Array.isArray(op.parameters) ? op.parameters.length : 0),
        responseStatusKeys: Object.keys(responses).sort(),
      });
    }
  }
  const operationsByMethod: Record<string, number> = {};
  for (const operation of operations)
    operationsByMethod[operation.method] =
      (operationsByMethod[operation.method] ?? 0) + 1;
  return {
    sourceFamily: input.sourceFamily,
    snapshotSha256: input.snapshotSha256,
    pathCount: Object.keys(paths).length,
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
}

export async function inventoryAcceptedSnapshots(input: {
  store: ApiWatchStore;
  snapshots?: readonly SnapshotMetadata[];
}): Promise<OperationInventory[]> {
  const snapshots = input.snapshots ?? (await input.store.listSnapshots());
  const inventories: OperationInventory[] = [];
  for (const snapshot of snapshots) {
    const bytes = await readAcceptedSnapshot(snapshot);
    const filename = snapshot.artifactPath.endsWith(".yaml")
      ? "snapshot.yaml"
      : snapshot.artifactPath.endsWith(".yml")
        ? "snapshot.yml"
        : "snapshot.json";
    const inventory = buildCompleteOperationInventory({
      sourceFamily: snapshot.sourceFamily,
      snapshotSha256: snapshot.sha256,
      bytes,
      filename,
    });
    await input.store.saveInventory(inventory);
    inventories.push(inventory);
  }
  return inventories;
}
