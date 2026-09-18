"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Cursor,
  has,
  LoadState,
  Shell,
  Table,
  useAdmin,
  useData,
  withCursor,
} from "../admin-ui";

type Target = {
  targetId: string;
  provider: string;
  surface: string;
  variant: string;
  browserFamily: string;
  browserVersion: string;
  latestHealthState: string | null;
  latestObservationAt: string | null;
  latestSuccessfulRunAt: string | null;
  activeIncidentId: string | null;
  baselineProfileRevisionId: string | null;
  candidateProfileRevisionId: string | null;
  candidateState: string;
  latestH4Result: string | null;
  latestH5Result: string | null;
  recommendation: string | null;
};
type Page = { items: Target[]; nextCursor: string | null };

export default function HealthPage() {
  const { me } = useAdmin();
  const [path, setPath] = useState("/v1/admin/health/targets?limit=25");
  const result = useData<Page>(has(me, "health.read") ? path : null);
  if (!has(me, "health.read")) return null;
  return (
    <Shell title="Health operations">
      <section className="card">
        <p className="eyebrow">Read-only monitoring view</p>
        <p className="muted">
          Health observations, incidents, profile evaluations, and advisory
          recommendations. This page cannot publish, roll out, pause, rollback,
          or apply restrictions.
        </p>
        <LoadState busy={result.busy} error={result.error} />
        {result.data && result.data.items.length === 0 && (
          <p role="status">No Health targets are available.</p>
        )}
        {result.data && result.data.items.length > 0 && (
          <Table
            headers={[
              "Target",
              "State",
              "Last observation",
              "Incident",
              "Baseline / candidate",
              "H4 / H5",
              "Recommendation",
            ]}
            rows={result.data.items.map((target) => [
              <Link
                key={target.targetId}
                href={`/health/${target.targetId}`}
              >{`${target.provider} / ${target.surface} / ${target.variant}`}</Link>,
              `${target.latestHealthState ?? "—"} (${target.browserFamily} ${target.browserVersion})`,
              target.latestObservationAt ?? "—",
              target.activeIncidentId ? (
                <Link href={`/health/incidents/${target.activeIncidentId}`}>
                  Active
                </Link>
              ) : (
                "None"
              ),
              `${target.baselineProfileRevisionId ?? "—"} / ${target.candidateProfileRevisionId ?? "NO_CANDIDATE"}`,
              `${target.latestH4Result ?? "—"} / ${target.latestH5Result ?? "—"}`,
              target.recommendation ?? "—",
            ])}
          />
        )}
        {result.data?.nextCursor && (
          <Cursor
            cursor={result.data.nextCursor}
            onNext={() =>
              setPath(
                withCursor(
                  "/v1/admin/health/targets?limit=25",
                  result.data!.nextCursor!,
                ),
              )
            }
          />
        )}
      </section>
    </Shell>
  );
}
