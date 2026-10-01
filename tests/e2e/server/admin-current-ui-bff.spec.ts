import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  adminLogin,
  adminOrigin,
  reset,
  seedAdminIdentity,
} from "./support/fixtures.js";

const owner = "b06-current-ui-owner@example.test";

async function json(
  response: Awaited<ReturnType<Page["request"]["fetch"]>>,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function get(page: Page, path: string) {
  return page.request.get(`${adminOrigin}/api/control-plane${path}`);
}

async function expectInvalidRequest(page: Page, path: string) {
  const response = await get(page, path);
  expect(response.status()).toBe(404);
  expect(await json(response)).toMatchObject({
    error: { code: "INVALID_REQUEST" },
  });
}

test("current admin Health, Support, and Beta UI uses the normal BFF/API path", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);

  const reads = [
    "/v1/admin/health/targets?limit=25",
    "/v1/admin/health/notifications?limit=25",
    "/v1/admin/health/diagnostics/summary?window=24h",
    "/v1/admin/health/diagnostics/breakdown?window=24h",
    "/v1/admin/support/cases?limit=50",
    "/v1/admin/support/aggregates",
    "/v1/admin/support/funnels?funnel=ONBOARDING&window=30D",
    "/v1/admin/beta/admission",
  ];
  for (const path of reads) {
    const response = await get(page, path);
    expect(response.status(), path).toBe(200);
  }

  await page.goto(`${adminOrigin}/health`);
  await expect(
    page.getByRole("heading", { name: "Health operations" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  await page.goto(`${adminOrigin}/support`);
  await expect(
    page.getByRole("heading", { name: "Support cases" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  await page.goto(`${adminOrigin}/beta`);
  await expect(
    page.getByRole("heading", { name: "Beta admission" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current state" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("allowed mutation routes reach the server CSRF guard without mutating state", async ({
  page,
}) => {
  await reset();
  await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);

  const before = await get(page, "/v1/admin/beta/admission");
  expect(before.status()).toBe(200);
  const betaBefore = await json(before);

  const betaMutation = await page.request.post(
    `${adminOrigin}/api/control-plane/v1/admin/beta/admission`,
    {
      data: {
        requestId: randomUUID(),
        expectedRevision: Number(betaBefore.revision),
        action: "OPEN",
        reason: "B06 disposable no-CSRF reachability probe",
      },
    },
  );
  expect(betaMutation.status()).toBe(403);
  expect(await json(betaMutation)).toMatchObject({
    error: { code: "ADMIN_CSRF_INVALID" },
  });

  const supportMutation = await page.request.post(
    `${adminOrigin}/api/control-plane/v1/admin/support/cases/${randomUUID()}/status`,
    { data: { status: "TRIAGED" } },
  );
  expect(supportMutation.status()).toBe(403);
  expect(await json(supportMutation)).toMatchObject({
    error: { code: "ADMIN_CSRF_INVALID" },
  });

  const after = await get(page, "/v1/admin/beta/admission");
  expect(after.status()).toBe(200);
  expect(await json(after)).toEqual(betaBefore);
});

test("unexposed adjacent admin routes fail at the BFF boundary", async ({
  page,
}) => {
  await reset();
  const identity = await seedAdminIdentity(owner, "ADMIN_OWNER");
  await adminLogin(page, owner);

  await expectInvalidRequest(page, "/v1/admin/health/incidents");
  await expectInvalidRequest(page, "/v1/admin/health/evaluations");
  await expectInvalidRequest(page, "/v1/admin/health/recommendations");
  await expectInvalidRequest(page, "/v1/admin/support/future");
  await expectInvalidRequest(
    page,
    `/v1/admin/beta/admission/accounts/${identity.accountId}`,
  );
});
