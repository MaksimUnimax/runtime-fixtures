import type {
  MonitoringLaneRunner,
  MonitoringRunResult,
} from "@product/monitoring-control";
import { evaluateOperatorCandidate, runAuthorityPass } from "./authority.js";
import { diffInventories } from "./diff.js";
import { classifyApiImpact } from "./impact.js";
import { promoteAcceptedSnapshot, readAcceptedSnapshot } from "./snapshot.js";
import { buildCompleteOperationInventory } from "./inventory.js";
import type {
  ApiWatchDependencies,
  ApiWatchReportSourceOutcome,
  AuthorityPassResult,
  SemanticDiff,
} from "./types.js";

function resultFromAuthorityPass(
  pass: AuthorityPassResult,
): MonitoringRunResult {
  if (
    pass.outcomes.some(
      (outcome) => outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
    )
  )
    return {
      status: "SUCCEEDED",
      code: "API_SOURCE_CANDIDATE_ACQUIRED",
      summary: `API-watch completed ${pass.outcomes.length} source-family checks.`,
    };
  if (
    pass.outcomes.some((outcome) => outcome.kind === "OPERATOR_SOURCE_REQUIRED")
  )
    return {
      status: "SOURCE_UNAVAILABLE",
      code: "OPERATOR_SOURCE_REQUIRED",
      summary:
        "API-watch created or retained a bounded operator source request.",
    };
  if (
    pass.outcomes.some(
      (outcome) => outcome.kind === "SOURCE_TEMPORARILY_UNAVAILABLE",
    )
  )
    return {
      status: "NOT_OBSERVABLE",
      code: "API_SOURCE_TEMPORARILY_UNAVAILABLE",
      summary: "API-watch encountered a bounded transient source condition.",
    };
  if (
    pass.outcomes.every(
      (outcome) => outcome.kind === "SOURCE_URL_AUTHORITY_MISSING",
    )
  )
    return {
      status: "NOT_OBSERVABLE",
      code: "SOURCE_URL_AUTHORITY_MISSING",
      summary:
        "API-watch has no accepted official URL authority for the monitored families.",
    };
  return {
    status: "FAILED",
    code: "INVALID_OFFICIAL_SOURCE_RESPONSE",
    summary: "API-watch rejected one or more official source responses safely.",
  };
}

export function createApiWatchRunner(
  dependencies: ApiWatchDependencies,
): MonitoringLaneRunner {
  return async (run) => {
    const reportStore = dependencies.reportStore;
    if (!reportStore) {
      const pass = await runAuthorityPass(dependencies);
      return resultFromAuthorityPass(pass);
    }
    return runApiWatchReport({
      dependencies: { ...dependencies, reportStore },
      runId: run.runId,
      source: run.source,
    });
  };
}

function currentTime(dependencies: ApiWatchDependencies): Date {
  return (dependencies.clock ?? (() => new Date()))();
}

function extensionFor(
  outcome: Extract<
    AuthorityPassResult["outcomes"][number],
    { kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" }
  >,
): string {
  return `.${outcome.artifactType.toLowerCase()}`;
}

function reportResult(
  state: "COMPLETED" | "PARTIAL" | "BLOCKED" | "FAILED",
): MonitoringRunResult {
  if (state === "COMPLETED")
    return {
      status: "SUCCEEDED",
      code: "API_WATCH_REPORT_COMPLETED",
      summary: "API-watch report completed.",
    };
  if (state === "PARTIAL")
    return {
      status: "NOT_OBSERVABLE",
      code: "API_WATCH_REPORT_PARTIAL",
      summary: "API-watch report completed with blocked source families.",
    };
  if (state === "BLOCKED")
    return {
      status: "NOT_OBSERVABLE",
      code: "API_WATCH_REPORT_BLOCKED",
      summary: "API-watch report was blocked by source authority conditions.",
    };
  return {
    status: "FAILED",
    code: "API_WATCH_REPORT_FAILED",
    summary: "API-watch report failed safely.",
  };
}

async function analyzeAcceptedOutcome(input: {
  dependencies: ApiWatchDependencies;
  outcome: Extract<
    AuthorityPassResult["outcomes"][number],
    { kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" }
  >;
  record: AuthorityPassResult["records"][number];
  previousSnapshots: Awaited<
    ReturnType<ApiWatchDependencies["store"]["listSnapshots"]>
  >;
}): Promise<ApiWatchReportSourceOutcome> {
  const { dependencies, outcome, record, previousSnapshots } = input;
  const now = currentTime(dependencies);
  const snapshot = await promoteAcceptedSnapshot({
    record,
    bytes: outcome.bytes,
    store: dependencies.store,
    snapshotRoot: dependencies.snapshotRoot,
    now: () => now,
  });
  const filename = `accepted${extensionFor(outcome)}`;
  const inventory = buildCompleteOperationInventory({
    sourceFamily: outcome.sourceFamily,
    snapshotSha256: snapshot.sha256,
    bytes: outcome.bytes,
    filename,
  });
  await dependencies.store.saveInventory(inventory);
  const previous = previousSnapshots
    .filter((candidate) => candidate.sourceFamily === outcome.sourceFamily)
    .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())[0];
  if (!previous)
    return {
      sourceFamily: outcome.sourceFamily,
      acquisitionOutcome: outcome.kind,
      authorityStatus: record.authorityStatus,
      snapshotSha256: snapshot.sha256,
      inventoryOperationCount: inventory.operationCount,
      baseSnapshotSha256: null,
      diffSha256: null,
      impactSeverity: null,
      blockerCode: null,
      errorCode: null,
      changeMode: "FIRST_SNAPSHOT",
      addedCount: null,
      removedCount: null,
      changedCount: null,
      unchangedCount: null,
      blockingRiskCount: null,
      reviewRequiredCount: null,
      unknownCount: null,
      noPolicyImpactCount: null,
    };
  if (previous.sha256 === snapshot.sha256)
    return {
      sourceFamily: outcome.sourceFamily,
      acquisitionOutcome: outcome.kind,
      authorityStatus: record.authorityStatus,
      snapshotSha256: snapshot.sha256,
      inventoryOperationCount: inventory.operationCount,
      baseSnapshotSha256: previous.sha256,
      diffSha256: null,
      impactSeverity: null,
      blockerCode: null,
      errorCode: null,
      changeMode: "NO_CHANGE",
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      blockingRiskCount: 0,
      reviewRequiredCount: 0,
      unknownCount: 0,
      noPolicyImpactCount: 0,
    };
  const previousBytes = await readAcceptedSnapshot(previous);
  const previousInventory =
    (await dependencies.store.findInventory(
      previous.sourceFamily,
      previous.sha256,
    )) ??
    buildCompleteOperationInventory({
      sourceFamily: previous.sourceFamily,
      snapshotSha256: previous.sha256,
      bytes: previousBytes,
      filename: previous.artifactPath.endsWith(".yaml")
        ? "previous.yaml"
        : previous.artifactPath.endsWith(".yml")
          ? "previous.yml"
          : "previous.json",
    });
  const diff: SemanticDiff = diffInventories({
    base: previousInventory,
    target: inventory,
    createdAt: now,
  });
  await dependencies.store.saveSemanticDiff(diff);
  const impact = classifyApiImpact(diff);
  return {
    sourceFamily: outcome.sourceFamily,
    acquisitionOutcome: outcome.kind,
    authorityStatus: record.authorityStatus,
    snapshotSha256: snapshot.sha256,
    inventoryOperationCount: inventory.operationCount,
    baseSnapshotSha256: previous.sha256,
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
  };
}

function blockedOutcome(
  outcome: AuthorityPassResult["outcomes"][number],
  record: AuthorityPassResult["records"][number] | undefined,
): ApiWatchReportSourceOutcome {
  return {
    sourceFamily: outcome.sourceFamily,
    acquisitionOutcome: outcome.kind,
    authorityStatus: record?.authorityStatus ?? null,
    snapshotSha256: null,
    inventoryOperationCount: null,
    baseSnapshotSha256: null,
    diffSha256: null,
    impactSeverity: null,
    blockerCode: outcome.kind,
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
  };
}

function reportCounts(sources: ApiWatchReportSourceOutcome[]) {
  const sum = (
    field: keyof Pick<
      ApiWatchReportSourceOutcome,
      | "addedCount"
      | "removedCount"
      | "changedCount"
      | "unchangedCount"
      | "blockingRiskCount"
      | "reviewRequiredCount"
      | "unknownCount"
      | "noPolicyImpactCount"
    >,
  ) => sources.reduce((total, source) => total + (source[field] ?? 0), 0);
  return {
    addedCount: sum("addedCount"),
    removedCount: sum("removedCount"),
    changedCount: sum("changedCount"),
    unchangedCount: sum("unchangedCount"),
    blockingRiskCount: sum("blockingRiskCount"),
    reviewRequiredCount: sum("reviewRequiredCount"),
    unknownCount: sum("unknownCount"),
    noPolicyImpactCount: sum("noPolicyImpactCount"),
    overallImpactSeverity: sources.some(
      (source) => source.impactSeverity === "BLOCKING_RISK",
    )
      ? "BLOCKING_RISK"
      : sources.some((source) => source.impactSeverity === "REVIEW_REQUIRED")
        ? "REVIEW_REQUIRED"
        : sources.some((source) => source.impactSeverity === "UNKNOWN")
          ? "UNKNOWN"
          : sources.some(
                (source) => source.impactSeverity === "NO_POLICY_IMPACT",
              )
            ? "NO_POLICY_IMPACT"
            : null,
  } as const;
}

export async function runApiWatchReport(input: {
  dependencies: ApiWatchDependencies & {
    reportStore: NonNullable<ApiWatchDependencies["reportStore"]>;
  };
  runId: string;
  source: "SCHEDULED" | "FORCED";
}): Promise<MonitoringRunResult> {
  const { dependencies, runId, source } = input;
  const reportStore = dependencies.reportStore;
  const now = currentTime(dependencies);
  const report = await reportStore.createReport({
    reportId: `api-watch:${runId}`,
    runSource: source,
    createdAt: now,
  });
  await reportStore.transitionReport({
    reportId: report.reportId,
    state: "RUNNING",
    at: now,
  });
  try {
    const previousSnapshots = await dependencies.store.listSnapshots();
    const pass = await runAuthorityPass({
      ...dependencies,
      now: dependencies.clock,
    });
    const sources: ApiWatchReportSourceOutcome[] = [];
    for (const [index, outcome] of pass.outcomes.entries()) {
      const record = pass.records[index];
      if (outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" && record) {
        sources.push(
          await analyzeAcceptedOutcome({
            dependencies,
            outcome,
            record,
            previousSnapshots,
          }),
        );
      } else {
        sources.push(blockedOutcome(outcome, record));
      }
    }
    const usable = sources.filter(
      (sourceOutcome) => sourceOutcome.snapshotSha256 !== null,
    ).length;
    const state =
      usable === pass.outcomes.length
        ? "COMPLETED"
        : usable > 0
          ? "PARTIAL"
          : "BLOCKED";
    await reportStore.transitionReport({
      reportId: report.reportId,
      state,
      at: currentTime(dependencies),
      sources,
      counts: reportCounts(sources),
    });
    return reportResult(state);
  } catch {
    await reportStore.transitionReport({
      reportId: report.reportId,
      state: "FAILED",
      at: currentTime(dependencies),
      counts: { overallImpactSeverity: null },
    });
    return reportResult("FAILED");
  }
}

export function createApiWatchRuntime(dependencies: ApiWatchDependencies) {
  return {
    runAuthorityPass: () => runAuthorityPass(dependencies),
    evaluateOperatorCandidate: (requestId: string) =>
      evaluateOperatorCandidate({
        requestId,
        registry: dependencies.registry,
        pendingStore: dependencies.pendingStore,
        store: dependencies.store,
        quarantineDir:
          dependencies.quarantineDir ??
          process.env.SWAGGER_QUARANTINE_DIR ??
          "/var/lib/octoport/api-watch/quarantine",
        now: dependencies.clock,
      }),
  };
}
