import { test, expect, type Page, type Route } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const draft = "Кнопка не показала результат проверки.";
const accounts = [
  { id: accountId, displayName: "Test account", status: "ACTIVE" },
];
const accepted = { case: { caseId } };
const submittedCase = {
  caseId,
  category: "OTHER",
  severity: "NORMAL",
  status: "OPEN",
  description: draft,
  createdAt: "2026-10-24T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
};
const main = (page: Page) => page.getByRole("main");
const status = (page: Page, text: string | RegExp) =>
  main(page).getByRole("status").filter({ hasText: text });
const send = (page: Page) =>
  main(page).getByRole("button", { name: "Отправить", exact: true });
const field = (page: Page) =>
  main(page).getByRole("textbox", { name: "Описание", exact: true });
const json = (route: Route, value: unknown, code = 200) =>
  route.fulfill({
    status: code,
    contentType: "application/json",
    body: JSON.stringify(value),
  });

test.describe("portal feedback recovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/control-plane/v1/accounts", (route) =>
      json(route, { accounts }),
    );
    await page.route("**/api/control-plane/v1/support/cases", (route) =>
      json(route, { items: [] }),
    );
  });

  async function ready(page: Page) {
    await page.goto("/feedback");
    await expect(
      main(page).getByRole("heading", { name: "Обратная связь", exact: true }),
    ).toBeVisible();
    await field(page).fill(draft);
    await expect(send(page)).toBeEnabled();
  }

  test("pending same-task submits issue only one POST and freeze the draft", async ({
    page,
  }) => {
    let posts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/control-plane/v1/support/cases", async (route) => {
      if (route.request().method() !== "POST")
        return json(route, { items: [] });
      posts += 1;
      await gate;
      await json(route, accepted);
    });
    try {
      await ready(page);
      await main(page)
        .locator("form")
        .evaluate((form) => {
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
        });
      await expect(send(page)).toBeDisabled();
      await expect(field(page)).toBeDisabled();
      await expect.poll(() => posts).toBe(1);
      release();
      await expect(status(page, caseId)).toBeVisible();
      expect(posts).toBe(1);
    } finally {
      release();
    }
  });

  for (const failure of [
    "network",
    "http",
    "malformed",
    "missing-case",
  ] as const) {
    test(`submission ${failure} failure preserves draft and never claims success`, async ({
      page,
    }) => {
      let posts = 0;
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route(
        "**/api/control-plane/v1/support/cases",
        async (route) => {
          if (route.request().method() !== "POST")
            return json(route, { items: [] });
          posts += 1;
          if (failure === "network") return route.abort("failed");
          if (failure === "http") return json(route, {}, 503);
          if (failure === "malformed")
            return route.fulfill({
              status: 200,
              contentType: "application/json",
              body: "not-json",
            });
          return json(route, { case: {} });
        },
      );
      await ready(page);
      await send(page).click();
      await expect(
        status(page, "Не удалось подтвердить отправку"),
      ).toBeVisible();
      await expect(field(page)).toHaveValue(draft);
      await expect(send(page)).toBeEnabled();
      await expect(status(page, "Сообщение принято")).toHaveCount(0);
      expect(posts).toBe(1);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const failure of ["network", "http", "malformed"] as const) {
    test(`initial ${failure} load is visibly unavailable, not an empty list`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/control-plane/v1/support/cases", (route) => {
        if (failure === "network") return route.abort("failed");
        if (failure === "http") return json(route, {}, 503);
        return json(route, { items: null });
      });
      await page.goto("/feedback");
      await expect(
        status(page, "Не удалось загрузить данные обратной связи"),
      ).toBeVisible();
      await expect(status(page, "Загрузка…")).toHaveCount(0);
      await expect(
        main(page).getByText("Обращений пока нет.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        main(page).getByRole("button", { name: "Обновить", exact: true }),
      ).toBeEnabled();
      expect(pageErrors).toEqual([]);
    });
  }

  test("explicit reload recovers initial failure without an automatic retry", async ({
    page,
  }) => {
    let reads = 0;
    await page.route("**/api/control-plane/v1/support/cases", (route) => {
      reads += 1;
      return reads === 1 ? json(route, {}, 503) : json(route, { items: [] });
    });
    await page.goto("/feedback");
    await expect(
      status(page, "Не удалось загрузить данные обратной связи"),
    ).toBeVisible();
    expect(reads).toBe(1);
    await main(page)
      .getByRole("button", { name: "Обновить", exact: true })
      .click();
    await expect(
      main(page).getByText("Обращений пока нет.", { exact: true }),
    ).toBeVisible();
    await field(page).fill(draft);
    await expect(send(page)).toBeEnabled();
    expect(reads).toBe(2);
  });

  for (const includeDiagnostics of [false, true]) {
    test(`success preserves CSRF and diagnostics consent=${includeDiagnostics}`, async ({
      page,
    }) => {
      let posted: Record<string, unknown> | undefined;
      let csrf: string | undefined;
      await page.route("**/api/control-plane/v1/support/cases", (route) => {
        if (route.request().method() !== "POST")
          return json(route, { items: posted ? [submittedCase] : [] });
        posted = route.request().postDataJSON() as Record<string, unknown>;
        csrf = route.request().headers()["x-csrf-token"];
        return json(route, accepted);
      });
      await ready(page);
      await page.evaluate(() => {
        document.cookie =
          "pcp_csrf=synthetic-feedback-csrf; path=/; SameSite=Lax";
      });
      await main(page).getByRole("checkbox").setChecked(includeDiagnostics);
      await send(page).click();
      await expect(status(page, caseId)).toBeVisible();
      await expect(field(page)).toHaveValue("");
      await expect(main(page).getByRole("listitem")).toContainText(draft);
      expect(posted).toEqual({
        accountId,
        category: "OTHER",
        description: draft,
        ...(includeDiagnostics
          ? { diagnostics: { portalVersion: "0.1.0" } }
          : {}),
      });
      expect(csrf).toBe("synthetic-feedback-csrf");
    });
  }

  test("accepted POST remains accepted when the following list reload fails", async ({
    page,
  }) => {
    let posted = false;
    await page.route("**/api/control-plane/v1/support/cases", (route) => {
      if (route.request().method() === "POST") {
        posted = true;
        return json(route, accepted);
      }
      return posted ? route.abort("failed") : json(route, { items: [] });
    });
    await ready(page);
    await send(page).click();
    await expect(status(page, caseId)).toBeVisible();
    await expect(
      status(page, "Не удалось загрузить данные обратной связи"),
    ).toBeVisible();
    await expect(status(page, "Не удалось подтвердить отправку")).toHaveCount(
      0,
    );
    await expect(field(page)).toHaveValue("");
    await expect(field(page)).toBeEnabled();
  });
  test("shows only the verified same-case support reply in the existing feedback list", async ({
    page,
  }) => {
    const userNote = "SYNTHETIC_USER_NOTE_NOT_SUPPORT";
    const staffReply = "SYNTHETIC_SUPPORT_REPLY_B16";
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/control-plane/v1/support/cases", (route) =>
      json(route, { items: [submittedCase] }),
    );
    await page.route(
      `**/api/control-plane/v1/support/cases/${caseId}`,
      (route) =>
        json(route, {
          ...submittedCase,
          status: "TRIAGED",
          followups: [
            {
              followupId: "11111111-1111-4111-8111-111111111102",
              authorType: "USER",
              body: userNote,
              createdAt: "2026-10-24T00:01:00Z",
            },
            {
              followupId: "11111111-1111-4111-8111-111111111103",
              authorType: "SUPPORT",
              body: staffReply,
              createdAt: "2026-10-24T00:02:00Z",
            },
          ],
        }),
    );
    await page.goto("/feedback");
    await expect(
      main(page).getByText(`Номер обращения: ${caseId}`),
    ).toBeVisible();
    await main(page)
      .getByRole("button", { name: "Проверить ответ поддержки" })
      .click();
    await expect(main(page).getByText(staffReply)).toBeVisible();
    await expect(
      main(page).getByText("Актуальный статус: TRIAGED"),
    ).toBeVisible();
    await expect(main(page).getByText(userNote)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
