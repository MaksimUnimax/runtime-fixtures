import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import type { SwaggerSourceFamily } from "@product/monitoring-control";
import type {
  ApiWatchImpact,
  OperationInventory,
  ProductRegistryEntry,
} from "./types.js";

export const PRODUCT_REGISTRY_PARSE_UNSUPPORTED = "PRODUCT_REGISTRY_PARSE_UNSUPPORTED";
export const OZON_PRODUCT_REGISTRY_PATH = resolve(
  new URL("../../../apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js", import.meta.url).pathname,
);
export const WB_PRODUCT_REGISTRY_PATH = resolve(
  new URL("../../../migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js", import.meta.url).pathname,
);

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
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

function objectProperties(node: ts.ObjectLiteralExpression): Record<string, unknown> {
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

function normalizePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function entryFromObject(
  sourceFamily: SwaggerSourceFamily,
  object: Record<string, unknown>,
): ProductRegistryEntry | undefined {
  const method = typeof object.method === "string" ? object.method.toUpperCase() : undefined;
  const pathValue = typeof object.path === "string" ? object.path : undefined;
  if (!method || !pathValue) return undefined;
  const runtimeAlias = typeof object.alias === "string"
    ? object.alias
    : typeof object.runtimeAlias === "string"
      ? object.runtimeAlias
      : typeof object.operation === "string"
        ? object.operation
        : `${method} ${pathValue}`;
  const provider = typeof object.provider === "string" ? object.provider : undefined;
  return {
    sourceFamily,
    runtimeAlias,
    method,
    normalizedPath: normalizePath(pathValue),
    executionEnabled: object.execution_enabled !== false,
    effect: typeof object.effect === "string" ? object.effect : "UNKNOWN",
    privacyClass: typeof object.privacy_policy === "string"
      ? object.privacy_policy
      : typeof object.privacy === "string"
        ? object.privacy
        : "UNKNOWN",
    runtimeSafetyClass: typeof object.safety_class === "string" ? object.safety_class : null,
    workflowRole: typeof object.workflow_role === "string" ? object.workflow_role : null,
    entitlementKey: typeof object.entitlement_key === "string" ? object.entitlement_key : null,
    currentness: typeof object.currentness === "string"
      ? object.currentness
      : typeof object.current === "boolean"
        ? object.current ? "current" : "not_current"
        : null,
    blockedReason: typeof object.blocked_reason === "string" ? object.blocked_reason : null,
    providerMetadata: { ...object, ...(provider ? { provider } : {}) },
  };
}

function parseEntries(sourceFamily: SwaggerSourceFamily, source: string): ProductRegistryEntry[] {
  const file = ts.createSourceFile("registry.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const findVariable = (name: string): ts.Expression | undefined => {
    let result: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (result) return;
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) result = node.initializer;
      node.forEachChild(visit);
    };
    visit(file);
    return result;
  };
  const objects: ts.ObjectLiteralExpression[] = [];
  if (sourceFamily === "OZON_SELLER" || sourceFamily === "OZON_PERFORMANCE") {
    const initializer = findVariable("OPERATIONS");
    if (!initializer || !ts.isCallExpression(initializer)) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const callee = initializer.expression.getText(file);
    if (callee !== "deepFreeze" || initializer.arguments.length !== 1) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    const operations = initializer.arguments[0];
    if (!operations || !ts.isObjectLiteralExpression(operations)) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    objects.push(...collectObjectLiterals(operations));
  } else {
    const raw = findVariable("raw");
    if (!raw || !ts.isArrayLiteralExpression(raw)) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
    for (const element of raw.elements) {
      if (!ts.isObjectLiteralExpression(element)) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
      objects.push(element);
    }
  }
  const entries = objects
    .map((object) => entryFromObject(sourceFamily, objectProperties(object)))
    .filter((entry): entry is ProductRegistryEntry => Boolean(entry))
    .filter((entry) => sourceFamily === "WILDBERRIES" || entry.providerMetadata.provider === (sourceFamily === "OZON_SELLER" ? "seller_api" : "performance_api"));
  if (!entries.length) throw new Error(PRODUCT_REGISTRY_PARSE_UNSUPPORTED);
  return entries;
}

export async function extractProductRegistry(input: {
  sourceFamily: SwaggerSourceFamily;
  filePath?: string;
}): Promise<ProductRegistryEntry[]> {
  const defaultPath = input.sourceFamily === "WILDBERRIES"
    ? WB_PRODUCT_REGISTRY_PATH
    : OZON_PRODUCT_REGISTRY_PATH;
  const source = await readFile(input.filePath ?? defaultPath, "utf8");
  return parseEntries(input.sourceFamily, source);
}

export function productIdentity(entry: Pick<ProductRegistryEntry, "sourceFamily" | "method" | "normalizedPath">): string {
  return `${entry.sourceFamily}:${entry.method.toUpperCase()}:${normalizePath(entry.normalizedPath)}`;
}

export function inventoryIdentity(item: { sourceFamily: SwaggerSourceFamily; method: string; path: string }): string {
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
  const sourceById = new Map(input.inventory.operations.map((item) => [inventoryIdentity(item), item]));
  const runtimeById = new Map<string, ProductRegistryEntry[]>();
  for (const entry of input.runtimeEntries) {
    const key = productIdentity(entry);
    const list = runtimeById.get(key) ?? [];
    list.push(entry);
    runtimeById.set(key, list);
  }
  const all = new Set([...sourceById.keys(), ...runtimeById.keys()]);
  const impactById = new Map((input.impact?.operations ?? []).map((item) => [item.identity, item]));
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
    if (state === "AMBIGUOUS_RUNTIME_MAPPING" || (state === "RUNTIME_ONLY" && runtimes[0]?.executionEnabled)) reviewState = "BLOCKING_RISK";
    else if (state === "SOURCE_ONLY" || state === "RUNTIME_ONLY" || impact?.severity === "REVIEW_REQUIRED" || impact?.severity === "UNKNOWN") reviewState = "REVIEW_REQUIRED";
    else if (impact?.severity === "BLOCKING_RISK") reviewState = "BLOCKING_RISK";
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
  return { rows, registryCounts: { [input.inventory.sourceFamily]: input.runtimeEntries.length } };
}
