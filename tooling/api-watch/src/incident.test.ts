import { describe, expect, it, vi } from "vitest";
import {
  evaluateApiWatchIncidents,
  InMemoryApiWatchIncidentStore,
} from "./incident.js";
import type { ApiWatchReport } from "./types.js";

function report(
  state: ApiWatchReport["state"],
  source = "SOURCE_URL_AUTHORITY_MISSING",
): ApiWatchReport {
  return {
    reportId: "r",
    runSource: "SCHEDULED",
    createdAt: new Date(0),
    startedAt: new Date(0),
    completedAt: new Date(1),
    state,
    sources: [
      {
        sourceFamily: "OZON_SELLER",
        acquisitionOutcome: source,
        authorityStatus: null,
        snapshotSha256: null,
        inventoryOperationCount: null,
        baseSnapshotSha256: null,
        diffSha256: null,
        impactSeverity: null,
        blockerCode: source,
        errorCode: null,
        changeMode: null,
        addedCount: null,
        removedCount: null,
        changedCount: null,
        unchangedCount: null,
        blockingRiskCount: null,
        reviewRequiredCount: null,
        unknownCount: null,
        noPolicyImpactCount: null,
      },
    ],
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    blockingRiskCount: 0,
    reviewRequiredCount: 0,
    unknownCount: 0,
    noPolicyImpactCount: 0,
    overallImpactSeverity: null,
  };
}

describe("A8 durable incidents", () => {
  it("deduplicates open source blockers and notifies once", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const notify = vi.fn().mockResolvedValue(undefined);
    await evaluateApiWatchIncidents({
      report: report("BLOCKED"),
      store,
      notifier: notify,
      now: new Date(1),
    });
    await evaluateApiWatchIncidents({
      report: report("BLOCKED"),
      store,
      notifier: notify,
      now: new Date(2),
    });
    const open = await store.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]?.occurrenceCount).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("opens one incident for each missing source family", async () => {
    const base = report("BLOCKED");
    base.sources = (
      ["OZON_SELLER", "OZON_PERFORMANCE", "WILDBERRIES"] as const
    ).map((sourceFamily) => ({ ...base.sources[0]!, sourceFamily }));
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({ report: base, store });
    expect(await store.listOpen()).toHaveLength(3);
  });
  it("does not resolve operation incidents from partial or blocked observations", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({
      report: report("COMPLETED"),
      store,
      crosswalkRows: [
        {
          crosswalkId: "x",
          reportId: "r",
          sourceFamily: "OZON_SELLER",
          sourceIdentity: "OZON_SELLER:GET:/x",
          runtimeAlias: null,
          crosswalkState: "SOURCE_ONLY",
          reviewState: "REVIEW_REQUIRED",
          executionEnabled: null,
          impactSeverity: null,
          diffSha256: "d",
          createdAt: new Date(),
        },
      ],
    });
    const open = (await store.listOpen()).filter(
      (item) => item.incidentType === "RUNTIME_OPERATION_STALE",
    );
    expect(open).toHaveLength(1);
    await evaluateApiWatchIncidents({ report: report("BLOCKED"), store });
    expect((await store.find(open[0]!.incidentKey))?.state).toBe("OPEN");
  });
  it("keeps operation incidents open without accepted repair evidence", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const row = {
      crosswalkId: "x",
      reportId: "r",
      sourceFamily: "OZON_SELLER" as const,
      sourceIdentity: "OZON_SELLER:GET:/x",
      runtimeAlias: null,
      crosswalkState: "SOURCE_ONLY" as const,
      reviewState: "REVIEW_REQUIRED" as const,
      executionEnabled: null,
      impactSeverity: null,
      diffSha256: "d",
      createdAt: new Date(),
    };
    await evaluateApiWatchIncidents({
      report: report("COMPLETED"),
      store,
      crosswalkRows: [row],
    });
    await evaluateApiWatchIncidents({
      report: {
        ...report("COMPLETED", "OK"),
        sources: [
          {
            ...report("COMPLETED", "OK").sources[0]!,
            blockerCode: null,
            acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
          },
        ],
      },
      store,
      notifier: async () => undefined,
    });
    expect(
      (await store.listOpen()).filter(
        (item) => item.incidentType === "RUNTIME_OPERATION_STALE",
      ),
    ).toHaveLength(1);
  });
});

function comparableReport(): ApiWatchReport {
  const value = report("COMPLETED", "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
  value.reportId = "comparable";
  value.sources[0] = {
    ...value.sources[0]!,
    authorityStatus: "AUTHORITY_ACCEPTED",
    snapshotSha256: "a".repeat(64),
    baseSnapshotSha256: "a".repeat(64),
    blockerCode: null,
    errorCode: "PRODUCT_BASELINE_REPOSITORY_UNAVAILABLE",
    changeMode: "NO_CHANGE",
    inventoryOperationCount: 1,
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    unchangedCount: 1,
  };
  return value;
}

describe("operation recovery requires accepted compatibility evidence", () => {
  const cases = [
    ["MAPPED_ENABLED", "BLOCKING_RISK", "API_CHANGE_BLOCKING"],
    ["MAPPED_ENABLED", "REVIEW_REQUIRED", "API_CHANGE_REVIEW_REQUIRED"],
    ["SOURCE_ONLY", "REVIEW_REQUIRED", "RUNTIME_OPERATION_STALE"],
    [
      "AMBIGUOUS_RUNTIME_MAPPING",
      "REVIEW_REQUIRED",
      "RUNTIME_MAPPING_AMBIGUOUS",
    ],
  ] as const;

  it.each(cases)(
    "keeps %s/%s open after a repeated snapshot and a NO_ACTION mapping",
    async (crosswalkState, reviewState, incidentType) => {
      const store = new InMemoryApiWatchIncidentStore();
      const notify = vi.fn().mockResolvedValue(undefined);
      const row = {
        crosswalkId: "operation-row",
        reportId: "changed",
        sourceFamily: "OZON_SELLER" as const,
        sourceIdentity: "OZON_SELLER:GET:/x",
        runtimeAlias: "seller_info",
        crosswalkState,
        reviewState,
        executionEnabled: true,
        impactSeverity: reviewState,
        diffSha256: "d".repeat(64),
        createdAt: new Date(1),
      };
      const changed = comparableReport();
      changed.reportId = "changed";
      changed.sources[0]!.changeMode = "CHANGED";
      await evaluateApiWatchIncidents({
        report: changed,
        crosswalkRows: [row],
        store,
        notifier: notify,
        now: new Date(1),
      });
      const original = (await store.listOpen())[0]!;
      expect(original.incidentType).toBe(incidentType);

      // After the first acquisition, the same still-breaking document produces
      // no fresh diff. Neither this nor a mapping row proves deployed recovery.
      for (const crosswalkRows of [
        [],
        [
          {
            ...row,
            crosswalkState: "MAPPED_ENABLED" as const,
            reviewState: "NO_ACTION" as const,
          },
        ],
      ]) {
        await evaluateApiWatchIncidents({
          report: comparableReport(),
          crosswalkRows,
          store,
          notifier: notify,
          now: new Date(2),
        });
        expect(await store.find(original.incidentKey)).toEqual(original);
      }
      expect(await store.listOpen()).toHaveLength(1);
      expect(notify.mock.calls.map(([event]) => event.kind)).toEqual([
        "OPENED",
      ]);
    },
  );

  it("resolves product incidents after a verified return to the accepted baseline", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const notify = vi.fn().mockResolvedValue(undefined);
    const changed = comparableReport();
    changed.reportId = "changed";
    changed.sources[0]!.changeMode = "CHANGED";
    await evaluateApiWatchIncidents({
      report: changed,
      store,
      notifier: notify,
      crosswalkRows: [
        {
          crosswalkId: "return-row",
          reportId: "changed",
          sourceFamily: "OZON_SELLER",
          sourceIdentity: "OZON_SELLER:GET:/x",
          runtimeAlias: "seller_info",
          crosswalkState: "MAPPED_ENABLED",
          reviewState: "BLOCKING_RISK",
          executionEnabled: true,
          impactSeverity: "BLOCKING_RISK",
          diffSha256: "d".repeat(64),
          createdAt: new Date(1),
        },
      ],
      now: new Date(1),
    });
    expect(await store.listOpen()).toHaveLength(1);

    const recovered = comparableReport();
    recovered.reportId = "restored";
    recovered.sources[0]!.errorCode = null;
    await evaluateApiWatchIncidents({
      report: recovered,
      store,
      notifier: notify,
      now: new Date(2),
    });

    expect(await store.listOpen()).toHaveLength(0);
    expect(notify.mock.calls.map(([event]) => event.kind)).toEqual([
      "OPENED",
      "RESOLVED",
    ]);
  });

  it("does not resolve a product incident when one document in the family is uncertain", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const changed = comparableReport();
    changed.reportId = "changed";
    changed.sources[0]!.changeMode = "CHANGED";
    await evaluateApiWatchIncidents({
      report: changed,
      store,
      crosswalkRows: [
        {
          crosswalkId: "multi-doc-row",
          reportId: "changed",
          sourceFamily: "OZON_SELLER",
          sourceIdentity: "OZON_SELLER:GET:/x",
          runtimeAlias: "seller_info",
          crosswalkState: "MAPPED_ENABLED",
          reviewState: "BLOCKING_RISK",
          executionEnabled: true,
          impactSeverity: "BLOCKING_RISK",
          diffSha256: "d".repeat(64),
          createdAt: new Date(1),
        },
      ],
    });

    const recovered = comparableReport();
    recovered.sources[0]!.documentKey = "public";
    recovered.sources[0]!.errorCode = null;
    recovered.sources.push({
      ...recovered.sources[0]!,
      documentKey: "private",
      errorCode: "PRODUCT_BASELINE_MISSING",
    });
    await evaluateApiWatchIncidents({ report: recovered, store });
    expect(await store.listOpen()).toHaveLength(1);
  });

  it("does not use a completed report for another family as operation recovery", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({
      report: comparableReport(),
      store,
      crosswalkRows: [
        {
          crosswalkId: "x",
          reportId: "r",
          sourceFamily: "OZON_SELLER",
          sourceIdentity: "OZON_SELLER:GET:/x",
          runtimeAlias: null,
          crosswalkState: "SOURCE_ONLY",
          reviewState: "REVIEW_REQUIRED",
          executionEnabled: null,
          impactSeverity: null,
          diffSha256: "d".repeat(64),
          createdAt: new Date(1),
        },
      ],
    });
    const otherFamily = comparableReport();
    otherFamily.sources[0]!.sourceFamily = "WILDBERRIES";
    await evaluateApiWatchIncidents({ report: otherFamily, store });
    expect(await store.listOpen()).toHaveLength(1);
  });
});

describe("acquisition recovery remains automatic", () => {
  it("closes only the actually recovered source family and notifies once", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const notify = vi.fn().mockResolvedValue(undefined);
    const blocked = report("BLOCKED");
    blocked.sources.push({
      ...blocked.sources[0]!,
      sourceFamily: "WILDBERRIES",
    });
    await evaluateApiWatchIncidents({
      report: blocked,
      store,
      notifier: notify,
    });
    await evaluateApiWatchIncidents({
      report: comparableReport(),
      store,
      notifier: notify,
    });
    await evaluateApiWatchIncidents({
      report: comparableReport(),
      store,
      notifier: notify,
    });
    expect((await store.listOpen()).map((x) => x.sourceFamily)).toEqual([
      "WILDBERRIES",
    ]);
    expect(
      notify.mock.calls.filter(([event]) => event.kind === "RESOLVED"),
    ).toHaveLength(1);
  });

  it("does not treat an unaccepted snapshot as source recovery", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    await evaluateApiWatchIncidents({ report: report("BLOCKED"), store });
    const unaccepted = comparableReport();
    unaccepted.sources[0]!.authorityStatus = null;
    await evaluateApiWatchIncidents({ report: unaccepted, store });
    expect(await store.listOpen()).toHaveLength(1);
  });

  it("closes a failed watch only after a completed report", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const failed = comparableReport();
    failed.state = "FAILED";
    await evaluateApiWatchIncidents({ report: failed, store });
    const partial = comparableReport();
    partial.state = "PARTIAL";
    await evaluateApiWatchIncidents({ report: partial, store });
    expect((await store.listOpen())[0]?.incidentType).toBe("WATCH_RUN_FAILED");
    await evaluateApiWatchIncidents({ report: comparableReport(), store });
    expect(await store.listOpen()).toHaveLength(0);
  });
});
