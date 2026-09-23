import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { InMemorySwaggerSourceStore } from "@product/monitoring-control";
import { createApiWatchRunner } from "./run.js";
import {
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
} from "./authority.js";
import { promoteAcceptedSnapshot } from "./snapshot.js";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";
import { classifyApiImpact } from "./impact.js";
import { InMemoryApiWatchReportStore } from "./report.js";
import {
  buildProductCrosswalk,
  extractProductRegistry,
} from "./product-registry.js";
import { InMemoryProductCrosswalkStore } from "./crosswalk.js";
import {
  evaluateApiWatchIncidents,
  InMemoryApiWatchIncidentStore,
} from "./incident.js";
import { applyRetryDecision, InMemoryApiWatchRetryStore } from "./retry.js";
import { createSourceRegistry } from "./source-registry.js";
import type { AuthorityRecord } from "./types.js";

function spec(target: boolean): Uint8Array {
  const paths: Record<string, unknown> = {
    "/same": {
      get: { operationId: "same", responses: { "200": { description: "ok" } } },
    },
    "/rename": {
      get: {
        operationId: target ? "renamed" : "old",
        responses: { "200": { description: "ok" } },
      },
    },
    "/secure": {
      get: {
        operationId: "secure",
        ...(target ? { security: [{ bearerAuth: [] }] } : {}),
        responses: { "200": { description: "ok" } },
      },
    },
    "/body": {
      post: {
        operationId: "body",
        ...(target ? { requestBody: { required: true } } : {}),
        responses: target
          ? { "200": { description: "ok" }, "201": { description: "created" } }
          : { "200": { description: "ok" } },
      },
    },
  };
  if (!target)
    paths["/removed"] = {
      delete: {
        operationId: "removed",
        responses: { "204": { description: "gone" } },
      },
    };
  if (target)
    paths["/added"] = {
      get: {
        operationId: "added",
        responses: { "200": { description: "ok" } },
      },
    };
  return new TextEncoder().encode(
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "fixture", version: "1" },
      paths,
    }),
  );
}

function acceptedRecord(
  family: "OZON_SELLER",
  bytes: Uint8Array,
  at: Date,
  id: string,
): AuthorityRecord {
  return {
    recordId: id,
    sourceFamily: family,
    officialUrl: "https://fixture.invalid/api.json",
    acquisitionMode: "AUTOMATIC",
    authorityStatus: "AUTHORITY_ACCEPTED",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    specVersion: "3.0.3",
    acquiredAt: at,
    validatedAt: at,
    operatorRequestId: null,
    artifactExtension: ".json",
    safeProvenance: { source: "fixture" },
    failureClassification: null,
  };
}

export async function runApiWatchAcceptance() {
  const root = await mkdtemp(join(tmpdir(), "octoport-api-watch-acceptance-"));
  const state = createInMemoryApiWatchState();
  const store = new InMemoryApiWatchStore(state);
  const at = new Date("2026-09-22T00:00:00.000Z");
  const baseBytes = spec(false);
  const targetBytes = spec(true);
  const baseRecord = acceptedRecord(
    "OZON_SELLER",
    baseBytes,
    at,
    "base-record",
  );
  const targetRecord = acceptedRecord(
    "OZON_SELLER",
    targetBytes,
    at,
    "target-record",
  );
  const baseSnapshot = await promoteAcceptedSnapshot({
    record: baseRecord,
    bytes: baseBytes,
    store,
    snapshotRoot: root,
    now: () => at,
  });
  const targetSnapshot = await promoteAcceptedSnapshot({
    record: targetRecord,
    bytes: targetBytes,
    store,
    snapshotRoot: root,
    now: () => at,
  });
  const baseInventory = buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: baseSnapshot.sha256,
    bytes: baseBytes,
    filename: "base.json",
  });
  const targetInventory = buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: targetSnapshot.sha256,
    bytes: targetBytes,
    filename: "target.json",
  });
  const diff = diffInventories({
    base: baseInventory,
    target: targetInventory,
    createdAt: at,
  });
  const impact = classifyApiImpact(diff);
  const runtimeEntries = await extractProductRegistry({
    sourceFamily: "OZON_SELLER",
  });
  const crosswalk = buildProductCrosswalk({
    reportId: "acceptance-report",
    inventory: targetInventory,
    runtimeEntries,
    impact,
    diffSha256: diff.diffSha256,
    createdAt: at,
  });
  const crosswalkStore = new InMemoryProductCrosswalkStore();
  await crosswalkStore.saveRows(crosswalk.rows);
  const reports = new InMemoryApiWatchReportStore();
  const report = await reports.createReport({
    reportId: "acceptance-report",
    runSource: "FORCED",
    createdAt: at,
  });
  await reports.transitionReport({
    reportId: report.reportId,
    state: "RUNNING",
    at,
  });
  const completed = await reports.transitionReport({
    reportId: report.reportId,
    state: "COMPLETED",
    at,
    sources: [
      {
        sourceFamily: "OZON_SELLER",
        acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
        authorityStatus: "AUTHORITY_ACCEPTED",
        snapshotSha256: targetSnapshot.sha256,
        inventoryOperationCount: targetInventory.operationCount,
        baseSnapshotSha256: baseSnapshot.sha256,
        diffSha256: diff.diffSha256,
        impactSeverity: impact.overallSeverity,
        blockerCode: null,
        errorCode: null,
        changeMode: "CHANGED",
        addedCount: diff.addedCount,
        removedCount: diff.removedCount,
        changedCount: diff.changedCount,
        unchangedCount: diff.unchangedCount,
        blockingRiskCount: impact.blockingRiskCount,
        reviewRequiredCount: impact.reviewRequiredCount,
        unknownCount: impact.unknownCount,
        noPolicyImpactCount: impact.noPolicyImpactCount,
      },
    ],
    counts: {
      addedCount: diff.addedCount,
      removedCount: diff.removedCount,
      changedCount: diff.changedCount,
      unchangedCount: diff.unchangedCount,
      overallImpactSeverity: impact.overallSeverity,
    },
  });
  const incidents = new InMemoryApiWatchIncidentStore();
  await evaluateApiWatchIncidents({
    report: completed,
    crosswalkRows: crosswalk.rows,
    store: incidents,
    now: at,
  });
  const retries = new InMemoryApiWatchRetryStore();
  const retry = await applyRetryDecision({
    sourceFamily: "OZON_SELLER",
    outcome: {
      kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://fixture.invalid/api.json",
      blockerReason: "fixture timeout",
    },
    store: retries,
    now: at,
  });
  const blockedReports = new InMemoryApiWatchReportStore();
  const blockedIncidents = new InMemoryApiWatchIncidentStore();
  const pending = new InMemorySwaggerSourceStore();
  const blockedRegistry = createSourceRegistry({
    OZON_SELLER: { officialUrl: null, documents: [] },
    OZON_PERFORMANCE: { officialUrl: null, documents: [] },
    WILDBERRIES: { officialUrl: null, documents: [] },
  });
  const blockedRunner = createApiWatchRunner({
    registry: blockedRegistry,
    store: new InMemoryApiWatchStore(),
    pendingStore: pending,
    reportStore: blockedReports,
    incidentStore: blockedIncidents,
    clock: () => at,
  });
  await blockedRunner({
    runId: "blocked-run",
    source: "SCHEDULED",
    lane: "SWAGGER_API",
  });
  const blocked = await blockedReports.getReport("api-watch:blocked-run");
  return {
    root,
    baseSnapshot,
    targetSnapshot,
    baseInventory,
    targetInventory,
    diff,
    impact,
    crosswalk,
    completed,
    incidents: await incidents.listOpen(),
    retry,
    blocked,
    blockedIncidents: await blockedIncidents.listOpen(),
    pending: await pending.listPending(at),
  };
}
