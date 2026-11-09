import { describe, expect, it, vi } from "vitest";
import {
  deriveLlmHealthNotificationEvent,
  type LlmHealthNotificationInput,
} from "@product/health";
import type { DatabaseQuery } from "./index.js";
import { observeLlmHealthFailureInTransaction } from "./health-notification-repository.js";

const observedAt = new Date("2026-11-09T10:00:00.123Z");
const base: LlmHealthNotificationInput = {
  incidentId: "11111111-1111-4111-8111-111111111111",
  healthRunId: "22222222-2222-4222-8222-222222222222",
  provider: "chatgpt",
  surface: "work",
  healthLevel: "H3",
  rootContourKey: "C05_SEND_CONTROL",
  observedAt,
  eventKind: "INCIDENT_OPENED",
  healthState: "BROKEN",
};
type ProductKind = "INCIDENT_OPENED" | "INCIDENT_ESCALATED";

function current(kind: ProductKind, healthState: "DEGRADED" | "BROKEN") {
  const event = deriveLlmHealthNotificationEvent({ ...base, eventKind: kind, healthState })!;
  return {
    id: "33333333-3333-4333-8333-333333333333",
    eventKind: event.eventKind,
    severity: event.severity,
    latestObservedAt: observedAt,
    cooldownUntil: event.cooldownUntil,
  };
}

function fixture(row: ReturnType<typeof current> | null) {
  // Query-result/argument port only; no database or SQL execution.
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.startsWith("SELECT")) return { rows: row ? [row] : [] };
    if (sql.startsWith("INSERT")) {
      return { rows: [{ id: "inserted", payload: JSON.parse(String(parameters[9])) }] };
    }
    return { rows: [] };
  });
  return { q: { query } as unknown as DatabaseQuery, query };
}

describe("Health notification aggregate event identity", () => {
  it.each([
    ["INCIDENT_OPENED", "DEGRADED", "DRIFT"],
    ["INCIDENT_OPENED", "DEGRADED", "DEGRADED"],
    ["INCIDENT_OPENED", "BROKEN", "BROKEN"],
    ["INCIDENT_ESCALATED", "BROKEN", "BROKEN"],
    ["INCIDENT_ESCALATED", "BROKEN", "DEGRADED"],
  ] as const)("preserves %s/%s on newer %s", async (kind, previousState, healthState) => {
    const row = current(kind, previousState);
    const before = JSON.stringify(row);
    const { q, query } = fixture(row);
    const input = { ...base, healthState, observedAt: new Date(observedAt.getTime() + 1_000) };
    const expectedEvent = deriveLlmHealthNotificationEvent(input)!;
    const result = await observeLlmHealthFailureInTransaction(q, input);
    expect(result).toEqual({ opened: false, escalated: false });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('event_kind AS "eventKind"');
    expect(query.mock.calls[0]?.[1]).toEqual([base.incidentId]);
    const args = query.mock.calls[1]![1]!;
    expect(args.slice(0, 4)).toEqual([row.id, input.observedAt, expectedEvent.cooldownUntil, input.healthRunId]);
    expect(JSON.parse(String(args[4]))).toEqual({ ...expectedEvent.payload, eventKind: kind });
    expect(args[5]).toBe(true);
    expect(JSON.stringify(row)).toBe(before);
  });

  it.each(["INCIDENT_OPENED", "INCIDENT_ESCALATED"] as const)(
    "retains %s through repeated same-severity preparation with new run/time",
    async (kind) => {
      const row = current(kind, "BROKEN");
      const { q, query } = fixture(row);
      for (let index = 1; index <= 3; index += 1) {
        await observeLlmHealthFailureInTransaction(q, {
          ...base,
          healthRunId: `new-run-${index}`,
          observedAt: new Date(observedAt.getTime() + index * 1_000),
        });
      }
      expect(query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(0);
      for (const [, args] of query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"))) {
        expect(JSON.parse(String(args![4])).eventKind).toBe(kind);
      }
    },
  );

  it("keeps the original OPENED aggregate and distinct stronger escalation key", async () => {
    const { q, query } = fixture(current("INCIDENT_OPENED", "DEGRADED"));
    const result = await observeLlmHealthFailureInTransaction(q, {
      ...base, observedAt: new Date(observedAt.getTime() + 1_000),
    });
    expect(result).toEqual({ opened: false, escalated: true });
    expect(query).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(query.mock.calls[1]![1]![4])).eventKind).toBe("INCIDENT_OPENED");
    const inserted = query.mock.calls[2]![1]!;
    expect(inserted[0]).toBe(`llm-health:v1:${base.incidentId}:INCIDENT_ESCALATED:CRITICAL`);
    expect(inserted[4]).toBe("INCIDENT_ESCALATED");
    expect(JSON.parse(String(inserted[9])).eventKind).toBe("INCIDENT_ESCALATED");
  });

  it("keeps first failure OPENED without an existing aggregate", async () => {
    const { q, query } = fixture(null);
    expect(await observeLlmHealthFailureInTransaction(q, base)).toEqual({ opened: true, escalated: false });
    const inserted = query.mock.calls[1]![1]!;
    expect(inserted[0]).toBe(`llm-health:v1:${base.incidentId}:INCIDENT_OPENED`);
    expect(JSON.parse(String(inserted[9])).eventKind).toBe("INCIDENT_OPENED");
  });

  it.each([-1, 0])("does not escalate an older/equal observation (%s ms)", async (delta) => {
    const { q, query } = fixture(current("INCIDENT_OPENED", "DEGRADED"));
    expect(await observeLlmHealthFailureInTransaction(q, {
      ...base, observedAt: new Date(observedAt.getTime() + delta),
    })).toEqual({ opened: false, escalated: false });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not create product notification work for UNKNOWN", async () => {
    const { q, query } = fixture(current("INCIDENT_ESCALATED", "BROKEN"));
    expect(await observeLlmHealthFailureInTransaction(q, { ...base, healthState: "UNKNOWN" }))
      .toEqual({ opened: false, escalated: false });
    expect(query).not.toHaveBeenCalled();
  });
});
