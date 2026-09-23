import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { diffInventories } from "./diff.js";
import { classifyApiImpact } from "./impact.js";
import type {
  OperationInventory,
  OperationInventoryItem,
  SemanticDiff,
} from "./types.js";

const FAMILY = "OZON_SELLER" as const;
const BASE_SHA = "c".repeat(64);
const TARGET_SHA = "d".repeat(64);

function item(
  overrides: Partial<OperationInventoryItem> = {},
): OperationInventoryItem {
  const method = overrides.method ?? "GET";
  const path = overrides.path ?? "/items";
  return {
    sourceFamily: FAMILY,
    snapshotSha256: BASE_SHA,
    identity: `${FAMILY}:${method}:${path}`,
    method,
    path,
    operationId: "listItems",
    tags: ["items"],
    deprecated: false,
    summaryHash: "summary",
    securitySchemeReferences: ["bearerAuth"],
    requestBodyPresent: false,
    parameterCount: 1,
    responseStatusKeys: ["200"],
    ...overrides,
  };
}

function inventory(
  operations: OperationInventoryItem[],
  sha = BASE_SHA,
): OperationInventory {
  const operationsByMethod: Record<string, number> = {};
  for (const operation of operations)
    operationsByMethod[operation.method] =
      (operationsByMethod[operation.method] ?? 0) + 1;
  return {
    sourceFamily: FAMILY,
    snapshotSha256: sha,
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
}

function impact(
  base: OperationInventoryItem[],
  target: OperationInventoryItem[],
): ReturnType<typeof classifyApiImpact> {
  return classifyApiImpact(
    diffInventories({
      base: inventory(base),
      target: inventory(target, TARGET_SHA),
      createdAt: new Date("2026-09-22T00:00:00Z"),
    }),
  );
}

describe("A5 conservative API change impact", () => {
  it("A5-01 classifies a removed operation as BLOCKING_RISK", () => {
    expect(impact([item()], []).overallSeverity).toBe("BLOCKING_RISK");
  });

  it("A5-02 classifies added security as BLOCKING_RISK", () => {
    expect(
      impact(
        [item()],
        [item({ securitySchemeReferences: ["bearerAuth", "sellerAuth"] })],
      ).overallSeverity,
    ).toBe("BLOCKING_RISK");
  });

  it("A5-03 classifies removed security as BLOCKING_RISK", () => {
    expect(
      impact([item()], [item({ securitySchemeReferences: [] })])
        .overallSeverity,
    ).toBe("BLOCKING_RISK");
  });

  it("A5-04 classifies request-body addition as REVIEW_REQUIRED", () => {
    expect(
      impact([item()], [item({ requestBodyPresent: true })]).overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-05 classifies request-body removal as REVIEW_REQUIRED", () => {
    expect(
      impact([item({ requestBodyPresent: true })], [item()]).overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-06 classifies parameter-count changes as REVIEW_REQUIRED", () => {
    expect(
      impact([item()], [item({ parameterCount: 2 })]).overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-07 classifies response status additions as REVIEW_REQUIRED", () => {
    expect(
      impact([item()], [item({ responseStatusKeys: ["200", "201"] })])
        .overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-08 classifies response status removals as REVIEW_REQUIRED", () => {
    expect(
      impact([item({ responseStatusKeys: ["200", "404"] })], [item()])
        .overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-09 classifies deprecated changes as REVIEW_REQUIRED", () => {
    expect(impact([item()], [item({ deprecated: true })]).overallSeverity).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("C03 classifies parameter/request/response schema changes as REVIEW_REQUIRED", () => {
    for (const field of [
      "parameterSchemaSha256",
      "requestSchemaSha256",
      "responseSchemaSha256",
    ] as const) {
      const result = impact(
        [item({ [field]: "a".repeat(64) })],
        [item({ [field]: "b".repeat(64) })],
      );
      expect(result.overallSeverity).toBe("REVIEW_REQUIRED");
      expect(result.operations[0]?.reasons).toHaveLength(1);
    }
  });

  it("C03 classifies security requirement semantic changes as BLOCKING_RISK", () => {
    const result = impact(
      [item({ securityRequirementsSha256: "a".repeat(64) })],
      [item({ securityRequirementsSha256: "b".repeat(64) })],
    );
    expect(result.overallSeverity).toBe("BLOCKING_RISK");
    expect(result.operations[0]?.reasons).toEqual([
      "SECURITY_REQUIREMENTS_CHANGED",
    ]);
  });

  it("A5-10 classifies operationId-only changes as NO_POLICY_IMPACT", () => {
    const result = impact([item()], [item({ operationId: "renamed" })]);
    expect(result.overallSeverity).toBe("NO_POLICY_IMPACT");
    expect(result.noPolicyImpactCount).toBe(1);
  });

  it("A5-11 classifies tag-only changes as NO_POLICY_IMPACT", () => {
    expect(impact([item()], [item({ tags: ["other"] })]).overallSeverity).toBe(
      "NO_POLICY_IMPACT",
    );
  });

  it("A5-12 classifies an added GET as REVIEW_REQUIRED, not safe", () => {
    const result = impact([], [item()]);
    expect(result.overallSeverity).toBe("REVIEW_REQUIRED");
    expect(result.operations[0]?.readPolicyCandidate).toBe("REVIEW_REQUIRED");
  });

  it("A5-13 classifies an added POST as REVIEW_REQUIRED", () => {
    expect(
      impact([], [item({ method: "POST", identity: `${FAMILY}:POST:/items` })])
        .overallSeverity,
    ).toBe("REVIEW_REQUIRED");
  });

  it("A5-14 classifies an unknown field delta as UNKNOWN", () => {
    const base = diffInventories({
      base: inventory([item()]),
      target: inventory([item()], TARGET_SHA),
    });
    const unknown = {
      ...base,
      operations: [
        {
          ...base.operations[0]!,
          state: "CHANGED",
          deltas: [{ field: "unknown" as never, before: 1, after: 2 }],
        },
      ],
    } as SemanticDiff;
    const result = classifyApiImpact(unknown);
    expect(result.overallSeverity).toBe("UNKNOWN");
  });

  it("A5-15 mixed operations use the highest severity", () => {
    const result = impact(
      [item(), item({ path: "/removed", identity: `${FAMILY}:GET:/removed` })],
      [
        item({ operationId: "renamed" }),
        item({ path: "/added", identity: `${FAMILY}:GET:/added` }),
      ],
    );
    expect(result.overallSeverity).toBe("BLOCKING_RISK");
    expect(result.blockingRiskCount).toBe(1);
    expect(result.reviewRequiredCount).toBe(1);
    expect(result.noPolicyImpactCount).toBe(1);
  });

  it("A5-16 never emits an auto-approved READ_POLICY result", () => {
    const result = impact([item()], [item({ operationId: "renamed" })]);
    expect(result.operations[0]?.readPolicyCandidate).toBe("NONE");
    expect(JSON.stringify(result)).not.toContain("AUTO_APPROVED");
    expect(JSON.stringify(result)).not.toContain("AUTO_ENABLED");
  });

  it("A5-17 has no product adapter mutation path", async () => {
    const source = await readFile(
      new URL("./impact.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/adapter|auto.?patch|child_process|eval\s*\(/i);
  });

  it("A5-18 has no Stream-1 execution-authority mutation", async () => {
    const source = await readFile(
      new URL("../../../apps/telegram-operator/src/main.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /executionAuthority|bootstrapAuthority|offlineGrace/,
    );
  });
});
