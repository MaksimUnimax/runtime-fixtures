import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HealthDiagnosticsPage from "../app/health/diagnostics/page";

const response = vi.hoisted(() => ({
  summary: null as unknown,
  error: null as unknown,
  busy: false,
  allowed: true,
}));

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
    }),
    has: (me: { permissions: string[] } | null, permission: string) =>
      Boolean(me?.permissions.includes(permission)),
    useData: (path: string | null) => ({
      data: path?.includes("/summary") ? response.summary : null,
      error: response.error,
      busy: response.busy,
    }),
    Shell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  };
});

const success = "2034-05-06T10:01:02.123Z";
const failure = "2034-05-06T10:02:03.456Z";
function summary(scheduler: Record<string, string | number | null>) {
  return {
    generatedAt: "2034-05-06T12:00:00.500Z",
    window: "24h",
    windowStart: "2034-05-05T12:00:00.500Z",
    windowEnd: "2034-05-06T12:00:00.500Z",
    latestHealthObservationAt: "2034-05-06T11:00:00.500Z",
    stale: false,
    currentTargets: [{
      targetId: "a".repeat(64), monitoringLayer: "NO_SESSION",
      provider: "chatgpt", surface: "CHATGPT_STANDARD", variant: "default",
      browserFamily: "chrome", browserVersion: "153", observationStatus: "OBSERVED",
      latestHealthState: "UNKNOWN", latestCompletedRunAt: "2034-05-06T11:00:00.500Z",
      activeIncidentCount: 0, latestIncidentRoot: null,
      latestHealthyAt: null, baselineProfileRevisionId: null,
      baselineProfileContentSha256: null, candidateProfileRevisionId: null,
      latestNotificationState: null,
    }],
    stateCounts: ["HEALTHY", "DRIFT", "DEGRADED", "BROKEN", "UNKNOWN", "MAINTENANCE"]
      .map((state) => ({ state, count: state === "UNKNOWN" ? 1 : 0 })),
    productQualityCounts: ["HEALTHY", "DRIFT", "DEGRADED", "BROKEN"]
      .map((state) => ({ state, count: 0 })),
    environmentCounts: [{ state: "UNKNOWN", count: 1 }, { state: "MAINTENANCE", count: 0 }],
    activeIncidentCount: 0,
    notification: {
      pending: 0, claimed: 0, retryableFailures: 0, terminalFailures: 0,
      suppressed: 0, delivered: 0, oldestPendingAt: null, nextRetryAt: null,
      recentRecoveryNotifications: 0, recentEscalationNotifications: 0,
    },
    scheduler: {
      latestSuccessfulScheduledRunAt: null, latestFailedScheduledExecutionAt: null,
      overdueDueTargetCount: 0, retryingExecutionCount: 0, ...scheduler,
    },
  };
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  vi.unstubAllGlobals();
  response.summary = null;
  response.error = null;
  response.busy = false;
  response.allowed = true;
});

describe("Health diagnostics scheduler visibility", () => {
  it.each([
    [success, failure, 3, 2],
    [failure, success, 0, 0],
    [failure, failure, 1, 1],
    [null, failure, 4, 0],
    [success, null, 0, 3],
    [null, null, 0, 0],
  ])("shows independent execution dates and exact counts: %s / %s", (ok, failed, overdue, retry) => {
    response.summary = summary({
      latestSuccessfulScheduledRunAt: ok,
      latestFailedScheduledExecutionAt: failed,
      overdueDueTargetCount: overdue,
      retryingExecutionCount: retry,
    });
    const html = renderToStaticMarkup(createElement(HealthDiagnosticsPage));
    expect(html).toContain(`<td>Latest successful execution</td><td>${ok ?? "Not recorded"}</td>`);
    expect(html).toContain(`<td>Latest failed execution</td><td>${failed ?? "Not recorded"}</td>`);
    expect(html).toContain(`<td>Overdue due targets</td><td>${overdue}</td>`);
    expect(html).toContain(`<td>Retryable executions</td><td>${retry}</td>`);
    expect(html).toContain("UNKNOWN (OBSERVED)");
    expect(html).toContain("or the cause of UNKNOWN.");
  });

  it("does not invent scheduler results after a failed current read", () => {
    response.error = new Error("PRIVATE_DIAGNOSTIC_ERROR");
    const html = renderToStaticMarkup(createElement(HealthDiagnosticsPage));
    expect(html).not.toContain("<td>Latest successful execution</td>");
    expect(html).not.toContain("<td>Latest failed execution</td>");
    expect(html).not.toContain("PRIVATE_DIAGNOSTIC_ERROR");
  });

  it("does not render scheduler values before data arrives", () => {
    response.busy = true;
    const html = renderToStaticMarkup(createElement(HealthDiagnosticsPage));
    expect(html).toContain("Loading");
    expect(html).not.toContain("<td>Overdue due targets</td>");
  });

  it("preserves the existing health.read visibility fence", () => {
    response.allowed = false;
    response.summary = summary({ latestSuccessfulScheduledRunAt: success });
    expect(renderToStaticMarkup(createElement(HealthDiagnosticsPage))).toBe("");
  });
});
