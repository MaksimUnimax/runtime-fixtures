import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HealthNotificationsPage from "../app/health/notifications/page";
import HealthNotificationDetailPage from "../app/health/notifications/[id]/page";
import { formatHealthNotificationSchedule } from "./health-notification-ui";

const response = vi.hoisted(() => ({
  data: null as unknown,
  allowed: true,
  busy: false,
  error: null as unknown,
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "intent-1" }) }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      createElement("a", { href }, children),
  };
});
vi.mock("../app/admin-ui", async (importOriginal) => {
  const original = await importOriginal<typeof import("../app/admin-ui")>();
  const { createElement } = await import("react");
  return {
    ...original,
    useAdmin: () => ({
      me: response.allowed ? { permissions: ["health.read"] } : null,
      loading: false,
    }),
    has: (me: { permissions: string[] } | null, permission: string) =>
      Boolean(me?.permissions.includes(permission)),
    useData: () => ({ data: response.data, busy: response.busy, error: response.error }),
    Shell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  };
});

const retainedDate = "2034-05-06T12:00:00.501Z";
const deliveredDate = "2034-05-06T12:01:02.345Z";
const cases = [
  ["PENDING", `Attempt due ${retainedDate}`],
  ["FAILED_RETRYABLE", `Retry due ${retainedDate}`],
  ["CLAIMED", "Claimed; awaiting completion or lease expiry"],
  ["DELIVERED", "No next attempt (delivered)"],
  ["FAILED_TERMINAL", "No retry scheduled (terminal failure)"],
  ["SUPPRESSED", "No attempt while suppressed"],
] as const;

function notification(state: string) {
  return {
    id: "intent-1", incidentId: "incident-1", eventKind: "INCIDENT_RECOVERED",
    severity: "INFO", state, routeKey: "HEALTH_OPERATOR", groupCount: 2,
    attemptCount: 3, nextAttemptAt: retainedDate,
    deliveredAt: state === "DELIVERED" ? deliveredDate : null,
    suppressionReason: state === "SUPPRESSED" ? "MAINTENANCE_ENTERED" : null,
    firstObservedAt: "2034-05-06T11:00:00.001Z",
    latestObservedAt: "2034-05-06T11:01:00.002Z",
    cooldownUntil: "2034-05-06T11:06:00.002Z",
    createdAt: "2034-05-06T11:00:00.001Z", updatedAt: "2034-05-06T12:01:02.345Z",
    lastProviderResultCode: state === "DELIVERED" ? "DELIVERED" : "UNKNOWN",
    providerSink: "DETERMINISTIC_TEST_SINK", provider: "chatgpt", surface: "CHATGPT_STANDARD",
    dedupIdentity: { scheme: "LLM_HEALTH_V1", eventKind: "INCIDENT_RECOVERED", severity: "INFO" },
    claim: { state: state === "CLAIMED" ? "CLAIMED" : "UNCLAIMED", leaseExpiresAt: null, attempt: 3 },
    sourceHealth: { healthRunId: "run-1", healthState: "HEALTHY", healthLevel: "FULL", browserFamily: "chrome", browserVersion: "153", variant: "default" },
    incident: { id: "incident-1", status: "RESOLVED", resolvedAt: deliveredDate },
    evidenceReferences: [], retention: { retentionClass: "HEALTH_OPERATIONAL", expiresAt: null },
  };
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  vi.unstubAllGlobals();
  response.data = null;
  response.allowed = true;
  response.busy = false;
  response.error = null;
});

describe("Health notification attempt schedule visibility", () => {
  it.each(cases)("list uses persisted %s to qualify the retained date", (state, label) => {
    const item = notification(state);
    response.data = { items: [item], nextCursor: null };
    const html = renderToStaticMarkup(createElement(HealthNotificationsPage));
    expect(html).toContain(label);
    expect(html).toContain(`${state} / INFO`);
    expect(html).toContain(`3 attempts; ${item.lastProviderResultCode};`);
    expect(html).toContain('/health/notifications/intent-1');
    expect(html).toContain('/health/incidents/incident-1');
    if (!["PENDING", "FAILED_RETRYABLE"].includes(state)) expect(html).not.toContain(retainedDate);
    if (state === "SUPPRESSED") expect(html).toContain("MAINTENANCE_ENTERED");
    expect(html).toContain("no external destination is shown");
  });

  it.each(cases)("detail uses persisted %s without advertising a false retry", (state, label) => {
    response.data = notification(state);
    const html = renderToStaticMarkup(createElement(HealthNotificationDetailPage));
    expect(html).toContain("<th>Attempt schedule</th>");
    expect(html).toContain(`<td>${label}</td>`);
    expect(html).toContain(`<td>${state}</td>`);
    expect(html).toContain("DETERMINISTIC_TEST_SINK");
    expect(html).toContain(state === "DELIVERED" ? deliveredDate : "Not delivered");
    if (!["PENDING", "FAILED_RETRYABLE"].includes(state)) expect(html).not.toContain(retainedDate);
    if (state === "SUPPRESSED") expect(html).toContain("Suppression reason: MAINTENANCE_ENTERED");
    expect(html).toContain("No delivery, retry, suppression, or route actions");
  });

  it("does not infer delivery or scheduling from provider result or deliveredAt", () => {
    const item = { ...notification("FAILED_RETRYABLE"), lastProviderResultCode: "DELIVERED", deliveredAt: deliveredDate };
    response.data = { items: [item], nextCursor: null };
    expect(renderToStaticMarkup(createElement(HealthNotificationsPage))).toContain(`Retry due ${retainedDate}`);
    response.data = { ...notification("DELIVERED"), lastProviderResultCode: null, deliveredAt: null };
    const detail = renderToStaticMarkup(createElement(HealthNotificationDetailPage));
    expect(detail).toContain("No next attempt (delivered)");
    expect(detail).toContain("Not delivered");
  });

  it("keeps exact past-due timestamps and can show a resumed suppressed intent", () => {
    const date = "2001-02-03T04:05:06.007Z";
    expect(formatHealthNotificationSchedule("SUPPRESSED", date)).toBe("No attempt while suppressed");
    expect(formatHealthNotificationSchedule("PENDING", date)).toBe(`Attempt due ${date}`);
    expect(formatHealthNotificationSchedule("FAILED_RETRYABLE", date)).toBe(`Retry due ${date}`);
  });

  it("does not invent a schedule for an unrecognized state", () => {
    expect(formatHealthNotificationSchedule("FUTURE_STATE", retainedDate)).toBe("Schedule unavailable");
  });

  it("preserves empty list and missing read behavior", () => {
    response.data = { items: [], nextCursor: null };
    expect(renderToStaticMarkup(createElement(HealthNotificationsPage))).toContain("No LLM Health notification intents");
    response.data = null;
    response.busy = true;
    for (const page of [HealthNotificationsPage, HealthNotificationDetailPage]) {
      const html = renderToStaticMarkup(createElement(page));
      expect(html).toContain("Loading");
      expect(html).not.toContain("Attempt due");
      expect(html).not.toContain("Retry due");
    }
  });

  it("does not display schedule data after a failed current read", () => {
    response.error = new Error("PRIVATE_NOTIFICATION_READ_ERROR");
    for (const page of [HealthNotificationsPage, HealthNotificationDetailPage]) {
      const html = renderToStaticMarkup(createElement(page));
      expect(html).not.toContain(retainedDate);
      expect(html).not.toContain("PRIVATE_NOTIFICATION_READ_ERROR");
    }
  });

  it("preserves health.read access for both consumers", () => {
    response.allowed = false;
    response.data = notification("PENDING");
    for (const page of [HealthNotificationsPage, HealthNotificationDetailPage]) {
      const html = renderToStaticMarkup(createElement(page));
      expect(html).toContain("Forbidden: Health read permission is required.");
      expect(html).not.toContain(retainedDate);
    }
  });
});
