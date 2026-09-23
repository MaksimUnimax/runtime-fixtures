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
} from "../../admin-ui";

type Notification = {
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
};
type Page = { items: Notification[]; nextCursor: string | null };

export default function HealthNotificationsPage() {
  const { me, loading } = useAdmin();
  const [path, setPath] = useState("/v1/admin/health/notifications?limit=25");
  const result = useData<Page>(
    !loading && has(me, "health.read") ? path : null,
  );
  if (loading)
    return (
      <Shell title="Health notifications">
        <p role="status">Loading admin access…</p>
      </Shell>
    );
  if (!me || !has(me, "health.read"))
    return (
      <Shell title="Health notifications">
        <p role="alert">Forbidden: Health read permission is required.</p>
      </Shell>
    );
  return (
    <Shell title="Health notifications">
      <p>
        <Link href="/health">← Health operations</Link>
      </p>
      <section className="card">
        <p className="eyebrow">Read-only operational visibility</p>
        <p className="muted">
          LLM Health notification intent and delivery state. Current sinks are
          deterministic test or disabled sinks; no external destination is shown
          or implied.
        </p>
        <LoadState busy={result.busy} error={result.error} />
        {result.data && result.data.items.length === 0 && (
          <p role="status">No LLM Health notification intents are available.</p>
        )}
        {result.data && result.data.items.length > 0 && (
          <Table
            headers={[
              "Event",
              "State / severity",
              "Incident",
              "Provider / surface",
              "Grouping",
              "Delivery",
              "Suppression",
            ]}
            rows={result.data.items.map((item) => [
              <Link key={item.id} href={`/health/notifications/${item.id}`}>
                {item.eventKind}
              </Link>,
              `${item.state} / ${item.severity}`,
              <Link
                key={`${item.id}-incident`}
                href={`/health/incidents/${item.incidentId}`}
              >
                {item.incidentId}
              </Link>,
              `${item.provider} / ${item.surface}`,
              `${item.groupCount} observations; cooldown until ${item.cooldownUntil}`,
              `${item.attemptCount} attempts; ${item.lastProviderResultCode ?? "Not attempted"}; next ${item.nextAttemptAt}`,
              item.suppressionReason ?? "—",
            ])}
          />
        )}
        {result.data?.nextCursor && (
          <Cursor
            cursor={result.data.nextCursor}
            onNext={() =>
              setPath(
                withCursor(
                  "/v1/admin/health/notifications?limit=25",
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
