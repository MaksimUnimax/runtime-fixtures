import { describe, expect, it } from "vitest";
import {
  DeterministicNotificationTestSink,
  deriveLlmHealthNotificationEvent,
  isRepeatedFailureWithinCooldown,
  notificationDedupKey,
  notificationSeverityForHealthState,
} from "./index.js";

const base = {
  incidentId: "11111111-1111-4111-8111-111111111111",
  healthRunId: "22222222-2222-4222-8222-222222222222",
  provider: "chatgpt",
  surface: "WORK",
  healthLevel: "H3" as const,
  rootContourKey: "C05_SEND_CONTROL" as const,
  observedAt: new Date("2026-09-19T10:00:00.000Z"),
};

describe("LLM Health notification adapter", () => {
  it("derives stable severity and dedup identity from accepted Health state", () => {
    expect(notificationSeverityForHealthState("BROKEN")).toBe("CRITICAL");
    expect(notificationSeverityForHealthState("DEGRADED")).toBe("WARNING");
    expect(notificationSeverityForHealthState("UNKNOWN")).toBeNull();
    const first = deriveLlmHealthNotificationEvent({
      ...base,
      eventKind: "INCIDENT_OPENED",
      healthState: "BROKEN",
    });
    const replay = deriveLlmHealthNotificationEvent({
      ...base,
      eventKind: "INCIDENT_OPENED",
      healthState: "BROKEN",
    });
    expect(first?.dedupKey).toBe(replay?.dedupKey);
    expect(first?.dedupKey).toBe(
      notificationDedupKey({
        incidentId: base.incidentId,
        eventKind: "INCIDENT_OPENED",
        severity: "CRITICAL",
      }),
    );
  });

  it("does not create product-break events for UNKNOWN or maintenance observations", () => {
    expect(
      deriveLlmHealthNotificationEvent({
        ...base,
        eventKind: "INCIDENT_OPENED",
        healthState: "UNKNOWN",
      }),
    ).toBeNull();
    expect(
      deriveLlmHealthNotificationEvent({
        ...base,
        eventKind: "INCIDENT_OPENED",
        healthState: "MAINTENANCE",
      }),
    ).toBeNull();
    expect(
      deriveLlmHealthNotificationEvent({
        ...base,
        eventKind: "MAINTENANCE_ENTERED",
        healthState: "MAINTENANCE",
      })?.severity,
    ).toBe("INFO");
  });

  it("keeps repeated failures aggregated during finite cooldown", () => {
    const sameSeverity = {
      lastObservedAt: base.observedAt,
      observedAt: new Date("2026-09-19T10:14:59.000Z"),
      lastSeverity: "WARNING" as const,
      severity: "WARNING" as const,
    };
    expect(isRepeatedFailureWithinCooldown(sameSeverity)).toBe(true);
    expect(
      isRepeatedFailureWithinCooldown({
        ...sameSeverity,
        observedAt: new Date("2026-09-19T10:15:01.000Z"),
      }),
    ).toBe(false);
    expect(
      isRepeatedFailureWithinCooldown({
        ...sameSeverity,
        severity: "CRITICAL",
      }),
    ).toBe(false);
  });

  it("uses one deterministic escalation and one recovery identity per episode", () => {
    const escalation = deriveLlmHealthNotificationEvent({
      ...base,
      eventKind: "INCIDENT_ESCALATED",
      healthState: "BROKEN",
    });
    const recovery = deriveLlmHealthNotificationEvent({
      ...base,
      eventKind: "INCIDENT_RECOVERED",
      healthState: "HEALTHY",
    });
    expect(escalation?.dedupKey).toContain("INCIDENT_ESCALATED:CRITICAL");
    expect(recovery?.dedupKey).toContain("INCIDENT_RECOVERED");
    expect(escalation?.dedupKey).not.toBe(recovery?.dedupKey);
  });

  it("keeps the payload bounded and free of private or evidence bytes", () => {
    const event = deriveLlmHealthNotificationEvent({
      ...base,
      eventKind: "INCIDENT_OPENED",
      healthState: "BROKEN",
    });
    expect(event?.payload).toEqual(
      expect.objectContaining({
        incidentId: base.incidentId,
        healthRunId: base.healthRunId,
        safeEvidenceReference: `health-run:${base.healthRunId}`,
      }),
    );
    expect(JSON.stringify(event?.payload)).not.toMatch(
      /cookie|storageState|authorization|password|assistant|screenshot|\bdom\b/i,
    );
  });

  it("deduplicates provider delivery by the stable intent key", async () => {
    const sink = new DeterministicNotificationTestSink();
    const request = {
      intentId: "intent-1",
      idempotencyKey: "llm-health:v1:incident:INCIDENT_OPENED",
      routeKey: "OWNER_MONITORING",
      payload: { incidentId: base.incidentId },
    };
    const first = await sink.deliver(request);
    const replay = await sink.deliver(request);
    expect(first).toEqual(replay);
    expect(sink.deliveries.size).toBe(1);
  });
});
