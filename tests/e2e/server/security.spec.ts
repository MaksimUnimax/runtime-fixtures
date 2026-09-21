import { expect, test } from "@playwright/test";
import {
  apiOrigin,
  approve,
  client,
  login,
  portalOrigin,
  reset,
  sql,
  start,
} from "./support/fixtures.js";

test.beforeEach(async () => reset());

test("unsafe return targets stay on the portal origin", async ({ page }) => {
  const allowedOrigins = new Set([portalOrigin, apiOrigin]);
  await page.route("**/*", async (route) => {
    if (!allowedOrigins.has(new URL(route.request().url()).origin)) {
      await route.abort();
      throw new Error("unexpected origin");
    }
    await route.continue();
  });
  for (const [index, unsafe] of [
    "https://example.com",
    "//example.com",
    "javascript:alert(1)",
    "%2F%2Fevil.example",
  ].entries()) {
    await page.goto(`/login?returnTo=${encodeURIComponent(unsafe)}`);
    await page
      .getByLabel("Email")
      .fill(`p26-openredirect-${index + 1}@example.test`);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill("424242");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(`${portalOrigin}/`);
    expect(new URL(page.url()).origin).toBe(portalOrigin);
    expect(new URL(page.url()).pathname).toBe("/");
  }
});

test("activation leaves secrets out of browser URLs and storage", async ({
  page,
}) => {
  await login(page);
  const extension = client();
  const authorization = await start(extension);
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await approve(page, authorization);
  expect(
    await extension.exchange(
      authorization.deviceCode,
      "e2e-privacy-exchange-01",
    ),
  ).toEqual({ kind: "ACTIVATED" });
  await page.goto("/devices");
  for (const secret of [
    authorization.userCode,
    authorization.deviceCode,
    "424242",
  ]) {
    expect(urls.some((url) => url.includes(secret))).toBe(false);
  }
  const keys = await page.evaluate(() => [
    ...Object.keys(localStorage),
    ...Object.keys(sessionStorage),
  ]);
  expect(
    keys.filter((key) =>
      /otp|challenge|user.?code|device.?code|access.?token|refresh.?token|session|csrf/i.test(
        key,
      ),
    ),
  ).toEqual([]);
});

test("suspended accounts remain manageable but cannot approve", async ({
  page,
}) => {
  await login(page);
  const extension = client();
  const first = await start(extension);
  await approve(page, first);
  expect(
    await extension.exchange(first.deviceCode, "e2e-suspend-first-01"),
  ).toEqual({ kind: "ACTIVATED" });
  const accounts = await sql<{ id: string }>("SELECT id FROM accounts LIMIT 1");
  await sql("UPDATE accounts SET status = 'SUSPENDED' WHERE id = $1", [
    accounts[0]!.id,
  ]);
  const second = await start(client());
  await page.goto(second.verificationUrl);
  await expect(page.getByRole("combobox")).toContainText(/SUSPENDED/);
  await page.getByLabel("User code").fill(second.userCode);
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await page.goto("/devices");
  await expect(page.getByRole("combobox")).toContainText(/SUSPENDED/);
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(/REVOKED/)).toBeVisible();
});
