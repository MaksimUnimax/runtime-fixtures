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
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
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

test("expired OTP can return to email without sending a hidden request", async ({
  page,
}) => {
  let requests = 0;
  const attempts: Array<{
    challengeId: string;
    code: string;
    key: string | undefined;
  }> = [];
  await page.route(
    "**/api/control-plane/v1/auth/otp/request",
    async (route) => {
      requests += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "accepted",
          challengeId: `22222222-2222-4222-8222-${String(requests).padStart(12, "0")}`,
          expiresAt,
        }),
      });
    },
  );
  await page.route("**/api/control-plane/v1/auth/otp/verify", async (route) => {
    const body = route.request().postDataJSON() as {
      challengeId: string;
      code: string;
    };
    attempts.push({
      ...body,
      key: route.request().headers()["idempotency-key"],
    });
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "AUTH_OTP_EXPIRED" } }),
    });
  });
  await openLogin(page);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  const submit = async (code: string) => {
    await page.getByLabel("Code").fill(code);
    const response = page.waitForResponse(
      (value) =>
        value.url().endsWith("/v1/auth/otp/verify") &&
        value.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await (await response).finished();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Неверный или просроченный код",
    );
    await expect(
      page.getByRole("button", { name: "Verify", exact: true }),
    ).toBeEnabled();
  };
  await submit("111111");
  await page
    .getByRole("button", { name: "Запросить новый код", exact: true })
    .click();
  await expect(page.getByLabel("Email")).toHaveValue(
    "otp-failclosed-e2e@example.test",
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Code")).toHaveCount(0);
  expect(requests).toBe(1);
  expect(attempts).toHaveLength(1);
  await expect(page).toHaveURL(`${portalOrigin}/login?returnTo=%2Fdevices`);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByLabel("Code")).toHaveValue("");
  await submit("222222");
  await submit("222222");
  expect(requests).toBe(2);
  expect(attempts).toHaveLength(3);
  expect(attempts[1]?.challengeId).not.toBe(attempts[0]?.challengeId);
  expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
  expect(attempts[1]?.key).toMatch(/^[0-9a-f-]{36}$/i);
  expect(attempts[1]?.key).not.toBe(attempts[0]?.key);
  expect(attempts[2]?.key).toBe(attempts[1]?.key);
});

for (const phase of ["request", "verify"] as const) {
  test(`OTP ${phase} prevents overlapping submit and restart while pending`, async ({
    page,
  }) => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (phase === "verify") await acceptSyntheticChallenge(page);
    await page.route(
      `**/api/control-plane/v1/auth/otp/${phase}`,
      async (route) => {
        calls += 1;
        await gate;
        await route.fulfill({
          status: phase === "request" ? 202 : 401,
          contentType: "application/json",
          body: JSON.stringify(
            phase === "request"
              ? { status: "accepted", challengeId, expiresAt }
              : { error: { code: "AUTH_OTP_EXPIRED" } },
          ),
        });
      },
    );
    try {
      if (phase === "request") await openLogin(page);
      else await page.getByLabel("Code").fill("111111");
      const submit = page.getByRole("button", {
        name: phase === "request" ? "Send code" : "Verify",
        exact: true,
      });
      await submit.click();
      await expect.poll(() => calls).toBe(1);
      await expect(submit).toBeDisabled();
      await expect(
        page.getByLabel(phase === "request" ? "Email" : "Code"),
      ).toBeDisabled();
      if (phase === "verify")
        await expect(
          page.getByRole("button", {
            name: "Запросить новый код",
            exact: true,
          }),
        ).toBeDisabled();
      await page.locator("main form").evaluate((form) => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      release?.();
      if (phase === "request")
        await expect(page.getByLabel("Code")).toBeVisible();
      else {
        await expect(page.getByRole("main").getByRole("alert")).toContainText(
          "Неверный или просроченный код",
        );
        await expect(
          page.getByRole("button", {
            name: "Запросить новый код",
            exact: true,
          }),
        ).toBeEnabled();
      }
      expect(calls).toBe(1);
      await expect(page).toHaveURL(`${portalOrigin}/login?returnTo=%2Fdevices`);
    } finally {
      release?.();
    }
  });
}
