import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import {
  AdminAuditEventsResponseV1Schema,
  BetaAdmissionMutationBodyV1Schema,
  BetaAdmissionResponseV1Schema,
} from "../../../packages/contracts/src/index";
import {
  activeCommercialPeriodEnd,
  adminLogin,
  adminOrigin,
  reset,
  seedAdminIdentity,
  sql,
} from "./support/fixtures.js";

// Real browser -> admin BFF -> API -> disposable PostgreSQL. Authentication
// uses the existing harness OTP and ordinary admin elevation. No API responses
// or cookies are manufactured. This file's source does not imply an executed
// E2E result; it may run only with the existing isolated database/reset authority.
// The established default audit envelope is used, without proposed DTO fields.
type BetaState = ReturnType<typeof BetaAdmissionResponseV1Schema.parse>;
type QuotaAction = ReturnType<
  typeof BetaAdmissionMutationBodyV1Schema.parse
>["action"];
type TypedValue =
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "INTEGER"; value: number };
type Invitation = {
  invitationId: string;
  status: "PENDING" | "CONSUMED" | "REVOKED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  replay?: boolean;
};
type BetaSnapshot = {
  mode: string;
  capacity: number;
  admitted: number;
  revision: number;
  mutationCount: number;
  invitations: { id: string; consumed: boolean; revoked: boolean }[];
  auditCount: number;
};
type OverrideRow = {
  id: string;
  revision: number;
  operation: "SET" | "CLEAR";
  booleanValue: boolean | null;
  integerValue: string | null;
};
type AuditRow = {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  correlationId: string;
  reason: string;
  metadata: Record<string, unknown>;
};

const bff = (path: string) => `${adminOrigin}/api/control-plane${path}`;
const email = (label: string) =>
  `b14-ops-${label}-${randomUUID()}@example.test`;
const betaPath = "/v1/admin/beta/admission";
const invitationPath = "/v1/admin/beta/invitations";
const booleanKey = "b14.real.boolean";
const integerKey = "b14.real.integer";
const historyPath = (accountId: string) =>
  `/v1/admin/accounts/${accountId}/entitlement-overrides`;
const overridePath = (accountId: string, key: string, operation = "set") =>
  `${historyPath(accountId)}/${key}/${operation}`;
const effectivePath = (accountId: string, key: string) =>
  `/v1/admin/accounts/${accountId}/entitlements/${key}`;

async function seedOwner(label: string) {
  const address = email(label);
  const owner = await seedAdminIdentity(address, "ADMIN_OWNER");
  if (!owner.principalId)
    throw new Error("B14 operations owner fixture missing");
  return { ...owner, principalId: owner.principalId, email: address };
}

async function post(page: Page, path: string, data: Record<string, unknown>) {
  const csrf = (await page.context().cookies(adminOrigin)).find(
    (cookie) => cookie.name === "pcp_admin_csrf",
  );
  if (!csrf) throw new Error("Normal admin CSRF cookie missing");
  return page.request.post(bff(path), {
    headers: { "x-csrf-token": csrf.value },
    data,
  });
}

async function json<T>(response: APIResponse | Response): Promise<T> {
  expect(response.status()).toBe(200);
  return (await response.json()) as T;
}

function expectInvitationProjection(
  invitation: Invitation,
  address: string,
  mutation: boolean,
) {
  const fields = [
    "consumedAt",
    "createdAt",
    "expiresAt",
    "invitationId",
    "revokedAt",
    "status",
    ...(mutation ? ["replay"] : []),
  ];
  expect(Object.keys(invitation).sort()).toEqual(fields.sort());
  expect(JSON.stringify(invitation)).not.toContain(address);
}

async function expectError(
  response: APIResponse | Response,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

function countPosts(page: Page, path: string) {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url() === bff(path)) count += 1;
  });
  return () => count;
}

async function confirm(
  page: Page,
  dialog: Locator,
  button: string,
  path: string,
) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url() === bff(path),
  );
  await dialog.getByRole("button", { name: button, exact: true }).click();
  return response;
}

const quotaPanel = (page: Page) =>
  page.locator("section.panel").filter({
    has: page.getByRole("combobox", { name: "Action", exact: true }),
  });
const invitationPanel = (page: Page) =>
  page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Create targeted invitation",
      exact: true,
    }),
  });
const revokePanel = (page: Page) =>
  page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Revoke pending invitation" }),
  });

async function reviewQuota(
  page: Page,
  action: QuotaAction,
  reason: string,
  amount?: number,
) {
  const panel = quotaPanel(page);
  await panel
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption(action);
  if (action === "ADD_CAPACITY" || action === "SET_CAPACITY") {
    if (amount === undefined) throw new Error("Quota numeric fixture missing");
    await panel
      .getByRole("spinbutton", {
        name: action === "ADD_CAPACITY" ? "Positive amount" : "Capacity",
        exact: true,
      })
      .fill(String(amount));
  }
  await panel
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill(reason);
  await panel
    .getByRole("button", { name: "Review change", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Confirm beta admission change" });
}

async function quotaMutation(
  page: Page,
  action: QuotaAction,
  reason: string,
  amount?: number,
) {
  const dialog = await reviewQuota(page, action, reason, amount);
  const response = await confirm(page, dialog, "Confirm", betaPath);
  const state = BetaAdmissionResponseV1Schema.parse(await json(response));
  await expect(
    page.getByText("Beta admission updated.", { exact: true }),
  ).toBeVisible();
  await expect(
    quotaPanel(page).getByRole("combobox", { name: "Action", exact: true }),
  ).toBeEnabled();
  return { response, state };
}

async function reviewInvitation(page: Page, address: string, reason: string) {
  const panel = invitationPanel(page);
  await panel
    .getByRole("textbox", { name: "Reviewer email", exact: true })
    .fill(address);
  await panel
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill(reason);
  await panel
    .getByRole("button", { name: "Review invitation", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Confirm targeted invitation" });
}

async function createInvitation(page: Page, address: string, reason: string) {
  const dialog = await reviewInvitation(page, address, reason);
  const response = await confirm(
    page,
    dialog,
    "Confirm invitation",
    invitationPath,
  );
  const invitation = await json<Invitation>(response);
  expect(invitation).toMatchObject({ status: "PENDING", replay: false });
  expectInvitationProjection(invitation, address, true);
  await expect(
    page.getByText("Targeted reviewer invitation created.", { exact: true }),
  ).toBeVisible();
  await expect(
    invitationPanel(page).getByRole("textbox", {
      name: "Reviewer email",
      exact: true,
    }),
  ).toBeEnabled();
  return { response, invitation };
}

async function reviewRevoke(page: Page, reason: string) {
  const panel = revokePanel(page);
  await panel
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill(reason);
  await panel
    .getByRole("button", { name: "Review revoke", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Confirm invitation revoke" });
}

async function betaSnapshot(): Promise<BetaSnapshot> {
  const [snapshot] = await sql<BetaSnapshot>(
    `SELECT mode,capacity,admitted,revision,
       (SELECT count(*)::integer FROM beta_admission_mutations) AS "mutationCount",
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id',id,'consumed',consumed_at IS NOT NULL,'revoked',revoked_at IS NOT NULL)
         ORDER BY id) FROM beta_identity_invitations),'[]'::jsonb) AS invitations,
       (SELECT count(*)::integer FROM audit_events WHERE action IN
         ('BETA_ADMISSION_CHANGED','BETA_IDENTITY_INVITED',
          'BETA_IDENTITY_INVITATION_REVOKED')) AS "auditCount"
     FROM beta_admission_state WHERE id=1`,
  );
  if (!snapshot) throw new Error("Beta singleton fixture missing");
  return snapshot;
}

async function expectAudit(
  page: Page,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string,
) {
  const rows = await sql<AuditRow>(
    `SELECT actor_id AS "actorId",action,target_type AS "targetType",
       target_id AS "targetId",correlation_id AS "correlationId",reason,
       safe_metadata AS metadata FROM audit_events
     WHERE actor_id=$1 AND action=$2 AND target_id IS NOT DISTINCT FROM $3::uuid
       AND reason=$4`,
    [actorId, action, targetId, reason],
  );
  expect(rows).toHaveLength(1);
  const event = rows[0]!;
  expect(event).toMatchObject({
    actorId,
    action,
    targetType,
    targetId,
    reason,
  });
  // Read this committed event through the ordinary safe public projection.
  // Reasons/metadata are asserted only inside this disposable fixture DB.
  const result = AdminAuditEventsResponseV1Schema.parse(
    await json(
      await page.request.get(
        bff(
          `/v1/admin/audit-events?correlationId=${encodeURIComponent(event.correlationId)}`,
        ),
      ),
    ),
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    actorId,
    action,
    targetType,
    targetId,
  });
  expect(result.items[0]).not.toHaveProperty("reason");
  expect(result.items[0]).not.toHaveProperty("safeMetadata");
  return event;
}

async function seedCommercialAccounts(accountIds: string[]) {
  const planId = randomUUID();
  const revisionId = randomUUID();
  await sql(
    `INSERT INTO entitlement_definitions
       (entitlement_key,value_type,security_classification,description)
     VALUES($1,'BOOLEAN','CAPABILITY','B14 real boolean fixture'),
           ($2,'INTEGER','LIMIT','B14 real integer fixture'),
           ('device.max_active','INTEGER','LIMIT','B14 real device allowance')`,
    [booleanKey, integerKey],
  );
  await sql("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    `b14-real-${planId.replaceAll("-", "")}`,
  ]);
  await sql(
    `INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description)
     VALUES($1,$2,1,'DRAFT','B14 real operations','Disposable commercial fixture')`,
    [revisionId, planId],
  );
  await sql(
    `INSERT INTO plan_entitlements
       (plan_revision_id,entitlement_key,boolean_value,integer_value)
     VALUES($1,$2,true,NULL),($1,$3,NULL,5),($1,'device.max_active',NULL,2)`,
    [revisionId, booleanKey, integerKey],
  );
  await sql(
    "UPDATE plan_revisions SET state='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
    [revisionId],
  );
  const start = new Date(Date.now() - 60_000);
  for (const accountId of accountIds) {
    await sql(
      `INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,
         started_at,current_period_start,current_period_end,state_reason)
       VALUES($1,'ACTIVE',1,$2,$3,$3,$4,'B14 disposable operations fixture')`,
      [accountId, revisionId, start, activeCommercialPeriodEnd()],
    );
  }
}

async function openEntitlement(page: Page, accountId: string, key: string) {
  await page.goto(`${adminOrigin}/accounts/${accountId}`);
  const panel = page.locator("section.card").filter({
    has: page.getByRole("heading", { name: "Entitlements", exact: true }),
  });
  await panel
    .getByRole("textbox", { name: "Entitlement key", exact: true })
    .fill(key);
  await expect(
    panel
      .getByRole("combobox", { name: "Override value", exact: true })
      .or(
        panel.getByRole("spinbutton", { name: "Override value", exact: true }),
      ),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "Clear override", exact: true }),
  ).toBeEnabled();
  return panel;
}

async function reviewOverride(
  panel: Locator,
  action: "Set override" | "Clear override",
  reason: string,
  value?: TypedValue,
) {
  if (value?.kind === "BOOLEAN") {
    await panel
      .getByRole("combobox", { name: "Override value", exact: true })
      .selectOption(String(value.value));
  } else if (value?.kind === "INTEGER") {
    await panel
      .getByRole("spinbutton", { name: "Override value", exact: true })
      .fill(String(value.value));
  }
  const button = panel.getByRole("button", { name: action, exact: true });
  const mutation = button.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' panel ')][1]",
  );
  await mutation
    .getByRole("textbox", { name: "Operator reason", exact: true })
    .fill(reason);
  await button.click();
  return panel.getByRole("dialog", { name: `Confirm ${action}`, exact: true });
}

async function overrideMutation(
  page: Page,
  panel: Locator,
  accountId: string,
  key: string,
  action: "Set override" | "Clear override",
  reason: string,
  value?: TypedValue,
) {
  const dialog = await reviewOverride(panel, action, reason, value);
  const response = await confirm(
    page,
    dialog,
    `Confirm ${action}`,
    overridePath(accountId, key, action === "Set override" ? "set" : "clear"),
  );
  expect(await json(response)).toMatchObject({
    status: "applied",
    changed: true,
  });
  await expect(
    page.getByText(`${action} completed.`, { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: action, exact: true }),
  ).toBeEnabled();
  return response;
}

async function overrideSnapshot(accountId: string, key: string) {
  const rows = await sql<OverrideRow>(
    `SELECT id,revision,operation,boolean_value AS "booleanValue",
       integer_value::text AS "integerValue"
     FROM account_entitlement_overrides
     WHERE account_id=$1 AND entitlement_key=$2 ORDER BY revision`,
    [accountId, key],
  );
  const [count] = await sql<{ auditCount: number }>(
    `SELECT count(*)::integer AS "auditCount" FROM audit_events
     WHERE target_type='ACCOUNT' AND target_id=$1
       AND action IN ('ACCOUNT_ENTITLEMENT_OVERRIDE_SET','ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED')
       AND safe_metadata->>'entitlementKey'=$2`,
    [accountId, key],
  );
  if (!count) throw new Error("Override count fixture missing");
  return { rows, auditCount: count.auditCount };
}

async function expectEffective(
  page: Page,
  panel: Locator,
  accountId: string,
  key: string,
  expected: Record<string, unknown>,
) {
  expect(
    await json(await page.request.get(bff(effectivePath(accountId, key)))),
  ).toMatchObject(expected);
  const prefix = "Effective server result: ";
  const status = panel.getByRole("status").filter({ hasText: prefix });
  await expect(status).toBeVisible();
  await expect
    .poll(async () => {
      const text = await status.innerText();
      return JSON.parse(text.slice(prefix.length)) as unknown;
    })
    .toMatchObject(expected);
}

test.beforeEach(async () => {
  // This is the existing guarded reset, not a new database authorization.
  await reset();
});

test("B14 real Beta quota actions persist revisions and audit once per request", async ({
  page,
}) => {
  const owner = await seedOwner("quota");
  await adminLogin(page, owner.email);
  await page.goto(`${adminOrigin}/beta`);
  let prior = BetaAdmissionResponseV1Schema.parse(
    await json(await page.request.get(bff(betaPath))),
  );
  const steps: {
    action: QuotaAction;
    amount?: number;
    mode: BetaState["mode"];
    capacity: number;
  }[] = [
    { action: "PAUSE", mode: "PAUSED", capacity: prior.capacity },
    { action: "CLOSE", mode: "CLOSED", capacity: prior.capacity },
    { action: "OPEN", mode: "OPEN", capacity: prior.capacity },
    {
      action: "ADD_CAPACITY",
      amount: 7,
      mode: "OPEN",
      capacity: prior.capacity + 7,
    },
    { action: "SET_CAPACITY", amount: 42, mode: "OPEN", capacity: 42 },
  ];
  for (const [index, step] of steps.entries()) {
    const reason = `B14 real quota ${step.action}`;
    const { response, state } = await quotaMutation(
      page,
      step.action,
      reason,
      step.amount,
    );
    const submitted = BetaAdmissionMutationBodyV1Schema.parse(
      response.request().postDataJSON(),
    );
    expect(submitted).toMatchObject({
      action: step.action,
      expectedRevision: prior.revision,
      reason,
    });
    expect(state).toMatchObject({
      mode: step.mode,
      capacity: step.capacity,
      admitted: prior.admitted,
      revision: prior.revision + 1,
    });
    expect(state.remaining).toBe(state.capacity - state.admitted);
    expect(await betaSnapshot()).toMatchObject({
      mode: state.mode,
      capacity: state.capacity,
      admitted: state.admitted,
      revision: state.revision,
      mutationCount: index + 1,
      auditCount: index + 1,
    });
    const audit = await expectAudit(
      page,
      owner.principalId,
      "BETA_ADMISSION_CHANGED",
      "BETA_ADMISSION_STATE",
      null,
      reason,
    );
    expect(audit.metadata).toMatchObject({
      action: step.action,
      old: { revision: prior.revision },
      new: {
        revision: state.revision,
        mode: state.mode,
        capacity: state.capacity,
      },
    });
    const snapshot = await betaSnapshot();
    // A deliberate same-request replay through the authenticated BFF must not
    // become a second state transition or a second audit event.
    expect(await json(await post(page, betaPath, submitted))).toEqual(state);
    expect(await betaSnapshot()).toEqual(snapshot);
    prior = state;
  }
});

test("B14 real targeted invitation create inspect revoke and audit keep identity private", async ({
  page,
}) => {
  const owner = await seedOwner("invite");
  await adminLogin(page, owner.email);
  await page.goto(`${adminOrigin}/beta`);
  await quotaMutation(page, "CLOSE", "B14 invitation closed Beta setup");
  const address = email("reviewer");
  const createReason = "B14 actual reviewer invitation";
  const { response, invitation } = await createInvitation(
    page,
    address,
    createReason,
  );
  const createBody = response.request().postDataJSON() as Record<
    string,
    unknown
  >;
  expect(createBody).toMatchObject({ email: address, reason: createReason });
  const [created] = await sql<{
    id: string;
    creator: string;
    active: boolean;
    consumed: boolean;
    revoked: boolean;
  }>(
    `SELECT id,created_by_admin_principal_id AS creator,expires_at>clock_timestamp() AS active,
       consumed_at IS NOT NULL AS consumed,revoked_at IS NOT NULL AS revoked
     FROM beta_identity_invitations WHERE normalized_identity_target=$1`,
    [address],
  );
  expect(created).toEqual({
    id: invitation.invitationId,
    creator: owner.principalId,
    active: true,
    consumed: false,
    revoked: false,
  });
  const createAudit = await expectAudit(
    page,
    owner.principalId,
    "BETA_IDENTITY_INVITED",
    "BETA_IDENTITY_INVITATION",
    invitation.invitationId,
    createReason,
  );
  expect(Object.keys(createAudit.metadata).sort()).toEqual([
    "expiresAt",
    "requestIdHash",
  ]);
  expect(JSON.stringify(createAudit.metadata)).not.toContain(address);
  const snapshot = await betaSnapshot();
  const replayed = await json<Invitation>(
    await post(page, invitationPath, createBody),
  );
  expect(replayed).toMatchObject({
    invitationId: invitation.invitationId,
    replay: true,
  });
  expectInvitationProjection(replayed, address, true);
  expect(await betaSnapshot()).toEqual(snapshot);

  await page
    .getByRole("textbox", { name: "Invitation ID", exact: true })
    .fill(invitation.invitationId);
  const inspection = page.waitForResponse(
    (value) =>
      value.request().method() === "GET" &&
      value.url() === bff(`${invitationPath}/${invitation.invitationId}`),
  );
  await page
    .getByRole("button", { name: "Inspect invitation", exact: true })
    .click();
  const inspected = await json<Invitation>(await inspection);
  expect(inspected).toMatchObject({
    invitationId: invitation.invitationId,
    status: "PENDING",
    consumedAt: null,
    revokedAt: null,
  });
  expectInvitationProjection(inspected, address, false);
  await expect(
    page.getByRole("row").filter({ hasText: invitation.invitationId }),
  ).toContainText("PENDING");
  await expect(
    invitationPanel(page).getByRole("textbox", {
      name: "Reviewer email",
      exact: true,
    }),
  ).toHaveValue("");

  const revokeReason = "B14 actual reviewer invitation revoke";
  const dialog = await reviewRevoke(page, revokeReason);
  const path = `${invitationPath}/${invitation.invitationId}/revoke`;
  const revoked = await json<Invitation>(
    await confirm(page, dialog, "Confirm revoke", path),
  );
  expect(revoked).toMatchObject({
    invitationId: invitation.invitationId,
    status: "REVOKED",
    replay: false,
    consumedAt: null,
  });
  expectInvitationProjection(revoked, address, true);
  expect(revoked.revokedAt).not.toBeNull();
  await expect(
    page.getByText("Invitation revoked.", { exact: true }),
  ).toBeVisible();
  const [revocation] = await sql<{
    actor: string;
    revoked: boolean;
    consumed: boolean;
  }>(
    `SELECT revoked_by_admin_principal_id AS actor,revoked_at IS NOT NULL AS revoked,
       consumed_at IS NOT NULL AS consumed FROM beta_identity_invitations WHERE id=$1`,
    [invitation.invitationId],
  );
  expect(revocation).toEqual({
    actor: owner.principalId,
    revoked: true,
    consumed: false,
  });
  const revokeAudit = await expectAudit(
    page,
    owner.principalId,
    "BETA_IDENTITY_INVITATION_REVOKED",
    "BETA_IDENTITY_INVITATION",
    invitation.invitationId,
    revokeReason,
  );
  expect(Object.keys(revokeAudit.metadata)).toEqual(["requestIdHash"]);
  expect((await betaSnapshot()).auditCount).toBe(3);
});

test("B14 real BOOLEAN false first override and clear restore the plan with audit", async ({
  page,
}) => {
  const owner = await seedOwner("boolean");
  const customer = await seedAdminIdentity(email("boolean-customer"));
  await seedCommercialAccounts([customer.accountId]);
  await adminLogin(page, owner.email);
  const panel = await openEntitlement(page, customer.accountId, booleanKey);
  const setReason = "B14 boolean false first override";
  const response = await overrideMutation(
    page,
    panel,
    customer.accountId,
    booleanKey,
    "Set override",
    setReason,
    { kind: "BOOLEAN", value: false },
  );
  expect(response.request().postDataJSON()).toMatchObject({
    expectedLatestRevision: null,
    value: { kind: "BOOLEAN", value: false },
  });
  expect(await overrideSnapshot(customer.accountId, booleanKey)).toMatchObject({
    rows: [
      {
        revision: 1,
        operation: "SET",
        booleanValue: false,
        integerValue: null,
      },
    ],
    auditCount: 1,
  });
  await expectEffective(page, panel, customer.accountId, booleanKey, {
    effectiveValue: { kind: "BOOLEAN", value: false },
    source: "ACCOUNT_OVERRIDE",
    selectedOverride: { overrideRevision: 1, state: "ACTIVE_SET" },
  });
  const setAudit = await expectAudit(
    page,
    owner.principalId,
    "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
    "ACCOUNT",
    customer.accountId,
    setReason,
  );
  expect(setAudit.metadata).toMatchObject({
    entitlementKey: booleanKey,
    overrideRevision: 1,
    operation: "SET",
    valueType: "BOOLEAN",
  });

  const clearReason = "B14 boolean clear to plan";
  const cleared = await overrideMutation(
    page,
    panel,
    customer.accountId,
    booleanKey,
    "Clear override",
    clearReason,
  );
  expect(cleared.request().postDataJSON()).toMatchObject({
    expectedLatestRevision: 1,
  });
  expect(await overrideSnapshot(customer.accountId, booleanKey)).toMatchObject({
    rows: [
      { revision: 1, operation: "SET", booleanValue: false },
      {
        revision: 2,
        operation: "CLEAR",
        booleanValue: null,
        integerValue: null,
      },
    ],
    auditCount: 2,
  });
  await expectEffective(page, panel, customer.accountId, booleanKey, {
    effectiveValue: { kind: "BOOLEAN", value: true },
    source: "PLAN_REVISION",
    reason: "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN",
    selectedOverride: { overrideRevision: 2, state: "ACTIVE_CLEAR" },
  });
  const clearAudit = await expectAudit(
    page,
    owner.principalId,
    "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
    "ACCOUNT",
    customer.accountId,
    clearReason,
  );
  expect(clearAudit.metadata).toMatchObject({
    entitlementKey: booleanKey,
    overrideRevision: 2,
    operation: "CLEAR",
  });
});

test("B14 real INTEGER zero and 42 persist numeric values and increasing revisions", async ({
  page,
}) => {
  const owner = await seedOwner("integer");
  const customer = await seedAdminIdentity(email("integer-customer"));
  await seedCommercialAccounts([customer.accountId]);
  await adminLogin(page, owner.email);
  const panel = await openEntitlement(page, customer.accountId, integerKey);
  for (const [index, value] of [0, 42].entries()) {
    const reason = `B14 actual integer ${value}`;
    const response = await overrideMutation(
      page,
      panel,
      customer.accountId,
      integerKey,
      "Set override",
      reason,
      { kind: "INTEGER", value },
    );
    expect(response.request().postDataJSON()).toMatchObject({
      expectedLatestRevision: index === 0 ? null : 1,
      value: { kind: "INTEGER", value },
    });
    const snapshot = await overrideSnapshot(customer.accountId, integerKey);
    expect(snapshot.rows).toHaveLength(index + 1);
    expect(snapshot.rows[index]).toMatchObject({
      revision: index + 1,
      operation: "SET",
      booleanValue: null,
      integerValue: String(value),
    });
    expect(snapshot.auditCount).toBe(index + 1);
    await expectEffective(page, panel, customer.accountId, integerKey, {
      effectiveValue: { kind: "INTEGER", value },
      source: "ACCOUNT_OVERRIDE",
      selectedOverride: { overrideRevision: index + 1 },
    });
    const audit = await expectAudit(
      page,
      owner.principalId,
      "ACCOUNT_ENTITLEMENT_OVERRIDE_SET",
      "ACCOUNT",
      customer.accountId,
      reason,
    );
    expect(audit.metadata).toMatchObject({
      entitlementKey: integerKey,
      overrideRevision: index + 1,
      valueType: "INTEGER",
    });
  }
});

test("B14 real same-key overrides retain separate account authority and read history", async ({
  page,
}) => {
  const owner = await seedOwner("isolation");
  const first = await seedAdminIdentity(email("isolation-first"));
  const second = await seedAdminIdentity(email("isolation-second"));
  await seedCommercialAccounts([first.accountId, second.accountId]);
  await adminLogin(page, owner.email);
  for (const [customer, value] of [
    [first, 42],
    [second, 0],
  ] as const) {
    const panel = await openEntitlement(page, customer.accountId, integerKey);
    const response = await overrideMutation(
      page,
      panel,
      customer.accountId,
      integerKey,
      "Set override",
      `B14 isolated account value ${value}`,
      { kind: "INTEGER", value },
    );
    expect(response.request().postDataJSON()).toMatchObject({
      expectedLatestRevision: null,
      value: { kind: "INTEGER", value },
    });
    const history = await json<{ items: Record<string, unknown>[] }>(
      await page.request.get(
        bff(
          `${historyPath(customer.accountId)}?entitlementKey=${integerKey}&limit=100`,
        ),
      ),
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      accountId: customer.accountId,
      entitlementKey: integerKey,
      revision: 1,
      value: { kind: "INTEGER", value },
    });
    expect(history.items[0]).not.toHaveProperty("reason");
    await expectEffective(page, panel, customer.accountId, integerKey, {
      effectiveValue: { kind: "INTEGER", value },
      selectedOverride: { overrideRevision: 1 },
    });
  }
  const secondBefore = await overrideSnapshot(second.accountId, integerKey);
  const firstPanel = await openEntitlement(page, first.accountId, integerKey);
  const cleared = await overrideMutation(
    page,
    firstPanel,
    first.accountId,
    integerKey,
    "Clear override",
    "B14 first account only clear",
  );
  expect(cleared.request().postDataJSON()).toMatchObject({
    expectedLatestRevision: 1,
  });
  expect(await overrideSnapshot(second.accountId, integerKey)).toEqual(
    secondBefore,
  );
  expect(
    await json(
      await page.request.get(bff(effectivePath(second.accountId, integerKey))),
    ),
  ).toMatchObject({
    effectiveValue: { kind: "INTEGER", value: 0 },
    selectedOverride: { overrideRevision: 1 },
  });
});

test("B14 real competing Beta write rejects the stale review without replay or extra audit", async ({
  page,
  browser,
}) => {
  const first = await seedOwner("quota-stale-first");
  const second = await seedOwner("quota-stale-second");
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await adminLogin(page, first.email);
    await adminLogin(other, second.email);
    await page.goto(`${adminOrigin}/beta`);
    const before = BetaAdmissionResponseV1Schema.parse(
      await json(await page.request.get(bff(betaPath))),
    );
    const dialog = await reviewQuota(
      page,
      "PAUSE",
      "B14 stale quota must not commit",
    );
    const posts = countPosts(page, betaPath);
    await json(
      await post(other, betaPath, {
        requestId: randomUUID(),
        expectedRevision: before.revision,
        action: "ADD_CAPACITY",
        amount: 1,
        reason: "B14 competing quota commit",
      }),
    );
    const committed = await betaSnapshot();
    await expectError(
      await confirm(page, dialog, "Confirm", betaPath),
      409,
      "ADMIN_STATE_STALE",
    );
    await expect(
      page.getByText(
        "The beta change was not automatically repeated. Review current server data before submitting a new operation.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(
      quotaPanel(page).getByRole("combobox", { name: "Action", exact: true }),
    ).toBeEnabled();
    expect(posts()).toBe(1);
    expect(await betaSnapshot()).toEqual(committed);
    const reviewed = await quotaMutation(
      page,
      "PAUSE",
      "B14 quota explicitly reviewed again",
    );
    expect(reviewed.response.request().postDataJSON()).toMatchObject({
      expectedRevision: committed.revision,
    });
    expect(reviewed.state).toMatchObject({
      mode: "PAUSED",
      revision: committed.revision + 1,
    });
    expect(posts()).toBe(2);
  } finally {
    await otherContext.close();
  }
});

for (const operation of ["quota", "invite", "revoke"] as const) {
  test(`B14 real expired Beta admin session blocks ${operation} with no state or audit write`, async ({
    page,
  }) => {
    const owner = await seedOwner(`expired-${operation}`);
    await adminLogin(page, owner.email);
    await page.goto(`${adminOrigin}/beta`);
    await quotaMutation(page, "CLOSE", `B14 expired ${operation} setup`);
    let dialog: Locator;
    let path: string;
    let button: string;
    if (operation === "quota") {
      dialog = await reviewQuota(page, "OPEN", "B14 expired quota denied");
      path = betaPath;
      button = "Confirm";
    } else if (operation === "invite") {
      dialog = await reviewInvitation(
        page,
        email("expired-reviewer"),
        "B14 expired invite denied",
      );
      path = invitationPath;
      button = "Confirm invitation";
    } else {
      const { invitation } = await createInvitation(
        page,
        email("revoke-reviewer"),
        "B14 expired revoke target setup",
      );
      dialog = await reviewRevoke(page, "B14 expired revoke denied");
      path = `${invitationPath}/${invitation.invitationId}/revoke`;
      button = "Confirm revoke";
    }
    const posts = countPosts(page, path);
    const before = await betaSnapshot();
    // Shorten only the ordinarily established test session. Do not manufacture
    // a session, change created_at, weaken the guard, or alter its credentials.
    const expired = await sql<{ expired: boolean }>(
      `UPDATE admin_sessions SET expires_at=created_at+interval '1 millisecond'
       WHERE admin_principal_id=$1 AND revoked_at IS NULL
       RETURNING expires_at<=clock_timestamp() AS expired`,
      [owner.principalId],
    );
    expect(expired).toEqual([{ expired: true }]);
    await expectError(
      await confirm(page, dialog, button, path),
      401,
      "ADMIN_UNAUTHORIZED",
    );
    await expect(
      page.getByRole("heading", { name: "Admin sign-in" }),
    ).toBeVisible();
    expect(posts()).toBe(1);
    expect(await betaSnapshot()).toEqual(before);
  });
}

test("B14 real competing first override rejects null stale authority and requires fresh review", async ({
  page,
  browser,
}) => {
  const first = await seedOwner("override-stale-first");
  const second = await seedOwner("override-stale-second");
  const customer = await seedAdminIdentity(email("override-stale-customer"));
  await seedCommercialAccounts([customer.accountId]);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await adminLogin(page, first.email);
    await adminLogin(other, second.email);
    const panel = await openEntitlement(page, customer.accountId, booleanKey);
    const dialog = await reviewOverride(
      panel,
      "Set override",
      "B14 stale first override denied",
      { kind: "BOOLEAN", value: true },
    );
    const path = overridePath(customer.accountId, booleanKey);
    const posts = countPosts(page, path);
    expect(
      await json(
        await post(other, path, {
          expectedLatestRevision: null,
          value: { kind: "BOOLEAN", value: false },
          effectiveFrom: new Date().toISOString(),
          expiresAt: null,
          reason: "B14 competing first override commit",
        }),
      ),
    ).toMatchObject({ status: "applied", changed: true });
    const committed = await overrideSnapshot(customer.accountId, booleanKey);
    expect(committed.rows).toHaveLength(1);
    const rejected = await confirm(page, dialog, "Confirm Set override", path);
    expect(rejected.request().postDataJSON()).toMatchObject({
      expectedLatestRevision: null,
    });
    await expectError(rejected, 409, "ADMIN_STATE_STALE");
    await expect(
      page.getByText(
        "The previous operation was not automatically repeated. Review current server data before submitting a new operation.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Set override", exact: true }),
    ).toBeEnabled();
    expect(posts()).toBe(1);
    expect(await overrideSnapshot(customer.accountId, booleanKey)).toEqual(
      committed,
    );
    await expectEffective(page, panel, customer.accountId, booleanKey, {
      effectiveValue: { kind: "BOOLEAN", value: false },
      selectedOverride: { overrideRevision: 1 },
    });
    const reviewed = await overrideMutation(
      page,
      panel,
      customer.accountId,
      booleanKey,
      "Set override",
      "B14 override explicitly reviewed again",
      { kind: "BOOLEAN", value: true },
    );
    expect(reviewed.request().postDataJSON()).toMatchObject({
      expectedLatestRevision: 1,
    });
    expect(
      await overrideSnapshot(customer.accountId, booleanKey),
    ).toMatchObject({
      rows: [
        { revision: 1, booleanValue: false },
        { revision: 2, booleanValue: true },
      ],
      auditCount: 2,
    });
    expect(posts()).toBe(2);
  } finally {
    await otherContext.close();
  }
});
