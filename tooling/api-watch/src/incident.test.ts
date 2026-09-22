import { describe, expect, it, vi } from "vitest";
import { evaluateApiWatchIncidents, InMemoryApiWatchIncidentStore } from "./incident.js";
import type { ApiWatchReport } from "./types.js";

function report(state: ApiWatchReport["state"], source = "SOURCE_URL_AUTHORITY_MISSING"): ApiWatchReport {
  return { reportId: "r", runSource: "SCHEDULED", createdAt: new Date(0), startedAt: new Date(0), completedAt: new Date(1), state, sources: [{ sourceFamily: "OZON_SELLER", acquisitionOutcome: source, authorityStatus: null, snapshotSha256: null, inventoryOperationCount: null, baseSnapshotSha256: null, diffSha256: null, impactSeverity: null, blockerCode: source, errorCode: null, changeMode: null, addedCount: null, removedCount: null, changedCount: null, unchangedCount: null, blockingRiskCount: null, reviewRequiredCount: null, unknownCount: null, noPolicyImpactCount: null }], addedCount: 0, removedCount: 0, changedCount: 0, unchangedCount: 0, blockingRiskCount: 0, reviewRequiredCount: 0, unknownCount: 0, noPolicyImpactCount: 0, overallImpactSeverity: null };
}

describe("A8 durable incidents", () => {
  it("deduplicates open source blockers and notifies once", async () => {
    const store = new InMemoryApiWatchIncidentStore(); const notify = vi.fn().mockResolvedValue(undefined);
    await evaluateApiWatchIncidents({ report: report("BLOCKED"), store, notifier: notify, now: new Date(1) });
    await evaluateApiWatchIncidents({ report: report("BLOCKED"), store, notifier: notify, now: new Date(2) });
    const open = await store.listOpen();
    expect(open).toHaveLength(1); expect(open[0]?.occurrenceCount).toBe(2); expect(notify).toHaveBeenCalledTimes(1);
  });
  it("opens one incident for each missing source family", async () => {
    const base = report("BLOCKED");
    base.sources = (['OZON_SELLER', 'OZON_PERFORMANCE', 'WILDBERRIES'] as const).map((sourceFamily) => ({ ...base.sources[0]!, sourceFamily }));
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({ report: base, store });
    expect(await store.listOpen()).toHaveLength(3);
  });
  it("does not resolve operation incidents from partial or blocked observations", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({ report: report("COMPLETED"), store, crosswalkRows: [{ crosswalkId: "x", reportId: "r", sourceFamily: "OZON_SELLER", sourceIdentity: "OZON_SELLER:GET:/x", runtimeAlias: null, crosswalkState: "SOURCE_ONLY", reviewState: "REVIEW_REQUIRED", executionEnabled: null, impactSeverity: null, diffSha256: "d", createdAt: new Date() }] });
    const open = (await store.listOpen()).filter((item) => item.incidentType === "RUNTIME_OPERATION_STALE"); expect(open).toHaveLength(1);
    await evaluateApiWatchIncidents({ report: report("BLOCKED"), store });
    expect((await store.find(open[0]!.incidentKey))?.state).toBe("OPEN");
  });
  it("resolves stale incidents only on complete comparable evidence", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const row = { crosswalkId: "x", reportId: "r", sourceFamily: "OZON_SELLER" as const, sourceIdentity: "OZON_SELLER:GET:/x", runtimeAlias: null, crosswalkState: "SOURCE_ONLY" as const, reviewState: "REVIEW_REQUIRED" as const, executionEnabled: null, impactSeverity: null, diffSha256: "d", createdAt: new Date() };
    await evaluateApiWatchIncidents({ report: report("COMPLETED"), store, crosswalkRows: [row] });
    await evaluateApiWatchIncidents({ report: { ...report("COMPLETED", "OK"), sources: [{ ...report("COMPLETED", "OK").sources[0]!, blockerCode: null, acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" }] }, store, notifier: async () => undefined });
    expect((await store.listOpen()).filter((item) => item.incidentType === "RUNTIME_OPERATION_STALE")).toHaveLength(0);
  });
});
