import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  adminLogin,
  adminOrigin,
  reset,
  seedAdminIdentity,
  sql,
} from "./support/fixtures.js";

// Real browser -> admin BFF -> API -> disposable PostgreSQL. There are no
// intercepted API responses or manufactured authentication cookies here.
// Identities/data and the existing harness OTP are synthetic test fixtures;
// this suite does not constitute installed or live-owner acceptance.
type Role =
  | "ADMIN_OWNER"
  | "ADMIN_OPS"
  | "ADMIN_SUPPORT"
  | "ADMIN_BETA_OPERATOR";
type Principal = {
  principalId: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
  revision: number;
  roles: string[];
};
type Snapshot = {
  status: "ACTIVE" | "SUSPENDED";
  revision: number;
  roles: string[];
  auditCount: number;
};
const bff = (path: string) => `${adminOrigin}/api/control-plane${path}`;
const email = (label: string) => `b14-${label}-${randomUUID()}@example.test`;

async function seedRole(label: string, role: Role) {
  const address = email(label);
  if (role !== "ADMIN_BETA_OPERATOR") {
    const identity = await seedAdminIdentity(address, role);
    if (!identity.principalId)
      throw new Error("Admin fixture principal missing");
    return { ...identity, principalId: identity.principalId, email: address };
  }
  const identity = await seedAdminIdentity(address);
  const [principal] = await sql<{ id: string }>(
    "INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",
    [identity.userId],
  );
  if (!principal) throw new Error("Beta fixture principal missing");
  await sql(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_BETA_OPERATOR')",
    [principal.id],
  );
  return { ...identity, principalId: principal.id, email: address };
}

async function csrf(page: Page, name = "pcp_admin_csrf") {
  const cookie = (await page.context().cookies(adminOrigin)).find(
    (value) => value.name === name,
  );
  if (!cookie) throw new Error(`Missing disposable test cookie ${name}`);
  return cookie.value;
}

async function post(page: Page, path: string, data: Record<string, unknown>) {
  return page.request.post(bff(path), {
    headers: { "x-csrf-token": await csrf(page) },
    data,
  });
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.status()).toBe(200);
  return (await response.json()) as T;
}

async function error(response: APIResponse, status: number, code: string) {
  expect(response.status()).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

async function snapshot(principalId: string): Promise<Snapshot> {
  const [row] = await sql<Snapshot>(
    `SELECT p.status,p.revision,
       ARRAY(SELECT g.role::text FROM admin_role_grants g
         WHERE g.admin_principal_id=p.id AND g.revoked_at IS NULL
         ORDER BY g.role::text) AS roles,
       (SELECT count(*)::integer FROM audit_events a
         WHERE a.target_type='ADMIN_PRINCIPAL' AND a.target_id=p.id) AS "auditCount"
     FROM admin_principals p WHERE p.id=$1`,
    [principalId],
  );
  if (!row) throw new Error("Expected disposable principal missing");
  return row;
}

async function seedDevice(accountId: string, userId: string, label: string) {
  const [device] = await sql<{ id: string }>(
    `INSERT INTO devices(account_id,created_by_user_id,label,browser_family,
       browser_version_last_seen,extension_version_last_seen)
     VALUES($1,$2,$3,'chrome','151','1.0.0') RETURNING id`,
    [accountId, userId, label],
  );
  if (!device) throw new Error("Device fixture missing");
  return device.id;
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

async function submitReview(
  page: Page,
  dialog: Locator,
  action: string,
  path: string,
) {
  const response = page.waitForResponse(
    (value) => value.request().method() === "POST" && value.url() === bff(path),
  );
  await dialog
    .getByRole("button", {
      name: `Confirm ${action}`,
      exact: true,
    })
    .click();
  return response;
}

async function uiMutation(
  page: Page,
  scope: Page | Locator,
  action: string,
  path: string,
  reason: string,
) {
  const dialog = await review(scope, action, reason);
  const response = await submitReview(page, dialog, action, path);
  expect(response.status()).toBe(200);
  await expect(
    page.getByText(`${action} completed.`, { exact: true }),
  ).toBeVisible();
  return response;
}

const principalRow = (page: Page, id: string) =>
  page.getByRole("row").filter({ hasText: id });

function countPosts(page: Page, path: string) {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url() === bff(path)) count += 1;
  });
  return () => count;
}

test.beforeEach(async () => {
  // The existing helper authorizes this reset only in its approved isolated
  // test databases. Real Server CI supplies its own PostgreSQL and one worker.
  await reset();
});

for (const role of [
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BETA_OPERATOR",
] as const) {
  test(`B14 normal OTP and real API permissions for ${role}`, async ({
    page,
  }) => {
    const actor = await seedRole("matrix", role);
    const customer = await seedAdminIdentity(email("matrix-customer"));
    const deviceId = await seedDevice(
      customer.accountId,
      customer.userId,
      "B14 matrix device",
    );
    await adminLogin(page, actor.email);
    const me = await json<{ principalId: string; roles: string[] }>(
      await page.request.get(bff("/v1/admin/me")),
    );
    expect(me).toMatchObject({ principalId: actor.principalId, roles: [role] });

    const betaOnly = role === "ADMIN_BETA_OPERATOR";
    const owner = role === "ADMIN_OWNER";
    const reads: [string, boolean][] = [
      [`/v1/admin/accounts?accountId=${customer.accountId}`, !betaOnly],
      [`/v1/admin/users?userId=${customer.userId}`, !betaOnly],
      ["/v1/admin/principals?limit=1", owner],
      ["/v1/admin/audit-events?limit=1", !betaOnly],
      ["/v1/admin/beta/admission", role !== "ADMIN_OPS"],
    ];
    for (const [path, allowed] of reads) {
      const response = await page.request.get(bff(path));
      expect(response.status(), path).toBe(allowed ? 200 : 403);
      if (!allowed)
        expect(await response.json()).toMatchObject({
          error: { code: "ADMIN_FORBIDDEN" },
        });
    }
    const creation = await post(page, "/v1/admin/principals", {
      userId: customer.userId,
      initialRole: "ADMIN_SUPPORT",
      reason: "B14 actual role authorization",
    });
    if (owner) {
      const value = await json<Principal>(creation);
      expect(value).toMatchObject({
        userId: customer.userId,
        roles: ["ADMIN_SUPPORT"],
      });
    } else {
      await error(creation, 403, "ADMIN_FORBIDDEN");
      expect(
        await sql("SELECT id FROM admin_principals WHERE user_id=$1", [
          customer.userId,
        ]),
      ).toHaveLength(0);
    }

    const revoke = await post(
      page,
      `/v1/admin/accounts/${customer.accountId}/devices/${deviceId}/revoke`,
      { reason: "B14 device permission" },
    );
    if (betaOnly) await error(revoke, 403, "ADMIN_FORBIDDEN");
    else expect(revoke.status()).toBe(200);
    const [device] = await sql<{ status: string }>(
      "SELECT status FROM devices WHERE id=$1",
      [deviceId],
    );
    expect(device?.status).toBe(betaOnly ? "ACTIVE" : "REVOKED");

    const [before] = await sql<{ revision: number; capacity: number }>(
      "SELECT revision,capacity FROM beta_admission_state WHERE id=1",
    );
    if (!before) throw new Error("Beta fixture state missing");
    const change = await post(page, "/v1/admin/beta/admission", {
      requestId: randomUUID(),
      expectedRevision: before.revision,
      action: "ADD_CAPACITY",
      amount: 1,
      reason: "B14 Beta permission",
    });
    const mayManageBeta = owner || betaOnly;
    if (mayManageBeta) expect(change.status()).toBe(200);
    else await error(change, 403, "ADMIN_FORBIDDEN");
    const [after] = await sql<{ revision: number; capacity: number }>(
      "SELECT revision,capacity FROM beta_admission_state WHERE id=1",
    );
    expect(after).toEqual(
      mayManageBeta
        ? { revision: before.revision + 1, capacity: before.capacity + 1 }
        : before,
    );
  });
}

test("B14 confirmed UI principal lifecycle persists revisions and readable audit", async ({
  page,
}) => {
  const owner = await seedRole("lifecycle-owner", "ADMIN_OWNER");
  const target = await seedAdminIdentity(email("lifecycle-target"));
  await adminLogin(page, owner.email);
  await page.goto(`${adminOrigin}/principals`);
  await page.getByLabel("User ID", { exact: true }).fill(target.userId);
  await page.getByLabel("Initial role").selectOption("ADMIN_SUPPORT");
  const dialog = await review(
    page,
    "Create principal",
    "B14 lifecycle creation",
  );
  await expect(dialog).toContainText(target.userId);
  await expect(dialog).toContainText("ADMIN_SUPPORT");
  expect(
    await sql("SELECT id FROM admin_principals WHERE user_id=$1", [
      target.userId,
    ]),
  ).toHaveLength(0);
  const creation = await submitReview(
    page,
    dialog,
    "Create principal",
    "/v1/admin/principals",
  );
  expect(creation.status()).toBe(200);
  const created = (await creation.json()) as Principal;
  expect(created).toMatchObject({
    userId: target.userId,
    revision: 1,
    roles: ["ADMIN_SUPPORT"],
  });
  const id = created.principalId;
  const row = principalRow(page, id);
  await expect(row).toBeVisible();
  expect(await snapshot(id)).toMatchObject({
    revision: 1,
    status: "ACTIVE",
    roles: ["ADMIN_SUPPORT"],
    auditCount: 2,
  });

  const grantReason = `B14-grant-${randomUUID()}`;
  for (const [operation, revision, roles] of [
    ["Grant", 2, ["ADMIN_OPS", "ADMIN_SUPPORT"]],
    ["Revoke", 3, ["ADMIN_SUPPORT"]],
  ] as const) {
    await row
      .getByRole("combobox", { name: `Role for ${id}`, exact: true })
      .selectOption("ADMIN_OPS");
    const action = `${operation} ADMIN_OPS`;
    const response = await uiMutation(
      page,
      row,
      action,
      `/v1/admin/principals/${id}/roles/ADMIN_OPS/${operation.toLowerCase()}`,
      operation === "Grant"
        ? grantReason
        : "B14 remove selected non-first role",
    );
    expect(await response.json()).toMatchObject({
      revision,
      roles: [...roles],
    });
    await expect(
      row.getByRole("cell", { name: String(revision), exact: true }),
    ).toBeVisible();
    expect(await snapshot(id)).toMatchObject({ revision, roles: [...roles] });
  }
  for (const [action, status, revision] of [
    ["Suspend", "SUSPENDED", 4],
    ["Restore", "ACTIVE", 5],
  ] as const) {
    const response = await uiMutation(
      page,
      row,
      action,
      `/v1/admin/principals/${id}/${action.toLowerCase()}`,
      `B14 ${action}`,
    );
    expect(await response.json()).toMatchObject({
      changed: true,
      principal: { status, revision },
    });
    await expect(
      row.getByRole("cell", { name: String(revision), exact: true }),
    ).toBeVisible();
    expect(await snapshot(id)).toMatchObject({ status, revision });
  }

  const events = await sql<{
    actor_id: string;
    action: string;
    reason: string;
    correlation_id: string;
  }>(
    "SELECT actor_id,action,reason,correlation_id FROM audit_events WHERE target_type='ADMIN_PRINCIPAL' AND target_id=$1",
    [id],
  );
  expect(events).toHaveLength(6);
  expect(events.every((event) => event.actor_id === owner.principalId)).toBe(
    true,
  );
  const granted = events.find(
    (event) =>
      event.action === "ADMIN_ROLE_GRANTED" && event.reason === grantReason,
  );
  if (!granted) throw new Error("Confirmed role change audit missing");
  // The BFF does not forward x-request-id. Read the correlation of this
  // exact committed fixture action, then use the public audit projection.
  const audit = await json<{ items: Record<string, unknown>[] }>(
    await page.request.get(
      bff(`/v1/admin/audit-events?correlationId=${granted.correlation_id}`),
    ),
  );
  expect(audit.items).toHaveLength(1);
  expect(audit.items[0]).toMatchObject({
    actorId: owner.principalId,
    action: "ADMIN_ROLE_GRANTED",
    targetId: id,
  });
  expect(audit.items[0]).not.toHaveProperty("reason");
  expect(audit.items[0]).not.toHaveProperty("safeMetadata");
  await page.goto(`${adminOrigin}/audit`);
  await expect(
    page.getByRole("row").filter({ hasText: granted.correlation_id }),
  ).toContainText("ADMIN_ROLE_GRANTED");
  await expect(page.locator("body")).not.toContainText(grantReason);
});

test("B14 existing Beta principals survive HTTP mutations and session suspension", async ({
  page,
  browser,
}) => {
  const owner = await seedRole("beta-owner", "ADMIN_OWNER");
  const target = await seedRole("beta-target", "ADMIN_BETA_OPERATOR");
  const betaContext = await browser.newContext();
  try {
    const betaPage = await betaContext.newPage();
    await adminLogin(page, owner.email);
    await adminLogin(betaPage, target.email);
    const initial = await json<{ items: Principal[] }>(
      await page.request.get(
        bff("/v1/admin/principals?role=ADMIN_BETA_OPERATOR"),
      ),
    );
    expect(initial.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: target.principalId,
          roles: ["ADMIN_BETA_OPERATOR"],
        }),
      ]),
    );
    for (const [operation, expectedRevision, roles] of [
      ["grant", 1, ["ADMIN_BETA_OPERATOR", "ADMIN_OPS"]],
      ["revoke", 2, ["ADMIN_BETA_OPERATOR"]],
    ] as const) {
      const value = await json<Principal>(
        await post(
          page,
          `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/${operation}`,
          { expectedRevision, reason: "B14 existing Beta role response" },
        ),
      );
      expect(value).toMatchObject({
        revision: expectedRevision + 1,
        roles: [...roles],
      });
      expect(await snapshot(target.principalId)).toMatchObject({
        revision: expectedRevision + 1,
        roles: [...roles],
      });
    }
    for (const [operation, expectedRevision, status] of [
      ["suspend", 3, "SUSPENDED"],
      ["restore", 4, "ACTIVE"],
    ] as const) {
      const value = await json<{ changed: boolean; principal: Principal }>(
        await post(
          page,
          `/v1/admin/principals/${target.principalId}/${operation}`,
          { expectedRevision, reason: "B14 existing Beta status response" },
        ),
      );
      expect(value).toMatchObject({
        changed: true,
        principal: {
          status,
          revision: expectedRevision + 1,
          roles: ["ADMIN_BETA_OPERATOR"],
        },
      });
      expect(await snapshot(target.principalId)).toMatchObject({
        status,
        revision: expectedRevision + 1,
      });
      // Restore must not revive the admin session revoked by suspension.
      await error(
        await betaPage.request.get(bff("/v1/admin/me")),
        401,
        "ADMIN_UNAUTHORIZED",
      );
    }
    await adminLogin(betaPage, target.email);
    expect(
      await json(await betaPage.request.get(bff("/v1/admin/me"))),
    ).toMatchObject({ roles: ["ADMIN_BETA_OPERATOR"] });

    const another = await seedAdminIdentity(email("new-beta"));
    const created = await json<Principal>(
      await post(page, "/v1/admin/principals", {
        userId: another.userId,
        initialRole: "ADMIN_BETA_OPERATOR",
        reason: "B14 create Beta through HTTP",
      }),
    );
    expect(created).toMatchObject({
      revision: 1,
      roles: ["ADMIN_BETA_OPERATOR"],
    });
    for (const [operation, expectedRevision, roles] of [
      ["revoke", 1, []],
      ["grant", 2, ["ADMIN_BETA_OPERATOR"]],
    ] as const) {
      const value = await json<Principal>(
        await post(
          page,
          `/v1/admin/principals/${created.principalId}/roles/ADMIN_BETA_OPERATOR/${operation}`,
          { expectedRevision, reason: "B14 Beta role path" },
        ),
      );
      expect(value).toMatchObject({
        revision: expectedRevision + 1,
        roles: [...roles],
      });
    }
  } finally {
    await betaContext.close();
  }
});

test("B14 principal mutations require the actual admin CSRF token", async ({
  page,
}) => {
  const owner = await seedRole("csrf-owner", "ADMIN_OWNER");
  const target = await seedRole("csrf-target", "ADMIN_SUPPORT");
  await adminLogin(page, owner.email);
  const path = `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`;
  const before = await snapshot(target.principalId);
  const data = { expectedRevision: 1, reason: "B14 CSRF boundary" };
  const portalCsrf = await csrf(page, "pcp_csrf");
  expect(portalCsrf).not.toBe(await csrf(page));
  for (const value of [undefined, "invalid-b14-csrf", portalCsrf]) {
    const response = await page.request.post(bff(path), {
      data,
      headers: value === undefined ? {} : { "x-csrf-token": value },
    });
    await error(response, 403, "ADMIN_CSRF_INVALID");
    expect(await snapshot(target.principalId)).toEqual(before);
  }
  const accepted = await json<Principal>(await post(page, path, data));
  expect(accepted).toMatchObject({
    revision: 2,
    roles: ["ADMIN_OPS", "ADMIN_SUPPORT"],
  });
  expect((await snapshot(target.principalId)).auditCount).toBe(
    before.auditCount + 1,
  );
});

test("B14 a real competing change makes the open form stale without replay", async ({
  page,
  browser,
}) => {
  const first = await seedRole("stale-first", "ADMIN_OWNER");
  const second = await seedRole("stale-second", "ADMIN_OWNER");
  const target = await seedRole("stale-target", "ADMIN_SUPPORT");
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await adminLogin(page, first.email);
    await adminLogin(other, second.email);
    await page.goto(`${adminOrigin}/principals`);
    const row = principalRow(page, target.principalId);
    await row
      .getByRole("combobox", {
        name: `Role for ${target.principalId}`,
        exact: true,
      })
      .selectOption("ADMIN_OPS");
    const dialog = await review(
      row,
      "Grant ADMIN_OPS",
      "B14 stale submitted form",
    );
    await json(
      await post(
        other,
        `/v1/admin/principals/${target.principalId}/roles/ADMIN_BILLING_READONLY/grant`,
        { expectedRevision: 1, reason: "B14 competing authority change" },
      ),
    );
    const before = await snapshot(target.principalId);
    const path = `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`;
    const writes = countPosts(page, path);
    const response = await submitReview(page, dialog, "Grant ADMIN_OPS", path);
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "ADMIN_STATE_STALE" },
    });
    await expect(
      page.getByText(/The previous operation was not automatically repeated/),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: "2", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("combobox", {
        name: `Role for ${target.principalId}`,
        exact: true,
      }),
    ).toHaveValue("");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("Grant ADMIN_OPS completed.", { exact: true }),
    ).toHaveCount(0);
    expect(writes()).toBe(1);
    expect(await snapshot(target.principalId)).toEqual(before);
  } finally {
    await context.close();
  }
});

test("B14 losing owner permission invalidates an already reviewed operation", async ({
  page,
  browser,
}) => {
  const first = await seedRole("loss-first", "ADMIN_OWNER");
  const second = await seedRole("loss-second", "ADMIN_OWNER");
  const target = await seedRole("loss-target", "ADMIN_SUPPORT");
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await adminLogin(page, first.email);
    await adminLogin(other, second.email);
    await page.goto(`${adminOrigin}/principals`);
    const row = principalRow(page, target.principalId);
    await row
      .getByRole("combobox", {
        name: `Role for ${target.principalId}`,
        exact: true,
      })
      .selectOption("ADMIN_OPS");
    const dialog = await review(
      row,
      "Grant ADMIN_OPS",
      "B14 permission changed before confirmation",
    );
    // Retain SUPPORT so the old session is still authenticated; the pending
    // write must fail specifically with 403, not a no-roles 401.
    await json(
      await post(
        other,
        `/v1/admin/principals/${first.principalId}/roles/ADMIN_SUPPORT/grant`,
        { expectedRevision: 1, reason: "B14 retain support role" },
      ),
    );
    await json(
      await post(
        other,
        `/v1/admin/principals/${first.principalId}/roles/ADMIN_OWNER/revoke`,
        { expectedRevision: 2, reason: "B14 withdraw owner authority" },
      ),
    );
    const before = await snapshot(target.principalId);
    const writes = countPosts(
      page,
      `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`,
    );
    const response = await submitReview(
      page,
      dialog,
      "Grant ADMIN_OPS",
      `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`,
    );
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ADMIN_FORBIDDEN" },
    });
    await expect(
      page.getByText("Your permission changed. The page has been refreshed.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: `Role for ${target.principalId}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Grant ADMIN_OPS completed.", { exact: true }),
    ).toHaveCount(0);
    expect(writes()).toBe(1);
    expect(await snapshot(target.principalId)).toEqual(before);
    expect(
      await json(await page.request.get(bff("/v1/admin/me"))),
    ).toMatchObject({ roles: ["ADMIN_SUPPORT"] });
  } finally {
    await context.close();
  }
});

test("B14 actual admin-session expiry ends editing without a write", async ({
  page,
}) => {
  const owner = await seedRole("expiry-owner", "ADMIN_OWNER");
  const target = await seedRole("expiry-target", "ADMIN_SUPPORT");
  await adminLogin(page, owner.email);
  await page.goto(`${adminOrigin}/principals`);
  const row = principalRow(page, target.principalId);
  await row
    .getByRole("combobox", {
      name: `Role for ${target.principalId}`,
      exact: true,
    })
    .selectOption("ADMIN_OPS");
  const dialog = await review(row, "Grant ADMIN_OPS", "B14 expired session");
  const before = await snapshot(target.principalId);
  // Shorten only this test identity's session. The real DB guard remains
  // enabled; created_at and all immutable identity fields remain unchanged.
  const expired = await sql<{ expired: boolean }>(
    `UPDATE admin_sessions SET expires_at=created_at+interval '1 millisecond'
     WHERE admin_principal_id=$1 AND revoked_at IS NULL
     RETURNING expires_at<=clock_timestamp() AS expired`,
    [owner.principalId],
  );
  expect(expired).toHaveLength(1);
  expect(expired[0]?.expired).toBe(true);
  const writes = countPosts(
    page,
    `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`,
  );
  const response = await submitReview(
    page,
    dialog,
    "Grant ADMIN_OPS",
    `/v1/admin/principals/${target.principalId}/roles/ADMIN_OPS/grant`,
  );
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({
    error: { code: "ADMIN_UNAUTHORIZED" },
  });
  await expect(
    page.getByRole("heading", { name: "Admin sign-in" }),
  ).toBeVisible();
  await expect(
    page.getByText("Grant ADMIN_OPS completed.", { exact: true }),
  ).toHaveCount(0);
  expect(writes()).toBe(1);
  expect(await snapshot(target.principalId)).toEqual(before);
});

test("B14 actual HTTP preserves the last active owner", async ({ page }) => {
  const owner = await seedRole("last-owner", "ADMIN_OWNER");
  await adminLogin(page, owner.email);
  const before = await snapshot(owner.principalId);
  for (const suffix of ["roles/ADMIN_OWNER/revoke", "suspend"]) {
    await error(
      await post(page, `/v1/admin/principals/${owner.principalId}/${suffix}`, {
        expectedRevision: 1,
        reason: "B14 last owner boundary",
      }),
      409,
      "ADMIN_LAST_OWNER_REQUIRED",
    );
    expect(await snapshot(owner.principalId)).toEqual(before);
  }
});

test("B14 HTTP rejects invisible audit controls before creating a principal", async ({
  page,
}) => {
  const owner = await seedRole("reason-owner", "ADMIN_OWNER");
  await adminLogin(page, owner.email);
  for (const control of ["\u0085", "\u202e"]) {
    const target = await seedAdminIdentity(email("invalid-reason"));
    await error(
      await post(page, "/v1/admin/principals", {
        userId: target.userId,
        initialRole: "ADMIN_SUPPORT",
        reason: `before${control}after`,
      }),
      400,
      "INVALID_REQUEST",
    );
    expect(
      await sql("SELECT id FROM admin_principals WHERE user_id=$1", [
        target.userId,
      ]),
    ).toHaveLength(0);
  }
});

test("B14 account lookup reads actual Beta access and only that account's devices", async ({
  page,
}) => {
  const owner = await seedRole("account-owner", "ADMIN_OWNER");
  const customerEmail = email("account-customer");
  const customer = await seedAdminIdentity(customerEmail);
  const other = await seedAdminIdentity(email("account-other"));
  await sql(
    "UPDATE accounts SET display_name='B14 target account' WHERE id=$1",
    [customer.accountId],
  );
  await sql("INSERT INTO beta_admissions(account_id,user_id) VALUES($1,$2)", [
    customer.accountId,
    customer.userId,
  ]);
  await sql("UPDATE beta_admission_state SET admitted=admitted+1 WHERE id=1");
  const deviceId = await seedDevice(
    customer.accountId,
    customer.userId,
    "B14 target installation",
  );
  const otherDeviceId = await seedDevice(
    other.accountId,
    other.userId,
    "B14 other installation",
  );
  await adminLogin(page, owner.email);
  await page.goto(`${adminOrigin}/users`);
  await page.getByLabel("Email", { exact: true }).fill(customerEmail);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: customer.userId }),
  ).toContainText(customerEmail);
  await page.goto(`${adminOrigin}/accounts`);
  await page.getByLabel("Account ID", { exact: true }).fill(customer.accountId);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const accountRow = page
    .getByRole("row")
    .filter({ hasText: customer.accountId });
  await expect(accountRow).toContainText("B14 target account");
  await accountRow
    .getByRole("link", { name: "Workspace", exact: true })
    .click();
  await expect(page).toHaveURL(`${adminOrigin}/accounts/${customer.accountId}`);
  await expect(
    page.getByText(
      "BETA access is active; commercial subscription is not required.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: deviceId }),
  ).toContainText("B14 target installation");
  await expect(
    page.getByRole("row").filter({ hasText: otherDeviceId }),
  ).toHaveCount(0);

  const access = await json(
    await page.request.get(
      bff(`/v1/admin/accounts/${customer.accountId}/subscription`),
    ),
  );
  expect(access).toMatchObject({
    accountId: customer.accountId,
    accessBasis: "BETA",
    access: { status: "ELIGIBLE", reason: null },
    subscription: null,
  });
  const devices = await json<{ items: Record<string, unknown>[] }>(
    await page.request.get(
      bff(`/v1/admin/accounts/${customer.accountId}/devices`),
    ),
  );
  expect(devices.items).toHaveLength(1);
  expect(devices.items[0]).toMatchObject({
    id: deviceId,
    status: "ACTIVE",
    browserFamily: "chrome",
  });
  expect(JSON.stringify(devices)).not.toMatch(
    /session|token|otp|secret|createdByUserId/i,
  );
  await error(
    await post(
      page,
      `/v1/admin/accounts/${customer.accountId}/devices/${otherDeviceId}/revoke`,
      { reason: "B14 account and device mismatch" },
    ),
    404,
    "ADMIN_RESOURCE_NOT_FOUND",
  );
  const [untouched] = await sql<{ status: string }>(
    "SELECT status FROM devices WHERE id=$1",
    [otherDeviceId],
  );
  expect(untouched?.status).toBe("ACTIVE");
});
