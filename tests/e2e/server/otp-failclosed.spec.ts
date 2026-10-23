import { expect, test, type Page } from "@playwright/test";
import { portalOrigin, reset } from "./support/fixtures.js";

const challengeId = "22222222-2222-4222-8222-222222222222";
const expiresAt = "2030-10-23T05:30:00.000Z";

test.beforeEach(async () => reset());

async function openLogin(page: Page): Promise<void> {
  await page.goto("/login?returnTo=%2Fdevices");
  await page.getByLabel("Email").fill("otp-failclosed-e2e@example.test");
}

async function acceptSyntheticChallenge(page: Page): Promise<void> {
  await page.route(
    "**/api/control-plane/v1/auth/otp/request",
    async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "accepted",
          challengeId,
          expiresAt,
        }),
      });
    },
  );
  await openLogin(page);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();
}

for (const sample of [
  {
    name: "HTTP 204 without a challenge",
    status: 204,
    body: "",
  },
  {
    name: "HTTP 202 with an invalid challenge identifier",
    status: 202,
    body: JSON.stringify({
      status: "accepted",
      challengeId: "invalid-uuid",
      expiresAt,
    }),
  },
]) {
  test(`login refuses ${sample.name} without opening OTP verification`, async ({
    page,
  }) => {
    await page.route(
      "**/api/control-plane/v1/auth/otp/request",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        await route.fulfill({
          status: sample.status,
          contentType: "application/json",
          body: sample.body,
        });
      },
    );
    await openLogin(page);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Сервер вернул неполный ответ",
    );
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Code")).toHaveCount(0);
    await expect(page).toHaveURL(`${portalOrigin}/login?returnTo=%2Fdevices`);
  });
}

test("unexpected successful verify status cannot navigate to an authenticated page", async ({
  page,
}) => {
  await acceptSyntheticChallenge(page);
  await page.route("**/api/control-plane/v1/auth/otp/verify", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ status: 204, body: "" });
  });
  await page.getByLabel("Code").fill("111111");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Сервер не подтвердил вход",
  );
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect(page).toHaveURL(`${portalOrigin}/login?returnTo=%2Fdevices`);
});

test("correcting the OTP changes the idempotency key, but retrying the same code does not", async ({
  page,
}) => {
  await acceptSyntheticChallenge(page);
  const attempts: Array<{ code: string; key: string | undefined }> = [];
  await page.route("**/api/control-plane/v1/auth/otp/verify", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const payload: unknown = request.postDataJSON();
    expect(payload).toMatchObject({ challengeId });
    const code =
      payload && typeof payload === "object" && "code" in payload
        ? (payload as { code: string }).code
        : "";
    attempts.push({
      code,
      key: request.headers()["idempotency-key"],
    });
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "AUTH_OTP_INVALID" } }),
    });
  });
  const submit = async (value: string, expectedCount: number) => {
    await page.getByLabel("Code").fill(value);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/control-plane/v1/auth/otp/verify") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Verify" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(401);
    await response.finished();
    await expect.poll(() => attempts.length).toBe(expectedCount);
  };
  await submit("111111", 1);
  await expect(page.getByRole("alert")).toContainText(
    "Неверный или просроченный код",
  );
  await submit("111111", 2);
  await submit("222222", 3);

  expect(attempts.map((attempt) => attempt.code)).toEqual([
    "111111",
    "111111",
    "222222",
  ]);
  expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
  expect(attempts[1]?.key).toBe(attempts[0]?.key);
  expect(attempts[2]?.key).not.toBe(attempts[0]?.key);
  await expect(page).toHaveURL(`${portalOrigin}/login?returnTo=%2Fdevices`);
});
