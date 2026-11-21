import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AdminAccountsResponseV1Schema,
  AdminDeviceRevokeBodyV1Schema,
  AdminDeviceRevokeResponseV1Schema,
  AdminDevicesResponseV1Schema,
  AdminMeResponseV1Schema,
  AdminPrincipalCreateBodyV1Schema,
  AdminPrincipalItemV1Schema,
  AdminPrincipalMutationBodyV1Schema,
  AdminPrincipalsResponseV1Schema,
  AdminPrincipalStatusResponseV1Schema,
  AdminSessionResponseV1Schema,
  AdminSubscriptionGrantBodyV1Schema,
  AdminSubscriptionMutationResponseV1Schema,
  AdminSubscriptionResponseV1Schema,
  ApiErrorEnvelopeV1Schema,
} from "../../../packages/contracts/src/index";
import {
  DefinitionDeprecateBodySchema,
  OverrideClearBodySchema,
  OverrideSetBodySchema,
  PlanCreateBodySchema,
  PlanUpdateBodySchema,
  type AdminCommercialPage,
} from "../../../packages/server/admin-commercial/src/index";
import type {
  InspectedPlan,
  InspectedPrice,
} from "../../../packages/server/commercial-catalog/src/index";
import {
  computeP4PlanRevisionContentFingerprintV1,
  type EntitlementDefinition,
  type PlanSummary,
} from "../../../packages/server/plans/src/index";
import {
  CommercialEntitlementResolutionSchema,
  type AccountEntitlementOverride,
} from "../../../packages/server/entitlements/src/index";

// B14 browser regressions against the actual admin UI and explicitly synthetic
// API responses. Fixtures use current exported wire schemas where available;
// commercial reads below use the current service DTOs and route projection.
// These scenarios
// do not establish real API/RBAC, persistence/audit, package or installed status.
// No shared fixture login, database reset, server process or new contract lives
// in this file. The runner owns the isolated Next server and E2E_ADMIN_PORT.
const adminOrigin = `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3300"}`;
const accountA = "00000000-0000-4000-8000-000000000081";
const accountB = "00000000-0000-4000-8000-000000000082";
const principalId = "00000000-0000-4000-8000-000000000083";
const userId = "00000000-0000-4000-8000-000000000084";
const subscriptionId = "00000000-0000-4000-8000-000000000085";
const planOne = "00000000-0000-4000-8000-000000000086";
const planTwo = "00000000-0000-4000-8000-000000000087";
const deviceA = "00000000-0000-4000-8000-000000000088";
const deviceB = "00000000-0000-4000-8000-000000000089";
const csrf = "synthetic-b14-admin-csrf";
const createdAt = "2026-01-01T00:00:00.000Z";
const initialPeriod = "2030-11-01T10:30";
const changedPeriod = "2030-12-01T15:30";
const accountPath = (id: string, resource: string) =>
  `/v1/admin/accounts/${id}/${resource}`;
const apiPath = (url: string) =>
  new URL(url).pathname.split("/api/control-plane")[1]!;

test.use({ timezoneId: "UTC" });

type SubscriptionRead = ReturnType<
  typeof AdminSubscriptionResponseV1Schema.parse
>;
type DeviceRead = ReturnType<typeof AdminDevicesResponseV1Schema.parse>;
type AuthFailure = "ADMIN_UNAUTHORIZED" | "ADMIN_REAUTH_REQUIRED";
type Write = {
  method: string;
  path: string;
  body: unknown;
  csrf: string | undefined;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function subscription(
  accountId: string,
  options: {
    basis?: "BETA" | "COMMERCIAL" | "NONE";
    planName?: string;
    omitBasis?: boolean;
  } = {},
): SubscriptionRead {
  const basis = options.basis ?? "COMMERCIAL";
  return AdminSubscriptionResponseV1Schema.parse({
    accountId,
    ...(options.omitBasis ? {} : { accessBasis: basis }),
    access: {
      status: basis === "NONE" ? "INELIGIBLE" : "ELIGIBLE",
      reason: basis === "NONE" ? "NO_CURRENT_SUBSCRIPTION" : null,
    },
    subscription:
      basis === "COMMERCIAL"
        ? {
            id: subscriptionId,
            state: "ACTIVE",
            stateRevision: 7,
            plan: {
              planRevisionId: planOne,
              planCode: "B14_SYNTHETIC",
              planRevision: 3,
              displayName: options.planName ?? "Synthetic B14 professional",
            },
            price: null,
            currentPeriodStart: createdAt,
            currentPeriodEnd: "2030-11-01T10:30:00.000Z",
            graceUntil: null,
            cancelAtPeriodEnd: false,
          }
        : null,
    deviceAllowance: {
      maxActive: null,
      activeCount: 1,
      remaining: null,
      overLimit: false,
    },
  });
}

function devices(id: string, label: string, withheld = false): DeviceRead {
  return AdminDevicesResponseV1Schema.parse({
    items: [
      {
        id,
        status: "ACTIVE",
        label,
        createdAt,
        activatedAt: createdAt,
        lastSeenAt: createdAt,
        revokedAt: null,
        ...(withheld
          ? {}
          : {
              browserFamily: "chrome",
              browserVersionLastSeen: "140.0",
              extensionVersionLastSeen: "1.0.0",
            }),
      },
    ],
    nextCursor: null,
  });
}

function apiError(
  code: AuthFailure | "SERVICE_UNAVAILABLE" | "ADMIN_STATE_STALE",
) {
  return ApiErrorEnvelopeV1Schema.parse({
    error: {
      code,
      message: "Synthetic B14 API response",
      correlationId: "synthetic-b14-safety",
    },
  });
}

async function syntheticApi(
  page: Page,
  options: {
    subscriptionA?: SubscriptionRead;
    withheldDevice?: boolean;
    principalStatus?: "ACTIVE" | "SUSPENDED";
    holdWrite?: Promise<void>;
    rejectLogout?: boolean;
  } = {},
) {
  const reads: string[] = [];
  const writes: Write[] = [];
  const unexpected: string[] = [];
  const subscriptions = new Map([
    [accountA, options.subscriptionA ?? subscription(accountA)],
    [
      accountB,
      subscription(accountB, { planName: "Synthetic account B plan" }),
    ],
  ]);
  const devicePages = new Map([
    [
      accountA,
      devices(
        deviceA,
        "Synthetic account A installation",
        options.withheldDevice,
      ),
    ],
    [accountB, devices(deviceB, "Synthetic account B installation")],
  ]);
  const principal = AdminPrincipalItemV1Schema.parse({
    principalId,
    userId,
    status: options.principalStatus ?? "ACTIVE",
    revision: 7,
    roles: ["ADMIN_SUPPORT"],
    createdAt,
    updatedAt: createdAt,
  });
  let authFailure: AuthFailure | undefined;
  const heldReads = new Map<
    string,
    {
      seen: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
      settled: ReturnType<typeof deferred>;
    }
  >();

  await page
    .context()
    .addCookies([{ name: "pcp_admin_csrf", value: csrf, url: adminOrigin }]);
  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const path = apiPath(request.url());
    const method = request.method();
    if (method === "GET") reads.push(path);
    const held = method === "GET" ? heldReads.get(path) : undefined;
    if (held) {
      heldReads.delete(path);
      held.seen.resolve();
      await held.release.promise;
    }
    // Next may abort an old page's GET during normal client-side navigation.
    // That is a valid isolation outcome; any other route error remains a failure.
    const fulfill = async (status: number, json?: unknown) => {
      try {
        await route.fulfill({
          status,
          ...(json === undefined ? {} : { json }),
        });
      } catch (error) {
        if (!page.isClosed() && !request.failure()) throw error;
      } finally {
        held?.settled.resolve();
      }
    };

    if (method === "GET" && authFailure) {
      await fulfill(401, apiError(authFailure));
      return;
    }
    if (method === "GET" && path === "/v1/admin/me") {
      await fulfill(
        200,
        AdminMeResponseV1Schema.parse({
          status: "authenticated",
          principalId: "00000000-0000-4000-8000-000000000080",
          roles: ["ADMIN_OWNER"],
          permissions: [
            "account.read",
            "subscription.read",
            "subscription.grant",
            "device.read",
            "admin.principal.read",
            "admin.principal.manage",
          ],
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      );
      return;
    }
    if (method === "GET" && path === "/v1/admin/accounts") {
      const requested = new URL(request.url()).searchParams.get("accountId");
      await fulfill(
        200,
        AdminAccountsResponseV1Schema.parse({
          items: [accountA, accountB]
            .filter((id) => !requested || requested === id)
            .map((id) => ({
              id,
              status: "ACTIVE",
              displayName:
                id === accountA ? "Synthetic account A" : "Synthetic account B",
              createdAt,
              updatedAt: createdAt,
            })),
          nextCursor: null,
        }),
      );
      return;
    }
    for (const id of [accountA, accountB]) {
      if (method === "GET" && path === accountPath(id, "subscription")) {
        await fulfill(
          200,
          AdminSubscriptionResponseV1Schema.parse(subscriptions.get(id)),
        );
        return;
      }
      if (method === "GET" && path === accountPath(id, "devices")) {
        await fulfill(
          200,
          AdminDevicesResponseV1Schema.parse(devicePages.get(id)),
        );
        return;
      }
    }
    if (method === "GET" && path === "/v1/admin/principals") {
      await fulfill(
        200,
        AdminPrincipalsResponseV1Schema.parse({
          items: [principal],
          nextCursor: null,
        }),
      );
      return;
    }
    if (method === "DELETE" && path === "/v1/admin/session") {
      writes.push({
        method,
        path,
        body: null,
        csrf: request.headers()["x-csrf-token"],
      });
      authFailure = "ADMIN_UNAUTHORIZED";
      await fulfill(
        options.rejectLogout ? 401 : 204,
        options.rejectLogout ? apiError(authFailure) : undefined,
      );
      return;
    }
    if (
      method === "POST" &&
      path === accountPath(accountA, "subscription/grant")
    ) {
      const body = AdminSubscriptionGrantBodyV1Schema.parse(
        request.postDataJSON(),
      );
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      await options.holdWrite;
      const granted = subscription(accountA);
      granted.subscription!.plan.planRevisionId = body.planRevisionId;
      granted.subscription!.currentPeriodEnd = body.currentPeriodEnd;
      subscriptions.set(
        accountA,
        AdminSubscriptionResponseV1Schema.parse(granted),
      );
      await fulfill(
        200,
        AdminSubscriptionMutationResponseV1Schema.parse({
          status: "applied",
          changed: true,
          subscription: {
            id: subscriptionId,
            accountId: accountA,
            state: "ACTIVE",
            stateRevision: 7,
            planRevisionId: body.planRevisionId,
            boundPriceRevisionId: null,
            currentPeriodStart: createdAt,
            currentPeriodEnd: body.currentPeriodEnd,
            graceUntil: null,
            cancelAtPeriodEnd: false,
            suspendedAt: null,
            updatedAt: createdAt,
          },
        }),
      );
      return;
    }
    const principalStatus = path.match(
      new RegExp(`^/v1/admin/principals/${principalId}/(suspend|restore)$`),
    );
    if (method === "POST" && principalStatus) {
      const body = AdminPrincipalMutationBodyV1Schema.parse(
        request.postDataJSON(),
      );
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      await options.holdWrite;
      principal.status =
        principalStatus[1] === "suspend" ? "SUSPENDED" : "ACTIVE";
      principal.revision++;
      await fulfill(
        200,
        AdminPrincipalStatusResponseV1Schema.parse({
          changed: true,
          principal,
        }),
      );
      return;
    }
    unexpected.push(`${method} ${path}`);
    await fulfill(503, apiError("SERVICE_UNAVAILABLE"));
  });
  return {
    reads,
    writes,
    unexpected,
    expire(code: AuthFailure) {
      authFailure = code;
    },
    holdNextRead(path: string) {
      const held = {
        seen: deferred(),
        release: deferred(),
        settled: deferred(),
      };
      heldReads.set(path, held);
      return held;
    },
  };
}

async function openAccount(page: Page, id = accountA) {
  const response = page.waitForResponse(
    (value) =>
      apiPath(value.url()) === accountPath(id, "subscription") &&
      value.request().method() === "GET",
  );
  await page.goto(`${adminOrigin}/accounts/${id}`);
  await response;
  await expect(
    page.getByRole("heading", { name: "Account workspace", exact: true }),
  ).toBeVisible();
}

async function openPrincipals(page: Page) {
  await page.goto(`${adminOrigin}/principals`);
  const row = page.getByRole("row").filter({ hasText: principalId });
  await expect(row).toBeVisible();
  return row;
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

for (const code of ["ADMIN_UNAUTHORIZED", "ADMIN_REAUTH_REQUIRED"] as const) {
  test(`B14-05 synthetic ${code} on GET returns the existing UI to sign-in`, async ({
    page,
  }) => {
    const api = await syntheticApi(page);
    await openAccount(page);
    await expect(
      page.getByRole("button", { name: "Grant subscription", exact: true }),
    ).toBeVisible();
    api.expire(code);
    await page
      .getByRole("button", { name: "Reload workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start OTP sign-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Grant subscription", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Admin sections" }),
    ).toHaveCount(0);
    expect(api.writes).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test("B14-05 synthetic logout 401 clears stale editing and offers sign-in", async ({
  page,
}) => {
  const api = await syntheticApi(page, { rejectLogout: true });
  await openAccount(page);
  await page
    .getByRole("button", { name: "End admin session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Admin sign-in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start OTP sign-in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Grant subscription", exact: true }),
  ).toHaveCount(0);
  expect(api.writes).toEqual([
    { method: "DELETE", path: "/v1/admin/session", body: null, csrf },
  ]);
  expect(api.unexpected).toEqual([]);
});

test("B14-01 synthetic BETA access remains visible without a commercial subscription", async ({
  page,
}) => {
  const api = await syntheticApi(page, {
    subscriptionA: subscription(accountA, { basis: "BETA" }),
  });
  await openAccount(page);
  await expect(page.getByText(/BETA access is active/i)).toBeVisible();
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("B14-01 synthetic access without a subscription remains visible when optional accessBasis is absent", async ({
  page,
}) => {
  // accessBasis is optional in the actual wire. A valid eligibility result must
  // not disappear solely because no commercial subscription record exists.
  const api = await syntheticApi(page, {
    subscriptionA: subscription(accountA, { basis: "BETA", omitBasis: true }),
  });
  await openAccount(page);
  await expect(page.getByText(/\bELIGIBLE\b/)).toBeVisible();
  expect(api.writes).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

test("B14-01 synthetic current-wire plan object has a readable name", async ({
  page,
}) => {
  const api = await syntheticApi(page);
  await openAccount(page);
  await expect(
    page.getByText("Synthetic B14 professional", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("[object Object]", { exact: false })).toHaveCount(
    0,
  );
  expect(api.unexpected).toEqual([]);
});

test("B14-01 synthetic WITHHELD device metadata never fabricates a browser", async ({
  page,
}) => {
  const api = await syntheticApi(page, { withheldDevice: true });
  await openAccount(page);
  const row = page.getByRole("row").filter({ hasText: deviceA });
  await expect(row).toBeVisible();
  const browserCell = row.getByRole("cell").nth(2);
  await expect(browserCell).not.toContainText(/undefined|null|CHROME|FIREFOX/i);
  await expect(browserCell).toHaveText(/\S/);
  expect(api.unexpected).toEqual([]);
});

for (const action of ["Suspend", "Restore"] as const) {
  test(`B14-03 synthetic ${action} identifies its principal and session consequences`, async ({
    page,
  }) => {
    const api = await syntheticApi(page, {
      principalStatus: action === "Suspend" ? "ACTIVE" : "SUSPENDED",
    });
    const row = await openPrincipals(page);
    const dialog = await review(row, action, "synthetic B14 status change");
    await expect.soft(dialog).toContainText(principalId);
    await expect.soft(dialog).toContainText(/session/i);
    await expect
      .soft(dialog)
      .toContainText(
        action === "Suspend"
          ? /revok|end|invalidat/i
          : /not|remain|stay|new|sign.?in/i,
      );
    expect(api.writes).toHaveLength(0);
    await dialog
      .getByRole("button", { name: `Confirm ${action}`, exact: true })
      .click();
    await expect(
      page.getByText(`${action} completed.`, { exact: true }),
    ).toBeVisible();
    expect(api.writes).toEqual([
      {
        method: "POST",
        path: `/v1/admin/principals/${principalId}/${action.toLowerCase()}`,
        body: { expectedRevision: 7, reason: "synthetic B14 status change" },
        csrf,
      },
    ]);
    await expect(
      row.getByRole("cell", {
        name: action === "Suspend" ? "SUSPENDED" : "ACTIVE",
        exact: true,
      }),
    ).toBeVisible();
    expect(api.unexpected).toEqual([]);
  });
}

for (const changedField of ["plan", "period"] as const) {
  test(`B14-03/05 synthetic grant review is invalidated when its ${changedField} changes`, async ({
    page,
  }) => {
    const api = await syntheticApi(page, {
      subscriptionA: subscription(accountA, { basis: "NONE" }),
    });
    await openAccount(page);
    await page
      .getByLabel("Published plan revision ID", { exact: true })
      .fill(planOne);
    await page
      .getByLabel("New period end", { exact: true })
      .fill(initialPeriod);
    await review(page, "Grant subscription", "original reviewed parameters");
    if (changedField === "plan")
      await page
        .getByLabel("Published plan revision ID", { exact: true })
        .fill(planTwo);
    else
      await page
        .getByLabel("New period end", { exact: true })
        .fill(changedPeriod);
    await expect(
      page.getByRole("dialog", {
        name: "Confirm Grant subscription",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(api.writes).toHaveLength(0);
    const dialog = await review(
      page,
      "Grant subscription",
      "new explicit review",
    );
    expect(api.writes).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Confirm Grant subscription", exact: true })
      .click();
    await expect(
      page.getByText("Grant subscription completed.", { exact: true }),
    ).toBeVisible();
    expect(api.writes).toEqual([
      {
        method: "POST",
        path: accountPath(accountA, "subscription/grant"),
        body: {
          planRevisionId: changedField === "plan" ? planTwo : planOne,
          currentPeriodEnd: `${changedField === "period" ? changedPeriod : initialPeriod}:00.000Z`,
          reason: "new explicit review",
        },
        csrf,
      },
    ]);
    expect(api.unexpected).toEqual([]);
  });
}

test("B14-05 synthetic pending mutation keeps Cancel disabled until its outcome", async ({
  page,
}) => {
  const pending = deferred();
  const api = await syntheticApi(page, { holdWrite: pending.promise });
  const row = await openPrincipals(page);
  try {
    const dialog = await review(row, "Suspend", "pending synthetic operation");
    await dialog
      .getByRole("button", { name: "Confirm Suspend", exact: true })
      .click();
    await expect.poll(() => api.writes.length).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "Confirm Suspend", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Suspend completed.", { exact: true }),
    ).toHaveCount(0);
    pending.resolve();
    await expect(
      page.getByText("Suspend completed.", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(api.writes).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.resolve();
  }
});

test("B14-01/05 synthetic delayed account A reads cannot replace account B after normal navigation", async ({
  page,
}) => {
  const api = await syntheticApi(page);
  await openAccount(page);
  await expect(
    page.getByRole("row").filter({ hasText: deviceA }),
  ).toBeVisible();
  const oldSubscription = api.holdNextRead(
    accountPath(accountA, "subscription"),
  );
  const oldDevices = api.holdNextRead(accountPath(accountA, "devices"));
  try {
    await page
      .getByRole("button", { name: "Reload workspace", exact: true })
      .click();
    await Promise.all([oldSubscription.seen.promise, oldDevices.seen.promise]);
    // Use product links, not a full reload or synthetic history manipulation.
    // A safe Next remount/abort is a positive result, not evidence of a bug.
    await page.getByRole("link", { name: "Accounts", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Account lookup", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Account ID", { exact: true }).fill(accountB);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: accountB })
      .getByRole("link", { name: "Workspace", exact: true })
      .click();
    await expect(page).toHaveURL(`${adminOrigin}/accounts/${accountB}`);
    await expect(
      page.getByRole("row").filter({ hasText: deviceB }),
    ).toBeVisible();
    oldSubscription.release.resolve();
    oldDevices.release.resolve();
    await Promise.all([
      oldSubscription.settled.promise,
      oldDevices.settled.promise,
    ]);
    // Allow the delivered/cancelled fetch continuations and React paint to run.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("row").filter({ hasText: deviceB }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: deviceA }),
    ).toHaveCount(0);
    await expect(page.getByText(accountB, { exact: true })).toBeVisible();
    await expect(page.getByText(accountA, { exact: true })).toHaveCount(0);
    expect(api.reads).toContain(accountPath(accountB, "subscription"));
    expect(api.reads).toContain(accountPath(accountB, "devices"));
    expect(api.writes).toEqual([]);
    expect(api.unexpected).toEqual([]);
  } finally {
    oldSubscription.release.resolve();
    oldDevices.release.resolve();
  }
});

// Independent whole-packet regressions for generic Mutation consumers outside
// the AccountWorkspace parent busy lock. Their responses are also synthetic.
const commercialPlanId = "00000000-0000-4000-8000-000000000090";
const commercialRevisionId = "00000000-0000-4000-8000-000000000091";
const commercialPriceId = "00000000-0000-4000-8000-000000000092";
const commercialPriceRevisionId = "00000000-0000-4000-8000-000000000093";
const commercialPlansPath = "/v1/admin/commercial/plans";
const commercialPlanPath = `${commercialPlansPath}/${commercialPlanId}`;
const commercialPricePath = `/v1/admin/commercial/prices/${commercialPriceId}`;

function commercialPlanFixture(): InspectedPlan {
  return {
    id: commercialPlanId,
    code: "synthetic-commercial-plan",
    status: "DRAFT",
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    revisions: [
      {
        id: commercialRevisionId,
        revision: 1,
        state: "DRAFT",
        displayName: "Synthetic commercial draft",
        description: "Synthetic B14 generic mutation regression",
        createdAt: new Date(createdAt),
        publishedAt: null,
        entitlements: [],
      },
    ],
  };
}

function commercialPriceFixture(): InspectedPrice {
  return {
    id: commercialPriceId,
    planId: commercialPlanId,
    code: "synthetic-monthly-price",
    marketKey: "synthetic",
    channelKey: "web",
    status: "DRAFT",
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    revisions: [
      {
        id: commercialPriceRevisionId,
        revision: 1,
        planRevisionId: commercialRevisionId,
        state: "DRAFT",
        amountMinor: 1999,
        currency: "USD",
        billingIntervalUnit: "MONTH",
        billingIntervalCount: 1,
        effectiveFrom: new Date(createdAt),
        effectiveTo: null,
        createdAt: new Date(createdAt),
        publishedAt: null,
        contentFingerprintSha256: "c".repeat(64),
      },
    ],
    saleAssignments: [],
  };
}

async function syntheticCommercialApi(
  page: Page,
  options: {
    holdCreate?: Promise<void>;
    createFailure?: "ADMIN_UNAUTHORIZED";
    staleUpdateThenFailedRead?: boolean;
  } = {},
) {
  const reads: string[] = [];
  const writes: Write[] = [];
  const unexpected: string[] = [];
  const plans: PlanSummary[] = [];
  const plan = commercialPlanFixture();
  const price = commercialPriceFixture();
  const projectedPlan = {
    ...plan,
    revisions: plan.revisions.map((revision) => ({
      ...revision,
      contentFingerprintSha256: computeP4PlanRevisionContentFingerprintV1({
        planId: plan.id,
        planRevisionId: revision.id,
        revision: revision.revision,
        displayName: revision.displayName,
        description: revision.description,
        entitlements: revision.entitlements,
      }),
    })),
  };
  let authenticated = true;
  let planReadFails = false;
  await page
    .context()
    .addCookies([{ name: "pcp_admin_csrf", value: csrf, url: adminOrigin }]);
  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const path = apiPath(request.url());
    const method = request.method();
    if (method === "GET") reads.push(path);
    if (method === "GET" && path === "/v1/admin/me") {
      await route.fulfill(
        authenticated
          ? {
              json: AdminMeResponseV1Schema.parse({
                status: "authenticated",
                principalId,
                roles: ["ADMIN_OWNER"],
                permissions: [
                  "plan.read",
                  "plan.manage",
                  "price.read",
                  "price.manage",
                ],
                expiresAt: "2099-01-01T00:00:00.000Z",
              }),
            }
          : { status: 401, json: apiError("ADMIN_UNAUTHORIZED") },
      );
      return;
    }
    // admin-commercial-routes.ts currently declares passthrough responses, not
    // exported strict response schemas. These fixtures follow its PlanSummary,
    // safePlan/InspectedPrice and checkResult projections, without inventing a
    // test-only product contract. Mutation bodies use its actual strict schemas.
    if (method === "GET" && path === commercialPlansPath) {
      await route.fulfill({ json: { items: plans } });
      return;
    }
    if (method === "GET" && path === commercialPlanPath) {
      await route.fulfill(
        planReadFails
          ? {
              status: 503,
              json: apiError("SERVICE_UNAVAILABLE"),
            }
          : { json: projectedPlan },
      );
      return;
    }
    if (method === "GET" && path === commercialPricePath) {
      await route.fulfill({ json: price });
      return;
    }
    if (method === "POST" && path === commercialPlansPath) {
      const body = PlanCreateBodySchema.parse(request.postDataJSON());
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      await options.holdCreate;
      if (options.createFailure) {
        authenticated = false;
        await route.fulfill({
          status: 401,
          json: apiError(options.createFailure),
        });
        return;
      }
      const created: PlanSummary = {
        id: commercialPlanId,
        code: body.code,
        status: "DRAFT",
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
      };
      plans.push(created);
      await route.fulfill({
        json: { status: "applied", changed: true, value: created },
      });
      return;
    }
    if (
      method === "POST" &&
      path ===
        `${commercialPlanPath}/revisions/${commercialRevisionId}/update` &&
      options.staleUpdateThenFailedRead
    ) {
      const body = PlanUpdateBodySchema.parse(request.postDataJSON());
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      planReadFails = true;
      await route.fulfill({ status: 409, json: apiError("ADMIN_STATE_STALE") });
      return;
    }
    unexpected.push(`${method} ${path}`);
    await route.fulfill({ status: 503, json: apiError("SERVICE_UNAVAILABLE") });
  });
  return { reads, writes, unexpected };
}

async function openCommercialPage(
  page: Page,
  urlPath: string,
  expectedApiPath: string,
  heading: string,
) {
  const loaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      apiPath(response.url()) === expectedApiPath,
  );
  await page.goto(`${adminOrigin}${urlPath}`);
  await loaded;
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
}

test("B14 shared synthetic delayed Create plan keeps its outcome and reload after draft edits", async ({
  page,
}) => {
  const pending = deferred();
  const api = await syntheticCommercialApi(page, {
    holdCreate: pending.promise,
  });
  try {
    await openCommercialPage(
      page,
      "/commercial/plans",
      commercialPlansPath,
      "Plans",
    );
    const listReadsBefore = api.reads.filter(
      (path) => path === commercialPlansPath,
    ).length;
    const code = page.getByLabel("Code", { exact: true });
    await code.fill("synthetic-submitted-plan");
    const dialog = await review(
      page,
      "Create plan",
      "synthetic submitted plan reason",
    );
    await dialog
      .getByRole("button", { name: "Confirm Create plan", exact: true })
      .click();
    await expect.poll(() => api.writes.length).toBe(1);
    // This consumer has editable draft fields outside the shared busy lock.
    // Editing the next draft does not cancel the previously confirmed request.
    await code.fill("synthetic-next-draft");
    pending.resolve();
    await expect(
      page.getByText("Create plan completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: commercialPlanId }),
    ).toContainText("synthetic-submitted-plan");
    expect(
      api.reads.filter((path) => path === commercialPlansPath),
    ).toHaveLength(listReadsBefore + 1);
    await expect(code).toHaveValue("synthetic-next-draft");
    expect(api.writes).toEqual([
      {
        method: "POST",
        path: commercialPlansPath,
        body: {
          code: "synthetic-submitted-plan",
          reason: "synthetic submitted plan reason",
        },
        csrf,
      },
    ]);
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.resolve();
  }
});

test("B14 shared synthetic delayed Create plan 401 still recovers sign-in after draft edits", async ({
  page,
}) => {
  const pending = deferred();
  const api = await syntheticCommercialApi(page, {
    holdCreate: pending.promise,
    createFailure: "ADMIN_UNAUTHORIZED",
  });
  try {
    await openCommercialPage(
      page,
      "/commercial/plans",
      commercialPlansPath,
      "Plans",
    );
    const authorityReadsBefore = api.reads.filter(
      (path) => path === "/v1/admin/me",
    ).length;
    const code = page.getByLabel("Code", { exact: true });
    await code.fill("synthetic-expiring-plan");
    const dialog = await review(page, "Create plan", "synthetic expiry reason");
    await dialog
      .getByRole("button", { name: "Confirm Create plan", exact: true })
      .click();
    await expect.poll(() => api.writes.length).toBe(1);
    await code.fill("synthetic-next-draft");
    pending.resolve();
    await expect(
      page.getByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start OTP sign-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create plan", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Create plan completed.", { exact: true }),
    ).toHaveCount(0);
    expect(api.writes).toHaveLength(1);
    expect(api.reads.filter((path) => path === "/v1/admin/me")).toHaveLength(
      authorityReadsBefore + 1,
    );
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.resolve();
  }
});

test("B14 shared synthetic stale POST followed by GET 503 never claims a successful refresh", async ({
  page,
}) => {
  const api = await syntheticCommercialApi(page, {
    staleUpdateThenFailedRead: true,
  });
  await openCommercialPage(
    page,
    `/commercial/plans/${commercialPlanId}`,
    commercialPlanPath,
    "Plan detail",
  );
  const planReadsBefore = api.reads.filter(
    (path) => path === commercialPlanPath,
  ).length;
  await page
    .getByLabel("Draft display name", { exact: true })
    .fill("Synthetic reviewed update");
  const dialog = await review(
    page,
    "Update draft revision",
    "synthetic stale update reason",
  );
  await dialog
    .getByRole("button", { name: "Confirm Update draft revision", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
  ).toContainText("temporarily unavailable");
  await expect(page.getByText(/not automatically repeated/i)).toBeVisible();
  await expect(
    page.getByText(/Current server state was refreshed/i),
  ).toHaveCount(0);
  await expect(
    page.getByText("Update draft revision completed.", { exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(api.writes).toHaveLength(1);
  expect(api.reads.filter((path) => path === commercialPlanPath)).toHaveLength(
    planReadsBefore + 1,
  );
  expect(api.unexpected).toEqual([]);
});

for (const action of ["Create draft revision", "Assign sale price"] as const) {
  test(`B14 shared synthetic ${action} review survives an unrelated price-page render`, async ({
    page,
  }) => {
    // Date moves deterministically while timers keep running. A render-generated
    // effectiveFrom must not replace an already reviewed operation's timestamp.
    await page.clock.setFixedTime(new Date("2030-10-29T10:00:00.000Z"));
    const api = await syntheticCommercialApi(page);
    await openCommercialPage(
      page,
      `/commercial/prices/${commercialPriceId}`,
      commercialPricePath,
      "Price detail",
    );
    await page
      .getByLabel("Plan revision ID", { exact: true })
      .fill(commercialRevisionId);
    const dialog = await review(
      page,
      action,
      "synthetic stable reviewed reason",
    );
    await expect(dialog).toBeVisible();
    await page.clock.setFixedTime(new Date("2030-10-29T10:00:10.000Z"));
    // The first textarea belongs to the separate publish/status actions, not to
    // this Mutation. It re-renders the parent without changing this request.
    await page
      .getByLabel("Operator reason", { exact: true })
      .first()
      .fill("separate publication reason");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("synthetic stable reviewed reason");
    await expect(
      dialog.getByRole("button", { name: `Confirm ${action}`, exact: true }),
    ).toBeEnabled();
    expect(api.writes).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

// Shared-list and session-boundary regressions. All delayed responses below
// remain explicitly synthetic; the tests exercise public controls and rendered
// outcomes, without reading React state or changing application internals.
const secondPrincipalId = "00000000-0000-4000-8000-000000000094";
const secondPrincipalUserId = "00000000-0000-4000-8000-000000000095";
const newPrincipalUserId = "00000000-0000-4000-8000-000000000096";
const newPrincipalId = "00000000-0000-4000-8000-000000000097";
const newActorId = "00000000-0000-4000-8000-000000000098";
const principalListPath = "/v1/admin/principals";

function responseGate() {
  return { seen: deferred(), release: deferred(), settled: deferred() };
}

async function paintDeliveredResponse(page: Page) {
  // The route has delivered (or the browser has canceled) the old response.
  // Let its fetch continuation and React paint finish before inspecting UI.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function syntheticPrincipalListApi(page: Page) {
  const base = await syntheticApi(page);
  const writes: Write[] = [];
  const reads: string[] = [];
  const unexpected: string[] = [];
  const pending = new Map<string, ReturnType<typeof responseGate>>();
  const principals = [
    { principalId, userId },
    { principalId: secondPrincipalId, userId: secondPrincipalUserId },
  ].map((identity) =>
    AdminPrincipalItemV1Schema.parse({
      ...identity,
      status: "ACTIVE",
      revision: 7,
      roles: ["ADMIN_SUPPORT"],
      createdAt,
      updatedAt: createdAt,
    }),
  );
  await page.route(
    "**/api/control-plane/v1/admin/principals**",
    async (route) => {
      const request = route.request();
      const path = apiPath(request.url());
      const method = request.method();
      if (method === "GET" && path === principalListPath) {
        reads.push(request.url());
        await route.fulfill({
          json: AdminPrincipalsResponseV1Schema.parse({
            items: principals,
            // A real next-page control is needed to verify that it cannot discard
            // the common list while one of its mutations is still in flight.
            nextCursor: new URL(request.url()).searchParams.has("cursor")
              ? null
              : secondPrincipalId,
          }),
        });
        return;
      }
      const statusTarget = principals.find(
        (principal) =>
          path === `${principalListPath}/${principal.principalId}/suspend`,
      );
      if (method === "POST" && (path === principalListPath || statusTarget)) {
        const body =
          path === principalListPath
            ? AdminPrincipalCreateBodyV1Schema.parse(request.postDataJSON())
            : AdminPrincipalMutationBodyV1Schema.parse(request.postDataJSON());
        writes.push({
          method,
          path,
          body,
          csrf: request.headers()["x-csrf-token"],
        });
        const held = pending.get(path);
        pending.delete(path);
        held?.seen.resolve();
        await held?.release.promise;
        try {
          if (statusTarget) {
            statusTarget.status = "SUSPENDED";
            statusTarget.revision++;
            await route.fulfill({
              json: AdminPrincipalStatusResponseV1Schema.parse({
                changed: true,
                principal: statusTarget,
              }),
            });
          } else {
            const creation = AdminPrincipalCreateBodyV1Schema.parse(body);
            const created = AdminPrincipalItemV1Schema.parse({
              principalId: newPrincipalId,
              userId: creation.userId,
              status: "ACTIVE",
              revision: 1,
              roles: [creation.initialRole],
              createdAt,
              updatedAt: createdAt,
            });
            principals.push(created);
            await route.fulfill({ json: created });
          }
        } catch (error) {
          if (!page.isClosed() && !request.failure()) throw error;
        } finally {
          held?.settled.resolve();
        }
        return;
      }
      unexpected.push(`${method} ${path}`);
      await route.fulfill({
        status: 503,
        json: apiError("SERVICE_UNAVAILABLE"),
      });
    },
  );
  return {
    reads,
    writes,
    unexpected,
    base,
    holdWrite(path: string) {
      const held = responseGate();
      pending.set(path, held);
      return held;
    },
  };
}

for (const operation of ["row", "create"] as const) {
  test(`B14 shared synthetic pending principal ${operation} protects all rows, creation and pagination`, async ({
    page,
  }) => {
    const api = await syntheticPrincipalListApi(page);
    const writePath =
      operation === "row"
        ? `${principalListPath}/${principalId}/suspend`
        : principalListPath;
    const held = api.holdWrite(writePath);
    try {
      const first = await openPrincipals(page);
      const second = page
        .getByRole("row")
        .filter({ hasText: secondPrincipalId });
      await expect(second).toBeVisible();
      await page
        .getByLabel("User ID", { exact: true })
        .fill(newPrincipalUserId);
      const action = operation === "row" ? "Suspend" : "Create principal";
      const dialog = await review(
        operation === "row" ? first : page,
        action,
        "Synthetic shared principal list operation",
      );
      const readsBefore = api.reads.length;
      await dialog
        .getByRole("button", { name: `Confirm ${action}`, exact: true })
        .click();
      await held.seen.promise;
      await expect(
        dialog.getByRole("button", { name: `Confirm ${action}`, exact: true }),
      ).toBeDisabled();
      await expect(
        second.getByRole("button", { name: "Suspend", exact: true }),
      ).toBeDisabled();
      await expect(
        second.getByRole("combobox", {
          name: `Role for ${secondPrincipalId}`,
          exact: true,
        }),
      ).toBeDisabled();
      if (operation === "create")
        await expect(
          first.getByRole("button", { name: "Suspend", exact: true }),
        ).toBeDisabled();
      else
        await expect(
          page.getByRole("button", { name: "Create principal", exact: true }),
        ).toBeDisabled();
      await expect(page.getByLabel("User ID", { exact: true })).toBeDisabled();
      await expect(
        page.getByRole("combobox", { name: /^Initial role/ }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Next page", exact: true }),
      ).toBeDisabled();
      expect(api.writes).toHaveLength(1);
      expect(api.reads).toHaveLength(readsBefore);

      held.release.resolve();
      await expect(
        page.getByText(`${action} completed.`, { exact: true }),
      ).toBeVisible();
      await expect.poll(() => api.reads.length).toBe(readsBefore + 1);
      if (operation === "row")
        await expect(
          first.getByRole("cell", { name: "SUSPENDED", exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("row").filter({ hasText: newPrincipalId }),
        ).toContainText(newPrincipalUserId);
      await expect(
        second.getByRole("cell", { name: "ACTIVE", exact: true }),
      ).toBeVisible();
      await expect(
        second.getByRole("button", { name: "Suspend", exact: true }),
      ).toBeEnabled();
      await expect(page.getByLabel("User ID", { exact: true })).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Next page", exact: true }),
      ).toBeEnabled();
      expect(api.writes).toEqual([
        expect.objectContaining({ method: "POST", path: writePath, csrf }),
      ]);
      expect([...api.unexpected, ...api.base.unexpected]).toEqual([]);
    } finally {
      held.release.resolve();
    }
  });
}

test("B14 shared synthetic one principal reload cannot lose another principal outcome", async ({
  page,
}) => {
  const api = await syntheticPrincipalListApi(page);
  const firstPath = `${principalListPath}/${principalId}/suspend`;
  const secondPath = `${principalListPath}/${secondPrincipalId}/suspend`;
  const firstWrite = api.holdWrite(firstPath);
  const secondWrite = api.holdWrite(secondPath);
  try {
    const first = await openPrincipals(page);
    const second = page.getByRole("row").filter({ hasText: secondPrincipalId });
    const firstDialog = await review(
      first,
      "Suspend",
      "Synthetic first principal outcome",
    );
    await firstDialog
      .getByRole("button", { name: "Confirm Suspend", exact: true })
      .click();
    await firstWrite.seen.promise;
    await expect(
      firstDialog.getByRole("button", { name: "Confirm Suspend", exact: true }),
    ).toBeDisabled();
    const secondButton = second.getByRole("button", {
      name: "Suspend",
      exact: true,
    });
    const mayRunConcurrently = await secondButton.isEnabled();
    if (mayRunConcurrently) {
      const secondDialog = await review(
        second,
        "Suspend",
        "Synthetic second principal outcome",
      );
      await secondDialog
        .getByRole("button", { name: "Confirm Suspend", exact: true })
        .click();
      await secondWrite.seen.promise;
    } else {
      // Serializing writes is a valid solution. The next operation must become
      // usable after the first operation and its authoritative reload finish.
      await expect(secondButton).toBeDisabled();
      expect(api.writes).toHaveLength(1);
    }
    firstWrite.release.resolve();
    await expect(
      first.getByRole("cell", { name: "SUSPENDED", exact: true }),
    ).toBeVisible();
    await expect(
      second.getByRole("cell", { name: "ACTIVE", exact: true }),
    ).toBeVisible();
    if (!mayRunConcurrently) {
      await expect(secondButton).toBeEnabled();
      const secondDialog = await review(
        second,
        "Suspend",
        "Synthetic second principal outcome",
      );
      await secondDialog
        .getByRole("button", { name: "Confirm Suspend", exact: true })
        .click();
      await secondWrite.seen.promise;
    }
    secondWrite.release.resolve();
    // On the buggy path the first reload unmounts the second Mutation; its POST
    // then succeeds, but no second list read or visible status update follows.
    await expect(
      second.getByRole("cell", { name: "SUSPENDED", exact: true }),
    ).toBeVisible();
    await expect(
      first.getByRole("cell", { name: "SUSPENDED", exact: true }),
    ).toBeVisible();
    expect(api.writes.map(({ path }) => path)).toEqual([firstPath, secondPath]);
    expect(api.writes.every((write) => write.csrf === csrf)).toBe(true);
    expect([...api.unexpected, ...api.base.unexpected]).toEqual([]);
  } finally {
    firstWrite.release.resolve();
    secondWrite.release.resolve();
  }
});

async function syntheticAuthorityRaceApi(page: Page) {
  const base = await syntheticApi(page);
  const sessionWrites: Write[] = [];
  const oldActor = AdminMeResponseV1Schema.parse({
    status: "authenticated",
    principalId: "00000000-0000-4000-8000-000000000080",
    roles: ["ADMIN_OWNER"],
    permissions: [
      "account.read",
      "subscription.read",
      "subscription.grant",
      "device.read",
    ],
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const newActor = AdminMeResponseV1Schema.parse({
    status: "authenticated",
    principalId: newActorId,
    roles: ["ADMIN_OPS"],
    permissions: ["account.read", "subscription.read", "device.read"],
    expiresAt: "2099-01-02T00:00:00.000Z",
  });
  let currentActor: typeof oldActor | null = oldActor;
  const heldMe: {
    result: "success" | "error";
    gate: ReturnType<typeof responseGate>;
  }[] = [];
  const failedReads = new Set<string>();
  await page.context().addCookies([
    {
      name: "pcp_csrf",
      value: "synthetic-b14-portal-csrf",
      url: adminOrigin,
    },
  ]);
  await page.route("**/api/control-plane/v1/admin/me", async (route) => {
    const pending = heldMe.shift();
    // Capture the answer when the server receives the request. A later login
    // must not rewrite the old response that is deliberately delayed in flight.
    const answer = pending
      ? pending.result === "success"
        ? oldActor
        : null
      : currentActor;
    pending?.gate.seen.resolve();
    await pending?.gate.release.promise;
    try {
      await route.fulfill(
        answer
          ? { json: AdminMeResponseV1Schema.parse(answer) }
          : { status: 401, json: apiError("ADMIN_UNAUTHORIZED") },
      );
    } catch (error) {
      // Aborting an obsolete read is also a valid session-isolation outcome.
      if (!page.isClosed() && !route.request().failure()) throw error;
    } finally {
      pending?.gate.settled.resolve();
    }
  });
  await page.route(
    "**/api/control-plane/v1/admin/accounts/*/*",
    async (route) => {
      const path = apiPath(route.request().url());
      if (route.request().method() === "GET" && failedReads.delete(path)) {
        await route.fulfill({
          status: 401,
          json: apiError("ADMIN_UNAUTHORIZED"),
        });
        return;
      }
      await route.fallback();
    },
  );
  await page.route("**/api/control-plane/v1/admin/session", async (route) => {
    const request = route.request();
    const method = request.method();
    sessionWrites.push({
      method,
      path: "/v1/admin/session",
      body: null,
      csrf: request.headers()["x-csrf-token"],
    });
    if (method === "DELETE") {
      currentActor = null;
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "POST") {
      currentActor = newActor;
      await route.fulfill({
        json: AdminSessionResponseV1Schema.parse({
          status: "authenticated",
          expiresAt: newActor.expiresAt,
        }),
      });
      return;
    }
    await route.fulfill({ status: 503, json: apiError("SERVICE_UNAVAILABLE") });
  });
  return {
    base,
    sessionWrites,
    failNextRead(path: string) {
      failedReads.add(path);
    },
    endServerSession() {
      currentActor = null;
    },
    holdNextMe(result: "success" | "error") {
      const gate = responseGate();
      heldMe.push({ result, gate });
      return gate;
    },
  };
}

test("B14 shared synthetic delayed me success cannot reopen a completed logout", async ({
  page,
}) => {
  const api = await syntheticAuthorityRaceApi(page);
  await openAccount(page);
  const old = api.holdNextMe("success");
  try {
    api.failNextRead(accountPath(accountA, "subscription"));
    await page
      .getByRole("button", { name: "Reload workspace", exact: true })
      .click();
    await old.seen.promise;
    await page
      .getByRole("button", { name: "End admin session", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${adminOrigin}/login`);
    old.release.resolve();
    await old.settled.promise;
    await paintDeliveredResponse(page);
    await expect(
      page.getByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Admin sections" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Session overview", exact: true }),
    ).toHaveCount(0);
    expect(api.sessionWrites).toEqual([
      { method: "DELETE", path: "/v1/admin/session", body: null, csrf },
    ]);
    expect(api.base.writes).toEqual([]);
    expect(api.base.unexpected).toEqual([]);
  } finally {
    old.release.resolve();
  }
});

for (const oldResult of ["success", "error"] as const) {
  test(`B14 shared synthetic old me ${oldResult} cannot replace a newer signed-in actor`, async ({
    page,
  }) => {
    const api = await syntheticAuthorityRaceApi(page);
    await openAccount(page);
    const old = api.holdNextMe(oldResult);
    try {
      api.failNextRead(accountPath(accountA, "subscription"));
      await page
        .getByRole("button", { name: "Reload workspace", exact: true })
        .click();
      await old.seen.promise;
      // A second read observes expiry while the earlier /me response is still
      // pending. This intentionally does not use logout as an invalidation aid.
      api.endServerSession();
      api.failNextRead(accountPath(accountA, "devices"));
      await page
        .getByRole("button", { name: "Reload workspace", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Admin sign-in", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Continue with current sign-in",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", { name: "Session overview", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(newActorId, { exact: true })).toBeVisible();
      await expect(
        page.locator(".topbar").getByText("ADMIN_OPS", { exact: true }),
      ).toBeVisible();
      old.release.resolve();
      await old.settled.promise;
      await paintDeliveredResponse(page);
      await expect(
        page.getByRole("heading", { name: "Session overview", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(newActorId, { exact: true })).toBeVisible();
      await expect(
        page.locator(".topbar").getByText("ADMIN_OPS", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Admin sign-in", exact: true }),
      ).toHaveCount(0);
      expect(api.sessionWrites).toEqual([
        {
          method: "POST",
          path: "/v1/admin/session",
          body: null,
          csrf: "synthetic-b14-portal-csrf",
        },
      ]);
      expect(api.base.writes).toEqual([]);
      expect(api.base.unexpected).toEqual([]);
    } finally {
      old.release.resolve();
    }
  });
}

// The following packet keeps all responses synthetic while exercising real
// pagination, row unmounts, confirmations and outcome callbacks in the UI.
const paginationEntitlementKey = "b14.pagination_capability";
const paginationOverrideId = "00000000-0000-4000-8000-000000000101";
const paginationOlderOverrideId = "00000000-0000-4000-8000-000000000102";

async function syntheticAccountPaginationApi(
  page: Page,
  kind: "devices" | "overrides",
) {
  const base = await syntheticApi(page);
  const writes: Write[] = [];
  const reads: { path: string; cursor: string | null }[] = [];
  const authorityReads: { path: string; kind: "definition" | "history" }[] = [];
  const write = responseGate();
  const reload = responseGate();
  const listPath = accountPath(
    accountA,
    kind === "devices" ? "devices" : "entitlement-overrides",
  );
  const effectivePath = accountPath(
    accountA,
    "entitlements/" + paginationEntitlementKey,
  );
  const currentDevices = devices(deviceA, "Synthetic pending revoke target");
  let committed = false;
  let reloadHeld = false;
  let operation: "SET" | "CLEAR" = "SET";
  let effectiveFrom = new Date(createdAt);

  const currentOverride = (): Omit<AccountEntitlementOverride, "reason"> => ({
    id: paginationOverrideId,
    accountId: accountA,
    entitlementKey: paginationEntitlementKey,
    revision: committed ? 8 : 7,
    operation,
    value: operation === "SET" ? { kind: "BOOLEAN", value: committed } : null,
    effectiveFrom,
    expiresAt: null,
    createdAt: new Date(createdAt),
  });

  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const path = apiPath(request.url());
    const method = request.method();
    if (method === "GET" && path === "/v1/admin/me") {
      await route.fulfill({
        json: AdminMeResponseV1Schema.parse({
          status: "authenticated",
          principalId,
          roles: ["ADMIN_OWNER"],
          permissions: [
            "account.read",
            "subscription.read",
            ...(kind === "devices"
              ? ["device.read", "device.revoke"]
              : ["entitlement.read", "entitlement.override"]),
          ],
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    if (
      kind === "overrides" &&
      method === "GET" &&
      path === "/v1/admin/commercial/entitlements/definitions"
    ) {
      const query = new URL(request.url()).searchParams;
      expect(query.get("entitlementKey")).toBe(paginationEntitlementKey);
      expect(query.get("limit")).toBe("100");
      authorityReads.push({ path, kind: "definition" });
      const result: AdminCommercialPage<EntitlementDefinition> = {
        items: [
          {
            entitlementKey: paginationEntitlementKey,
            valueType: "BOOLEAN",
            securityClassification: "CAPABILITY",
            description: "Synthetic pagination capability definition",
            deprecatedAt: null,
            createdAt: new Date(createdAt),
          },
        ],
      };
      await route.fulfill({ json: result });
      return;
    }
    if (method === "GET" && path === listPath) {
      const query = new URL(request.url()).searchParams;
      const cursor = query.get("cursor");
      if (kind === "overrides" && query.get("limit") === "100") {
        expect(query.get("entitlementKey")).toBe(paginationEntitlementKey);
        expect(cursor).toBeNull();
        authorityReads.push({ path, kind: "history" });
        const row = currentOverride();
        const result: AdminCommercialPage<
          Omit<AccountEntitlementOverride, "reason">
        > = {
          items: [
            row,
            {
              ...row,
              id: paginationOlderOverrideId,
              revision: 6,
              operation: "SET",
              value: { kind: "BOOLEAN", value: false },
            },
          ],
        };
        // The separate authority query sees the complete accepted history;
        // visible limit=50 pagination keeps its original independent probes.
        await route.fulfill({ json: result });
        return;
      }
      reads.push({ path, cursor });
      const held = committed && !reloadHeld;
      if (held) {
        reloadHeld = true;
        reload.seen.resolve();
        await reload.release.promise;
      }
      try {
        if (kind === "devices") {
          await route.fulfill({
            json: AdminDevicesResponseV1Schema.parse(
              cursor
                ? devices(deviceB, "Synthetic next device page")
                : { ...currentDevices, nextCursor: deviceA },
            ),
          });
        } else {
          const row = currentOverride();
          // Match safeOverridePage: omit freeform reason from the read DTO.
          const result: AdminCommercialPage<
            Omit<AccountEntitlementOverride, "reason">
          > = cursor
            ? {
                items: [
                  {
                    ...row,
                    id: paginationOlderOverrideId,
                    revision: 6,
                    operation: "SET",
                    value: { kind: "BOOLEAN", value: false },
                  },
                ],
              }
            : { items: [row], nextCursor: paginationOverrideId };
          await route.fulfill({ json: result });
        }
      } finally {
        if (held) reload.settled.resolve();
      }
      return;
    }
    if (method === "GET" && path === effectivePath) {
      reads.push({ path, cursor: null });
      await route.fulfill({
        json: CommercialEntitlementResolutionSchema.parse({
          entitlementKey: paginationEntitlementKey,
          definition: {
            valueType: "BOOLEAN",
            securityClassification: "CAPABILITY",
            deprecatedAt: null,
          },
          plan: {
            planId: commercialPlanId,
            planCode: "b14-pagination",
            planRevisionId: planOne,
            planRevisionNumber: 1,
            baseValue: { kind: "BOOLEAN", value: false },
          },
          selectedOverride: {
            overrideId: paginationOverrideId,
            overrideRevision: committed ? 8 : 7,
            operation,
            effectiveFrom,
            expiresAt: null,
            state: operation === "SET" ? "ACTIVE_SET" : "ACTIVE_CLEAR",
          },
          effectiveValue: {
            kind: "BOOLEAN",
            value: committed && operation === "SET",
          },
          source: operation === "SET" ? "ACCOUNT_OVERRIDE" : "PLAN_REVISION",
          reason:
            operation === "SET"
              ? "ACCOUNT_OVERRIDE_SET"
              : "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN",
        }),
      });
      return;
    }

    const revokePath = accountPath(accountA, "devices/" + deviceA + "/revoke");
    const overridePrefix = accountPath(
      accountA,
      "entitlement-overrides/" + paginationEntitlementKey + "/",
    );
    if (
      method === "POST" &&
      ((kind === "devices" && path === revokePath) ||
        (kind === "overrides" &&
          (path === overridePrefix + "set" ||
            path === overridePrefix + "clear")))
    ) {
      const rawBody: unknown = request.postDataJSON();
      if (kind === "devices") {
        AdminDeviceRevokeBodyV1Schema.parse(rawBody);
      } else {
        const command =
          path === overridePrefix + "set"
            ? OverrideSetBodySchema.parse(rawBody)
            : OverrideClearBodySchema.parse(rawBody);
        expect(command.expectedLatestRevision).toBe(7);
        effectiveFrom = command.effectiveFrom;
      }
      writes.push({
        method,
        path,
        body: rawBody,
        csrf: request.headers()["x-csrf-token"],
      });
      write.seen.resolve();
      await write.release.promise;
      committed = true;
      try {
        if (kind === "devices") {
          currentDevices.items[0]!.status = "REVOKED";
          currentDevices.items[0]!.revokedAt = createdAt;
          await route.fulfill({
            json: AdminDeviceRevokeResponseV1Schema.parse({
              status: "revoked",
              deviceId: deviceA,
              idempotent: false,
            }),
          });
        } else {
          operation = path === overridePrefix + "set" ? "SET" : "CLEAR";
          await route.fulfill({
            json: {
              status: "applied",
              changed: true,
              value: {
                ...currentOverride(),
                reason: (rawBody as { reason: string }).reason,
              },
            },
          });
        }
      } finally {
        write.settled.resolve();
      }
      return;
    }
    await route.fallback();
  });
  return {
    base,
    writes,
    reads,
    authorityReads,
    write,
    reload,
    listPath,
    effectivePath,
  };
}

test("B14 shared synthetic pending device Revoke locks device Next through its authoritative reload", async ({
  page,
}) => {
  const api = await syntheticAccountPaginationApi(page, "devices");
  try {
    await openAccount(page);
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Devices", exact: true }),
    });
    const row = section.getByRole("row").filter({ hasText: deviceA });
    const next = section.getByRole("button", {
      name: "Next page",
      exact: true,
    });
    await expect(row).toBeVisible();
    await expect(next).toBeEnabled();
    const reason = "Synthetic pagination-safe device revoke";
    const dialog = await review(row, "Revoke", reason);
    await dialog
      .getByRole("button", { name: "Confirm Revoke", exact: true })
      .click();
    await api.write.seen.promise;
    await expect(next).toBeDisabled();
    expect(api.reads.filter((read) => read.cursor !== null)).toEqual([]);
    expect(api.writes).toEqual([
      {
        method: "POST",
        path: accountPath(accountA, "devices/" + deviceA + "/revoke"),
        body: { reason },
        csrf,
      },
    ]);

    api.write.release.resolve();
    await api.reload.seen.promise;
    await expect(
      page.getByRole("button", { name: "Reload workspace", exact: true }),
    ).toBeDisabled();
    api.reload.release.resolve();
    await expect(
      page.getByText("Revoke completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: "REVOKED", exact: true }),
    ).toBeVisible();
    await expect(next).toBeEnabled();
    expect(api.reads.filter((read) => read.path === api.listPath)).toEqual([
      { path: api.listPath, cursor: null },
      { path: api.listPath, cursor: null },
    ]);
    await next.click();
    await expect(
      section.getByRole("row").filter({ hasText: deviceB }),
    ).toBeVisible();
    expect(api.reads.at(-1)).toEqual({
      path: api.listPath,
      cursor: deviceA,
    });
    expect(api.writes).toHaveLength(1);
    expect(api.base.unexpected).toEqual([]);
  } finally {
    api.write.release.resolve();
    api.reload.release.resolve();
  }
});

for (const operation of ["SET", "CLEAR"] as const) {
  test(
    "B14 shared synthetic pending override " +
      operation +
      " locks override Next and refreshes current revision and effective data",
    async ({ page }) => {
      const api = await syntheticAccountPaginationApi(page, "overrides");
      try {
        await openAccount(page);
        await page
          .getByLabel("Entitlement key", { exact: true })
          .fill(paginationEntitlementKey);
        const section = page.locator("section").filter({
          has: page.getByLabel("Entitlement key", { exact: true }),
        });
        const row = section.getByRole("row").filter({
          hasText: paginationEntitlementKey,
        });
        const next = section.getByRole("button", {
          name: "Next page",
          exact: true,
        });
        const effective = section.getByRole("status").filter({
          hasText: "Effective server result:",
        });
        await expect(
          row.getByRole("cell", { name: "7", exact: true }),
        ).toBeVisible();
        await expect(effective).toContainText('"overrideRevision":7');
        await expect(
          section.getByRole("combobox", {
            name: "Override value",
            exact: true,
          }),
        ).toBeVisible();
        const authorityReadsBefore = api.authorityReads.length;
        const readsBefore = api.reads.filter(
          (read) => read.path === api.listPath,
        ).length;
        const effectiveReadsBefore = api.reads.filter(
          (read) => read.path === api.effectivePath,
        ).length;
        const action = operation === "SET" ? "Set override" : "Clear override";
        const reason = "Synthetic pagination-safe override " + operation;
        const dialog = await review(section, action, reason);
        await dialog
          .getByRole("button", {
            name: "Confirm " + action,
            exact: true,
          })
          .click();
        await api.write.seen.promise;
        await expect(next).toBeDisabled();
        expect(api.reads.filter((read) => read.cursor !== null)).toEqual([]);
        expect(api.writes).toHaveLength(1);
        expect(api.writes[0]).toMatchObject({
          method: "POST",
          path: accountPath(
            accountA,
            "entitlement-overrides/" +
              paginationEntitlementKey +
              "/" +
              operation.toLowerCase(),
          ),
          body: {
            expectedLatestRevision: 7,
            effectiveFrom: expect.any(String),
            expiresAt: null,
            reason,
            ...(operation === "SET"
              ? { value: { kind: "BOOLEAN", value: true } }
              : {}),
          },
          csrf,
        });
        api.write.release.resolve();
        await api.reload.seen.promise;
        await expect(
          page.getByRole("button", {
            name: "Reload workspace",
            exact: true,
          }),
        ).toBeDisabled();
        api.reload.release.resolve();
        await expect(
          page.getByText(action + " completed.", { exact: true }),
        ).toBeVisible();
        await expect(
          row.getByRole("cell", { name: "8", exact: true }),
        ).toBeVisible();
        await expect(
          row.getByRole("cell", { name: operation, exact: true }),
        ).toBeVisible();
        await expect(effective).toContainText('"overrideRevision":8');
        await expect(effective).toContainText(
          '"reason":"' +
            (operation === "SET"
              ? "ACCOUNT_OVERRIDE_SET"
              : "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN") +
            '"',
        );
        await expect(next).toBeEnabled();
        expect(api.authorityReads).toHaveLength(authorityReadsBefore + 2);
        expect(
          api.authorityReads
            .slice(authorityReadsBefore)
            .map((read) => read.kind)
            .sort(),
        ).toEqual(["definition", "history"]);
        expect(
          api.reads.filter((read) => read.path === api.listPath),
        ).toHaveLength(readsBefore + 1);
        expect(
          api.reads.filter((read) => read.path === api.effectivePath),
        ).toHaveLength(effectiveReadsBefore + 1);
        await next.click();
        await expect(
          row.getByRole("cell", { name: "6", exact: true }),
        ).toBeVisible();
        expect(api.reads.at(-1)).toEqual({
          path: api.listPath,
          cursor: paginationOverrideId,
        });
        expect(api.writes).toHaveLength(1);
        expect(api.base.unexpected).toEqual([]);
      } finally {
        api.write.release.resolve();
        api.reload.release.resolve();
      }
    },
  );
}

const siblingDefinitionsPath = "/v1/admin/commercial/entitlements/definitions";
const siblingFirstKey = "b14.sibling_first";
const siblingSecondKey = "b14.sibling_second";

async function syntheticSiblingDefinitionApi(
  page: Page,
  secondOutcome: "success" | "error",
) {
  const base = await syntheticApi(page);
  const reads: string[] = [];
  const writes: Write[] = [];
  const firstWrite = responseGate();
  const secondWrite = responseGate();
  const firstReload = responseGate();
  let firstApplied = false;
  let firstReloadHeld = false;
  const definitions: EntitlementDefinition[] = [
    siblingFirstKey,
    siblingSecondKey,
  ].map((entitlementKey) => ({
    entitlementKey,
    valueType: "BOOLEAN",
    securityClassification: "CAPABILITY",
    description: "Synthetic independent definition",
    deprecatedAt: null,
    createdAt: new Date(createdAt),
  }));

  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const path = apiPath(request.url());
    const method = request.method();
    if (method === "GET" && path === "/v1/admin/me") {
      await route.fulfill({
        json: AdminMeResponseV1Schema.parse({
          status: "authenticated",
          principalId,
          roles: ["ADMIN_OWNER"],
          permissions: ["entitlement.read", "plan.manage"],
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    if (method === "GET" && path === siblingDefinitionsPath) {
      reads.push(path);
      const held = firstApplied && !firstReloadHeld;
      if (held) {
        firstReloadHeld = true;
        firstReload.seen.resolve();
        await firstReload.release.promise;
      }
      try {
        const result: AdminCommercialPage<EntitlementDefinition> = {
          items: definitions,
        };
        await route.fulfill({ json: result });
      } finally {
        if (held) firstReload.settled.resolve();
      }
      return;
    }
    const index = definitions.findIndex(
      (item) =>
        path ===
        siblingDefinitionsPath + "/" + item.entitlementKey + "/deprecate",
    );
    if (method === "POST" && index >= 0) {
      const body = DefinitionDeprecateBodySchema.parse(request.postDataJSON());
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      const gate = index === 0 ? firstWrite : secondWrite;
      gate.seen.resolve();
      await gate.release.promise;
      try {
        if (index === 1 && secondOutcome === "error") {
          await route.fulfill({
            status: 503,
            json: apiError("SERVICE_UNAVAILABLE"),
          });
        } else {
          definitions[index]!.deprecatedAt = new Date(createdAt);
          if (index === 0) firstApplied = true;
          await route.fulfill({
            json: {
              status: "applied",
              changed: true,
              value: definitions[index],
            },
          });
        }
      } finally {
        gate.settled.resolve();
      }
      return;
    }
    await route.fallback();
  });
  return { base, reads, writes, firstWrite, secondWrite, firstReload };
}

for (const outcome of ["success", "error"] as const) {
  test(
    "B14 shared synthetic unscoped sibling reload preserves a later " + outcome,
    async ({ page }) => {
      const api = await syntheticSiblingDefinitionApi(page, outcome);
      try {
        await openCommercialPage(
          page,
          "/commercial/entitlements",
          siblingDefinitionsPath,
          "Entitlement definitions",
        );
        const first = page
          .getByRole("row")
          .filter({ hasText: siblingFirstKey });
        const second = page
          .getByRole("row")
          .filter({ hasText: siblingSecondKey });
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        for (const [row, gate, reason] of [
          [first, api.firstWrite, "Synthetic first definition outcome"],
          [second, api.secondWrite, "Synthetic second definition outcome"],
        ] as const) {
          const dialog = await review(row, "Deprecate", reason);
          await dialog
            .getByRole("button", {
              name: "Confirm Deprecate",
              exact: true,
            })
            .click();
          await gate.seen.promise;
        }
        expect(api.writes).toHaveLength(2);

        api.firstWrite.release.resolve();
        await api.firstReload.seen.promise;
        // Hold the shared GET until both old rows actually disappear. This
        // forces the pending sibling to unmount; timing alone cannot pass.
        await expect(first).toHaveCount(0);
        await expect(second).toHaveCount(0);
        api.firstReload.release.resolve();
        await expect(
          first.getByRole("cell", {
            name: "DEPRECATED",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          second.getByRole("cell", {
            name: "ACTIVE",
            exact: true,
          }),
        ).toBeVisible();
        const readsAfterFirst = api.reads.length;
        expect(readsAfterFirst).toBe(2);

        api.secondWrite.release.resolve();
        await api.secondWrite.settled.promise;
        if (outcome === "success") {
          await expect(
            second.getByRole("cell", {
              name: "DEPRECATED",
              exact: true,
            }),
          ).toBeVisible();
          expect(api.reads).toHaveLength(readsAfterFirst + 1);
        } else {
          // A non-auth, non-stale error exercises the generic catch guard too.
          await expect(
            page.getByText("The control plane is temporarily unavailable.", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            second.getByRole("cell", {
              name: "ACTIVE",
              exact: true,
            }),
          ).toBeVisible();
          expect(api.reads).toHaveLength(readsAfterFirst);
        }
        expect(api.writes).toEqual([
          {
            method: "POST",
            path: siblingDefinitionsPath + "/" + siblingFirstKey + "/deprecate",
            body: { reason: "Synthetic first definition outcome" },
            csrf,
          },
          {
            method: "POST",
            path:
              siblingDefinitionsPath + "/" + siblingSecondKey + "/deprecate",
            body: { reason: "Synthetic second definition outcome" },
            csrf,
          },
        ]);
        expect(api.base.unexpected).toEqual([]);
      } finally {
        api.firstWrite.release.resolve();
        api.secondWrite.release.resolve();
        api.firstReload.release.resolve();
      }
    },
  );
}
