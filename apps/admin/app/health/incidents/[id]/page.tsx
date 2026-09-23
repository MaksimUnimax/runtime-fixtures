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

type Incident = {
  id: string;
  provider: string;
  surface: string;
  variant: string;
  browserFamily: string;
  status: string;
  rootContourKey: string | null;
  firstSeenRunId: string;
  latestSeenRunId: string;
  lastObservedRunId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastObservedAt: string;
  resolvedAt: string | null;
};
export default function IncidentPage() {
  const { me } = useAdmin();
  const { id } = useParams<{ id: string }>();
  const result = useData<Incident>(
    has(me, "health.read") ? `/v1/admin/health/incidents/${id}` : null,
  );
  if (!has(me, "health.read")) return null;
  return (
    <Shell title="Health incident">
      <p>
        <Link href="/health">← Health targets</Link>
      </p>
      <LoadState busy={result.busy} error={result.error} />
      {result.data && (
        <section className="card">
          <h2>
            {result.data.provider} / {result.data.surface} /{" "}
            {result.data.variant}
          </h2>
          <Table
            headers={[
              "Status",
              "Browser",
              "Root contour",
              "First seen",
              "Last observed",
              "Recovery",
            ]}
            rows={[
              [
                result.data.status,
                result.data.browserFamily,
                result.data.rootContourKey ?? "—",
                result.data.firstSeenAt,
                result.data.lastObservedAt,
                result.data.resolvedAt ?? "Not resolved",
              ],
            ]}
          />
          <p>
            Incident lifecycle remains Health authority. A candidate evaluation
            does not resolve a production incident.
          </p>
        </section>
      )}
    </Shell>
  );
}
