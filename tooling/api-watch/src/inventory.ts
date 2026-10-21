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

type CanonicalMode = "node" | "named-fields" | "literal";
const NAMED_FIELD_MAPS = new Set([
  "properties",
  "patternProperties",
  "definitions",
  "$defs",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
  "content",
  "headers",
  "mapping",
  "scopes",
]);

function canonical(
  value: unknown,
  seen = new Set<object>(),
  mode: CanonicalMode = "node",
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return { $cycle: true };
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) =>
      canonical(item, seen, mode === "literal" ? "literal" : "node"),
    );
    seen.delete(value);
    return result;
  }
  const object = value as Record<string, unknown>;
  const entries: [string, unknown][] = [];
  for (const key of Object.keys(object).sort()) {
    // Annotation names are ordinary business field names inside a field map
    // and ordinary keys inside literal defaults/enum members.
    if (
      mode === "node" &&
      (key === "description" || key === "example" || key === "examples")
    )
      continue;
    const childMode: CanonicalMode =
      mode === "literal"
        ? "literal"
        : mode === "named-fields"
          ? "node"
          : ["default", "const", "enum"].includes(key)
            ? "literal"
            : NAMED_FIELD_MAPS.has(key)
              ? "named-fields"
              : "node";
    const field = object[key];
    const projected =
      mode === "node" &&
      (key === "enum" || key === "required") &&
      Array.isArray(field)
        ? field
            .map((item) => canonical(item, seen, childMode))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : canonical(field, seen, childMode);
    entries.push([key, projected]);
  }
  seen.delete(value);
  // Object assignment would treat __proto__ as a setter and lose that field.
  return Object.fromEntries(entries);
}

type RefContext = "openapi" | "schema" | "schema-map" | "literal";
const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "definitions",
  "$defs",
  "dependentSchemas",
  "dependencies",
]);
const SCHEMA_VALUE_KEYS = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
]);

function refChildContext(context: RefContext, key: string): RefContext {
  if (context === "schema-map") return "schema";
  if (context === "schema") {
    if (SCHEMA_MAP_KEYS.has(key)) return "schema-map";
    return SCHEMA_VALUE_KEYS.has(key) ? "schema" : "literal";
  }
  return key === "schema" ? "schema" : "openapi";
}

function localRef(
  value: unknown,
  root: Record<string, unknown>,
  seen = new Set<string>(),
  context: RefContext = "openapi",
): unknown {
  if (context === "literal") return value;
  if (Array.isArray(value))
    return value.map((item) => localRef(item, root, seen, context));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (
    context !== "schema-map" &&
    typeof object.$ref === "string" &&
    object.$ref.startsWith("#/")
  ) {
    const ref = object.$ref;
    let resolved: unknown;
    if (seen.has(ref)) {
      resolved = { $recursiveRef: ref };
    } else {
      const target = ref
        .slice(2)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
        .reduce<unknown>((at, key) => asObject(at)[key], root);
      resolved =
        target === undefined
          ? { $unresolvedRef: ref }
          : localRef(target, root, new Set([...seen, ref]), context);
    }
    // OpenAPI3.1 Schema Object $ref is a JSON Schema applicator. Sibling
    // constraints also apply; a non-schema Reference Object keeps its own rule.
    if (
      context === "schema" &&
      typeof root.openapi === "string" &&
      /^3\.1(?:\.|$)/.test(root.openapi)
    ) {
      const siblings = localRef(
        Object.fromEntries(
          Object.entries(object).filter(([key]) => key !== "$ref"),
        ),
        root,
        seen,
        "schema",
      );
      if (Object.keys(asObject(canonical(siblings))).length > 0)
        return { allOf: [resolved, siblings] };
    }
    return resolved;
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      localRef(item, root, seen, refChildContext(context, key)),
    ]),
  );
}

function fingerprint(value: unknown, mode: CanonicalMode = "node"): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value, new Set(), mode)))
    .digest("hex");
}

function schemaFingerprint(
  value: unknown,
  root: Record<string, unknown>,
  mode: CanonicalMode = "node",
  context: RefContext = "openapi",
): string {
  return fingerprint(localRef(value ?? null, root, new Set(), context), mode);
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
      .map((name) => [
        name,
        canonical(localRef(definitions[name] ?? null, root)),
      ]),
  );
  // Scheme names and requirement keys are names, never annotations.
  return fingerprint({ requirements, schemes }, "literal");
}

// Operation parameters override Path Item parameters with the same name and
// location (OAS 2 and 3). Resolve local references before identifying them.
function effectiveParameters(
  operation: Record<string, unknown>,
  pathParameters: readonly unknown[],
  root: Record<string, unknown>,
): Record<string, unknown>[] {
  const effective = new Map<string, Record<string, unknown>>();
  let unresolvedIndex = 0;
  const add = (raw: unknown) => {
    const parameter = asObject(localRef(raw, root));
    const identity =
      typeof parameter.name === "string" && typeof parameter.in === "string"
        ? JSON.stringify([
            parameter.in === "header"
              ? parameter.name.toLowerCase()
              : parameter.name,
            parameter.in,
          ])
        : "unresolved:" + unresolvedIndex++;
    effective.set(identity, parameter);
  };
  for (const parameter of pathParameters) add(parameter);
  for (const parameter of Array.isArray(operation.parameters)
    ? operation.parameters
    : [])
    add(parameter);
  return [...effective.values()];
}

function parametersFingerprint(
  parameters: readonly Record<string, unknown>[],
  root: Record<string, unknown>,
): string {
  const openapi3 =
    typeof root.openapi === "string" && /^3\./u.test(root.openapi);
  const projected = parameters
    .map((parameter) => {
      // Header field names are case-insensitive on the wire. Canonicalize both
      // override identity and fingerprints, but not path/query/cookie names.
      const serialized =
        parameter.in === "header" && typeof parameter.name === "string"
          ? { ...parameter, name: parameter.name.toLowerCase() }
          : parameter;
      const locationStyle =
        parameter.in === "query" || parameter.in === "cookie"
          ? "form"
          : parameter.in === "path" || parameter.in === "header"
            ? "simple"
            : null;
      const effectiveStyle =
        typeof parameter.style === "string" ? parameter.style : locationStyle;
      return Object.fromEntries(
        Object.entries(serialized)
          .filter(([key, value]) => {
            if (
              key === "description" ||
              key === "example" ||
              key === "examples"
            )
              return false;
            // OAS 3 parameter serialization uses location-dependent defaults.
            // Drop only an explicit default so older hashes for omitted fields stay unchanged.
            if (openapi3) {
              if (key === "style" && value === locationStyle) return false;
              if (
                key === "explode" &&
                typeof value === "boolean" &&
                effectiveStyle !== null &&
                value === (effectiveStyle === "form")
              )
                return false;
            }
            if (value !== false) return true;
            // Explicit default false has the same meaning as omission.
            // Retain required:false on path parameters: OAS requires true there.
            if (key === "required" && parameter.in !== "path") return false;
            if (!openapi3) {
              if (parameter.in === "query" && key === "allowEmptyValue")
                return false;
              return true;
            }
            if (key === "deprecated") return false;
            if (
              parameter.in === "query" &&
              (key === "allowEmptyValue" || key === "allowReserved")
            )
              return false;
            return true;
          })
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return fingerprint(projected);
}

// Swagger 2.0 operation MIME declarations override root declarations, and
// an explicit [] clears the inherited set. Order and duplicates are inert.
function swagger2MediaTypes(
  operation: Record<string, unknown>,
  root: Record<string, unknown>,
  field: "consumes" | "produces",
): string[] {
  if (root.swagger !== "2.0") return [];
  return stringList(
    operation[field] === undefined ? root[field] : operation[field],
  );
}

function requestFingerprint(
  operation: Record<string, unknown>,
  parameters: readonly Record<string, unknown>[],
  root: Record<string, unknown>,
): string | null {
  const bodies = parameters
    .filter((parameter) => parameter.in === "body")
    .map((parameter) => parameter.schema ?? null);
  const legacy =
    operation.requestBody !== undefined
      ? schemaFingerprint(operation.requestBody, root)
      : bodies.length
        ? schemaFingerprint(bodies, root, "node", "schema")
        : null;
  // Consumes applies to actual request payloads, including Swagger 2 formData.
  // Preserve original hashes when no media contract is declared, and ignore
  // consumes changes for an operation that accepts no request payload.
  const hasPayload =
    operation.requestBody !== undefined ||
    parameters.some(
      (parameter) => parameter.in === "body" || parameter.in === "formData",
    );
  const media = hasPayload
    ? swagger2MediaTypes(operation, root, "consumes")
    : [];
  return media.length
    ? fingerprint({ legacyRequestSha256: legacy, consumes: media }, "literal")
    : legacy;
}

function responseFingerprint(
  responses: Record<string, unknown>,
  root: Record<string, unknown>,
  operation: Record<string, unknown>,
): string {
  const legacy = fingerprint(
    Object.fromEntries(
      Object.entries(responses).map(([status, raw]) => {
        const response = asObject(localRef(raw, root));
        const body = response.schema ?? response.content ?? null;
        // Response headers are contract fields, not just response annotations.
        // HTTP header names are case-insensitive; OAS ignores Content-Type here.
        const headers = Object.entries(asObject(response.headers))
          .filter(([name]) => name.toLowerCase() !== "content-type")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, rawHeader]) => {
            const header = asObject(localRef(rawHeader, root));
            const normalized = Object.fromEntries(
              Object.entries(header).filter(([key, value]) => {
                if (
                  key === "description" ||
                  key === "example" ||
                  key === "examples"
                )
                  return false;
                if (
                  value === false &&
                  (key === "required" || key === "deprecated")
                )
                  return false;
                if (key === "style" && value === "simple") return false;
                if (
                  key === "explode" &&
                  value === false &&
                  (header.style === undefined || header.style === "simple")
                )
                  return false;
                return true;
              }),
            );
            return [name.toLowerCase(), normalized] as const;
          });
        // Two differently cased HTTP header names are one wire-level header.
        // Do not silently discard either conflicting declaration: represent
        // only ambiguous maps as an array, preserving prior ordinary hashes.
        const seenHeaderNames = new Set<string>();
        const hasCaseCollision = headers.some(([name]) => {
          const repeated = seenHeaderNames.has(name);
          seenHeaderNames.add(name);
          return repeated;
        });
        // Preserve prior fingerprints for responses without semantic headers.
        return [
          status,
          headers.length > 0
            ? {
                body,
                headers: hasCaseCollision
                  ? headers
                  : Object.fromEntries(headers),
              }
            : body,
        ];
      }),
    ),
    "named-fields",
  );
  const media = swagger2MediaTypes(operation, root, "produces");
  return media.length
    ? fingerprint({ legacyResponseSha256: legacy, produces: media }, "literal")
    : legacy;
}

function normalizedPath(path: string): string {
  // OpenAPI paths are appended verbatim to their server URL. A repeated slash
  // denotes an empty segment and may identify a different endpoint.
  return path.startsWith("/") ? path : `/${path}`;
}

const PATH_ITEM_METHOD_NAMES = new Set(
  HTTP_METHODS.map((method) => method.toLowerCase()),
);

// A JSON Pointer can resolve to any JSON object, including non-Path Item
// components. Never turn an unrelated object into a synthetic API operation.
function assertReferencedPathItem(value: Record<string, unknown>): void {
  for (const [name, field] of Object.entries(value)) {
    if (name === "summary" || name === "description") {
      if (typeof field !== "string")
        throw new Error("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    } else if (name === "parameters" || name === "servers") {
      if (!Array.isArray(field))
        throw new Error("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    } else if (PATH_ITEM_METHOD_NAMES.has(name)) {
      const operation = asObject(field);
      if (
        !Object.hasOwn(operation, "responses") ||
        !operation.responses ||
        typeof operation.responses !== "object" ||
        Array.isArray(operation.responses)
      )
        throw new Error("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    } else if (!name.startsWith("x-")) {
      throw new Error("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    }
  }
}

// Resolve Path Item references before enumerating methods. Schema references are
// handled independently below; expanding only this top-level reference avoids
// altering fingerprints for ordinary inline operations.
function resolvePathItem(
  raw: unknown,
  root: Record<string, unknown>,
  seen = new Set<string>(),
): Record<string, unknown> {
  const item = asObject(raw);
  if (!Object.hasOwn(item, "$ref")) return item;
  const ref = item.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#"))
    throw new Error("APIWATCH_PATH_ITEM_REF_UNSUPPORTED");
  // Percent-decode the URI fragment before splitting JSON Pointer tokens.
  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    throw new Error("APIWATCH_PATH_ITEM_REF_INVALID");
  }
  if (!pointer.startsWith("/"))
    throw new Error("APIWATCH_PATH_ITEM_REF_UNSUPPORTED");
  if (seen.has(pointer) || seen.size >= 64)
    throw new Error("APIWATCH_PATH_ITEM_REF_CYCLE_OR_DEPTH");
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((segment) => {
      if (/~(?![01])/u.test(segment))
        throw new Error("APIWATCH_PATH_ITEM_REF_INVALID");
      return segment.replace(/~1/g, "/").replace(/~0/g, "~");
    });
  // Only actual Path Item catalog positions can supply Path Items. This
  // excludes unrelated parameter/schema maps even when they contain a "get" key.
  const inPaths =
    tokens.length === 2 &&
    tokens[0] === "paths" &&
    tokens[1]?.startsWith("/") === true;
  const inPathItems =
    typeof root.openapi === "string" &&
    /^3\.1(?:\.|$)/u.test(root.openapi) &&
    tokens.length === 3 &&
    tokens[0] === "components" &&
    tokens[1] === "pathItems";
  if (!inPaths && !inPathItems)
    throw new Error("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
  let target: unknown = root;
  for (const key of tokens) {
    const object = asObject(target);
    if (!Object.hasOwn(object, key))
      throw new Error("APIWATCH_PATH_ITEM_REF_UNRESOLVED");
    target = object[key];
  }
  if (!target || typeof target !== "object" || Array.isArray(target))
    throw new Error("APIWATCH_PATH_ITEM_REF_NOT_OBJECT");
  const referenced = resolvePathItem(target, root, new Set([...seen, pointer]));
  const siblings = Object.entries(item).filter(([key]) => key !== "$ref");
  // OAS defines overlapping Path Item and referenced fields as undefined.
  // Reject ambiguity rather than silently selecting an operation or parameter.
  for (const [key] of siblings)
    if (Object.hasOwn(referenced, key))
      throw new Error("APIWATCH_PATH_ITEM_REF_CONFLICT");
  const resolved = { ...referenced, ...Object.fromEntries(siblings) };
  assertReferencedPathItem(resolved);
  return resolved;
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
  parameters: readonly Record<string, unknown>[],
): boolean {
  if (operation.requestBody && typeof operation.requestBody === "object")
    return true;
  return parameters.some((parameter) => parameter.in === "body");
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
    const pathItem = resolvePathItem(paths[path], document.root);
    const pathParameterValues = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];
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
      const parameters = effectiveParameters(
        op,
        pathParameterValues,
        document.root,
      );
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
        requestBodyPresent: hasRequestBody(op, parameters),
        parameterCount: parameters.length,
        responseStatusKeys: Object.keys(responses).sort(),
        parameterSchemaSha256: parametersFingerprint(parameters, document.root),
        requestSchemaSha256: requestFingerprint(op, parameters, document.root),
        responseSchemaSha256: responseFingerprint(responses, document.root, op),
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
      documentKey: snapshot.documentKey ?? null,
      snapshotSha256: snapshot.sha256,
      bytes,
      filename,
    });
    await input.store.saveInventory(inventory);
    inventories.push(inventory);
  }
  return inventories;
}
