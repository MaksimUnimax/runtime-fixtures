import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AdminAccountsResponseV1Schema,
  AdminMeResponseV1Schema,
  AdminSessionResponseV1Schema,
  AdminSubscriptionResponseV1Schema,
  ApiErrorEnvelopeV1Schema,
  BetaAdmissionMutationBodyV1Schema,
  BetaAdmissionResponseV1Schema,
} from "../../../packages/contracts/src/index";
import {
  OverrideClearBodySchema,
  OverrideSetBodySchema,
  type AdminCommercialPage,
} from "../../../packages/server/admin-commercial/src/index";
import type { BetaIdentityInvitation } from "../../../packages/server/beta-access/src/index";
import {
  CommercialEntitlementResolutionSchema,
  type AccountEntitlementOverride,
} from "../../../packages/server/entitlements/src/index";
import type { EntitlementDefinition } from "../../../packages/server/plans/src/index";

// Real admin UI, deliberately synthetic API. No database reset, fake CI flags,
// production identities, shared browser profile or API/RBAC acceptance lives
// here. Wire fixtures use exported schemas; invitation views follow the existing
// private invitationView in beta-admin-routes.ts and its public service type.
const origin = `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3300"}`;
const accountId = "00000000-0000-4000-8000-000000000121";
const actorId = "00000000-0000-4000-8000-000000000122";
const nextActorId = "00000000-0000-4000-8000-000000000123";
const invitationId = "00000000-0000-4000-8000-000000000124";
const secondInvitationId = "00000000-0000-4000-8000-000000000125";
const overrideId = "00000000-0000-4000-8000-000000000126";
const olderOverrideId = "00000000-0000-4000-8000-000000000127";
const integerOverrideId = "00000000-0000-4000-8000-000000000130";
const planId = "00000000-0000-4000-8000-000000000128";
const planRevisionId = "00000000-0000-4000-8000-000000000129";
const createdAt = "2026-01-01T00:00:00.000Z";
const csrf = "synthetic-b14-operations-admin-csrf";
const portalCsrf = "synthetic-b14-operations-portal-csrf";
const booleanKey = "b14.operations_boolean";
const integerKey = "b14.operations_integer";
const betaPath = "/v1/admin/beta/admission";
const invitationPath = "/v1/admin/beta/invitations";
const subscriptionPath = `/v1/admin/accounts/${accountId}/subscription`;
const overridesPath = `/v1/admin/accounts/${accountId}/entitlement-overrides`;
const definitionsPath = "/v1/admin/commercial/entitlements/definitions";
const effectivePath = (key: string) =>
  `/v1/admin/accounts/${accountId}/entitlements/${key}`;
const setPath = (key: string) => `${overridesPath}/${key}/set`;
const revokePath = `${invitationPath}/${invitationId}/revoke`;
const apiPath = (url: string) =>
  new URL(url).pathname.split("/api/control-plane")[1] ?? "";

test.use({ timezoneId: "UTC" });

type Actor = ReturnType<typeof AdminMeResponseV1Schema.parse>;
type BetaState = ReturnType<typeof BetaAdmissionResponseV1Schema.parse>;
type Operation = "quota" | "invite" | "revoke";
type AuthorityError =
  | "ADMIN_UNAUTHORIZED"
  | "ADMIN_REAUTH_REQUIRED"
  | "ADMIN_CSRF_INVALID"
  | "ADMIN_FORBIDDEN";
type Read = { path: string; query: URLSearchParams };
type Write = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  csrf: string | undefined;
};
type Override = Omit<AccountEntitlementOverride, "reason">;
type Reply = {
  status?: number;
  json?: unknown;
  abort?: boolean;
  gate?: ReturnType<typeof responseGate>;
  received?: () => void;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function responseGate() {
  return { seen: deferred(), release: deferred(), settled: deferred() };
}
async function painted(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}
function errorBody(code: string) {
  return ApiErrorEnvelopeV1Schema.parse({
    error: {
      code,
      message: "Synthetic B14 operations response",
      correlationId: "synthetic-b14-operations",
    },
  });
}
function errorStatus(code: AuthorityError) {
  return code === "ADMIN_UNAUTHORIZED" || code === "ADMIN_REAUTH_REQUIRED"
    ? 401
    : 403;
}
function actor(id = actorId, manage = true): Actor {
  return AdminMeResponseV1Schema.parse({
    status: "authenticated",
    principalId: id,
    roles: [manage ? "ADMIN_OWNER" : "ADMIN_SUPPORT"],
    permissions: [
      "account.read",
      "subscription.read",
      "entitlement.read",
      "beta.admission.read",
      ...(manage ? ["entitlement.override", "beta.admission.manage"] : []),
    ],
    expiresAt:
      id === actorId ? "2099-01-01T00:00:00.000Z" : "2099-01-02T00:00:00.000Z",
  });
}
function subscription() {
  return AdminSubscriptionResponseV1Schema.parse({
    accountId,
    accessBasis: "BETA",
    access: { status: "ELIGIBLE", reason: null },
    subscription: null,
    deviceAllowance: {
      maxActive: null,
      activeCount: 0,
      remaining: null,
      overLimit: false,
    },
  });
}
function invitation(
  id = invitationId,
  status: "PENDING" | "REVOKED" = "PENDING",
) {
  const source: BetaIdentityInvitation = {
    id,
    status,
    createdAt: new Date(createdAt),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    consumedAt: null,
    revokedAt: status === "REVOKED" ? new Date(createdAt) : null,
  };
  // Exact safe projection of the current invitationView, with no target email,
  // reason, private request hash, or invented contract field.
  return {
    invitationId: source.id,
    status: source.status,
    createdAt: source.createdAt.toISOString(),
    expiresAt: source.expiresAt.toISOString(),
    consumedAt: source.consumedAt?.toISOString() ?? null,
    revokedAt: source.revokedAt?.toISOString() ?? null,
  };
}
function definition(key: string): EntitlementDefinition {
  const integer = key === integerKey;
  return {
    entitlementKey: key,
    valueType: integer ? "INTEGER" : "BOOLEAN",
    securityClassification: integer ? "LIMIT" : "CAPABILITY",
    description: "Synthetic B14 accepted entitlement definition",
    deprecatedAt: null,
    createdAt: new Date(createdAt),
  };
}
function override(
  key: string,
  revision = 7,
  id = key === integerKey ? integerOverrideId : overrideId,
): Override {
  return {
    id,
    accountId,
    entitlementKey: key,
    revision,
    operation: "SET",
    value:
      key === integerKey
        ? { kind: "INTEGER", value: 4 }
        : { kind: "BOOLEAN", value: true },
    effectiveFrom: new Date(createdAt),
    expiresAt: null,
    createdAt: new Date(createdAt),
  };
}
function effective(key: string, row?: Override) {
  const def = definition(key);
  const base =
    def.valueType === "INTEGER"
      ? ({ kind: "INTEGER", value: 1 } as const)
      : ({ kind: "BOOLEAN", value: false } as const);
  const selected = row
    ? {
        overrideId: row.id,
        overrideRevision: row.revision,
        operation: row.operation,
        effectiveFrom: row.effectiveFrom,
        expiresAt: row.expiresAt,
        state: row.operation === "SET" ? "ACTIVE_SET" : "ACTIVE_CLEAR",
      }
    : null;
  return CommercialEntitlementResolutionSchema.parse({
    entitlementKey: key,
    definition: {
      valueType: def.valueType,
      securityClassification: def.securityClassification,
      deprecatedAt: null,
    },
    plan: {
      planId,
      planCode: "synthetic-b14-operations",
      planRevisionId,
      planRevisionNumber: 1,
      baseValue: base,
    },
    selectedOverride: selected,
    effectiveValue: row?.operation === "SET" ? row.value : base,
    source: row?.operation === "SET" ? "ACCOUNT_OVERRIDE" : "PLAN_REVISION",
    reason:
      row?.operation === "SET"
        ? "ACCOUNT_OVERRIDE_SET"
        : row
          ? "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN"
          : "PLAN_VALUE",
  });
}

async function api(page: Page, options: { emptyOverrides?: boolean } = {}) {
  const writes: Write[] = [];
  const reads: Read[] = [];
  const unexpected: string[] = [];
  let currentActor: Actor | null = actor();
  let nextActor = actor(nextActorId);
  let nextOverrideSequence = 140;
  let state: BetaState = BetaAdmissionResponseV1Schema.parse({
    mode: "CLOSED",
    capacity: 30,
    admitted: 3,
    remaining: 27,
    revision: 7,
    updatedAt: createdAt,
  });
  const history = new Map<string, Override[]>(
    [booleanKey, integerKey].map((key) => [
      key,
      options.emptyOverrides ? [] : [override(key)],
    ]),
  );
  const invitations = new Map([
    [invitationId, invitation()],
    [secondInvitationId, invitation(secondInvitationId)],
  ]);
  const queued: {
    method: string;
    path: string;
    matches?: (query: URLSearchParams) => boolean;
    reply: Reply;
  }[] = [];
  const readReplies = new Map<string, (query: URLSearchParams) => Reply>();
  await page.context().addCookies([
    { name: "pcp_admin_csrf", value: csrf, url: origin },
    { name: "pcp_csrf", value: portalCsrf, url: origin },
  ]);
  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = apiPath(request.url());
    const query = new URL(request.url()).searchParams;
    const body =
      method === "POST" && request.postData()
        ? (request.postDataJSON() as Record<string, unknown>)
        : {};
    if (method === "GET") reads.push({ path, query });
    else
      writes.push({
        method,
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
    if (method === "POST" && path === betaPath)
      BetaAdmissionMutationBodyV1Schema.parse(body);
    if (method === "POST" && path.startsWith(overridesPath + "/")) {
      if (path.endsWith("/set")) OverrideSetBodySchema.parse(body);
      else OverrideClearBodySchema.parse(body);
    }
    const index = queued.findIndex(
      (entry) =>
        entry.method === method &&
        entry.path === path &&
        (!entry.matches || entry.matches(query)),
    );
    const configured =
      index < 0
        ? method === "GET"
          ? readReplies.get(path)?.(query)
          : undefined
        : queued.splice(index, 1)[0]!.reply;
    configured?.received?.();
    const held = configured?.gate;
    held?.seen.resolve();
    await held?.release.promise;
    const normal = (): { status?: number; json?: unknown } => {
      if (method === "GET" && path === "/v1/admin/me")
        return currentActor
          ? { json: AdminMeResponseV1Schema.parse(currentActor) }
          : { status: 401, json: errorBody("ADMIN_UNAUTHORIZED") };
      if (path === "/v1/admin/session" && method === "DELETE") {
        currentActor = null;
        return { status: 204 };
      }
      if (path === "/v1/admin/session" && method === "POST") {
        currentActor = nextActor;
        return {
          json: AdminSessionResponseV1Schema.parse({
            status: "authenticated",
            expiresAt: nextActor.expiresAt,
          }),
        };
      }
      if (method === "GET" && path === betaPath)
        return { json: BetaAdmissionResponseV1Schema.parse(state) };
      if (method === "POST" && path === betaPath) {
        const command = BetaAdmissionMutationBodyV1Schema.parse(body);
        state = BetaAdmissionResponseV1Schema.parse({
          ...state,
          revision: state.revision + 1,
          mode:
            command.action === "OPEN"
              ? "OPEN"
              : command.action === "PAUSE"
                ? "PAUSED"
                : command.action === "CLOSE"
                  ? "CLOSED"
                  : state.mode,
          capacity:
            command.action === "ADD_CAPACITY"
              ? state.capacity + command.amount!
              : command.action === "SET_CAPACITY"
                ? command.capacity!
                : state.capacity,
          remaining:
            command.action === "ADD_CAPACITY"
              ? state.remaining + command.amount!
              : command.action === "SET_CAPACITY"
                ? Math.max(0, command.capacity! - state.admitted)
                : state.remaining,
        });
        return { json: state };
      }
      if (method === "POST" && path === invitationPath) {
        const value = invitation();
        invitations.set(invitationId, value);
        return { json: { ...value, replay: false } };
      }
      if (method === "POST" && path === revokePath) {
        const value = invitation(invitationId, "REVOKED");
        invitations.set(invitationId, value);
        return { json: { ...value, replay: false } };
      }
      if (method === "GET" && path.startsWith(invitationPath + "/")) {
        const value = invitations.get(path.slice(invitationPath.length + 1));
        return value
          ? { json: value }
          : { status: 404, json: errorBody("ADMIN_RESOURCE_NOT_FOUND") };
      }
      if (method === "GET" && path === subscriptionPath)
        return { json: subscription() };
      if (method === "GET" && path === "/v1/admin/accounts")
        return {
          json: AdminAccountsResponseV1Schema.parse({
            items: [
              {
                id: accountId,
                displayName: "Synthetic B14 operations account",
                status: "ACTIVE",
                createdAt,
                updatedAt: createdAt,
              },
            ],
            nextCursor: null,
          }),
        };
      if (method === "GET" && path === definitionsPath) {
        const requested = query.get("entitlementKey");
        const value: AdminCommercialPage<EntitlementDefinition> = {
          items: [booleanKey, integerKey]
            .filter((key) => !requested || requested === key)
            .map(definition),
        };
        return { json: value };
      }
      if (method === "GET" && path === overridesPath) {
        const key = query.get("entitlementKey");
        const items = key
          ? (history.get(key) ?? [])
          : [...history.values()].flat();
        const value: AdminCommercialPage<Override> = {
          items: query.has("cursor") ? items.slice(1) : items,
        };
        return { json: value };
      }
      if (method === "GET" && path.startsWith(effectivePath(""))) {
        const key = path.slice(effectivePath("").length);
        const latest = history
          .get(key)
          ?.reduce<
            Override | undefined
          >((result, row) => (!result || row.revision > result.revision ? row : result), undefined);
        return { json: effective(key, latest) };
      }
      if (method === "POST" && path.startsWith(overridesPath + "/")) {
        const key = path.slice(overridesPath.length + 1).split("/")[0]!;
        const setCommand = path.endsWith("/set")
          ? OverrideSetBodySchema.parse(body)
          : undefined;
        const command = setCommand ?? OverrideClearBodySchema.parse(body);
        const previousRows = history.get(key) ?? [];
        const latestRevision = previousRows.length
          ? Math.max(...previousRows.map((row) => row.revision))
          : null;
        // Keep the synthetic successful write consistent with its supplied
        // authoritative history. This assertion is not a real database CAS.
        expect(command.expectedLatestRevision).toBe(latestRevision);
        const id =
          "00000000-0000-4000-8000-" +
          String(nextOverrideSequence++).padStart(12, "0");
        const row: Override = {
          ...override(key, (latestRevision ?? 0) + 1, id),
          operation: path.endsWith("/set") ? "SET" : "CLEAR",
          value: setCommand?.value ?? null,
          effectiveFrom: command.effectiveFrom,
          expiresAt: command.expiresAt,
        };
        history.set(key, [row, ...previousRows]);
        return { json: { status: "applied", changed: true, value: row } };
      }
      unexpected.push(`${method} ${path}`);
      return { status: 503, json: errorBody("SERVICE_UNAVAILABLE") };
    };
    try {
      if (configured?.abort) {
        await route.abort("failed");
        return;
      }
      const response =
        configured?.json !== undefined || configured?.status !== undefined
          ? configured
          : normal();
      await route.fulfill({
        status: response.status ?? 200,
        ...(response.json === undefined ? {} : { json: response.json }),
      });
    } catch (error) {
      // An obsolete request may be aborted by real navigation. Do not ignore a
      // failed fixture/schema or unrelated route failure.
      if (!page.isClosed() && !request.failure()) throw error;
    } finally {
      held?.settled.resolve();
    }
  });
  return {
    writes,
    reads,
    unexpected,
    history,
    queue(
      method: string,
      path: string,
      reply: Reply,
      matches?: (query: URLSearchParams) => boolean,
    ) {
      queued.push({ method, path, reply, matches });
    },
    onRead(path: string, handler: (query: URLSearchParams) => Reply) {
      readReplies.set(path, handler);
    },
    clearRead(path: string) {
      readReplies.delete(path);
    },
    setActor(value: Actor | null) {
      currentActor = value;
    },
    setNextActor(value: Actor) {
      nextActor = value;
    },
  };
}

function quotaPanel(page: Page) {
  return page.locator("section.panel").filter({
    has: page.getByRole("combobox", { name: "Action", exact: true }),
  });
}
function invitePanel(page: Page) {
  return page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Create targeted invitation",
      exact: true,
    }),
  });
}
function revokePanel(page: Page) {
  return page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Revoke pending invitation",
      exact: true,
    }),
  });
}
function entitlementPanel(page: Page) {
  return page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "Entitlements", exact: true }),
  });
}
const operationPath = (operation: Operation) =>
  operation === "quota"
    ? betaPath
    : operation === "invite"
      ? invitationPath
      : revokePath;
const operationDialog = (page: Page, operation: Operation) =>
  page.getByRole("dialog", {
    name:
      operation === "quota"
        ? "Confirm beta admission change"
        : operation === "invite"
          ? "Confirm targeted invitation"
          : "Confirm invitation revoke",
    exact: true,
  });
const operationConfirm = (dialog: Locator, operation: Operation) =>
  dialog.getByRole("button", {
    name:
      operation === "quota"
        ? "Confirm"
        : operation === "invite"
          ? "Confirm invitation"
          : "Confirm revoke",
    exact: true,
  });

async function openBeta(page: Page) {
  await page.goto(`${origin}/beta`);
  await expect(
    page.getByRole("heading", { name: "Current state", exact: true }),
  ).toBeVisible();
}
async function inspectInvitation(page: Page, id = invitationId) {
  await page.getByLabel("Invitation ID", { exact: true }).fill(id);
  await page
    .getByRole("button", { name: "Inspect invitation", exact: true })
    .click();
  const table = page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: "Targeted reviewer invitation",
      exact: true,
    }),
  });
  await expect(
    table.getByRole("cell", { name: id, exact: true }),
  ).toBeVisible();
}
async function reviewBeta(
  page: Page,
  operation: Operation,
  reason = "Synthetic B14 operations review",
) {
  if (operation === "quota") {
    const panel = quotaPanel(page);
    await panel
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption("ADD_CAPACITY");
    await panel.getByLabel("Positive amount", { exact: true }).fill("5");
    await panel
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill(reason);
    await panel
      .getByRole("button", { name: "Review change", exact: true })
      .click();
  } else if (operation === "invite") {
    const panel = invitePanel(page);
    await panel
      .getByLabel("Reviewer email", { exact: true })
      .fill("b14-reviewer@example.test");
    await panel
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill(reason);
    await panel
      .getByRole("button", { name: "Review invitation", exact: true })
      .click();
  } else {
    await inspectInvitation(page);
    const panel = revokePanel(page);
    await panel
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill(reason);
    await panel
      .getByRole("button", { name: "Review revoke", exact: true })
      .click();
  }
  const dialog = operationDialog(page, operation);
  await expect(dialog).toBeVisible();
  return dialog;
}
async function openAccount(page: Page) {
  await page.goto(`${origin}/accounts/${accountId}`);
  await expect(
    page.getByRole("heading", { name: "Account workspace", exact: true }),
  ).toBeVisible();
}
async function selectEntitlement(page: Page, key = booleanKey) {
  const panel = entitlementPanel(page);
  const response = page.waitForResponse((value) => {
    const url = new URL(value.url());
    return (
      apiPath(value.url()) === overridesPath &&
      url.searchParams.get("entitlementKey") === key &&
      value.request().method() === "GET"
    );
  });
  await panel.getByLabel("Entitlement key", { exact: true }).fill(key);
  await response;
  return panel;
}
async function reviewOverride(
  panel: Locator,
  action = "Set override",
  reason = "Synthetic B14 override review",
) {
  const button = panel.getByRole("button", { name: action, exact: true });
  const operationPanel = button.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]",
  );
  await operationPanel
    .getByRole("textbox", { name: "Operator reason", exact: true })
    .fill(reason);
  await button.click();
  const dialog = panel.getByRole("dialog", {
    name: `Confirm ${action}`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function attemptOverride(panel: Locator) {
  const button = panel.getByRole("button", {
    name: "Set override",
    exact: true,
  });
  if (await button.isEnabled()) {
    const dialog = await reviewOverride(panel);
    const confirm = dialog.getByRole("button", {
      name: "Confirm Set override",
      exact: true,
    });
    if (await confirm.isEnabled()) await confirm.click();
  }
}

for (const operation of ["quota", "invite", "revoke"] as const) {
  test(`B14 operations synthetic ${operation} serializes all Beta writes and locks review through reload`, async ({
    page,
  }) => {
    const mock = await api(page);
    await openBeta(page);
    if (operation !== "revoke") await inspectInvitation(page);
    const dialog = await reviewBeta(page, operation);
    const pending = responseGate();
    const reload = responseGate();
    mock.queue("POST", operationPath(operation), { gate: pending });
    mock.queue("GET", betaPath, { gate: reload });
    try {
      const confirm = operationConfirm(dialog, operation);
      // Two native clicks in one task exercise the synchronous pending guard;
      // a later disabled visual state alone is insufficient for this assertion.
      await confirm.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
      await pending.seen.promise;
      await expect(
        quotaPanel(page).getByRole("combobox", { name: "Action", exact: true }),
      ).toBeDisabled();
      const amount = quotaPanel(page).getByLabel("Positive amount", {
        exact: true,
      });
      if (await amount.count()) await expect(amount).toBeDisabled();
      await expect(
        quotaPanel(page).getByRole("textbox", { name: "Reason", exact: true }),
      ).toBeDisabled();
      await expect(
        invitePanel(page).getByLabel("Reviewer email", { exact: true }),
      ).toBeDisabled();
      await expect(
        invitePanel(page).getByRole("textbox", { name: "Reason", exact: true }),
      ).toBeDisabled();
      await expect(
        revokePanel(page).getByRole("textbox", { name: "Reason", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Invitation ID", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Inspect invitation", exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeDisabled();
      await expect(page.locator("section.panel button:enabled")).toHaveCount(0);
      expect(mock.writes).toHaveLength(1);
      expect(mock.writes[0]).toMatchObject({
        path: operationPath(operation),
        method: "POST",
        csrf,
      });
      const submitted = structuredClone(mock.writes[0]!.body);
      pending.release.resolve();
      await reload.seen.promise;
      await expect(page.locator("section.panel button:enabled")).toHaveCount(0);
      expect(mock.writes).toHaveLength(1);
      reload.release.resolve();
      await expect(
        page.getByRole("heading", { name: "Current state", exact: true }),
      ).toBeVisible();
      await expect(
        quotaPanel(page).getByRole("combobox", { name: "Action", exact: true }),
      ).toBeEnabled();
      expect(mock.writes[0]!.body).toEqual(submitted);
      expect(mock.unexpected).toEqual([]);
    } finally {
      pending.release.resolve();
      reload.release.resolve();
    }
  });

  test(`B14 operations synthetic ${operation} requires a new review after its target payload changes`, async ({
    page,
  }) => {
    const mock = await api(page);
    await openBeta(page);
    const dialog = await reviewBeta(page, operation);
    if (operation === "quota") {
      await quotaPanel(page)
        .getByLabel("Positive amount", { exact: true })
        .fill("9");
    } else if (operation === "invite") {
      await invitePanel(page)
        .getByLabel("Reviewer email", { exact: true })
        .fill("b14-other-reviewer@example.test");
    } else {
      await revokePanel(page)
        .getByRole("textbox", { name: "Reason", exact: true })
        .fill("Changed explicitly reviewed revoke reason");
    }
    await expect(dialog).toHaveCount(0);
    expect(mock.writes).toEqual([]);
    const panel =
      operation === "quota"
        ? quotaPanel(page)
        : operation === "invite"
          ? invitePanel(page)
          : revokePanel(page);
    const reviewName =
      operation === "quota"
        ? "Review change"
        : operation === "invite"
          ? "Review invitation"
          : "Review revoke";
    await panel.getByRole("button", { name: reviewName, exact: true }).click();
    await operationConfirm(operationDialog(page, operation), operation).click();
    await expect.poll(() => mock.writes.length).toBe(1);
    expect(mock.writes[0]!.body).toMatchObject(
      operation === "quota"
        ? { amount: 9 }
        : operation === "invite"
          ? { email: "b14-other-reviewer@example.test" }
          : { reason: "Changed explicitly reviewed revoke reason" },
    );
    expect(mock.unexpected).toEqual([]);
  });

  for (const code of [
    "ADMIN_UNAUTHORIZED",
    "ADMIN_REAUTH_REQUIRED",
    "ADMIN_CSRF_INVALID",
    "ADMIN_FORBIDDEN",
  ] as const) {
    test(`B14 operations synthetic ${operation} refreshes authority after ${code}`, async ({
      page,
    }) => {
      const mock = await api(page);
      await openBeta(page);
      const dialog = await reviewBeta(page, operation);
      const meReads = mock.reads.filter(
        (read) => read.path === "/v1/admin/me",
      ).length;
      mock.queue("POST", operationPath(operation), {
        status: errorStatus(code),
        json: errorBody(code),
        received: () =>
          mock.setActor(
            code === "ADMIN_FORBIDDEN" ? actor(actorId, false) : null,
          ),
      });
      await operationConfirm(dialog, operation).click();
      await expect
        .poll(
          () =>
            mock.reads.filter((read) => read.path === "/v1/admin/me").length,
        )
        .toBeGreaterThan(meReads);
      if (code === "ADMIN_FORBIDDEN") {
        await expect(
          page.locator(".topbar").getByText("ADMIN_SUPPORT", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Review change", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Review invitation", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Review revoke", exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(
          page.getByRole("heading", { name: "Admin sign-in", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Admin sections", exact: true }),
        ).toHaveCount(0);
      }
      expect(mock.writes).toHaveLength(1);
      expect(mock.unexpected).toEqual([]);
    });
  }

  test(`B14 operations synthetic ${operation} stale plus reload failure never claims refreshed data or replays`, async ({
    page,
  }) => {
    const mock = await api(page);
    await openBeta(page);
    const dialog = await reviewBeta(page, operation);
    const before = mock.reads.filter((read) => read.path === betaPath).length;
    mock.queue("POST", operationPath(operation), {
      status: 409,
      json: errorBody("ADMIN_STATE_STALE"),
    });
    mock.queue("GET", betaPath, {
      status: 503,
      json: errorBody("SERVICE_UNAVAILABLE"),
    });
    await operationConfirm(dialog, operation).click();
    await expect
      .poll(() => mock.reads.filter((read) => read.path === betaPath).length)
      .toBeGreaterThan(before);
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible();
    await painted(page);
    await expect(
      page.getByText(/state was refreshed|refreshed state|data was refreshed/i),
    ).toHaveCount(0);
    await expect(page.locator(".notice.success")).toHaveCount(0);
    await expect(operationDialog(page, operation)).toHaveCount(0);
    expect(mock.writes).toHaveLength(1);
    expect(mock.unexpected).toEqual([]);
  });

  test(`B14 operations synthetic ${operation} preserves retry identity after unknown outcome and changes it only for a new reviewed payload`, async ({
    page,
  }) => {
    const mock = await api(page);
    await openBeta(page);
    let dialog = await reviewBeta(page, operation);
    mock.queue("POST", operationPath(operation), { abort: true });
    await operationConfirm(dialog, operation).click();
    await expect(
      page.getByText("The control plane is temporarily unavailable.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(mock.writes).toHaveLength(1);
    const first = structuredClone(mock.writes[0]!.body);
    expect(first.requestId).toEqual(expect.any(String));
    expect(String(first.requestId).length).toBeGreaterThanOrEqual(16);
    dialog = operationDialog(page, operation);
    // The same reviewed request is explicitly retried; it is never submitted
    // automatically. A second unknown result lets us inspect a subsequent edit.
    mock.queue("POST", operationPath(operation), { abort: true });
    await operationConfirm(dialog, operation).click();
    await expect.poll(() => mock.writes.length).toBe(2);
    await expect(operationConfirm(dialog, operation)).toBeEnabled();
    expect(mock.writes[1]!.body).toEqual(first);
    const changedReason =
      "Explicit new synthetic B14 request after unknown result";
    const panel =
      operation === "quota"
        ? quotaPanel(page)
        : operation === "invite"
          ? invitePanel(page)
          : revokePanel(page);
    await panel
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill(changedReason);
    await expect(dialog).toHaveCount(0);
    const reviewName =
      operation === "quota"
        ? "Review change"
        : operation === "invite"
          ? "Review invitation"
          : "Review revoke";
    await panel.getByRole("button", { name: reviewName, exact: true }).click();
    await operationConfirm(operationDialog(page, operation), operation).click();
    await expect.poll(() => mock.writes.length).toBe(3);
    expect(mock.writes[2]!.body.requestId).not.toBe(first.requestId);
    expect(mock.writes[2]!.body.reason).toBe(changedReason);
    expect(mock.writes.map((write) => write.path)).toEqual(
      Array(3).fill(operationPath(operation)),
    );
    expect(mock.unexpected).toEqual([]);
  });

  for (const lateOutcome of ["success", "authority-error"] as const) {
    test(`B14 operations synthetic ${operation} late ${lateOutcome} cannot alter a newer signed-in actor or draft`, async ({
      page,
    }) => {
      const mock = await api(page);
      await openBeta(page);
      const dialog = await reviewBeta(page, operation);
      const pending = responseGate();
      mock.queue("POST", operationPath(operation), {
        gate: pending,
        ...(lateOutcome === "authority-error"
          ? { status: 401, json: errorBody("ADMIN_UNAUTHORIZED") }
          : {}),
      });
      try {
        await operationConfirm(dialog, operation).click();
        await pending.seen.promise;
        await page
          .getByRole("button", { name: "End admin session", exact: true })
          .click();
        await expect(page).toHaveURL(`${origin}/login`);
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
        await expect(
          page.getByText(nextActorId, { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("navigation", { name: "Admin sections", exact: true })
          .getByRole("link", { name: "Beta admission", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Current state", exact: true }),
        ).toBeVisible();
        await invitePanel(page)
          .getByLabel("Reviewer email", { exact: true })
          .fill("new-actor-draft@example.test");
        await invitePanel(page)
          .getByRole("textbox", { name: "Reason", exact: true })
          .fill("New actor draft must survive old result");
        const meReads = mock.reads.filter(
          (read) => read.path === "/v1/admin/me",
        ).length;
        pending.release.resolve();
        await pending.settled.promise;
        await painted(page);
        await expect(
          invitePanel(page).getByLabel("Reviewer email", { exact: true }),
        ).toHaveValue("new-actor-draft@example.test");
        await expect(
          invitePanel(page).getByRole("textbox", {
            name: "Reason",
            exact: true,
          }),
        ).toHaveValue("New actor draft must survive old result");
        await expect(
          page.getByRole("heading", { name: "Admin sign-in", exact: true }),
        ).toHaveCount(0);
        await expect(page.locator(".content > .notice")).toHaveCount(0);
        expect(
          mock.reads.filter((read) => read.path === "/v1/admin/me"),
        ).toHaveLength(meReads);
        expect(
          mock.writes.filter(
            (write) => write.path === operationPath(operation),
          ),
        ).toHaveLength(1);
        expect(
          mock.writes
            .filter((write) => write.path === "/v1/admin/session")
            .map((write) => write.method),
        ).toEqual(["DELETE", "POST"]);
        expect(mock.unexpected).toEqual([]);
      } finally {
        pending.release.resolve();
      }
    });
  }
}

test("B14 operations synthetic obsolete invitation lookup cannot replace a new actor's selection or authority", async ({
  page,
}) => {
  const mock = await api(page);
  await openBeta(page);
  const old = responseGate();
  mock.queue("GET", `${invitationPath}/${invitationId}`, {
    gate: old,
    status: 401,
    json: errorBody("ADMIN_UNAUTHORIZED"),
  });
  try {
    await page.getByLabel("Invitation ID", { exact: true }).fill(invitationId);
    await page
      .getByRole("button", { name: "Inspect invitation", exact: true })
      .click();
    await old.seen.promise;
    await page
      .getByRole("button", { name: "End admin session", exact: true })
      .click();
    await expect(page).toHaveURL(`${origin}/login`);
    await expect(
      page.getByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Continue with current sign-in",
        exact: true,
      })
      .click();
    await expect(page.getByText(nextActorId, { exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Admin sections", exact: true })
      .getByRole("link", { name: "Beta admission", exact: true })
      .click();
    await inspectInvitation(page, secondInvitationId);
    const meReads = mock.reads.filter(
      (read) => read.path === "/v1/admin/me",
    ).length;
    old.release.resolve();
    await old.settled.promise;
    await painted(page);
    await expect(page.getByLabel("Invitation ID", { exact: true })).toHaveValue(
      secondInvitationId,
    );
    await expect(page.locator(".content > .notice")).toHaveCount(0);
    expect(
      mock.reads.filter((read) => read.path === "/v1/admin/me"),
    ).toHaveLength(meReads);
    expect(mock.unexpected).toEqual([]);
  } finally {
    old.release.resolve();
  }
});

for (const entry of [
  { key: booleanKey, kind: "BOOLEAN", value: false, input: "false" },
  { key: integerKey, kind: "INTEGER", value: 0, input: "0" },
] as const) {
  test(`B14 operations synthetic first ${entry.kind} override uses proven empty history and reviewed value`, async ({
    page,
  }) => {
    const mock = await api(page, { emptyOverrides: true });
    await openAccount(page);
    const panel = await selectEntitlement(page, entry.key);
    const input = panel.getByRole(
      entry.kind === "BOOLEAN" ? "combobox" : "spinbutton",
      { name: "Override value", exact: true },
    );
    await expect(input).toBeVisible();
    if (entry.kind === "BOOLEAN") await input.selectOption(entry.input);
    else await input.fill(entry.input);
    const dialog = await reviewOverride(panel);
    await expect(dialog).toContainText(entry.key);
    await expect(dialog).toContainText(String(entry.value));
    await dialog
      .getByRole("button", { name: "Confirm Set override", exact: true })
      .click();
    await expect.poll(() => mock.writes.length).toBe(1);
    expect(mock.writes[0]).toMatchObject({
      path: setPath(entry.key),
      method: "POST",
      csrf,
      body: {
        expectedLatestRevision: null,
        value: { kind: entry.kind, value: entry.value },
        effectiveFrom: expect.any(String),
        expiresAt: null,
      },
    });
    await expect(
      page.getByText("Set override completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("status").filter({ hasText: "Effective server result:" }),
    ).toContainText(`"value":${entry.value}`);
    expect(
      mock.reads.some(
        (read) =>
          read.path === definitionsPath &&
          read.query.get("entitlementKey") === entry.key,
      ),
    ).toBe(true);
    expect(mock.unexpected).toEqual([]);
  });
}

test("B14 operations synthetic an existing INTEGER override sends the current revision and explicit nondefault value", async ({
  page,
}) => {
  const mock = await api(page);
  await openAccount(page);
  const panel = await selectEntitlement(page, integerKey);
  await panel
    .getByRole("spinbutton", { name: "Override value", exact: true })
    .fill("42");
  const dialog = await reviewOverride(panel);
  await expect(dialog).toContainText("42");
  await dialog
    .getByRole("button", { name: "Confirm Set override", exact: true })
    .click();
  await expect.poll(() => mock.writes.length).toBe(1);
  expect(mock.writes[0]!.body).toMatchObject({
    expectedLatestRevision: 7,
    value: { kind: "INTEGER", value: 42 },
  });
  expect(mock.unexpected).toEqual([]);
});

for (const missingAuthority of [
  "pending",
  "failed",
  "foreign-key",
  "looping-cursor",
] as const) {
  test(`B14 operations synthetic ${missingAuthority} override authority is never mistaken for no previous override`, async ({
    page,
  }) => {
    const mock = await api(page, { emptyOverrides: true });
    const held = responseGate();
    mock.onRead(overridesPath, (query) => {
      if (
        query.get("entitlementKey") !== booleanKey ||
        query.get("limit") !== "100"
      )
        return { json: { items: [] } satisfies AdminCommercialPage<Override> };
      if (missingAuthority === "pending")
        return { gate: held, json: { items: [] } };
      if (missingAuthority === "failed")
        return { status: 503, json: errorBody("SERVICE_UNAVAILABLE") };
      if (missingAuthority === "foreign-key")
        return {
          json: {
            items: [override(integerKey)],
          } satisfies AdminCommercialPage<Override>,
        };
      return {
        json: {
          items: [override(booleanKey)],
          nextCursor: overrideId,
        } satisfies AdminCommercialPage<Override>,
      };
    });
    try {
      await openAccount(page);
      const panel = entitlementPanel(page);
      await panel
        .getByLabel("Entitlement key", { exact: true })
        .fill(booleanKey);
      if (missingAuthority === "pending") await held.seen.promise;
      else {
        await expect
          .poll(
            () =>
              mock.reads.filter(
                (read) =>
                  read.path === overridesPath &&
                  read.query.get("entitlementKey") === booleanKey &&
                  read.query.get("limit") === "100",
              ).length,
          )
          .toBeGreaterThan(0);
        await expect(panel.getByRole("alert")).toContainText(
          missingAuthority === "failed"
            ? "The control plane is temporarily unavailable."
            : "The administrative operation could not be completed.",
        );
      }
      await attemptOverride(panel);
      await painted(page);
      expect(mock.writes).toEqual([]);
      await expect(page.locator(".notice.success")).toHaveCount(0);
      expect(mock.unexpected).toEqual([]);
    } finally {
      held.release.resolve();
    }
  });
}

test("B14 operations synthetic complete separate authority survives navigation to an older history page", async ({
  page,
}) => {
  const mock = await api(page);
  const current = override(booleanKey, 7);
  const old = override(booleanKey, 6, olderOverrideId);
  mock.history.set(booleanKey, [current, old]);
  mock.onRead(overridesPath, (query) => {
    const rows = mock.history.get(booleanKey) ?? [];
    if (query.get("limit") === "100")
      return { json: { items: rows } satisfies AdminCommercialPage<Override> };
    const cursor = query.get("cursor");
    const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
    const items = rows.slice(start, start + 1);
    return {
      json: {
        items,
        ...(start + items.length < rows.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      } satisfies AdminCommercialPage<Override>,
    };
  });
  await openAccount(page);
  const panel = await selectEntitlement(page);
  await expect(
    panel.getByRole("combobox", { name: "Override value", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    panel.getByRole("cell", { name: "6", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Override value", exact: true })
    .selectOption("false");
  const dialog = await reviewOverride(panel);
  await dialog
    .getByRole("button", { name: "Confirm Set override", exact: true })
    .click();
  await expect.poll(() => mock.writes.length).toBe(1);
  expect(mock.writes[0]!.body).toMatchObject({
    expectedLatestRevision: 7,
    value: { kind: "BOOLEAN", value: false },
  });
  expect(mock.unexpected).toEqual([]);
});

test("B14 operations synthetic authority scans accepted pages without assuming timestamp order is revision order", async ({
  page,
}) => {
  const mock = await api(page);
  const first = override(booleanKey, 6, olderOverrideId);
  const latest = override(booleanKey, 9, overrideId);
  mock.history.set(booleanKey, [first, latest]);
  mock.onRead(overridesPath, (query) => {
    const rows = mock.history.get(booleanKey) ?? [];
    if (query.get("limit") !== "100")
      return {
        json: {
          items: rows.slice(0, 1),
        } satisfies AdminCommercialPage<Override>,
      };
    const cursor = query.get("cursor");
    const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
    const items = rows.slice(start, start + 1);
    return {
      json: {
        items,
        ...(start + items.length < rows.length
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      } satisfies AdminCommercialPage<Override>,
    };
  });
  await openAccount(page);
  const panel = await selectEntitlement(page);
  await expect(
    panel.getByRole("combobox", { name: "Override value", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "Override value", exact: true })
    .selectOption("false");
  const dialog = await reviewOverride(panel);
  await dialog
    .getByRole("button", { name: "Confirm Set override", exact: true })
    .click();
  await expect.poll(() => mock.writes.length).toBe(1);
  expect(mock.writes[0]!.body.expectedLatestRevision).toBe(9);
  expect(
    mock.reads.some(
      (read) =>
        read.path === overridesPath &&
        read.query.get("limit") === "100" &&
        read.query.get("cursor") === olderOverrideId,
    ),
  ).toBe(true);
  expect(mock.unexpected).toEqual([]);
});

for (const input of ["", "1.5", "9007199254740992"] as const) {
  test(`B14 operations synthetic INTEGER value ${JSON.stringify(input)} never becomes a silent default or unsafe write`, async ({
    page,
  }) => {
    const mock = await api(page);
    await openAccount(page);
    const panel = await selectEntitlement(page, integerKey);
    await panel
      .getByRole("spinbutton", { name: "Override value", exact: true })
      .fill(input);
    await attemptOverride(panel);
    await painted(page);
    expect(mock.writes).toEqual([]);
    await expect(page.locator(".notice.success")).toHaveCount(0);
    expect(mock.unexpected).toEqual([]);
  });
}

test("B14 operations synthetic changing the selected override value discards the prior confirmation", async ({
  page,
}) => {
  const mock = await api(page);
  await openAccount(page);
  const panel = await selectEntitlement(page);
  await panel
    .getByRole("combobox", { name: "Override value", exact: true })
    .selectOption("false");
  const first = await reviewOverride(panel);
  await expect(first).toContainText("false");
  await panel
    .getByRole("combobox", { name: "Override value", exact: true })
    .selectOption("true");
  await expect(first).toHaveCount(0);
  expect(mock.writes).toEqual([]);
  const next = await reviewOverride(panel);
  await expect(next).toContainText("true");
  await next
    .getByRole("button", { name: "Confirm Set override", exact: true })
    .click();
  await expect.poll(() => mock.writes.length).toBe(1);
  expect(mock.writes[0]!.body).toMatchObject({
    expectedLatestRevision: 7,
    value: { kind: "BOOLEAN", value: true },
  });
  expect(mock.unexpected).toEqual([]);
});

test("B14 operations synthetic pending override locks target, value, sibling mutation and history until authority reload ends", async ({
  page,
}) => {
  const mock = await api(page);
  const pending = responseGate();
  const reload = responseGate();
  mock.onRead(overridesPath, (query) => {
    const rows =
      mock.history.get(query.get("entitlementKey") ?? booleanKey) ?? [];
    if (query.get("limit") === "100") return { json: { items: rows } };
    return { json: { items: rows, nextCursor: overrideId } };
  });
  try {
    await openAccount(page);
    const panel = await selectEntitlement(page);
    await panel
      .getByRole("combobox", { name: "Override value", exact: true })
      .selectOption("false");
    const dialog = await reviewOverride(panel);
    mock.queue("POST", setPath(booleanKey), { gate: pending });
    mock.queue(
      "GET",
      overridesPath,
      { gate: reload, json: { items: [override(booleanKey, 8)] } },
      (query) =>
        query.get("entitlementKey") === booleanKey &&
        query.get("limit") === "100",
    );
    await dialog
      .getByRole("button", { name: "Confirm Set override", exact: true })
      .click();
    await pending.seen.promise;
    await expect(
      panel.getByLabel("Entitlement key", { exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("combobox", { name: "Override value", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Clear override", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Next page", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    expect(mock.writes).toHaveLength(1);
    pending.release.resolve();
    await reload.seen.promise;
    await expect(
      page.getByRole("button", { name: "Reload workspace", exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Clear override", exact: true }),
    ).toBeDisabled();
    reload.release.resolve();
    await expect(
      page.getByRole("button", { name: "Reload workspace", exact: true }),
    ).toBeEnabled();
    expect(mock.writes).toHaveLength(1);
    expect(mock.unexpected).toEqual([]);
  } finally {
    pending.release.resolve();
    reload.release.resolve();
  }
});

test("B14 operations synthetic stale override and failed authority reload keep editing fail-closed without retry", async ({
  page,
}) => {
  const mock = await api(page);
  await openAccount(page);
  const panel = await selectEntitlement(page);
  await panel
    .getByRole("combobox", { name: "Override value", exact: true })
    .selectOption("false");
  const dialog = await reviewOverride(panel);
  mock.queue("POST", setPath(booleanKey), {
    status: 409,
    json: errorBody("ADMIN_STATE_STALE"),
    received: () =>
      mock.onRead(overridesPath, (query) =>
        query.get("limit") === "100"
          ? { status: 503, json: errorBody("SERVICE_UNAVAILABLE") }
          : { json: { items: [override(booleanKey)] } },
      ),
  });
  await dialog
    .getByRole("button", { name: "Confirm Set override", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      () =>
        mock.reads.filter(
          (read) =>
            read.path === overridesPath && read.query.get("limit") === "100",
        ).length,
    )
    .toBeGreaterThan(1);
  await painted(page);
  await attemptOverride(panel);
  await painted(page);
  expect(mock.writes).toHaveLength(1);
  await expect(
    page.getByText(/data was refreshed|refreshed data/i),
  ).toHaveCount(0);
  await expect(page.locator(".notice.success")).toHaveCount(0);
  expect(mock.unexpected).toEqual([]);
});

for (const outcome of ["pending", "503", "404", "confirmed-empty"] as const) {
  test(`B14 operations synthetic subscription ${outcome} distinguishes unknown state from confirmed absence`, async ({
    page,
  }) => {
    const mock = await api(page);
    const held = responseGate();
    if (outcome === "pending")
      mock.queue("GET", subscriptionPath, { gate: held });
    if (outcome === "503" || outcome === "404")
      mock.queue("GET", subscriptionPath, {
        status: Number(outcome),
        json: errorBody(
          outcome === "503"
            ? "SERVICE_UNAVAILABLE"
            : "ADMIN_RESOURCE_NOT_FOUND",
        ),
      });
    try {
      await openAccount(page);
      const section = page.locator("section.card").filter({
        has: page.getByRole("heading", { name: "Subscription", exact: true }),
      });
      if (outcome === "pending") await held.seen.promise;
      if (outcome === "503")
        await expect(
          section.getByText("The control plane is temporarily unavailable.", {
            exact: true,
          }),
        ).toBeVisible();
      if (outcome === "404")
        await expect(
          section.getByText("This resource is no longer available.", {
            exact: true,
          }),
        ).toBeVisible();
      if (outcome === "confirmed-empty") {
        await expect(
          section.getByText("No current subscription.", { exact: true }),
        ).toBeVisible();
        await expect(
          section.getByText(
            "BETA access is active; commercial subscription is not required.",
            { exact: true },
          ),
        ).toBeVisible();
      } else {
        await expect(
          section.getByText("No current subscription.", { exact: true }),
        ).toHaveCount(0);
        await expect(
          section.getByText(
            "BETA access is active; commercial subscription is not required.",
            { exact: true },
          ),
        ).toHaveCount(0);
      }
      expect(mock.writes).toEqual([]);
      expect(mock.unexpected).toEqual([]);
    } finally {
      held.release.resolve();
    }
  });
}
