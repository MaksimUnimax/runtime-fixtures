import { describe, expect, it } from "vitest";
import { InMemoryProductCrosswalkStore } from "./crosswalk.js";
import type { ProductCrosswalkRow } from "./types.js";

function row(
  identity: string,
  options: Partial<ProductCrosswalkRow> = {},
): ProductCrosswalkRow {
  return {
    crosswalkId: "",
    reportId: "report-1",
    sourceFamily: "OZON_SELLER",
    documentKey: null,
    sourceIdentity: identity,
    runtimeAlias: null,
    crosswalkState: "SOURCE_ONLY",
    reviewState: "REVIEW_REQUIRED",
    executionEnabled: null,
    impactSeverity: null,
    diffSha256: null,
    createdAt: new Date("2026-10-23T00:00:00Z"),
    ...options,
  };
}

describe("C03 in-memory product crosswalk persistence", () => {
  it("preserves each row under the generated ID when input IDs are empty", async () => {
    const store = new InMemoryProductCrosswalkStore();
    const saved = await store.saveRows([
      row("OZON_SELLER:GET:/first"),
      row("OZON_SELLER:GET:/second"),
    ]);

    expect(saved).toHaveLength(2);
    expect(saved.map((item) => item.sourceIdentity)).toEqual([
      "OZON_SELLER:GET:/first",
      "OZON_SELLER:GET:/second",
    ]);
    expect(saved.every((item) => item.crosswalkId.length > 0)).toBe(true);
    expect(new Set(saved.map((item) => item.crosswalkId)).size).toBe(2);

    const persisted = await store.listRows("report-1");
    expect(persisted).toHaveLength(2);
    expect(persisted.map((item) => item.sourceIdentity)).toEqual([
      "OZON_SELLER:GET:/first",
      "OZON_SELLER:GET:/second",
    ]);
    expect(new Set(persisted.map((item) => item.crosswalkId))).toEqual(
      new Set(saved.map((item) => item.crosswalkId)),
    );
  });

  it("keeps explicit IDs stable and applies an upsert without extra rows", async () => {
    const store = new InMemoryProductCrosswalkStore();
    const original = row("OZON_SELLER:GET:/fixed", {
      crosswalkId: "explicit-id",
    });
    expect((await store.saveRows([original]))[0]?.crosswalkId).toBe(
      "explicit-id",
    );

    const updated = row("OZON_SELLER:GET:/fixed", {
      crosswalkId: "explicit-id",
      reviewState: "BLOCKING_RISK",
    });
    const returned = await store.saveRows([updated]);
    expect(returned[0]?.crosswalkId).toBe("explicit-id");
    const persisted = await store.listRows("report-1");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.reviewState).toBe("BLOCKING_RISK");
  });

  it("isolates stored dates and returned rows from caller mutation", async () => {
    const store = new InMemoryProductCrosswalkStore();
    const input = row("OZON_SELLER:GET:/independent");
    const saved = await store.saveRows([input]);
    input.createdAt.setUTCFullYear(2030);
    saved[0]!.createdAt.setUTCFullYear(2040);
    saved[0]!.sourceIdentity = "altered";

    const persisted = await store.listRows("report-1");
    expect(persisted[0]?.createdAt.toISOString()).toBe(
      "2026-10-23T00:00:00.000Z",
    );
    expect(persisted[0]?.sourceIdentity).toBe("OZON_SELLER:GET:/independent");
  });
});
