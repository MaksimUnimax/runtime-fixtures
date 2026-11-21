import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AdminPrincipalCreateBodyV1Schema,
  AdminPrincipalItemV1Schema,
  AdminPrincipalMutationBodyV1Schema,
  AdminPrincipalRoleParamsV1Schema,
} from "../../../packages/contracts/src/index";

// Actual UI in a browser with synthetic API responses checked against the wire
// schemas. This does not replace server RBAC/transaction or installed testing.
const adminOrigin = `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3300"}`;
const principalId = "00000000-0000-4000-8000-000000000014";
const userId = "00000000-0000-4000-8000-000000000015";
const csrf = "synthetic-principal-role-csrf";
const grantRole = "ADMIN_BILLING_READONLY";
type Failure = "ADMIN_STATE_STALE" | "ADMIN_UNAUTHORIZED" | "ADMIN_FORBIDDEN";

async function principalPage(
  page: Page,
  options: {
    failure?: Failure;
    readOnly?: boolean;
    holdWrite?: Promise<void>;
  } = {},
) {
  const writes: { path: string; body: unknown; csrf: string | undefined }[] =
    [];
  const principal = {
    principalId,
    userId,
    status: "ACTIVE",
    revision: 7,
    roles: ["ADMIN_SUPPORT", "ADMIN_OPS"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let authenticated = true;
  let manage = !options.readOnly;
  await page
    .context()
    .addCookies([{ name: "pcp_admin_csrf", value: csrf, url: adminOrigin }]);
  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split(
      "/api/control-plane",
    )[1]!;
    if (request.method() === "GET" && path === "/v1/admin/me") {
      await route.fulfill(
        authenticated
          ? {
              json: {
                status: "authenticated",
                principalId: "00000000-0000-4000-8000-000000000001",
                roles: ["ADMIN_OWNER"],
                permissions: [
                  "admin.principal.read",
                  ...(manage ? ["admin.principal.manage"] : []),
                ],
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
            }
          : { status: 401, json: { error: { code: "ADMIN_UNAUTHORIZED" } } },
      );
      return;
    }
    if (request.method() === "GET" && path === "/v1/admin/principals") {
      await route.fulfill({
        json: {
          items: [AdminPrincipalItemV1Schema.parse(principal)],
          nextCursor: null,
        },
      });
      return;
    }
    if (
      request.method() === "POST" &&
      path.startsWith("/v1/admin/principals")
    ) {
      const body: unknown = request.postDataJSON();
      if (path === "/v1/admin/principals")
        AdminPrincipalCreateBodyV1Schema.parse(body);
      else AdminPrincipalMutationBodyV1Schema.parse(body);
      const roleChange = path.match(
        /\/principals\/([^/]+)\/roles\/([^/]+)\/(grant|revoke)$/,
      );
      if (roleChange)
        AdminPrincipalRoleParamsV1Schema.parse({
          principal_id: roleChange[1],
          role: roleChange[2],
        });
      writes.push({ path, body, csrf: request.headers()["x-csrf-token"] });
      await options.holdWrite;
      const { failure } = options;
      if (failure) {
        if (failure === "ADMIN_UNAUTHORIZED") authenticated = false;
        if (failure === "ADMIN_FORBIDDEN") manage = false;
        if (failure === "ADMIN_STATE_STALE") principal.revision = 8;
        await route.fulfill({
          status:
            failure === "ADMIN_UNAUTHORIZED"
              ? 401
              : failure === "ADMIN_FORBIDDEN"
                ? 403
                : 409,
          json: { error: { code: failure } },
        });
        return;
      }
      if (roleChange) {
        principal.roles =
          roleChange[3] === "grant"
            ? [...principal.roles, roleChange[2]!]
            : principal.roles.filter((role) => role !== roleChange[2]);
        principal.revision++;
      }
      await route.fulfill({
        json: AdminPrincipalItemV1Schema.parse(principal),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_TEST_REQUEST" } },
    });
  });
  await page.goto(`${adminOrigin}/principals`);
  await expect(
    page.getByRole("heading", { name: "Admin principals" }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: principalId });
  await expect(row).toBeVisible();
  return { writes, row };
}

async function review(scope: Page | Locator, action: string, reason: string) {
  const button = scope.getByRole("button", { name: action, exact: true });
  const panel = button.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]",
  );
  await panel.getByLabel("Operator reason").fill(reason);
  await button.click();
  return scope.getByRole("dialog", { name: `Confirm ${action}`, exact: true });
}

test("creates a principal with the chosen user, role, reason and CSRF", async ({
  page,
}) => {
  const { writes } = await principalPage(page);
  await expect(page.getByLabel("Initial role").locator("option")).toHaveCount(
    4,
  );
  await page.getByLabel("User ID", { exact: true }).fill(userId);
  await page.getByLabel("Initial role").selectOption("ADMIN_OPS");
  const dialog = await review(
    page,
    "Create principal",
    " operations administration ",
  );
  await expect(dialog).toContainText(userId);
  await expect(dialog).toContainText("ADMIN_OPS");
  expect(writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Confirm Create principal", exact: true })
    .click();
  await expect(
    page.getByText("Create principal completed.", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([
    {
      path: "/v1/admin/principals",
      body: {
        userId,
        initialRole: "ADMIN_OPS",
        reason: "operations administration",
      },
      csrf,
    },
  ]);
});

test("changing the new principal target requires a new confirmation", async ({
  page,
}) => {
  const { writes } = await principalPage(page);
  await page.getByLabel("User ID", { exact: true }).fill(userId);
  await review(page, "Create principal", "initial target");
  await page.getByLabel("Initial role").selectOption("ADMIN_OPS");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const dialog = await review(page, "Create principal", "changed role");
  await expect(dialog).toContainText("ADMIN_OPS");
  await page
    .getByLabel("User ID", { exact: true })
    .fill("00000000-0000-4000-8000-000000000016");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("grants the selected role instead of the principal's first role", async ({
  page,
}) => {
  const { writes, row } = await principalPage(page);
  await expect(row.getByRole("button", { name: /^Grant / })).toHaveCount(0);
  await row
    .getByRole("combobox", { name: `Role for ${principalId}`, exact: true })
    .selectOption(grantRole);
  await expect(
    row.getByRole("button", { name: `Revoke ${grantRole}`, exact: true }),
  ).toBeDisabled();
  const dialog = await review(
    row,
    `Grant ${grantRole}`,
    "grant billing access",
  );
  await expect(dialog).toContainText(principalId);
  await expect(dialog).toContainText(grantRole);
  await dialog
    .getByRole("button", { name: `Confirm Grant ${grantRole}`, exact: true })
    .click();
  await expect(
    page.getByText(`Grant ${grantRole} completed.`, { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([
    {
      path: `/v1/admin/principals/${principalId}/roles/${grantRole}/grant`,
      body: { expectedRevision: 7, reason: "grant billing access" },
      csrf,
    },
  ]);
  await expect(
    row.getByRole("combobox", { name: `Role for ${principalId}`, exact: true }),
  ).toHaveValue("");
  await expect(row.getByRole("cell", { name: "8", exact: true })).toBeVisible();
});

test("revokes a non-first role and prevents a redundant grant", async ({
  page,
}) => {
  const { writes, row } = await principalPage(page);
  await row
    .getByRole("combobox", { name: `Role for ${principalId}`, exact: true })
    .selectOption("ADMIN_OPS");
  await expect(
    row.getByRole("button", { name: "Grant ADMIN_OPS", exact: true }),
  ).toBeDisabled();
  const dialog = await review(
    row,
    "Revoke ADMIN_OPS",
    "remove operations access",
  );
  await expect(dialog).toContainText(principalId);
  await dialog
    .getByRole("button", { name: "Confirm Revoke ADMIN_OPS", exact: true })
    .click();
  await expect(
    page.getByText("Revoke ADMIN_OPS completed.", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([
    {
      path: `/v1/admin/principals/${principalId}/roles/ADMIN_OPS/revoke`,
      body: { expectedRevision: 7, reason: "remove operations access" },
      csrf,
    },
  ]);
  await expect(
    row.getByRole("cell", { name: "ADMIN_SUPPORT", exact: true }),
  ).toBeVisible();
});

test("changing a selected role discards its reason and confirmation", async ({
  page,
}) => {
  const { writes, row } = await principalPage(page);
  const selection = row.getByRole("combobox", {
    name: `Role for ${principalId}`,
    exact: true,
  });
  await selection.selectOption(grantRole);
  await review(row, `Grant ${grantRole}`, "old role");
  await selection.selectOption("ADMIN_OWNER");
  await expect(row.getByRole("dialog")).toHaveCount(0);
  await row
    .getByRole("button", { name: "Grant ADMIN_OWNER", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Confirm Grant ADMIN_OWNER", exact: true }),
  ).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("a stale role change reloads the revision without replay or success", async ({
  page,
}) => {
  const { writes, row } = await principalPage(page, {
    failure: "ADMIN_STATE_STALE",
  });
  await row
    .getByRole("combobox", { name: `Role for ${principalId}`, exact: true })
    .selectOption(grantRole);
  const dialog = await review(row, `Grant ${grantRole}`, "stale target");
  await dialog
    .getByRole("button", { name: `Confirm Grant ${grantRole}`, exact: true })
    .click();
  await expect(
    page.getByText(/The previous operation was not automatically repeated/),
  ).toBeVisible();
  await expect(row.getByRole("cell", { name: "8", exact: true })).toBeVisible();
  await expect(
    row.getByRole("combobox", { name: `Role for ${principalId}`, exact: true }),
  ).toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText(`Grant ${grantRole} completed.`, { exact: true }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

for (const failure of ["ADMIN_UNAUTHORIZED", "ADMIN_FORBIDDEN"] as const) {
  test(`${failure} ends role editing without replaying the change`, async ({
    page,
  }) => {
    const { writes, row } = await principalPage(page, { failure });
    await row
      .getByRole("combobox", { name: `Role for ${principalId}`, exact: true })
      .selectOption(grantRole);
    const dialog = await review(row, `Grant ${grantRole}`, "permission check");
    await dialog
      .getByRole("button", { name: `Confirm Grant ${grantRole}`, exact: true })
      .click();
    if (failure === "ADMIN_UNAUTHORIZED")
      await expect(
        page.getByRole("heading", { name: "Admin sign-in" }),
      ).toBeVisible();
    else
      await expect(
        page.getByText(
          "Your permission changed. The page has been refreshed.",
          { exact: true },
        ),
      ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: `Role for ${principalId}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText(`Grant ${grantRole} completed.`, { exact: true }),
    ).toHaveCount(0);
    expect(writes).toHaveLength(1);
  });
}

test("a principal reader receives no role mutation controls", async ({
  page,
}) => {
  const { writes, row } = await principalPage(page, { readOnly: true });
  await expect(page.getByLabel("Initial role")).toHaveCount(0);
  await expect(row.getByRole("combobox")).toHaveCount(0);
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

for (const operation of ["create", "grant"] as const) {
  test(`a pending ${operation} locks its target and blocks a second write`, async ({
    page,
  }) => {
    let release!: () => void;
    const holdWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { writes, row } = await principalPage(page, { holdWrite });
    try {
      if (operation === "create")
        await page.getByLabel("User ID", { exact: true }).fill(userId);
      else
        await row
          .getByRole("combobox", {
            name: `Role for ${principalId}`,
            exact: true,
          })
          .selectOption(grantRole);
      const action =
        operation === "create" ? "Create principal" : `Grant ${grantRole}`;
      const scope = operation === "create" ? page : row;
      const dialog = await review(scope, action, "pending request");
      await dialog
        .getByRole("button", { name: `Confirm ${action}`, exact: true })
        .click();
      await expect.poll(() => writes.length).toBe(1);
      await expect(
        dialog.getByRole("button", { name: `Confirm ${action}`, exact: true }),
      ).toBeDisabled();
      if (operation === "create") {
        await expect(
          page.getByLabel("User ID", { exact: true }),
        ).toBeDisabled();
        await expect(page.getByLabel("Initial role")).toBeDisabled();
      } else {
        await expect(
          row.getByRole("combobox", {
            name: `Role for ${principalId}`,
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          row.getByRole("button", { name: "Suspend", exact: true }),
        ).toBeDisabled();
        await expect(
          row.getByRole("button", { name: "Restore", exact: true }),
        ).toBeDisabled();
      }
      expect(writes).toHaveLength(1);
      release();
      await expect(
        page.getByText(`${action} completed.`, { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
  });
}
