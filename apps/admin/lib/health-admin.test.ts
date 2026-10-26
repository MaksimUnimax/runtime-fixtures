import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HealthTargetPage from "../app/health/[targetId]/page";

const healthRender = vi.hoisted(() => ({
  data: null as unknown,
  allowed: true,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ targetId: "test-target" }),
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
      me: healthRender.allowed ? { permissions: ["health.read"] } : null,
    }),
    has: (me: { permissions: string[] } | null, permission: string) =>
      Boolean(me?.permissions.includes(permission)),
    useData: () => ({ data: healthRender.data, busy: false, error: null }),
    Shell: ({ children }: { children: ReactNode }) =>
      createElement("main", null, children),
    LoadState: () => null,
  };
});

const healthPage = readFileSync(
  new URL("../app/health/page.tsx", import.meta.url),
  "utf8",
);
const healthDetailPage = readFileSync(
  new URL("../app/health/[targetId]/page.tsx", import.meta.url),
  "utf8",
);
const notificationsPage = readFileSync(
  new URL("../app/health/notifications/page.tsx", import.meta.url),
  "utf8",
);
const notificationDetailPage = readFileSync(
  new URL("../app/health/notifications/[id]/page.tsx", import.meta.url),
  "utf8",
);
const diagnosticsPage = readFileSync(
  new URL("../app/health/diagnostics/page.tsx", import.meta.url),
  "utf8",
);

describe("Health admin UI boundary", () => {
  it("exposes the bounded read-only target surface", () => {
    expect(healthPage).toContain("/v1/admin/health/targets?limit=25");
    expect(healthPage).toContain("No Health targets are available.");
    expect(healthPage).toContain("cannot publish, roll out, pause, rollback");
    expect(healthDetailPage).toContain("executionAuthority");
    expect(healthDetailPage).toContain("CURRENT BASELINE");
    expect(healthDetailPage).toContain("NO_CANDIDATE");
    expect(healthDetailPage).not.toMatch(
      /Apply restriction|Publish candidate|Start rollout/,
    );
  });

  it("exposes bounded notification visibility without actions or private fields", () => {
    expect(notificationsPage).toContain(
      "/v1/admin/health/notifications?limit=25",
    );
    expect(notificationsPage).toContain("No LLM Health notification intents");
    expect(notificationsPage).toContain("Forbidden: Health read permission");
    expect(notificationDetailPage).toContain("Suppression reason");
    expect(notificationDetailPage).toContain("No delivery, retry, suppression");
    expect(notificationDetailPage).not.toMatch(
      /Retry now|Send now|Cancel\b|Suppress\b|Unsuppress|Requeue|Mark delivered|claimToken|payload|webhook|email\b/i,
    );
  });

  it("exposes bounded aggregate diagnostics without misleading metrics", () => {
    expect(diagnosticsPage).toContain(
      "/v1/admin/health/diagnostics/summary?window=24h",
    );
    expect(diagnosticsPage).toContain("UNKNOWN and missing coverage");
    expect(diagnosticsPage).toContain("NOT_COVERED");
    expect(diagnosticsPage).toContain("observational");
    expect(diagnosticsPage).not.toMatch(
      /success percentage|failure percentage|Retry now|Send now|claimToken|payload/,
    );
  });
});

const safeTargetDetail = {
  targetId: "test-target",
  provider: "chatgpt",
  surface: "CHATGPT_WORK",
  variant: "work",
  browserFamily: "chrome",
  browserVersion: "155",
  latestHealthState: "DEGRADED",
  latestObservationAt: "2026-10-22T00:00:00Z",
  latestSuccessfulRunAt: null,
  baselineProfile: null,
  candidateProfile: null,
  contourStatuses: [] as { contourKey: string; outcome: string }[],
  evaluations: [],
  evidenceReferences: [],
  healthRecommendation: null,
  activeIncident: null,
};

// Vitest's JSX transform uses React.createElement here; Next handles the
// production client component separately using its configured JSX runtime.
beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  vi.unstubAllGlobals();
  healthRender.data = null;
  healthRender.allowed = true;
});

describe("Health target detail rendered contour outcomes", () => {
  it("shows actual PASS, DRIFT, BROKEN and UNKNOWN contour rows without deriving a global PASS", () => {
    healthRender.data = {
      ...safeTargetDetail,
      contourStatuses: [
        { contourKey: "C01", outcome: "PASS" },
        { contourKey: "C02", outcome: "DRIFT" },
        { contourKey: "C03", outcome: "BROKEN" },
        { contourKey: "C04", outcome: "UNKNOWN" },
      ],
    };
    const html = renderToStaticMarkup(createElement(HealthTargetPage));
    expect(html).toContain("Observed contour outcomes");
    expect(html).toContain("<td>C01</td><td>PASS</td>");
    expect(html).toContain("<td>C02</td><td>DRIFT</td>");
    expect(html).toContain("<td>C03</td><td>BROKEN</td>");
    expect(html).toContain("<td>C04</td><td>UNKNOWN</td>");
    expect(html).not.toContain("All contours passed");
  });

  it("states that no per-contour observation is available when the API list is empty", () => {
    healthRender.data = { ...safeTargetDetail, contourStatuses: [] };
    const html = renderToStaticMarkup(createElement(HealthTargetPage));
    expect(html).toContain("No per-contour observations are recorded");
    expect(html).not.toContain("<td>C01</td><td>PASS</td>");
  });

  it("does not expose contour details without the health.read permission", () => {
    healthRender.allowed = false;
    healthRender.data = {
      ...safeTargetDetail,
      contourStatuses: [{ contourKey: "C01", outcome: "PASS" }],
    };
    expect(renderToStaticMarkup(createElement(HealthTargetPage))).toBe("");
  });
});
