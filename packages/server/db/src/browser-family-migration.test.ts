import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("0033 browser family expansion migration", () => {
  const migration = readFileSync(
    join(__dirname, "../drizzle/0033_browser_family_product_matrix.sql"),
    "utf8",
  );
  const journal = readFileSync(
    join(__dirname, "../drizzle/meta/_journal.json"),
    "utf8",
  );

  it("adds the product browser families and widens browser-scoped checks", () => {
    for (const family of ["opera", "firefox", "safari"]) {
      expect(migration).toContain(`ADD VALUE IF NOT EXISTS '${family}'`);
    }
    for (const constraint of [
      "adapter_profile_assignments_browser_family",
      "health_runs_browser_family",
    ]) {
      expect(migration).toContain(`DROP CONSTRAINT IF EXISTS "${constraint}"`);
      expect(migration).toContain(`CONSTRAINT "${constraint}"`);
    }
    expect(migration).toContain(
      "'chrome', 'opera', 'yandex_chromium', 'firefox', 'safari'",
    );
    expect(journal).toContain("0033_browser_family_product_matrix");
  });
});
