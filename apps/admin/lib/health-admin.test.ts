import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
