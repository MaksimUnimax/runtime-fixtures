import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HealthPage from "../app/health/page";

const healthResponse = vi.hoisted(() => ({
  data: null as unknown,
  error: null as unknown,
  busy: false,
  canRead: true,
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
      me: healthResponse.canRead ? { permissions: ["health.read"] } : null,
    }),
    has: (me: { permissions: string[] } | null, permission: string) =>
      Boolean(me?.permissions.includes(permission)),
    useData: () => ({
      data: healthResponse.data,
      busy: healthResponse.busy,
      error: healthResponse.error,
    }),
    Shell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
  };
});

beforeEach(() => {
  // Vitest's classic JSX runtime requires React in this isolated unit only.
  vi.stubGlobal("React", React);
});

afterEach(() => {
  vi.unstubAllGlobals();
  healthResponse.data = null;
  healthResponse.error = null;
  healthResponse.busy = false;
  healthResponse.canRead = true;
});

describe("Health read-only list availability rendering", () => {
  it("makes unverified Health status explicit on an API error without guessing the cause", () => {
    healthResponse.error = new Error("PRIVATE_MONITOR_CONNECTION_SECRET");
    const html = renderToStaticMarkup(createElement(HealthPage));
    expect(html).toContain(
      "Health observations could not be verified. No target state is confirmed.",
    );
    expect(html).not.toContain("No Health targets are available.");
    expect(html).not.toContain("PRIVATE_MONITOR_CONNECTION_SECRET");
    expect(html).not.toContain("<td>HEALTHY</td>");
  });

  it("does not display an old HEALTHY row alongside a failed current read", () => {
    healthResponse.data = {
      items: [
        {
          targetId: "previous-target",
          provider: "chatgpt",
          surface: "CHATGPT_STANDARD",
          variant: "standard",
          browserFamily: "chrome",
          browserVersion: "155",
          latestHealthState: "HEALTHY",
          latestObservationAt: "2026-10-20T00:00:00Z",
          activeIncidentId: null,
          baselineProfileRevisionId: null,
          candidateProfileRevisionId: null,
          latestH4Result: null,
          latestH5Result: null,
          recommendation: null,
        },
      ],
      nextCursor: null,
    };
    healthResponse.error = new Error("internal transport failure");
    const html = renderToStaticMarkup(createElement(HealthPage));
    expect(html).toContain(
      "Health observations could not be verified. No target state is confirmed.",
    );
    expect(html).not.toContain("HEALTHY (chrome 155)");
    expect(html).not.toContain("2026-10-20T00:00:00Z");
  });

  it("keeps a successfully returned empty result distinct from request failure", () => {
    healthResponse.data = { items: [], nextCursor: null };
    const html = renderToStaticMarkup(createElement(HealthPage));
    expect(html).toContain("No Health targets are available.");
    expect(html).not.toContain("Health observations could not be verified.");
  });

  it("does not replace an actual returned target with an invented unavailable state", () => {
    healthResponse.data = {
      items: [
        {
          targetId: "synthetic-target",
          provider: "chatgpt",
          surface: "CHATGPT_STANDARD",
          variant: "standard",
          browserFamily: "chrome",
          browserVersion: "155",
          latestHealthState: "HEALTHY",
          latestObservationAt: "2026-10-22T00:00:00Z",
          latestSuccessfulRunAt: null,
          activeIncidentId: null,
          baselineProfileRevisionId: null,
          candidateProfileRevisionId: null,
          candidateState: "NO_CANDIDATE",
          latestH4Result: null,
          latestH5Result: null,
          recommendation: null,
        },
      ],
      nextCursor: null,
    };
    const html = renderToStaticMarkup(createElement(HealthPage));
    expect(html).toContain("HEALTHY (chrome 155)");
    expect(html).toContain("2026-10-22T00:00:00Z");
    expect(html).not.toContain("Health observations could not be verified.");
  });

  it("preserves the existing read-permission fence even when an error exists", () => {
    healthResponse.canRead = false;
    healthResponse.error = new Error("private");
    expect(renderToStaticMarkup(createElement(HealthPage))).toBe("");
  });

  it("does not report failure before a request has completed", () => {
    healthResponse.busy = true;
    const html = renderToStaticMarkup(createElement(HealthPage));
    expect(html).toContain("Loading");
    expect(html).not.toContain("Health observations could not be verified.");
  });
});
