import { expect, test } from "@playwright/test";
import { createAccessAuthProbe } from "./support/access-auth-probe.js";
import { accountId, approve, client, credentials, login, portalOrigin, reset, sql, start } from "./support/fixtures.js";

test.beforeEach(async () => reset());

test("OTP browser smoke establishes strict portal cookies", async ({ page, context }) => {
  await login(page);
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "pcp_portal_session");
  const csrf = cookies.find((cookie) => cookie.name === "pcp_csrf");
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  expect(csrf).toMatchObject({ httpOnly: false, sameSite: "Strict" });
});

test("portal approval activates and refreshes a simulated extension", async ({ page }) => {
  const extension = client();
  const authorization = await start(extension);
  expect(authorization.verificationUrl).toBe(
    `${portalOrigin}/activate?authorizationId=${authorization.authorizationId}`,
  );
  expect(authorization.verificationUrl).not.toContain(authorization.deviceCode);
  expect(authorization.verificationUrl).not.toContain(authorization.userCode);
  await page.goto(authorization.verificationUrl);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel("Email").fill("e2e@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill("424242");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(new RegExp(`authorizationId=${authorization.authorizationId}$`));
  await approve(page, authorization);
  expect(await extension.exchange(authorization.deviceCode, "e2e-exchange-key-0001")).toEqual({ kind: "ACTIVATED" });
  const first = await credentials(extension);
  expect(first.deviceId).toBeTruthy();
  expect(first.sessionId).toBeTruthy();
  expect(first.accessToken).toBeTruthy();
  expect(first.refreshToken).toBeTruthy();
  await expect.poll(() => extension.refresh("e2e-refresh-key-0001")).toBe(true);
  await page.goto("/devices");
  await expect(page.getByText(/E2E Chrome — ACTIVE, chrome 123.0/)).toBeVisible();
});

test("denial closes authorization without devices, sessions, or refresh credentials", async ({ page }) => {
  await login(page);
  const extension = client();
  const authorization = await start(extension);
  await page.goto(authorization.verificationUrl);
  await page.getByLabel("User code").fill(authorization.userCode);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("status")).toContainText("denied");
  expect(await extension.exchange(authorization.deviceCode, "e2e-deny-exchange-01")).toEqual({ kind: "CLOSED" });
  expect(await sql("SELECT id FROM devices")).toHaveLength(0);
  expect(await sql("SELECT id FROM sessions")).toHaveLength(0);
  expect(await sql("SELECT id FROM refresh_tokens")).toHaveLength(0);
});

test("limit reached authorization recovers after portal revocation", async ({ page }) => {
  await login(page);
  const firstClient = client();
  const firstAuthorization = await start(firstClient);
  await approve(page, firstAuthorization);
  expect(await firstClient.exchange(firstAuthorization.deviceCode, "e2e-first-exchange-01")).toEqual({ kind: "ACTIVATED" });
  const first = await credentials(firstClient);
  const accessProbe = createAccessAuthProbe({ databaseUrl: process.env.DATABASE_URL! });
  await expect(accessProbe.authenticate(first.accessToken)).resolves.toEqual({
    ok: true,
    value: {
      accountId: await accountId(),
      deviceId: first.deviceId,
      sessionId: first.sessionId,
    },
  });
  const secondClient = client();
  const secondAuthorization = await start(secondClient);
  await approve(page, secondAuthorization);
  const exchangeKey = "e2e-second-exchange-01";
  expect(await secondClient.exchange(secondAuthorization.deviceCode, exchangeKey)).toEqual({ kind: "LIMIT_REACHED" });
  await page.goto("/devices");
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(/E2E Chrome — REVOKED/)).toBeVisible();
  expect((await sql<{ status: string }>("SELECT status FROM devices WHERE id = $1", [first.deviceId]))[0]?.status).toBe("REVOKED");
  await expect(accessProbe.authenticate(first.accessToken)).resolves.toMatchObject({ ok: false });
  expect(await firstClient.refresh("e2e-revoked-refresh-01")).toBe(false);
  expect(await secondClient.exchange(secondAuthorization.deviceCode, exchangeKey)).toEqual({ kind: "ACTIVATED" });
  await page.reload();
  await expect(page.getByText(/E2E Chrome — REVOKED/)).toBeVisible();
  await expect(page.getByText(/E2E Chrome — ACTIVE/)).toBeVisible();
  const id = await accountId();
  expect((await sql<{ active: string }>("SELECT count(*)::text AS active FROM devices WHERE account_id = $1 AND status = 'ACTIVE'", [id]))[0]?.active).toBe("1");
  await accessProbe.close();
});
