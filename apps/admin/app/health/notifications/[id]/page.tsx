"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  has,
  LoadState,
  Shell,
  Table,
  useAdmin,
  useData,
} from "../../../admin-ui";

type Detail = {
  id: string;
  incidentId: string;
  eventKind: string;
  severity: string;
  state: string;
  routeKey: string;
  groupCount: number;
  attemptCount: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  suppressionReason: string | null;
  firstObservedAt: string;
  latestObservedAt: string;
  cooldownUntil: string;
  createdAt: string;
  updatedAt: string;
  lastProviderResultCode: string | null;
  providerSink: string | null;
  provider: string;
  surface: string;
  dedupIdentity: { scheme: string; eventKind: string; severity: string };
  claim: { state: string; leaseExpiresAt: string | null; attempt: number };
  sourceHealth: {
    healthRunId: string;
    healthState: string;
    healthLevel: string;
    browserFamily: string;
    browserVersion: string;
    variant: string;
  };
  incident: {
    id: string;
    provider: string;
    surface: string;
    variant: string;
    status: string;
    rootContourKey: string | null;
    firstSeenAt: string;
    lastObservedAt: string;
    resolvedAt: string | null;
  };
  evidenceReferences: {
    evidenceId: string;
    ruleId: string;
    classification: string;
    sha256: string | null;
    sizeBytes: number | null;
  }[];
  retention: { retentionClass: string; expiresAt: string | null };
};

export default function HealthNotificationDetailPage() {
  const { me, loading } = useAdmin();
  const { id } = useParams<{ id: string }>();
  const result = useData<Detail>(
    !loading && has(me, "health.read")
      ? `/v1/admin/health/notifications/${id}`
      : null,
  );
  if (loading)
    return (
      <Shell title="Health notification">
        <p role="status">Loading admin access…</p>
      </Shell>
    );
  if (!me || !has(me, "health.read"))
    return (
      <Shell title="Health notification">
        <p role="alert">Forbidden: Health read permission is required.</p>
      </Shell>
    );
  return (
    <Shell title="Health notification detail">
      <p>
        <Link href="/health/notifications">← Health notifications</Link>
      </p>
      <LoadState busy={result.busy} error={result.error} />
      {result.data && (
        <>
          <section className="card">
            <h2>
              {result.data.eventKind} · {result.data.severity}
            </h2>
            <Table
              headers={[
                "State",
                "Route",
                "Provider / surface",
                "Sink",
                "Result",
              ]}
              rows={[
                [
                  result.data.state,
                  result.data.routeKey,
                  `${result.data.provider} / ${result.data.surface}`,
                  result.data.providerSink ?? "Not selected",
                  result.data.lastProviderResultCode ?? "Not attempted",
                ],
              ]}
            />
          </section>
          <section className="card">
            <h2>Grouping, cooldown, and delivery</h2>
            <Table
              headers={[
                "Grouped observations",
                "Observed window",
                "Cooldown",
                "Attempts",
                "Next retry",
                "Delivered",
              ]}
              rows={[
                [
                  result.data.groupCount,
                  `${result.data.firstObservedAt} → ${result.data.latestObservedAt}`,
                  result.data.cooldownUntil,
                  `${result.data.attemptCount} (${result.data.claim.state})`,
                  result.data.nextAttemptAt,
                  result.data.deliveredAt ?? "Not delivered",
                ],
              ]}
            />
            <p>
              Suppression reason: {result.data.suppressionReason ?? "None"}
              {result.data.claim.leaseExpiresAt
                ? `; lease expires ${result.data.claim.leaseExpiresAt}`
                : ""}
            </p>
          </section>
          <section className="card">
            <h2>Source Health and incident</h2>
            <p>
              Health run {result.data.sourceHealth.healthRunId}:{" "}
              {result.data.sourceHealth.healthState} /{" "}
              {result.data.sourceHealth.healthLevel}; {result.data.provider} /{" "}
              {result.data.sourceHealth.variant}
            </p>
            <p>
              <Link href={`/health/incidents/${result.data.incident.id}`}>
                Incident {result.data.incident.id}
              </Link>{" "}
              remains Health-owned: {result.data.incident.status}; resolved at{" "}
              {result.data.incident.resolvedAt ?? "not resolved"}.
            </p>
            <Table
              headers={[
                "Evidence ID",
                "Rule",
                "Classification",
                "Hash",
                "Size",
              ]}
              rows={result.data.evidenceReferences.map((item) => [
                item.evidenceId,
                item.ruleId,
                item.classification,
                item.sha256 ?? "—",
                item.sizeBytes ?? "—",
              ])}
            />
          </section>
          <section className="card">
            <h2>Retention and identity</h2>
            <p>
              Dedup scheme: {result.data.dedupIdentity.scheme}; retention:{" "}
              {result.data.retention.retentionClass}; expires:{" "}
              {result.data.retention.expiresAt ?? "No expiry configured"}.
            </p>
            <p>
              Created {result.data.createdAt}; updated {result.data.updatedAt}.
              No delivery, retry, suppression, or route actions are available
              from this view.
            </p>
          </section>
        </>
      )}
    </Shell>
  );
}
