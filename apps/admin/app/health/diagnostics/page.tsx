"use client";

import Link from "next/link";
import {
  has,
  LoadState,
  Shell,
  Table,
  useAdmin,
  useData,
} from "../../admin-ui";

type StateCount = { state: string; count: number };
type Summary = {
  generatedAt: string;
  window: string;
  windowStart: string;
  windowEnd: string;
  latestHealthObservationAt: string | null;
  stale: boolean;
  currentTargets: Array<{
    provider: string;
    surface: string;
    variant: string;
    browserFamily: string | null;
    browserVersion: string | null;
    observationStatus: string;
    latestHealthState: string | null;
    latestCompletedRunAt: string | null;
    activeIncidentCount: number;
    latestIncidentRoot: string | null;
  }>;
  stateCounts: StateCount[];
  productQualityCounts: StateCount[];
  environmentCounts: StateCount[];
  activeIncidentCount: number;
  notification: Record<string, string | number | null>;
  scheduler: Record<string, string | number | null>;
};
type Breakdown = {
  providerSurface: Array<{
    provider: string;
    surface: string;
    variant: string;
    count: number;
    incidentCount: number;
  }>;
  browsers: Array<{
    browserFamily: string;
    browserVersion: string;
    coverage: string;
    count: number;
    unknownCount: number;
  }>;
  profiles: Array<{
    profileRevisionId: string;
    profileContentSha256: string;
    count: number;
    incidentCount: number;
    h4Evaluations: number;
    h5Evaluations: number;
  }>;
  incidentRoots: Array<{
    rootContourKey: string | null;
    status: string;
    provider: string;
    surface: string;
    activeCount: number;
    newCount: number;
    resolvedCount: number;
  }>;
};

export default function HealthDiagnosticsPage() {
  const { me } = useAdmin();
  const summary = useData<Summary>(
    has(me, "health.read")
      ? "/v1/admin/health/diagnostics/summary?window=24h"
      : null,
  );
  const breakdown = useData<Breakdown>(
    has(me, "health.read")
      ? "/v1/admin/health/diagnostics/breakdown?window=24h"
      : null,
  );
  if (!has(me, "health.read")) return null;
  return (
    <Shell title="Health diagnostics">
      <section className="card">
        <p className="eyebrow">LLM Health · bounded read-only diagnostics</p>
        <p className="muted">
          Window: 24h. Counts are observations or intents created in the
          explicit window; UNKNOWN and missing coverage are not product
          failures.
        </p>
        <p>
          <Link href="/health">← Health operations</Link>
        </p>
        <LoadState
          busy={summary.busy || breakdown.busy}
          error={summary.error || breakdown.error}
        />
        {summary.data && (
          <>
            <p role="status">
              {summary.data.stale
                ? "STALE / NO RECENT HEALTH OBSERVATION"
                : `Fresh through ${summary.data.latestHealthObservationAt ?? "no observation"}`}
            </p>
            <Table
              headers={["State", "Count"]}
              rows={summary.data.stateCounts.map((item) => [
                item.state,
                item.count,
              ])}
            />
            <Table
              headers={[
                "Provider / surface / variant",
                "Observations",
                "Active incidents",
              ]}
              rows={
                breakdown.data?.providerSurface.map((item) => [
                  `${item.provider} / ${item.surface} / ${item.variant}`,
                  item.count,
                  item.incidentCount,
                ]) ?? []
              }
            />
            <Table
              headers={["Target", "State", "Browser", "Observation", "Root"]}
              rows={summary.data.currentTargets.map((item) => [
                `${item.provider} / ${item.surface} / ${item.variant}`,
                `${item.latestHealthState ?? "NO_DATA"} (${item.observationStatus})`,
                item.browserFamily
                  ? `${item.browserFamily} ${item.browserVersion}`
                  : "NOT_COVERED",
                item.latestCompletedRunAt ?? "—",
                item.latestIncidentRoot ?? "—",
              ])}
            />
            <p className="muted">
              Notification queue: {summary.data.notification.pending} pending ·{" "}
              {summary.data.notification.retryableFailures} retryable ·{" "}
              {summary.data.notification.suppressed} suppressed ·{" "}
              {summary.data.notification.delivered} delivered. Scheduler failure
              is shown separately from Health state.
            </p>
          </>
        )}
        {breakdown.data && (
          <>
            <h2>Browser coverage</h2>
            <Table
              headers={["Browser", "Coverage", "Observations", "UNKNOWN"]}
              rows={breakdown.data.browsers.map((item) => [
                `${item.browserFamily} ${item.browserVersion}`,
                item.coverage,
                item.count,
                item.unknownCount,
              ])}
            />
            <h2>Profile revisions (observational)</h2>
            <Table
              headers={[
                "Revision",
                "Content SHA-256",
                "Observations",
                "Incidents",
                "H4 / H5",
              ]}
              rows={breakdown.data.profiles.map((item) => [
                item.profileRevisionId,
                item.profileContentSha256,
                item.count,
                item.incidentCount,
                `${item.h4Evaluations} / ${item.h5Evaluations}`,
              ])}
            />
            <h2>Incident roots</h2>
            <Table
              headers={[
                "Root",
                "Status",
                "Provider / surface",
                "Active",
                "New",
                "Resolved",
              ]}
              rows={breakdown.data.incidentRoots.map((item) => [
                item.rootContourKey ?? "UNCLASSIFIED",
                item.status,
                `${item.provider} / ${item.surface}`,
                item.activeCount,
                item.newCount,
                item.resolvedCount,
              ])}
            />
          </>
        )}
      </section>
    </Shell>
  );
}
