import { createHash } from "node:crypto";
import type {
  DiffField,
  DiffFieldDelta,
  DiffOperationState,
  OperationInventory,
  OperationInventoryItem,
  SemanticDiff,
  SemanticDiffOperation,
  SemanticOperation,
  SwaggerSourceFamily,
} from "./types.js";

const FIELD_ORDER: readonly DiffField[] = [
  "deprecated",
  "operationId",
  "parameterCount",
  "requestBodyPresent",
  "responseStatusKeys",
  "securitySchemeReferences",
  "summaryHash",
  "tags",
  "parameterSchemaSha256",
  "requestSchemaSha256",
  "responseSchemaSha256",
  "securityRequirementsSha256",
];

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function semanticOperation(item: OperationInventoryItem): SemanticOperation {
  return {
    identity: item.identity,
    sourceFamily: item.sourceFamily,
    method: item.method.toUpperCase(),
    path: item.path,
    operationId: item.operationId,
    deprecated: item.deprecated,
    tags: sortedUnique(item.tags),
    summaryHash: item.summaryHash,
    securitySchemeReferences: sortedUnique(item.securitySchemeReferences),
    requestBodyPresent: item.requestBodyPresent,
    parameterCount: item.parameterCount,
    responseStatusKeys: sortedUnique(item.responseStatusKeys),
    parameterSchemaSha256: item.parameterSchemaSha256 ?? "",
    requestSchemaSha256: item.requestSchemaSha256 ?? null,
    responseSchemaSha256: item.responseSchemaSha256 ?? "",
    securityRequirementsSha256: item.securityRequirementsSha256 ?? "",
  };
}

function compareOperation(
  a: SemanticDiffOperation,
  b: SemanticDiffOperation,
): number {
  return (
    a.sourceFamily.localeCompare(b.sourceFamily) ||
    a.path.localeCompare(b.path) ||
    a.method.localeCompare(b.method)
  );
}

function fieldValue(operation: SemanticOperation, field: DiffField): unknown {
  return operation[field];
}

function normalizedValue(field: DiffField, value: unknown): unknown {
  if (
    field === "tags" ||
    field === "securitySchemeReferences" ||
    field === "responseStatusKeys"
  )
    return sortedUnique((value as string[]) ?? []);
  return value;
}

function deltas(
  before: SemanticOperation,
  after: SemanticOperation,
): DiffFieldDelta[] {
  return FIELD_ORDER.flatMap((field) => {
    const beforeValue = normalizedValue(field, fieldValue(before, field));
    const afterValue = normalizedValue(field, fieldValue(after, field));
    return JSON.stringify(beforeValue) === JSON.stringify(afterValue)
      ? []
      : [{ field, before: beforeValue, after: afterValue }];
  }).sort((a, b) => a.field.localeCompare(b.field));
}

function methodCounts(inventory: OperationInventory): Record<string, number> {
  return Object.fromEntries(
    Object.entries(inventory.operationsByMethod).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
}

function canonicalBody(
  diff: Omit<SemanticDiff, "createdAt" | "diffId" | "diffSha256">,
) {
  return {
    sourceFamily: diff.sourceFamily,
    baseSnapshotSha256: diff.baseSnapshotSha256,
    targetSnapshotSha256: diff.targetSnapshotSha256,
    basePathCount: diff.basePathCount,
    targetPathCount: diff.targetPathCount,
    baseOperationCount: diff.baseOperationCount,
    targetOperationCount: diff.targetOperationCount,
    addedCount: diff.addedCount,
    removedCount: diff.removedCount,
    changedCount: diff.changedCount,
    unchangedCount: diff.unchangedCount,
    methodCountsBefore: diff.methodCountsBefore,
    methodCountsAfter: diff.methodCountsAfter,
    deprecatedBefore: diff.deprecatedBefore,
    deprecatedAfter: diff.deprecatedAfter,
    operations: diff.operations.map((operation) => ({
      identity: operation.identity,
      sourceFamily: operation.sourceFamily,
      method: operation.method,
      path: operation.path,
      state: operation.state,
      before: operation.before,
      after: operation.after,
      deltas: operation.deltas.map((delta) => ({
        field: delta.field,
        before: delta.before,
        after: delta.after,
      })),
    })),
  };
}

export function diffInventories(input: {
  base: OperationInventory;
  target: OperationInventory;
  createdAt?: Date;
}): SemanticDiff {
  if (input.base.sourceFamily !== input.target.sourceFamily)
    throw new Error("DIFF_SOURCE_FAMILY_MISMATCH");

  const family: SwaggerSourceFamily = input.base.sourceFamily;
  const base = new Map(
    input.base.operations.map((operation) => [
      operation.identity,
      semanticOperation(operation),
    ]),
  );
  const target = new Map(
    input.target.operations.map((operation) => [
      operation.identity,
      semanticOperation(operation),
    ]),
  );
  const identities = [...new Set([...base.keys(), ...target.keys()])].sort();
  const operations: SemanticDiffOperation[] = identities
    .map((identity) => {
      const before = base.get(identity) ?? null;
      const after = target.get(identity) ?? null;
      let state: DiffOperationState;
      let operationDeltas: DiffFieldDelta[] = [];
      if (!before) state = "ADDED";
      else if (!after) state = "REMOVED";
      else {
        operationDeltas = deltas(before, after);
        state = operationDeltas.length > 0 ? "CHANGED" : "UNCHANGED";
      }
      const source = after ?? before;
      if (!source) throw new Error("DIFF_OPERATION_SOURCE_MISSING");
      return {
        identity,
        sourceFamily: family,
        method: source.method,
        path: source.path,
        state,
        before,
        after,
        deltas: operationDeltas,
      };
    })
    .sort(compareOperation);

  const body = {
    sourceFamily: family,
    baseSnapshotSha256: input.base.snapshotSha256,
    targetSnapshotSha256: input.target.snapshotSha256,
    basePathCount: input.base.pathCount,
    targetPathCount: input.target.pathCount,
    baseOperationCount: input.base.operationCount,
    targetOperationCount: input.target.operationCount,
    addedCount: operations.filter((operation) => operation.state === "ADDED")
      .length,
    removedCount: operations.filter(
      (operation) => operation.state === "REMOVED",
    ).length,
    changedCount: operations.filter(
      (operation) => operation.state === "CHANGED",
    ).length,
    unchangedCount: operations.filter(
      (operation) => operation.state === "UNCHANGED",
    ).length,
    methodCountsBefore: methodCounts(input.base),
    methodCountsAfter: methodCounts(input.target),
    deprecatedBefore: input.base.deprecatedCount,
    deprecatedAfter: input.target.deprecatedCount,
    operations,
  } satisfies Omit<SemanticDiff, "createdAt" | "diffId" | "diffSha256">;
  const canonical = JSON.stringify(canonicalBody(body));
  const diffSha256 = createHash("sha256").update(canonical).digest("hex");
  return {
    ...body,
    diffId: `${family}:${input.base.snapshotSha256}:${input.target.snapshotSha256}:${diffSha256}`,
    diffSha256,
    createdAt: input.createdAt ?? new Date(),
  };
}

export function canonicalSemanticDiff(diff: SemanticDiff): string {
  return JSON.stringify(
    canonicalBody({
      ...diff,
      operations: [...diff.operations]
        .map((operation) => ({
          ...operation,
          deltas: [...operation.deltas].sort((a, b) =>
            a.field.localeCompare(b.field),
          ),
        }))
        .sort(compareOperation),
    }),
  );
}
