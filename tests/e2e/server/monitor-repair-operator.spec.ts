import { expect, test } from "@playwright/test";
import {
  adminLogin,
  adminOrigin,
  reset,
  seedAdminIdentity,
} from "./support/fixtures.js";

const scope = "a".repeat(64);
const owner = "repair-owner@example.test";
const support = "repair-support@example.test";

function safeCase() {
  const id = (n: number) =>
    "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const sha = (value: string) => value.repeat(64);
  return {
    repairCaseId: id(1),
    caseRevision: 1,
    bindingSha256: sha("b"),
    scopeSha256: scope,
    createdAt: "2026-10-01T00:00:00.000Z",
    caseState: "APPROVAL_STALE",
    staleReasons: ["CURRENT_OBSERVATION_CHANGED"],
    executionAuthority: false,
    incident: {
      id: id(2),
      status: "OPEN",
      scopeSha256: scope,
      firstSeenRunId: id(3),
      latestSeenRunId: id(3),
      lastObservedRunId: id(3),
      resolvedByRunId: null,
      resolvedAt: null,
    },
    observation: {
      runId: id(3),
      normalizedStateSha256: sha("c"),
      currentNormalizedStateSha256: null,
      currentHealthState: null,
      currentRunId: null,
    },
    candidate: {
      profileId: id(4),
      profileRevisionId: id(5),
      revision: 2,
      contentSha256: sha("d"),
      state: "CANDIDATE",
    },
    acceptedBaselineProfileRevisionId: id(6),
    rollbackProfileRevisionId: id(7),
    testedExtension: {
      version: "0.2.11",
      browserFamily: "chrome",
      browserVersion: "154.0.0.0",
      sourceCommitSha: "e".repeat(40),
      sourceTreeSha: "f".repeat(40),
      packageSha256: sha("1"),
    },
    testEvidence: {
      suiteRevisionId: id(8),
      suiteMachineKey: "repair-suite",
      suiteRevision: 1,
      suiteDefinitionSha256: sha("2"),
      h4EvaluationId: id(9),
      h4EvaluationKey: sha("3"),
      h4Status: null,
      h4Outcome: null,
      installedBehaviorEvidenceSha256: sha("4"),
      matrixSha256: sha("5"),
      resultsSha256: sha("6"),
    },
    assignment: {
      id: id(10),
      expectedRevision: 1,
      initialPercentageBps: 1000,
      currentRevision: null,
      currentRevisionId: null,
      currentMode: null,
      currentBaselineProfileRevisionId: null,
      currentCandidateProfileRevisionId: null,
      currentPercentageBps: null,
    },
    decision: {
      id: id(11),
      operatorPrincipalId: id(12),
      decision: "APPROVED",
      bindingSha256: sha("b"),
      requestSha256: sha("7"),
      manualChecklistSha256: sha("8"),
      issuedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2026-10-02T00:00:00.000Z",
      revokedAt: null,
      state: "STALE_APPROVED",
    },
    operation: null,
  };
}

test.describe.configure({ mode: "serial" });

test("owner sees a real scoped empty repair list through the normal BFF and API", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);
  await page.goto(adminOrigin + "/health/repairs");
  await page.getByLabel("SHA-256 scope").fill(scope);
  await page.getByRole("button", { name: "Показать случаи" }).click();
  await expect(
    page.getByText("Для этого scope случаев исправления нет."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Применить/i })).toHaveCount(0);
});

test("support permission is rejected through the normal BFF and by the UI", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(support, "ADMIN_SUPPORT");
  await adminLogin(page, support);
  const response = await page
    .context()
    .request.get(
      adminOrigin +
        "/api/control-plane/v1/admin/health/repair-cases?scopeSha256=" +
        scope,
    );
  expect(response.status()).toBe(403);
  await page.goto(adminOrigin + "/health/repairs");
  await expect(page.getByText(/нужны одновременно права Health/)).toBeVisible();
});

test("partial repair evidence is explicit and never becomes an apply action", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);
  const item = safeCase();
  const requested: string[] = [];
  await page.route(
    /\/api\/control-plane\/v1\/admin\/health\/repair-cases/,
    async (route) => {
      const url = new URL(route.request().url());
      requested.push(url.pathname + url.search);
      const detail = /\/repair-cases\/[^/]+\/1$/.test(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          detail ? item : { items: [item], nextCursor: null },
        ),
      });
    },
  );
  await page.goto(adminOrigin + "/health/repairs");
  await page.getByLabel("SHA-256 scope").fill(scope);
  await page.getByRole("button", { name: "Показать случаи" }).click();
  await expect(page.getByText("Разрешение устарело")).toBeVisible();
  await page.getByRole("button", { name: "Открыть" }).click();
  await expect(
    page.getByRole("heading", { name: "Карточка исправления" }),
  ).toBeVisible();
  await expect(page.getByText(/executionAuthority=false/)).toBeVisible();
  await expect(
    page.getByText("Нет текущего контрольного запуска."),
  ).toBeVisible();
  await expect(page.getByText("Нет результата H4.")).toBeVisible();
  await expect(page.getByText(/Текущее наблюдение отличается/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Применить/i })).toHaveCount(0);
  expect(requested).toHaveLength(2);
  expect(
    requested.every((value) => value.includes("scopeSha256=" + scope)),
  ).toBe(true);
});

test("repair API failure is shown without raw upstream details", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);
  await page.route(
    /\/api\/control-plane\/v1\/admin\/health\/repair-cases/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SERVICE_UNAVAILABLE", message: "<private SQLSTATE>" },
        }),
      }),
  );
  await page.goto(adminOrigin + "/health/repairs");
  await page.getByLabel("SHA-256 scope").fill(scope);
  await page.getByRole("button", { name: "Показать случаи" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SQLSTATE");
});
