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
} from "../../admin-ui";

type Detail = {
  targetId: string;
  provider: string;
  surface: string;
  variant: string;
  browserFamily: string;
  browserVersion: string;
  latestHealthState: string | null;
  latestObservationAt: string | null;
  latestSuccessfulRunAt: string | null;
  baselineProfile: {
    id: string;
    revision: number;
    state: string;
    contentSha256: string;
    role: string;
  } | null;
  candidateProfile: {
    id: string;
    revision: number;
    state: string;
    contentSha256: string;
    role: string;
  } | null;
  contourStatuses: { contourKey: string; outcome: string }[];
  evidenceReferences: {
    evidenceId: string;
    ruleId: string;
    classification: string;
    sha256: string | null;
  }[];
  activeIncident: {
    id: string;
    status: string;
    rootContourKey: string | null;
    firstSeenAt: string;
    lastObservedAt: string;
  } | null;
  evaluations: {
    id: string;
    phase: string;
    outcome: string;
    recommendation: string | null;
    currentAuthority: boolean;
    latestEvaluatedAt: string;
  }[];
  healthRecommendation: {
    recommendation: string;
    executionAuthority: false;
  } | null;
};

export default function HealthTargetPage() {
  const { me } = useAdmin();
  const params = useParams<{ targetId: string }>();
  const result = useData<Detail>(
    has(me, "health.read")
      ? `/v1/admin/health/targets/${params.targetId}`
      : null,
  );
  if (!has(me, "health.read")) return null;
  return (
    <Shell title="Health target detail">
      <p>
        <Link href="/health">← Health targets</Link>
      </p>
      <LoadState busy={result.busy} error={result.error} />
      {result.data && (
        <>
          <section className="card">
            <h2>
              {result.data.provider} / {result.data.surface} /{" "}
              {result.data.variant}
            </h2>
            <p>
              {result.data.latestHealthState ?? "No completed observation"} ·{" "}
              {result.data.browserFamily} {result.data.browserVersion}
            </p>
            <p>
              Last observation: {result.data.latestObservationAt ?? "—"};
              scheduled success: {result.data.latestSuccessfulRunAt ?? "—"}
            </p>
          </section>
          <section className="card">
            <h2>Current and candidate</h2>
            <Table
              headers={["Role", "Revision", "State", "Content fingerprint"]}
              rows={[
                result.data.baselineProfile
                  ? [
                      "CURRENT BASELINE",
                      result.data.baselineProfile.revision,
                      result.data.baselineProfile.state,
                      result.data.baselineProfile.contentSha256,
                    ]
                  : ["CURRENT BASELINE", "—", "NOT_AVAILABLE", "—"],
                result.data.candidateProfile
                  ? [
                      "CANDIDATE",
                      result.data.candidateProfile.revision,
                      result.data.candidateProfile.state,
                      result.data.candidateProfile.contentSha256,
                    ]
                  : ["CANDIDATE", "NO_CANDIDATE", "—", "—"],
              ]}
            />
          </section>
          <section className="card">
            <h2>Evaluations and recommendation</h2>
            <Table
              headers={[
                "Phase",
                "Outcome",
                "Recommendation",
                "Authority",
                "Completed",
              ]}
              rows={result.data.evaluations.map((item) => [
                item.phase,
                item.outcome,
                item.recommendation ?? "—",
                item.currentAuthority ? "CURRENT" : "STALE/HISTORICAL",
                item.latestEvaluatedAt,
              ])}
            />
            <p>
              Health recommendation:{" "}
              {result.data.healthRecommendation?.recommendation ?? "—"}{" "}
              (executionAuthority=
              {String(
                result.data.healthRecommendation?.executionAuthority ?? false,
              )}
              )
            </p>
          </section>
          <section className="card">
            <h2>Incident and safe evidence</h2>
            <p>
              {result.data.activeIncident
                ? `${result.data.activeIncident.status}; root contour ${result.data.activeIncident.rootContourKey ?? "—"}`
                : "No active incident"}
            </p>
            <Table
              headers={["Evidence ID", "Rule", "Classification", "Hash"]}
              rows={result.data.evidenceReferences.map((item) => [
                item.evidenceId,
                item.ruleId,
                item.classification,
                item.sha256 ?? "—",
              ])}
            />
          </section>
        </>
      )}
    </Shell>
  );
}
