import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import type { SwaggerSourceFamily } from "@product/monitoring-control";
import type {
  ApiWatchImpact,
  OperationInventory,
  ProductRegistryEntry,
} from "./types.js";

export const PRODUCT_REGISTRY_PARSE_UNSUPPORTED =
  "PRODUCT_REGISTRY_PARSE_UNSUPPORTED";
export const OZON_PRODUCT_REGISTRY_PATH = resolve(
  new URL(
    "../../../apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js",
    import.meta.url,
  ).pathname,
);
export const WB_PRODUCT_REGISTRY_PATH = resolve(
  new URL(
    "../../../migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js",
    import.meta.url,
  ).pathname,
);
export const WB_PRODUCT_REGISTRY_RETIREMENTS_OVERLAY_PATH = resolve(
  new URL(
    "../../../packages/marketplaces/wildberries/src/retired-analytics-registry-overlay.js",
    import.meta.url,
  ).pathname,
);
export const WB_PRODUCT_REGISTRY_OVERLAY_PATH = resolve(
  new URL(
    "../../../packages/marketplaces/wildberries/src/fbs-order-statuses-registry-overlay.js",
    import.meta.url,
  ).pathname,
);
export const EXTENSION_COMPOSITION_PATH = resolve(
  new URL("../../../apps/extension/composition.json", import.meta.url).pathname,
);

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return node.text;
  return undefined;
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken
  ) {
    const value = literalValue(node.operand);
    return typeof value === "string" ? -Number(value) : undefined;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (!name) continue;
      const value = literalValue(property.initializer);
      if (value !== undefined) result[name] = value;
    }
    return result;
  }
  return undefined;
}

function objectProperties(
  node: ts.ObjectLiteralExpression,
): Record<string, unknown> {
  return (literalValue(node) as Record<string, unknown> | undefined) ?? {};
}

function collectObjectLiterals(node: ts.Node): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isObjectLiteralExpression(current)) found.push(current);
    current.forEachChild((child) => visit(child));
  };
  visit(node);
  return found;
}

function findVariableInitializer(
  file: ts.SourceFile,
  name: string,
): ts.Expression | undefined {
  let result: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (result) return;
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      result = node.initializer;
    node.forEachChild(visit);
  };
  visit(file);
  return result;
}

function normalizePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return (
    withSlash.replace(/\/+/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") ||
    "/"
  );
}

function entryFromObject(
  sourceFamily: SwaggerSourceFamily,
  object: Record<string, unknown>,
): ProductRegistryEntry | undefined {
  const method =
    typeof object.method === "string" ? object.method.toUpperCase() : undefined;
  const pathValue = typeof object.path === "string" ? object.path : undefined;
  if (!method || !pathValue) return undefined;
  const runtimeAlias =
    typeof object.alias === "string"
      ? object.alias
      : typeof object.runtimeAlias === "string"
        ? object.runtimeAlias
        : typeof object.operation === "string"
          ? object.operation
          : `${method} ${pathValue}`;
  const provider =
    typeof object.provider === "string" ? object.provider : undefined;
  return {
    sourceFamily,
    runtimeAlias,
    method,
    normalizedPath: normalizePath(pathValue),
    executionEnabled: object.execution_enabled !== false,
    effect: typeof object.effect === "string" ? object.effect : "UNKNOWN",
    privacyClass:
      typeof object.privacy_policy === "string"
        ? object.privacy_policy
        : typeof object.privacy === "string"
          ? object.privacy
          : "UNKNOWN",
    runtimeSafetyClass:
      typeof object.safety_class === "string" ? object.safety_class : null,
    workflowRole:
      typeof object.workflow_role === "string" ? object.workflow_role : null,
    entitlementKey:
      typeof object.entitlement_key === "string"
        ? object.entitlement_key
        : null,
    currentness:
      typeof object.currentness === "string"
        ? object.currentness
        : typeof object.current === "boolean"
          ? object.current
            ? "current"
            : "not_current"
          : null,
    blockedReason:
      typeof object.blocked_reason === "string" ? object.blocked_reason : null,
    providerMetadata: { ...object, ...(provider ? { provider } : {}) },
  };
}

function parseEntries(
  sourceFamily: SwaggerSourceFamily,
  source: string,
): ProductRegistryEntry[] {
  const file = ts.createSourceFile(
    "registry.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const objects: ts.ObjectLiteralExpression[] = [];
  if (sourceFamily === "OZON_SELLER" || sourceFamily === "OZON_PERFORMANCE") {
    const initializer = findVariableInitializer(file, "OPERATIONS");
    if (!initializer || !ts.isCallExpression(initializer))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const callee = initializer.expression.getText(file);
    if (callee !== "deepFreeze" || initializer.arguments.length !== 1)
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const operations = initializer.arguments[0];
    if (!operations || !ts.isObjectLiteralExpression(operations))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    objects.push(...collectObjectLiterals(operations));
  } else {
    const raw = findVariableInitializer(file, "raw");
    if (!raw || !ts.isArrayLiteralExpression(raw))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    for (const element of raw.elements) {
      if (!ts.isObjectLiteralExpression(element))
        throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
      objects.push(element);
    }
  }
  const entries = objects
    .map((object) => entryFromObject(sourceFamily, objectProperties(object)))
    .filter((entry): entry is ProductRegistryEntry => Boolean(entry))
    .filter(
      (entry) =>
        sourceFamily === "WILDBERRIES" ||
        entry.providerMetadata.provider ===
          (sourceFamily === "OZON_SELLER" ? "seller_api" : "performance_api"),
    );
  if (!entries.length) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  return entries;
}

function objectFreezeArgument(
  expression: ts.Expression,
): ts.Expression | undefined {
  if (
    !ts.isCallExpression(expression) ||
    expression.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    !ts.isIdentifier(expression.expression.expression) ||
    expression.expression.expression.text !== "Object" ||
    expression.expression.name.text !== "freeze"
  )
    return undefined;
  return expression.arguments[0];
}

function parseWildberriesRetirements(source: string) {
  const file = ts.createSourceFile(
    "wb-retirements-overlay.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const initializer = findVariableInitializer(file, "RETIREMENTS");
  const frozen = initializer ? objectFreezeArgument(initializer) : undefined;
  if (!frozen || !ts.isArrayLiteralExpression(frozen))
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const targets = frozen.elements.map((element) => {
    const unwrapped = objectFreezeArgument(element as ts.Expression);
    if (!unwrapped || !ts.isObjectLiteralExpression(unwrapped))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const properties = objectProperties(unwrapped);
    if (
      typeof properties.alias !== "string" ||
      typeof properties.method !== "string" ||
      typeof properties.path !== "string"
    )
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    return {
      alias: properties.alias,
      method: properties.method.toUpperCase(),
      normalizedPath: normalizePath(properties.path),
    };
  });
  if (!targets.length) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  return targets;
}

function parseWildberriesAddition(source: string): ProductRegistryEntry {
  const file = ts.createSourceFile(
    "wb-registry-overlay.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const initializer = findVariableInitializer(file, "ADDITION");
  const frozen = initializer ? objectFreezeArgument(initializer) : undefined;
  if (!frozen || !ts.isObjectLiteralExpression(frozen))
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const names = frozen.properties.map((property) =>
    ts.isPropertyAssignment(property) ? propertyName(property.name) : undefined,
  );
  if (names.some((name) => !name) || new Set(names).size !== names.length)
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const properties = objectProperties(frozen);
  for (const key of ["query_keys", "required_query_keys"] as const) {
    const value = findPropertyInitializer(frozen, key);
    const array = value ? objectFreezeArgument(value) : undefined;
    if (!array || !ts.isArrayLiteralExpression(array))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const items = array.elements.map((item) => literalValue(item));
    if (items.some((item) => typeof item !== "string"))
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    properties[key] = items;
  }
  const expected: Record<string, unknown> = {
    alias: "analytics_item_returns",
    host: "analytics",
    method: "GET",
    path: "/api/analytics/v1/item-returns",
    category: "analytics",
    query_keys: ["dateFrom", "dateTo", "status", "limit", "offset"],
    required_query_keys: ["dateFrom", "dateTo", "status", "limit", "offset"],
    body_required: false,
    privacy: "standard",
    response_mode: "json",
    read_kind: "direct",
    effect: "READ",
    execution_enabled: true,
    current: true,
    source_openapi: "12-reports.yaml",
    source_path: "/api/analytics/v1/item-returns",
    source_readonly: true,
  };
  const expectedNames = Object.keys(expected);
  if (
    names.length !== expectedNames.length ||
    expectedNames.some((name) => !names.includes(name)) ||
    expectedNames.some(
      (name) =>
        JSON.stringify(properties[name]) !== JSON.stringify(expected[name]),
    )
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const entry = entryFromObject("WILDBERRIES", properties);
  if (!entry) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  return entry;
}

function findPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = object.properties.find(
    (candidate) =>
      ts.isPropertyAssignment(candidate) &&
      propertyName(candidate.name) === name,
  );
  return property && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}

function applyWildberriesEffectiveRegistryOverlays(input: {
  entries: ProductRegistryEntry[];
  retirementsOverlaySource: string;
  additionOverlaySource: string;
  fbsOverlaySource: string;
  compositionSource: string;
}): ProductRegistryEntry[] {
  const composition = JSON.parse(input.compositionSource) as {
    isolated_bundles?: Record<string, { reference_sources?: unknown }>;
  };
  const references =
    composition.isolated_bundles?.["shared/wb_adapter.js"]?.reference_sources;
  if (!Array.isArray(references))
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const donor =
      "migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js",
    retirements =
      "packages/marketplaces/wildberries/src/retired-analytics-registry-overlay.js",
    fbsOverlay =
      "packages/marketplaces/wildberries/src/fbs-order-statuses-registry-overlay.js",
    contract =
      "migration/reference/wildberries-v0.3.0/runtime/shared/wb_contract.js",
    donorIndex = references.indexOf(donor),
    retirementsIndex = references.indexOf(retirements),
    fbsIndex = references.indexOf(fbsOverlay),
    contractIndex = references.indexOf(contract);
  if (
    donorIndex < 0 ||
    retirementsIndex !== donorIndex + 1 ||
    fbsIndex !== retirementsIndex + 1 ||
    contractIndex < 0 ||
    fbsIndex >= contractIndex
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);

  let output = [...input.entries];
  const goodsReturn = output.filter(
    (entry) => entry.runtimeAlias === "goods_return",
  );
  if (
    goodsReturn.length !== 1 ||
    goodsReturn[0]?.method !== "GET" ||
    goodsReturn[0]?.normalizedPath !== "/api/v1/analytics/goods-return" ||
    goodsReturn[0]?.currentness !== "current" ||
    !goodsReturn[0]?.executionEnabled
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const parsedAddition = parseWildberriesAddition(input.additionOverlaySource);
  if (
    output.some(
      (entry) =>
        entry.runtimeAlias === parsedAddition.runtimeAlias ||
        entry.normalizedPath === parsedAddition.normalizedPath,
    )
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  for (const target of parseWildberriesRetirements(
    input.retirementsOverlaySource,
  )) {
    let matches = 0;
    output = output.filter((entry) => {
      if (entry.runtimeAlias !== target.alias) return true;
      matches += 1;
      if (
        matches !== 1 ||
        entry.method !== target.method ||
        entry.normalizedPath !== target.normalizedPath ||
        entry.currentness !== "current" ||
        !entry.executionEnabled
      )
        throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
      return false;
    });
    if (matches !== 1) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  }

  const addition = parsedAddition;
  if (
    output.some(
      (entry) =>
        entry.runtimeAlias === addition.runtimeAlias ||
        entry.normalizedPath === addition.normalizedPath,
    )
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  output.push(addition);

  const file = ts.createSourceFile(
      "wb-fbs-registry-overlay.js",
      input.fbsOverlaySource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    target = findVariableInitializer(file, "TARGET"),
    patched = findVariableInitializer(file, "patched");
  if (
    !target ||
    !ts.isStringLiteral(target) ||
    target.text !== "fbs_order_statuses"
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  if (
    !patched ||
    !ts.isCallExpression(patched) ||
    patched.expression.getText(file) !== "Object.freeze" ||
    patched.arguments.length !== 1
  )
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  const patchedObject = patched.arguments[0];
  if (!patchedObject || !ts.isObjectLiteralExpression(patchedObject))
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  if (objectProperties(patchedObject).body_required !== true)
    throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);

  let matched = false;
  output = output.map((entry) => {
    if (entry.runtimeAlias !== target.text) return entry;
    if (
      matched ||
      entry.method !== "POST" ||
      entry.normalizedPath !== "/api/v3/orders/status" ||
      entry.providerMetadata.body_required !== false
    )
      throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    matched = true;
    return {
      ...entry,
      providerMetadata: { ...entry.providerMetadata, body_required: true },
    };
  });
  if (!matched) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  return output;
}

export async function extractProductRegistry(input: {
  sourceFamily: SwaggerSourceFamily;
  filePath?: string;
}): Promise<ProductRegistryEntry[]> {
  const defaultPath =
    input.sourceFamily === "WILDBERRIES"
      ? WB_PRODUCT_REGISTRY_PATH
      : OZON_PRODUCT_REGISTRY_PATH;
  const source = await readFile(input.filePath ?? defaultPath, "utf8");
  const entries = parseEntries(input.sourceFamily, source);
  if (input.sourceFamily !== "WILDBERRIES" || input.filePath) return entries;
  const [retirementsOverlaySource, fbsOverlaySource, compositionSource] =
    await Promise.all([
      readFile(WB_PRODUCT_REGISTRY_RETIREMENTS_OVERLAY_PATH, "utf8"),
      readFile(WB_PRODUCT_REGISTRY_OVERLAY_PATH, "utf8"),
      readFile(EXTENSION_COMPOSITION_PATH, "utf8"),
    ]);
  return applyWildberriesEffectiveRegistryOverlays({
    entries,
    retirementsOverlaySource,
    additionOverlaySource: retirementsOverlaySource,
    fbsOverlaySource,
    compositionSource,
  });
}

export function productIdentity(
  entry: Pick<
    ProductRegistryEntry,
    "sourceFamily" | "method" | "normalizedPath"
  >,
): string {
  return `${entry.sourceFamily}:${entry.method.toUpperCase()}:${normalizePath(entry.normalizedPath)}`;
}

export function inventoryIdentity(item: {
  sourceFamily: SwaggerSourceFamily;
  method: string;
  path: string;
}): string {
  return `${item.sourceFamily}:${item.method.toUpperCase()}:${normalizePath(item.path)}`;
}

export type ProductCrosswalkResult = {
  rows: import("./types.js").ProductCrosswalkRow[];
  registryCounts: Record<string, number>;
};

export function buildProductCrosswalk(input: {
  reportId: string;
  inventory: OperationInventory;
  runtimeEntries: ProductRegistryEntry[];
  impact?: ApiWatchImpact;
  diffSha256?: string | null;
  createdAt?: Date;
}): ProductCrosswalkResult {
  const now = input.createdAt ?? new Date();
  const sourceById = new Map(
    input.inventory.operations.map((item) => [inventoryIdentity(item), item]),
  );
  const runtimeById = new Map<string, ProductRegistryEntry[]>();
  for (const entry of input.runtimeEntries) {
    const key = productIdentity(entry);
    const list = runtimeById.get(key) ?? [];
    list.push(entry);
    runtimeById.set(key, list);
  }
  const all = new Set([...sourceById.keys(), ...runtimeById.keys()]);
  const impactById = new Map(
    (input.impact?.operations ?? []).map((item) => [item.identity, item]),
  );
  const rows = [...all].sort().map((identity) => {
    const source = sourceById.get(identity);
    const runtimes = runtimeById.get(identity) ?? [];
    let state: import("./types.js").CrosswalkState;
    let executionEnabled: boolean | null = null;
    let alias: string | null = null;
    if (runtimes.length > 1) state = "AMBIGUOUS_RUNTIME_MAPPING";
    else if (!source) state = "RUNTIME_ONLY";
    else if (!runtimes.length) state = "SOURCE_ONLY";
    else {
      const runtime = runtimes[0]!;
      state = runtime.executionEnabled ? "MAPPED_ENABLED" : "MAPPED_DISABLED";
      executionEnabled = runtime.executionEnabled;
      alias = runtime.runtimeAlias;
    }
    const impact = impactById.get(identity);
    let reviewState: import("./types.js").CrosswalkReviewState;
    if (
      state === "AMBIGUOUS_RUNTIME_MAPPING" ||
      (state === "RUNTIME_ONLY" && runtimes[0]?.executionEnabled)
    )
      reviewState = "BLOCKING_RISK";
    else if (
      state === "SOURCE_ONLY" ||
      state === "RUNTIME_ONLY" ||
      impact?.severity === "REVIEW_REQUIRED" ||
      impact?.severity === "UNKNOWN"
    )
      reviewState = "REVIEW_REQUIRED";
    else if (impact?.severity === "BLOCKING_RISK")
      reviewState = "BLOCKING_RISK";
    else reviewState = "NO_ACTION";
    return {
      crosswalkId: `${input.reportId}:${identity}`,
      reportId: input.reportId,
      sourceFamily: source?.sourceFamily ?? runtimes[0]!.sourceFamily,
      sourceIdentity: identity,
      runtimeAlias: alias,
      crosswalkState: state,
      reviewState,
      executionEnabled,
      impactSeverity: impact?.severity ?? null,
      diffSha256: input.diffSha256 ?? null,
      createdAt: new Date(now),
    };
  });
  return {
    rows,
    registryCounts: {
      [input.inventory.sourceFamily]: input.runtimeEntries.length,
    },
  };
}
