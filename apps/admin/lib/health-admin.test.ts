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
});
