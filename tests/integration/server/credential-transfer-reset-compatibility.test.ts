import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Only the existing reset consumers. Reading SQL literals does not run their tests.
const consumers = [
  "packages/server/db/src/adapter-registry.integration.test.ts",
  "packages/server/db/src/api-watch-document-scope-migration.integration.test.ts",
  "packages/server/db/src/api-watch-product-baseline.integration.test.ts",
  "packages/server/db/src/canonical-lineage.integration.test.ts",
  "packages/server/db/src/health-admin-read.integration.test.ts",
  "packages/server/db/src/health-diagnostics-read.integration.test.ts",
  "packages/server/db/src/health-evaluation.integration.test.ts",
  "packages/server/db/src/health-incident-migration.integration.test.ts",
  "packages/server/db/src/health-incidents.integration.test.ts",
  "packages/server/db/src/health-no-session-persistence.integration.test.ts",
  "packages/server/db/src/health-persistence.integration.test.ts",
  "packages/server/db/src/health-retention-upgrade.integration.test.ts",
  "packages/server/db/src/health-scheduler.integration.test.ts",
  "packages/server/db/src/monitor-profile-repair-admission.integration.test.ts",
  "packages/server/db/src/p7-profile-lifecycle.integration.test.ts",
  "packages/server/db/src/p7.2-correction.integration.test.ts",
  "packages/server/db/src/p7.3-bootstrap-ai.integration.test.ts",
  "packages/server/db/src/p7.4-admin-ai.integration.test.ts",
  "packages/server/db/src/postgres.integration.test.ts",
  "tests/integration/server/h3-health-persistence.integration.test.ts",
  "tests/integration/server/health-authenticated-deep-scope.integration.test.ts",
  "tests/integration/server/monitor-pilot-authenticated-deep-authority.integration.test.ts",
  "tests/integration/server/monitor-pilot-authority.integration.test.ts",
  "tests/integration/server/monitor-pilot-retention.integration.test.ts",
  "tests/integration/server/s2-q1-llm-ops-prebeta-acceptance.integration.test.ts",
  "tests/integration/server/store-release-transition-preflight.integration.test.ts",
  "tests/integration/server/store1-opera-admin-activation.integration.test.ts",
] as const;

describe("test reset removes the private transfer schema before public", () => {
  it.each(consumers)("%s", (path) => {
    const text = readFileSync(resolve(process.cwd(), path), "utf8");
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const resets: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        /DROP SCHEMA (?:IF EXISTS )?public CASCADE/.test(node.text)
      ) {
        resets.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(resets.length).toBeGreaterThan(0);
    for (const sql of resets) {
      expect(sql).toMatch(
        /^DROP SCHEMA IF EXISTS octoport_transfer_fence CASCADE;\s*DROP SCHEMA (?:IF EXISTS )?public CASCADE/,
      );
    }
  });
});
