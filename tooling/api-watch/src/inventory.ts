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

function canonical(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return { $cycle: true };
    seen.add(value);
    const result = value.map((item) => canonical(item, seen));
    seen.delete(value);
    return result;
  }
  if (seen.has(value)) return { $cycle: true };
  seen.add(value);
  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    if (key === "description" || key === "example" || key === "examples")
      continue;
    const field = object[key];
    result[key] =
      (key === "enum" || key === "required") && Array.isArray(field)
        ? [...field]
            .map((item) => canonical(item, seen))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : canonical(field, seen);
  }
  seen.delete(value);
  return result;
}

function localRef(
  value: unknown,
  root: Record<string, unknown>,
  seen = new Set<string>(),
): unknown {
  if (Array.isArray(value))
    return value.map((item) => localRef(item, root, seen));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (typeof object.$ref === "string" && object.$ref.startsWith("#/")) {
    const ref = object.$ref;
    if (seen.has(ref)) return { $recursiveRef: ref };
    const target = ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<unknown>((at, key) => asObject(at)[key], root);
    if (target === undefined) return { $unresolvedRef: ref };
    return localRef(target, root, new Set([...seen, ref]));
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      localRef(item, root, seen),
    ]),
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function schemaFingerprint(
  value: unknown,
  root: Record<string, unknown>,
): string {
  return fingerprint(localRef(value ?? null, root));
}

function securityFingerprint(
  operation: Record<string, unknown>,
  root: Record<string, unknown>,
): string {
  const value =
    operation.security === undefined
      ? (root.security ?? [])
      : operation.security;
  const requirements = Array.isArray(value)
    ? value
        .map((item) =>
          Object.fromEntries(
            Object.entries(asObject(item))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, scopes]) => [
                key,
                [
                  ...new Set(
                    Array.isArray(scopes)
                      ? scopes.filter((s): s is string => typeof s === "string")
                      : [],
                  ),
                ].sort(),
              ]),
          ),
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value;
  const definitions = asObject(
    asObject(root.components).securitySchemes ?? root.securityDefinitions,
  );
  const used = new Set(
    Array.isArray(requirements)
      ? requirements.flatMap((item) => Object.keys(asObject(item)))
      : [],
  );
  const schemes = Object.fromEntries(
    [...used]
      .sort()
      .map((name) => [name, localRef(definitions[name] ?? null, root)]),
  );
  return fingerprint({ requirements, schemes });
}

function parametersFingerprint(
  operation: Record<string, unknown>,
  pathParameters: unknown[],
  root: Record<string, unknown>,
): string {
  const all = [
    ...pathParameters,
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  const projected = all
    .map((raw) => {
      const parameter = asObject(localRef(raw, root));
      return Object.fromEntries(
        Object.entries(parameter)
          .filter(
            ([key]) =>
              key !== "description" && key !== "example" && key !== "examples",
          )
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return fingerprint(projected);
}

function requestFingerprint(
  operation: Record<string, unknown>,
  parameters: unknown[],
  root: Record<string, unknown>,
): string | null {
  if (operation.requestBody !== undefined)
    return schemaFingerprint(operation.requestBody, root);
  const bodies = [
    ...parameters,
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ]
    .filter((raw) => asObject(raw).in === "body")
    .map((raw) => asObject(raw).schema ?? null);
  return bodies.length ? schemaFingerprint(bodies, root) : null;
}

function responseFingerprint(
  responses: Record<string, unknown>,
  root: Record<string, unknown>,
): string {
  return schemaFingerprint(
    Object.fromEntries(
      Object.entries(responses).map(([status, raw]) => {
        const response = asObject(localRef(raw, root));
        return [status, response.schema ?? response.content ?? null];
      }),
    ),
    root,
  );
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
  documentKey?: string | null;
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
        documentKey: input.documentKey ?? null,
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
        parameterSchemaSha256: parametersFingerprint(
          op,
          pathParameterValues,
          document.root,
        ),
        requestSchemaSha256: requestFingerprint(
          op,
          pathParameterValues,
          document.root,
        ),
        responseSchemaSha256: responseFingerprint(responses, document.root),
        securityRequirementsSha256: securityFingerprint(op, document.root),
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
