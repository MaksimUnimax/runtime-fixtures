import { describe, expect, it } from "vitest";
import { runApiWatchAcceptance } from "./acceptance.js";
import { extractProductRegistry } from "./product-registry.js";

describe("A10 whole API-watch acceptance", () => {
  it("runs the deterministic A2-A9 fixture pipeline", async () => {
    const result = await runApiWatchAcceptance();
    expect(result.baseInventory.operationCount).toBeGreaterThan(0);
    expect(result.diff.addedCount).toBe(1);
    expect(result.diff.removedCount).toBe(1);
    expect(result.diff.changedCount).toBe(3);
    expect(result.completed.state).toBe("COMPLETED");
    expect(result.retry?.retryCount).toBe(1);
    expect(result.root).not.toContain("runtime-fixtures");
  });
  it("extracts complete current Ozon and WB registries without execution", async () => {
    const [seller, performance, wb] = await Promise.all([
      extractProductRegistry({ sourceFamily: "OZON_SELLER" }),
      extractProductRegistry({ sourceFamily: "OZON_PERFORMANCE" }),
      extractProductRegistry({ sourceFamily: "WILDBERRIES" }),
    ]);
    expect(seller.length).toBeGreaterThan(0);
    expect(performance.length).toBeGreaterThan(0);
    expect(wb.length).toBeGreaterThan(0);
    expect(
      new Set(wb.map((row) => `${row.method}:${row.normalizedPath}`)).size,
    ).toBeLessThanOrEqual(wb.length);
  });
  it("keeps missing production URL authority blocked, incidented, and unretried", async () => {
    const result = await runApiWatchAcceptance();
    expect(result.blocked?.state).toBe("BLOCKED");
    expect(result.blockedIncidents).toHaveLength(3);
    expect(
      result.blockedIncidents.every(
        (incident) => incident.incidentType === "SOURCE_AUTHORITY_BLOCKED",
      ),
    ).toBe(true);
    expect(result.pending).toHaveLength(0);
  });
  it("does not expose raw specifications or executable paths in acceptance evidence", async () => {
    const result = await runApiWatchAcceptance();
    expect(JSON.stringify(result.incidents)).not.toContain("openapi");
    expect(JSON.stringify(result.incidents)).not.toMatch(
      /eval|Function|child_process|TELEGRAM_BOT_TOKEN/,
    );
  });
});
