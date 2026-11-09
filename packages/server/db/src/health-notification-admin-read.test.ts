import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "./index.js";
import { createHealthNotificationAdminReadRepository } from "./health-notification-admin-read-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const incidentId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const times = {
  nextAttemptAt: "2030-01-01T10:00:00.987Z",
  deliveredAt: "2030-01-01T10:00:01.777Z",
  firstObservedAt: "2030-01-01T09:00:00.123Z",
  latestObservedAt: "2030-01-01T09:00:00.789Z",
  cooldownUntil: "2030-01-01T10:05:00.456Z",
  createdAt: "2030-01-01T08:00:00.654Z",
  updatedAt: "2030-01-01T10:00:02.999Z",
  firstSeenAt: "2030-01-01T07:00:00.111Z",
  lastSeenAt: "2030-01-01T08:00:00.222Z",
  lastObservedAt: "2030-01-01T09:00:00.333Z",
  resolvedAt: "2030-01-01T10:00:00.444Z",
  claimExpiresAt: "2030-01-01T10:00:00.555Z",
  expiresAt: "2030-01-02T10:00:00.666Z",
};
const states = [
  "PENDING", "CLAIMED", "DELIVERED", "FAILED_RETRYABLE",
  "FAILED_TERMINAL", "SUPPRESSED",
] as const;
type State = (typeof states)[number];
type Form = "Date" | "offset";

function timestamp(value: string, form: Form) {
  if (form === "Date") return new Date(value);
  return new Date(Date.parse(value) + 3 * 60 * 60 * 1000)
    .toISOString().replace("Z", "+03:00");
}

function row(state: State = "CLAIMED", form: Form = "Date"): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id, incidentId, healthRunId: runId, eventKind: "INCIDENT_OPENED",
    severity: "CRITICAL", state, routeKey: "OWNER_MONITORING",
    groupCount: "2", attemptCount: "2", provider: "chatgpt",
    surface: "CHATGPT_WORK", variant: "work", healthState: "BROKEN",
    healthLevel: "H3", browserFamily: "chrome", browserVersion: "155",
    suppressionReason: state === "SUPPRESSED" ? "MAINTENANCE_ENTERED" : null,
    lastErrorCode: state === "FAILED_RETRYABLE" ? "RATE_LIMIT" : null,
    providerAdapterKey: state === "DELIVERED" ? "deterministic-test-sink" : null,
    incidentProvider: "chatgpt", incidentSurface: "CHATGPT_WORK",
    incidentVariant: "work", incidentBrowserFamily: "chrome",
    incidentStatus: state === "DELIVERED" ? "RESOLVED" : "OPEN",
    incidentRootContourKey: null, firstSeenRunId: runId,
    latestSeenRunId: runId, lastObservedRunId: runId,
    resolvedByRunId: state === "DELIVERED" ? runId : null,
    retentionClass: "HEALTH_NOTIFICATION", privateFixture: "NOT_PUBLIC",
  };
  for (const [key, value] of Object.entries(times)) result[key] = timestamp(value, form);
  if (state !== "DELIVERED") result.deliveredAt = result.resolvedAt = null;
  if (state !== "CLAIMED") result.claimExpiresAt = null;
  return result;
}

function fixture(rows: Record<string, unknown>[], paging = false) {
  const epoch = (value: unknown) => value instanceof Date ? value.valueOf() : Date.parse(String(value));
  // Readonly query-result/argument port; does not execute SQL or create a database.
  const query = vi.fn(async (text: string, args: unknown[] = []) => {
    if (text.includes("FROM health_evidence_references")) return { rows: [] };
    let selected = rows;
    if (paging && args[0] instanceof Date) {
      const cursor = args[0].valueOf();
      selected = rows.filter(item => epoch(item.createdAt) < cursor ||
        (epoch(item.createdAt) === cursor && String(item.id) < String(args[1])));
    }
    return { rows: paging ? selected.slice(0, Number(args[9])) : selected };
  });
  return {
    repository: createHealthNotificationAdminReadRepository({ query } as unknown as DatabaseRuntime),
    query,
  };
}

describe("Health notification read timestamp precision", () => {
  for (const form of ["Date", "offset"] as const) {
    it.each(states)(`retains ${form} notification and nested instants in %s`, async state => {
      const input = row(state, form), before = JSON.stringify(input);
      const { repository, query } = fixture([input]);
      const list = await repository.listNotifications({ limit: 1 });
      const detail = await repository.getNotification(id);
      const summary = {
        nextAttemptAt: times.nextAttemptAt,
        deliveredAt: state === "DELIVERED" ? times.deliveredAt : null,
        firstObservedAt: times.firstObservedAt, latestObservedAt: times.latestObservedAt,
        cooldownUntil: times.cooldownUntil, createdAt: times.createdAt, updatedAt: times.updatedAt,
        state, attemptCount: 2, eventKind: "INCIDENT_OPENED", incidentId,
      };
      expect(list.items[0]).toMatchObject(summary);
      expect(list.nextCursor).toBe(`${times.createdAt}~${id}`);
      expect(detail).toMatchObject({
        ...summary,
        claim: { leaseExpiresAt: state === "CLAIMED" ? times.claimExpiresAt : null, attempt: 2 },
        retention: { expiresAt: times.expiresAt },
        incident: {
          id: incidentId, firstSeenAt: times.firstSeenAt, lastSeenAt: times.lastSeenAt,
          lastObservedAt: times.lastObservedAt,
          resolvedAt: state === "DELIVERED" ? times.resolvedAt : null,
        },
        lastProviderResultCode: state === "DELIVERED" ? "DELIVERED" : state === "FAILED_RETRYABLE" ? "RATE_LIMIT" : null,
        suppressionReason: state === "SUPPRESSED" ? "MAINTENANCE_ENTERED" : null,
      });
      expect(detail).not.toHaveProperty("privateFixture");
      expect(JSON.stringify(input)).toBe(before);
      expect(query.mock.calls[0]?.[1]).toEqual([null, null, null, null, null, null, null, null, null, 1]);
      expect(query.mock.calls[1]?.[1]).toEqual([id]);
      expect(query.mock.calls[2]?.[1]).toEqual([runId]);
    });

    it(`retains the second same-second row after the ${form} cursor`, async () => {
      const nextId = "00000000-0000-4000-8000-000000000007";
      const first = { ...row("PENDING", form), createdAt: timestamp("2030-01-01T08:00:00.789Z", form) };
      const second = { ...row("PENDING", form), id: nextId, createdAt: timestamp("2030-01-01T08:00:00.456Z", form) };
      const { repository, query } = fixture([first, second], true);
      const page = await repository.listNotifications({ limit: 1 });
      const next = await repository.listNotifications({ limit: 1, cursor: page.nextCursor! });
      expect(next.items.map(item => item.id)).toEqual([nextId]);
      expect(query.mock.calls[1]?.[1]?.slice(0, 2)).toEqual([new Date("2030-01-01T08:00:00.789Z"), id]);
    });
  }

  it.each([null, undefined])("preserves absent nullable instants as null (%s)", async absent => {
    const { repository } = fixture([{
      ...row("DELIVERED"), deliveredAt: absent, resolvedAt: absent,
      claimExpiresAt: absent, expiresAt: absent,
    }]);
    expect(await repository.getNotification(id)).toMatchObject({
      deliveredAt: null, claim: { leaseExpiresAt: null },
      incident: { resolvedAt: null }, retention: { expiresAt: null },
    });
  });

  it.each(["1970-01-01T00:00:00.000Z", "1969-12-31T23:59:59.789Z"])("retains native Date boundary %s", async at => {
    const { repository } = fixture([{ ...row(), createdAt: new Date(at) }]);
    const page = await repository.listNotifications({ limit: 1 });
    expect(page.items[0]?.createdAt).toBe(at);
    expect(page.nextCursor).toBe(`${at}~${id}`);
  });

  it.each(["INVALID", new Date(Number.NaN), null])("rejects malformed required instants %s", async at => {
    const { repository } = fixture([{ ...row(), createdAt: at }]);
    await expect(repository.listNotifications({ limit: 1 })).rejects.toThrow();
    await expect(repository.getNotification(id)).rejects.toThrow();
  });
});
