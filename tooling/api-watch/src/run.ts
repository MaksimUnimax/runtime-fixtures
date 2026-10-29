import { completeOperatorPipeline } from "./operator-receipt.js";
import type {
  MonitoringCoverage,
  MonitoringLaneRunner,
  MonitoringRunResult,
  SwaggerSourceFamily,
} from "@product/monitoring-control";
import { evaluateOperatorCandidate, runAuthorityPass } from "./authority.js";
import { diffInventories } from "./diff.js";
import { classifyApiImpact } from "./impact.js";
import { promoteAcceptedSnapshot, readAcceptedSnapshot } from "./snapshot.js";
import { buildCompleteOperationInventory } from "./inventory.js";
import { evaluateApiWatchIncidents } from "./incident.js";
import {
  buildProductCrosswalk,
  inventoryIdentity,
  extractProductRegistry,
} from "./product-registry.js";
import { applyRetryPassDecisions } from "./retry.js";
import type {
  ApiWatchDependencies,
  ApiWatchImpact,
  ApiWatchReport,
  ApiWatchReportSourceOutcome,
  AuthorityPassResult,
  OperationInventory,
  SemanticDiff,
} from "./types.js";

function sourceTarget(
  sourceFamily: string,
  documentKey: string | null | undefined,
): string {
  return documentKey ? `${sourceFamily}:${documentKey}` : sourceFamily;
}

function maxChangeSeverity(
  sources: readonly ApiWatchReportSourceOutcome[],
): MonitoringCoverage["changeSeverity"] {
  const severities = sources.map((source) => source.impactSeverity);
  if (severities.includes("BLOCKING_RISK")) return "BLOCKING_RISK";
  if (severities.includes("REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (severities.includes("UNKNOWN")) return "UNKNOWN";
  if (severities.includes("NO_POLICY_IMPACT")) return "NO_POLICY_IMPACT";
  return null;
}

function coverageFromReportSources(
  sources: readonly ApiWatchReportSourceOutcome[],
  observedAt: Date,
): MonitoringCoverage {
  const testedTargets: string[] = [];
  const unverifiedTargets: string[] = [];
  for (const source of sources) {
    const target = sourceTarget(source.sourceFamily, source.documentKey);
    const productCompared =
      source.authorityStatus === "AUTHORITY_ACCEPTED" &&
      source.errorCode === null &&
      source.snapshotSha256 !== null &&
      source.baseSnapshotSha256 !== null &&
      (source.changeMode === "CHANGED" || source.changeMode === "NO_CHANGE");
    (productCompared ? testedTargets : unverifiedTargets).push(target);
  }
  const uniqueTested = [...new Set(testedTargets)].sort();
  const uniqueUnverified = [...new Set(unverifiedTargets)]
    .filter((target) => !uniqueTested.includes(target))
    .sort();
  return {
    observedAt: observedAt.toISOString(),
    checkDepth: "API_DOCUMENT_COMPARISON",
    testedTargets: uniqueTested,
    unverifiedTargets: uniqueUnverified,
    comparisonState:
      uniqueTested.length > 0 && uniqueUnverified.length === 0
        ? "COMPLETED"
        : uniqueTested.length > 0
          ? "PARTIAL"
          : "NOT_RUN",
    changeSeverity: maxChangeSeverity(sources),
  };
}

function coverageFromAuthorityPass(
  pass: AuthorityPassResult,
): MonitoringCoverage {
  const testedTargets: string[] = [];
  const unverifiedTargets: string[] = [];
  for (const outcome of pass.outcomes) {
    const target = sourceTarget(outcome.sourceFamily, outcome.documentKey);
    (outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
      ? testedTargets
      : unverifiedTargets
    ).push(target);
  }
  const observedAt = pass.records.reduce<Date | null>((latest, record) => {
    const current = new Date(record.validatedAt);
    return !latest || current.valueOf() > latest.valueOf() ? current : latest;
  }, null);
  return {
    observedAt: observedAt?.toISOString() ?? null,
    checkDepth: "API_SOURCE_ACQUISITION",
    testedTargets: [...new Set(testedTargets)].sort(),
    unverifiedTargets: [...new Set(unverifiedTargets)].sort(),
    comparisonState: "NOT_RUN",
    changeSeverity: null,
  };
}

function resultFromAuthorityPass(
  pass: AuthorityPassResult,
): MonitoringRunResult {
  const coverage = coverageFromAuthorityPass(pass);
  if (
    pass.outcomes.some(
      (outcome) => outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
    )
  )
    return {
      status: "SUCCEEDED",
      code: "API_SOURCE_CANDIDATE_ACQUIRED",
      summary: `API-watch completed ${pass.outcomes.length} source-family checks.`,
      coverage,
    };
  if (
    pass.outcomes.some((outcome) => outcome.kind === "OPERATOR_SOURCE_REQUIRED")
  )
    return {
      status: "SOURCE_UNAVAILABLE",
      code: "OPERATOR_SOURCE_REQUIRED",
      summary:
        "API-watch created or retained a bounded operator source request.",
      coverage,
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
      coverage,
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
      coverage,
    };
  return {
    status: "FAILED",
    code: "INVALID_OFFICIAL_SOURCE_RESPONSE",
    summary: "API-watch rejected one or more official source responses safely.",
    coverage,
  };
}

export function createApiWatchRunner(
  dependencies: ApiWatchDependencies,
): MonitoringLaneRunner {
  return async (run) => {
    const reportStore = dependencies.reportStore;
    if (!reportStore) {
      const pass = await runAuthorityPass({
        ...dependencies,
        skipOperatorBlocked: run.source === "SCHEDULED",
      });
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

type CrosswalkDocument = {
  inventory: OperationInventory;
  impact?: ApiWatchImpact;
  diffSha256?: string | null;
  createdAt: Date;
};

async function persistProductCrosswalks(input: {
  dependencies: ApiWatchDependencies;
  reportId: string;
  documents: CrosswalkDocument[];
  sources: ApiWatchReportSourceOutcome[];
}): Promise<string[]> {
  const verifiedFamilyAbsenceRowIds: string[] = [];
  const crosswalkStore = input.dependencies.crosswalkStore;
  if (!crosswalkStore) return verifiedFamilyAbsenceRowIds;
  const families = new Set(
    input.documents.map((doc) => doc.inventory.sourceFamily),
  );
  for (const sourceFamily of families) {
    const documents = input.documents.filter(
      (doc) => doc.inventory.sourceFamily === sourceFamily,
    );
    const sources = input.sources.filter(
      (source) => source.sourceFamily === sourceFamily,
    );
    // A failed acquisition or missing/invalid baseline is unknown coverage,
    // never proof that an operation is absent from the provider's documents.
    const complete =
      sources.length === documents.length &&
      sources.every(
        (source) =>
          source.authorityStatus === "AUTHORITY_ACCEPTED" &&
          source.blockerCode === null &&
          source.errorCode === null &&
          (source.changeMode === "NO_CHANGE" ||
            source.changeMode === "CHANGED"),
      );
    const familySourceIdentities = new Set(
      documents.flatMap((doc) =>
        doc.inventory.operations.map(inventoryIdentity),
      ),
    );
    const runtimeEntries = await extractProductRegistry({ sourceFamily });
    for (const [index, document] of documents.entries()) {
      const crosswalk = buildProductCrosswalk({
        ...document,
        reportId: input.reportId,
        runtimeEntries,
        familySourceIdentities,
        // Emit a truly missing operation once, with family-level provenance.
        includeRuntimeOnly: complete && index === 0,
      });
      await crosswalkStore.saveRows(crosswalk.rows);
      if (complete && index === 0) {
        verifiedFamilyAbsenceRowIds.push(
          ...crosswalk.rows
            .filter(
              (row) =>
                row.crosswalkState === "RUNTIME_ONLY" &&
                row.documentKey === null,
            )
            .map((row) => row.crosswalkId),
        );
      }
    }
  }
  return verifiedFamilyAbsenceRowIds;
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
  coverage?: MonitoringCoverage,
): MonitoringRunResult {
  if (state === "COMPLETED")
    return {
      status: "SUCCEEDED",
      code: "API_WATCH_REPORT_COMPLETED",
      summary: "API-watch report completed.",
      ...(coverage ? { coverage } : {}),
    };
  if (state === "PARTIAL")
    return {
      status: "NOT_OBSERVABLE",
      code: "API_WATCH_REPORT_PARTIAL",
      summary: "API-watch report completed with blocked source families.",
      ...(coverage ? { coverage } : {}),
    };
  if (state === "BLOCKED")
    return {
      status: "NOT_OBSERVABLE",
      code: "API_WATCH_REPORT_BLOCKED",
      summary: "API-watch report was blocked by source authority conditions.",
      ...(coverage ? { coverage } : {}),
    };
  return {
    status: "FAILED",
    code: "API_WATCH_REPORT_FAILED",
    summary: "API-watch report failed safely.",
    ...(coverage ? { coverage } : {}),
  };
}

function postcommitUnknownResult(
  options: {
    confirmedReport?: boolean;
    coverage?: MonitoringCoverage;
  } = {},
): MonitoringRunResult {
  return {
    status: "FAILED",
    // Telegram maps the older postcommit code to "report was saved".
    // Use a different code when the terminal commit itself is unverified.
    code: options.confirmedReport
      ? "API_WATCH_POSTCOMMIT_OUTCOME_UNKNOWN"
      : "API_WATCH_REPORT_COMMIT_UNKNOWN",
    summary: options.confirmedReport
      ? "API-watch report was saved, but a later monitoring step failed; its outcome is unknown."
      : "API-watch report completion or later monitoring actions could not be confirmed; their outcome is unknown.",
    ...(options.coverage ? { coverage: options.coverage } : {}),
  };
}

// Verify exactly the report and terminal state this run attempted, not just
// any truthy row returned by a store or injected readback adapter.
function isConfirmedTerminalReceipt(
  report: ApiWatchReport | undefined,
  reportId: string,
  expectedState: "COMPLETED" | "PARTIAL" | "BLOCKED",
): report is ApiWatchReport & { completedAt: Date } {
  return (
    report !== undefined &&
    report.reportId === reportId &&
    report.state === expectedState &&
    report.completedAt instanceof Date &&
    Number.isFinite(report.completedAt.valueOf())
  );
}

async function analyzeAcceptedOutcome(input: {
  dependencies: ApiWatchDependencies;
  reportId: string;
  crosswalkDocuments: CrosswalkDocument[];
  outcome: Extract<
    AuthorityPassResult["outcomes"][number],
    { kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" }
  >;
  record: AuthorityPassResult["records"][number];
  previousSnapshots: Awaited<
    ReturnType<ApiWatchDependencies["store"]["listSnapshots"]>
  >;
  /** Fired only after snapshot+inventory persistence returns an ACK. */
  onSnapshotAccepted?: (sha256: string, operationCount: number) => void;
}): Promise<ApiWatchReportSourceOutcome> {
  const { dependencies, outcome, record, previousSnapshots } = input;
  const now = currentTime(dependencies);
  const documentKey = outcome.documentKey ?? null;
  // Validate the semantic inventory before publishing accepted snapshot
  // metadata. An unresolved Path Item reference must not create a partial
  // accepted snapshot that has no corresponding inventory.
  const filename = `accepted${extensionFor(outcome)}`;
  const inventory = buildCompleteOperationInventory({
    sourceFamily: outcome.sourceFamily,
    documentKey,
    snapshotSha256: outcome.sha256,
    bytes: outcome.bytes,
    filename,
  });
  const snapshot = await promoteAcceptedSnapshot({
    record,
    bytes: outcome.bytes,
    store: dependencies.store,
    inventory,
    snapshotRoot: dependencies.snapshotRoot,
    documentKey,
    now: () => now,
  });
  // An ACK here is the first reliable evidence that this exact snapshot and
  // inventory are accepted. Keep it even if later baseline/diff work fails.
  input.onSnapshotAccepted?.(snapshot.sha256, inventory.operationCount);
  const baseline = dependencies.productBaselineRepository
    ? await dependencies.productBaselineRepository.read({
        sourceFamily: outcome.sourceFamily,
        documentKey,
      })
    : undefined;
  const baselineUncertainty = baseline
    ? null
    : dependencies.productBaselineRepository
      ? "PRODUCT_BASELINE_MISSING"
      : "PRODUCT_BASELINE_REPOSITORY_UNAVAILABLE";
  const previous = baseline
    ? previousSnapshots.find(
        (candidate) => candidate.snapshotId === baseline.snapshotId,
      )
    : previousSnapshots
        .filter(
          (candidate) =>
            candidate.sourceFamily === outcome.sourceFamily &&
            (candidate.documentKey ?? null) === documentKey,
        )
        .sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())[0];
  if (
    baseline &&
    (!previous ||
      previous.sourceFamily !== baseline.sourceFamily ||
      (previous.documentKey ?? null) !== baseline.documentKey ||
      previous.sha256 !== baseline.snapshotSha256 ||
      previous.specVersion !== baseline.snapshotSpecVersion)
  )
    return {
      sourceFamily: outcome.sourceFamily,
      documentKey,
      acquisitionOutcome: outcome.kind,
      authorityStatus: record.authorityStatus,
      snapshotSha256: snapshot.sha256,
      inventoryOperationCount: inventory.operationCount,
      baseSnapshotSha256: baseline.snapshotSha256,
      diffSha256: null,
      impactSeverity: "UNKNOWN",
      blockerCode: null,
      errorCode: "PRODUCT_BASELINE_REFERENCE_INVALID",
      changeMode: null,
      addedCount: null,
      removedCount: null,
      changedCount: null,
      unchangedCount: null,
      blockingRiskCount: 0,
      reviewRequiredCount: 0,
      unknownCount: 1,
      noPolicyImpactCount: 0,
    };
  if (!previous)
    return {
      sourceFamily: outcome.sourceFamily,
      documentKey,
      acquisitionOutcome: outcome.kind,
      authorityStatus: record.authorityStatus,
      snapshotSha256: snapshot.sha256,
      inventoryOperationCount: inventory.operationCount,
      baseSnapshotSha256: null,
      diffSha256: null,
      impactSeverity: null,
      blockerCode: null,
      errorCode: baselineUncertainty,
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
  if (previous.sha256 === snapshot.sha256) {
    if (baseline) input.crosswalkDocuments.push({ inventory, createdAt: now });
    return {
      sourceFamily: outcome.sourceFamily,
      documentKey,
      acquisitionOutcome: outcome.kind,
      authorityStatus: record.authorityStatus,
      snapshotSha256: snapshot.sha256,
      inventoryOperationCount: inventory.operationCount,
      baseSnapshotSha256: previous.sha256,
      diffSha256: null,
      impactSeverity: null,
      blockerCode: null,
      errorCode: baselineUncertainty,
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
  }
  const previousBytes = await readAcceptedSnapshot(previous);
  // Compare both accepted byte sets with the same normalization rules. Cached
  // inventories may have been produced before a semantic fingerprint repair.
  const previousInventory = buildCompleteOperationInventory({
    sourceFamily: previous.sourceFamily,
    documentKey: previous.documentKey ?? null,
    snapshotSha256: previous.sha256,
    bytes: previousBytes,
    filename: previous.artifactPath.endsWith(".yaml")
      ? "previous.yaml"
      : previous.artifactPath.endsWith(".yml")
        ? "previous.yml"
        : "previous.json",
  });
  await dependencies.store.saveInventory(previousInventory);
  const diff: SemanticDiff = diffInventories({
    base: previousInventory,
    target: inventory,
    createdAt: now,
  });
  await dependencies.store.saveSemanticDiff(diff);
  const impact = classifyApiImpact(diff);
  if (baseline)
    input.crosswalkDocuments.push({
      inventory,
      impact,
      diffSha256: diff.diffSha256,
      createdAt: now,
    });
  return {
    sourceFamily: outcome.sourceFamily,
    documentKey,
    acquisitionOutcome: outcome.kind,
    authorityStatus: record.authorityStatus,
    snapshotSha256: snapshot.sha256,
    inventoryOperationCount: inventory.operationCount,
    baseSnapshotSha256: previous.sha256,
    diffSha256: diff.diffSha256,
    impactSeverity: impact.overallSeverity,
    blockerCode: null,
    errorCode: baselineUncertainty,
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
    documentKey: outcome.documentKey ?? null,
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
  /** Only a validated run-bound retry owner may provide selected families. */
  sourceFamilies?: readonly SwaggerSourceFamily[];
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
  let terminalStateAttempted: "COMPLETED" | "PARTIAL" | "BLOCKED" | null = null;
  // An irreversible acquisition can ACK a snapshot before later semantic
  // analysis throws. Preserve the observed identities for a durable FAILED.
  let observedPass: AuthorityPassResult | undefined;
  const observedSources: ApiWatchReportSourceOutcome[] = [];
  try {
    const previousSnapshots = await dependencies.store.listSnapshots();
    const pass = await runAuthorityPass({
      ...dependencies,
      now: dependencies.clock,
      skipOperatorBlocked: input.source === "SCHEDULED",
      sourceFamilies: input.sourceFamilies,
    });
    observedPass = pass;
    const sources = observedSources;
    const crosswalkDocuments: CrosswalkDocument[] = [];
    for (const [index, outcome] of pass.outcomes.entries()) {
      const record = pass.records[index];
      if (outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" && record) {
        sources[index] = await analyzeAcceptedOutcome({
          dependencies,
          reportId: report.reportId,
          crosswalkDocuments,
          outcome,
          record,
          previousSnapshots,
          onSnapshotAccepted: (sha256, operationCount) => {
            // Do not label an accepted snapshot as absent if a later semantic
            // comparison throws. Comparison evidence is UNKNOWN, not success.
            sources[index] = {
              ...blockedOutcome(outcome, record),
              snapshotSha256: sha256,
              inventoryOperationCount: operationCount,
              blockerCode: null,
              errorCode: "SOURCE_ANALYSIS_INCOMPLETE",
              impactSeverity: "UNKNOWN",
              unknownCount: 1,
            };
          },
        });
      } else {
        sources[index] = blockedOutcome(outcome, record);
      }
    }
    const verifiedFamilyAbsenceRowIds = await persistProductCrosswalks({
      dependencies,
      reportId: report.reportId,
      documents: crosswalkDocuments,
      sources,
    });
    const usable = sources.filter(
      (sourceOutcome) =>
        sourceOutcome.snapshotSha256 !== null &&
        sourceOutcome.errorCode !== "PRODUCT_BASELINE_REFERENCE_INVALID",
    ).length;
    const state =
      pass.outcomes.length > 0 && usable === pass.outcomes.length
        ? "COMPLETED"
        : usable > 0
          ? "PARTIAL"
          : "BLOCKED";
    const completedAt = currentTime(dependencies);
    terminalStateAttempted = state;
    await reportStore.transitionReport({
      reportId: report.reportId,
      state,
      at: completedAt,
      sources,
      counts: reportCounts(sources),
    });
    const completedReport = await reportStore.getReport(report.reportId);
    // Do not run notification/retry/operator effects or report success
    // without an exact, finite terminal receipt for this run.
    if (!isConfirmedTerminalReceipt(completedReport, report.reportId, state))
      return postcommitUnknownResult();
    const crosswalkRows = dependencies.crosswalkStore
      ? await dependencies.crosswalkStore.listRows(report.reportId)
      : undefined;
    if (completedReport && dependencies.incidentStore)
      await evaluateApiWatchIncidents({
        report: completedReport,
        crosswalkRows,
        verifiedFamilyAbsenceRowIds,
        store: dependencies.incidentStore,
        notifier: dependencies.incidentNotifier,
        now: currentTime(dependencies),
      });
    if (dependencies.retryStore)
      await applyRetryPassDecisions({
        outcomes: pass.outcomes,
        store: dependencies.retryStore,
        scheduleEarlier: dependencies.scheduleEarlier,
        now: currentTime(dependencies),
      });
    if (pass.operatorCandidate)
      await completeOperatorPipeline({
        candidate: pass.operatorCandidate,
        reportId: report.reportId,
        store: dependencies.store,
        reportStore,
        quarantineDir:
          dependencies.quarantineDir ??
          process.env.SWAGGER_QUARANTINE_DIR ??
          "/var/lib/octoport/api-watch/quarantine",
      });
    return reportResult(state, coverageFromReportSources(sources, completedAt));
  } catch {
    // An awaited terminal transition might have committed before its ACK.
    // Recovery must validate the same durable terminal receipt as the
    // successful path, without replaying uncertain side effects.
    let persisted;
    try {
      persisted = await reportStore.getReport(report.reportId);
    } catch {
      return terminalStateAttempted !== null
        ? postcommitUnknownResult()
        : reportResult("FAILED");
    }
    if (persisted?.state === "RUNNING" && terminalStateAttempted === null) {
      const recordedPass = observedPass;
      const failedSources = recordedPass
        ? recordedPass.outcomes.map(
            (outcome, index) =>
              observedSources[index] ??
              blockedOutcome(outcome, recordedPass.records[index]),
          )
        : [];
      // Preserve the actual source observations, even when a completed
      // analysis could not be produced. Never fabricate accepted comparison.
      try {
        await reportStore.transitionReport({
          reportId: report.reportId,
          state: "FAILED",
          at: currentTime(dependencies),
          sources: failedSources,
          counts: reportCounts(failedSources),
        });
      } catch {
        // A FAILED transition may also commit before its ACK; no blind retry.
        return postcommitUnknownResult();
      }
      let failed;
      try {
        failed = await reportStore.getReport(report.reportId);
      } catch {
        return postcommitUnknownResult();
      }
      if (
        !failed ||
        failed.reportId !== report.reportId ||
        failed.state !== "FAILED" ||
        !(failed.completedAt instanceof Date) ||
        !Number.isFinite(failed.completedAt.valueOf())
      )
        return postcommitUnknownResult();
      if (dependencies.incidentStore) {
        try {
          await evaluateApiWatchIncidents({
            report: failed,
            store: dependencies.incidentStore,
            notifier: dependencies.incidentNotifier,
            now: currentTime(dependencies),
          });
        } catch {
          // The FAILED report is durable, but any incident transport result
          // is unknown. Do not downgrade the recorded source observations.
          return {
            ...reportResult("FAILED"),
            summary: "API-watch report failed; incident delivery is unknown.",
          };
        }
      }
      return reportResult("FAILED");
    }
    if (
      terminalStateAttempted !== null &&
      isConfirmedTerminalReceipt(
        persisted,
        report.reportId,
        terminalStateAttempted,
      )
    )
      return postcommitUnknownResult({
        confirmedReport: true,
        coverage: coverageFromReportSources(
          persisted.sources,
          persisted.completedAt,
        ),
      });
    if (
      terminalStateAttempted !== null ||
      persisted?.state === "COMPLETED" ||
      persisted?.state === "PARTIAL" ||
      persisted?.state === "BLOCKED"
    )
      return postcommitUnknownResult();
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
