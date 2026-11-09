import { describe, expect, it, vi } from "vitest";
import {
  createHealthAdminReadService,
  HealthIncidentSummarySchema,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";

const id = "00000000-0000-4000-8000-000000000001";
const latestRunId = "00000000-0000-4000-8000-000000000002";
const observedRunId = "00000000-0000-4000-8000-000000000003";
const recoveryRunId = "00000000-0000-4000-8000-000000000004";
const times = {
  firstSeenAt: "2030-01-01T00:00:00.123Z",
  lastSeenAt: "2030-01-01T01:00:00.456Z",
  lastObservedAt: "2030-01-01T02:00:00.789Z",
  resolvedAt: "2030-01-02T03:00:00.987Z",
};
const statuses = [
  "OPEN", "INVESTIGATING", "CANDIDATE_FIX", "CANDIDATE_PASS",
  "CANARY_ROLLOUT", "ROLLOUT", "RESOLVED", "FALSE_POSITIVE", "MAINTENANCE",
] as const;
type Status = (typeof statuses)[number];

function timestamp(value: string, form: "Date" | "offset") {
  if (form === "Date") return new Date(value);
  return new Date(Date.parse(value) + 3 * 60 * 60 * 1000)
    .toISOString().replace("Z", "+03:00");
}

function row(status: Status = "OPEN", form: "Date" | "offset" = "Date") {
  return {
    id, provider: "chatgpt", surface: "CHATGPT_WORK", variant: "work",
    browserFamily: "chrome", status,
    rootContourKey: status === "MAINTENANCE" ? null : "C04_COMPOSER_INPUT",
    firstSeenRunId: id, latestSeenRunId: latestRunId, lastObservedRunId: observedRunId,
    firstSeenAt: timestamp(times.firstSeenAt, form),
    lastSeenAt: timestamp(times.lastSeenAt, form),
    lastObservedAt: timestamp(times.lastObservedAt, form),
    resolvedByRunId: status === "RESOLVED" ? recoveryRunId : null,
    resolvedAt: status === "RESOLVED" ? timestamp(times.resolvedAt, form) : null,
  };
}

function expected(status: Status = "OPEN") {
  return {
    id, provider: "chatgpt", surface: "CHATGPT_WORK", variant: "work",
    browserFamily: "chrome", status,
    rootContourKey: status === "MAINTENANCE" ? null : "C04_COMPOSER_INPUT",
    firstSeenRunId: id, latestSeenRunId: latestRunId, lastObservedRunId: observedRunId,
    firstSeenAt: times.firstSeenAt, lastSeenAt: times.lastSeenAt,
    lastObservedAt: times.lastObservedAt,
    resolvedByRunId: status === "RESOLVED" ? recoveryRunId : null,
    resolvedAt: status === "RESOLVED" ? times.resolvedAt : null,
  };
}

function fixture(rows: unknown[]) {
  // Readonly query-result port: no SQL or DatabaseRuntime construction.
  const query = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => ({ rows }));
  const repository = createHealthAdminReadRepository({ query } as unknown as DatabaseRuntime);
  return { service: createHealthAdminReadService(repository), query };
}

describe("Health incident list and detail projection", () => {
  for (const form of ["Date", "offset"] as const) {
    it.each(statuses)(`preserves ${form} lifecycle instants for %s`, async (status) => {
      const input = row(status, form);
      const before = JSON.stringify(input);
      const { service, query } = fixture([input]);
      const list = await service.listIncidents({ limit: 2, activeOnly: false });
      const detail = await service.getIncident(id);
      expect(list).toEqual({ items: [expected(status)], nextCursor: null });
      expect(detail).toEqual(expected(status));
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]?.[1]).toEqual([null, null, null, false, null, 2]);
      expect(query.mock.calls[1]?.[1]).toEqual([id]);
      expect(JSON.stringify(input)).toBe(before);
    });
  }

  it("retains the row identity, default variant and excludes private metadata", async () => {
    const input = {
      ...row("OPEN", "offset"), provider: "alice", surface: "ALICE",
      variant: null, browserFamily: "yandex_chromium", privateFixture: true,
    };
    const { service } = fixture([input]);
    const value = await service.getIncident(id);
    expect(value).toEqual({
      ...expected(), provider: "alice", surface: "ALICE",
      variant: "default", browserFamily: "yandex_chromium",
    });
    expect(value).not.toHaveProperty("privateFixture");
  });

  it("keeps full-page order, cursor and query filters", async () => {
    const lastId = "00000000-0000-4000-8000-000000000005";
    const cursor = "00000000-0000-4000-8000-000000000000";
    const { service, query } = fixture([
      row("OPEN", "offset"), { ...row("RESOLVED", "offset"), id: lastId },
    ]);
    const value = await service.listIncidents({
      limit: 2, cursor, provider: "chatgpt", surface: "CHATGPT_WORK",
      incidentStatus: "RESOLVED", activeOnly: false,
    });
    expect(value.items.map((item) => item.id)).toEqual([id, lastId]);
    expect(value.nextCursor).toBe(lastId);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "chatgpt", "CHATGPT_WORK", "RESOLVED", false, cursor, 2,
    ]);
  });

  it("forwards activeOnly without rewriting lifecycle status", async () => {
    const { service, query } = fixture([row("MAINTENANCE", "offset")]);
    const value = await service.listIncidents({ limit: 3, activeOnly: true });
    expect(value.items[0]?.status).toBe("MAINTENANCE");
    expect(query.mock.calls[0]?.[1]).toEqual([null, null, null, true, null, 3]);
  });

  it("preserves empty pages, missing details and original read errors", async () => {
    const { service, query } = fixture([]);
    await expect(service.listIncidents({ limit: 2, activeOnly: false })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.getIncident(id)).resolves.toBeNull();
    const failure = new Error("READ_INPUT_FAILED");
    query.mockRejectedValueOnce(failure);
    await expect(service.listIncidents({ limit: 2, activeOnly: false })).rejects.toBe(failure);
    query.mockRejectedValueOnce(failure);
    await expect(service.getIncident(id)).rejects.toBe(failure);
  });

  it.each([
    { status: "UNKNOWN" }, { firstSeenAt: null }, { lastSeenAt: "INVALID" },
    { lastObservedAt: new Date(Number.NaN) }, { resolvedAt: "INVALID" },
    { firstSeenRunId: "INVALID" }, { rootContourKey: "UNSUPPORTED" },
    { browserFamily: "UNSUPPORTED" }, { resolvedByRunId: "INVALID" },
  ])("rejects malformed source fields %j", async (change) => {
    const { service } = fixture([{ ...row("OPEN", "offset"), ...change }]);
    await expect(service.listIncidents({ limit: 2, activeOnly: false })).rejects.toThrow();
    await expect(service.getIncident(id)).rejects.toThrow();
  });

  it("keeps strict summary validation", () => {
    expect(() => HealthIncidentSummarySchema.parse({ ...expected(), privateFixture: true })).toThrow();
    expect(() => HealthIncidentSummarySchema.parse({ ...expected(), lastObservedAt: undefined })).toThrow();
  });
});
