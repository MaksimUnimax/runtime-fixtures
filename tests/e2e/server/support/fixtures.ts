import { createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import {
  SimulatedExtensionClient,
  type BootstrapSnapshotStore,
  type ClientClock,
} from "../../../../packages/server/simulated-extension-client/src/index.js";
import {
  createDatabaseRuntime,
  createP3PolicyPublicationRepository,
} from "../../../../packages/server/db/src/index.js";
import { resetE2eDatabase, sql } from "./database.js";
export { sql };

const apiPort = process.env.E2E_API_PORT ?? "3100";
const portalPort = process.env.E2E_PORTAL_PORT ?? "3200";
const adminPort = process.env.E2E_ADMIN_PORT ?? "3300";
export const apiOrigin = `http://127.0.0.1:${apiPort}`;
export const portalOrigin = `http://127.0.0.1:${portalPort}`;
export const adminOrigin = `http://127.0.0.1:${adminPort}`;

export async function reset(): Promise<void> {
  await resetE2eDatabase();
}

export async function seedAdminIdentity(
  email: string,
  role?:
    | "ADMIN_OWNER"
    | "ADMIN_OPS"
    | "ADMIN_SUPPORT"
    | "ADMIN_BILLING_READONLY",
): Promise<{ userId: string; accountId: string; principalId?: string }> {
  const userId = randomUUID();
  const accountId = randomUUID();
  await sql("INSERT INTO users(id) VALUES($1)", [userId]);
  await sql("INSERT INTO accounts(id,display_name) VALUES($1,$2)", [
    accountId,
    "E2E admin account",
  ]);
  await sql(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [accountId, userId],
  );
  await sql(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,now())",
    [userId, email.toLowerCase()],
  );
  if (!role) return { userId, accountId };
  const principalId = randomUUID();
  await sql("INSERT INTO admin_principals(id,user_id) VALUES($1,$2)", [
    principalId,
    userId,
  ]);
  await sql(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,$2)",
    [principalId, role],
  );
  return { userId, accountId, principalId };
}

export async function adminLogin(page: Page, email: string): Promise<void> {
  await page.goto(`${adminOrigin}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Start OTP sign-in" }).click();
  await page.getByLabel("One-time code").fill("424242");
  const elevation = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/control-plane/v1/admin/session") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Verify and elevate" }).click();
  const elevationResponse = await elevation;
  if (!elevationResponse.ok()) throw new Error("admin elevation failed");
  await expect(page).toHaveURL(`${adminOrigin}/`);
}

export async function login(page: Page, returnTo = "/"): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email").fill("e2e@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill("424242");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(new RegExp(`${returnTo.replace("?", "\\?")}$`));
  await ensureDefaultCommercialSubscription();
}

async function ensureDefaultCommercialSubscription(): Promise<void> {
  const accounts = await sql<{ id: string }>(
    "SELECT id FROM accounts ORDER BY id LIMIT 1",
  );
  const account = accounts[0];
  if (!account) return;
  // Existing E2E coverage intentionally exercises commercial-only accounts.
  // The login flow creates a beta account when admission is open, so convert
  // this fixture account to the separately seeded commercial state without
  // decrementing cumulative beta admitted capacity.
  await sql("DELETE FROM beta_admissions WHERE account_id=$1", [account.id]);
  const existing = await sql<{ id: string }>(
    "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED'",
    [account.id],
  );
  if (existing[0]) return;
  const plan = randomUUID();
  const revision = randomUUID();
  await sql("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    plan,
    `e2e-default-${plan.replaceAll("-", "")}`,
  ]);
  await sql(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description) VALUES($1,$2,1,'DRAFT','E2E Default','E2E default plan')",
    [revision, plan],
  );
  await sql(
    "INSERT INTO entitlement_definitions(entitlement_key,value_type,security_classification,description) VALUES('device.max_active','INTEGER','LIMIT','Device limit')",
  );
  await sql(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,integer_value) VALUES($1,'device.max_active',1)",
    [revision],
  );
  await sql(
    "UPDATE plan_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [revision, new Date("2026-09-01T00:00:00.000Z")],
  );
  await sql(
    "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,'ACTIVE',1,$2,$3,$3,$4,'e2e default')",
    [
      account.id,
      revision,
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-10-01T00:00:00.000Z"),
    ],
  );
}

function packagedKeys(ids: string[]): ReadonlyMap<string, KeyObject> {
  const raw = JSON.parse(
    process.env.CONFIG_SIGNING_PUBLIC_KEY_RING_JSON ?? "[]",
  ) as Array<{
    keyId: string;
    publicKeySpkiDerB64: string;
  }>;
  return new Map(
    raw
      .filter((entry) => ids.includes(entry.keyId))
      .map((entry) => [
        entry.keyId,
        createPublicKey({
          key: Buffer.from(entry.publicKeySpkiDerB64, "base64"),
          format: "der",
          type: "spki",
        }),
      ]),
  );
}

/** Test setup supplies public package data; the client never discovers it. */
async function packagedKeysFromDisposableDb(
  ids: string[],
): Promise<ReadonlyMap<string, KeyObject>> {
  const rows = await sql<{ key_id: string; public_key_spki_der: Buffer }>(
    "SELECT key_id,public_key_spki_der FROM signing_keys WHERE key_id=ANY($1::text[])",
    [ids],
  );
  return new Map(
    rows.map((entry) => [
      entry.key_id,
      createPublicKey({
        key: entry.public_key_spki_der,
        format: "der",
        type: "spki",
      }),
    ]),
  );
}

async function packagedClient(
  trust: "old" | "overlap" | "new",
  options: {
    clock?: ClientClock;
    snapshotStore?: BootstrapSnapshotStore;
    fetch?: typeof fetch;
  } = {},
): Promise<SimulatedExtensionClient> {
  const ids =
    trust === "old"
      ? ["e2e-config-k1"]
      : trust === "new"
        ? ["e2e-config-k2"]
        : ["e2e-config-k1", "e2e-config-k2"];
  return new SimulatedExtensionClient({
    controlPlaneApiOrigin: apiOrigin,
    portalOrigin,
    trustedConfigSigningKeys: await packagedKeysFromDisposableDb(ids),
    ...options,
  });
}

export function client(
  trust: "old" | "overlap" | "new" = "overlap",
): SimulatedExtensionClient {
  const ids =
    trust === "old"
      ? ["e2e-config-k1"]
      : trust === "new"
        ? ["e2e-config-k2"]
        : ["e2e-config-k1", "e2e-config-k2"];
  return new SimulatedExtensionClient({
    controlPlaneApiOrigin: apiOrigin,
    portalOrigin,
    trustedConfigSigningKeys: packagedKeys(ids),
  });
}

export async function start(clientInstance: SimulatedExtensionClient) {
  return clientInstance.startAuthorization({
    clientType: "browser_extension",
    browserFamily: "chrome",
    browserVersion: "123.0",
    extensionVersion: "1.2.3",
    deviceLabel: "E2E Chrome",
  });
}

export async function approve(
  page: Page,
  authorization: Awaited<ReturnType<typeof start>>,
): Promise<void> {
  await ensureDefaultCommercialSubscription();
  await page.goto(authorization.verificationUrl);
  await expect(page.getByText("E2E Chrome")).toBeVisible();
  await expect(page.getByText("chrome 123.0")).toBeVisible();
  await expect(page.getByText("1.2.3")).toBeVisible();
  await page.getByLabel("User code").fill(authorization.userCode);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toContainText("Device approved");
}

export async function credentials(
  clientInstance: SimulatedExtensionClient,
): Promise<{
  deviceId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}> {
  const value = (
    clientInstance as unknown as {
      credentials?: {
        deviceId: string;
        sessionId: string;
        accessToken: string;
        refreshToken: string;
      };
    }
  ).credentials;
  if (!value) throw new Error("activation credentials are absent");
  return value;
}

export async function accountId(): Promise<string> {
  const rows = await sql<{ id: string }>("SELECT id FROM accounts LIMIT 1");
  if (!rows[0]) throw new Error("fixture account is absent");
  return rows[0].id;
}

export async function activateExtensionClient(
  page: Page,
  trust: "old" | "overlap" | "new" = "overlap",
  options: {
    clock?: ClientClock;
    snapshotStore?: BootstrapSnapshotStore;
    fetch?: typeof fetch;
  } = {},
) {
  await login(page);
  const extension = await packagedClient(trust, options);
  const authorization = await start(extension);
  await approve(page, authorization);
  if (
    (
      await extension.exchange(
        authorization.deviceCode,
        "e2e-bootstrap-exchange-key",
      )
    ).kind !== "ACTIVATED"
  )
    throw new Error("E2E extension activation failed");
  return extension;
}

export async function activateExtension(page: Page) {
  return credentials(await activateExtensionClient(page));
}

/** Uses the accepted publication path; only its public signer metadata exists in DB. */
export async function seedBootstrapConfig(
  options: {
    minimumExtensionVersion?: string;
    signingKeyId?: string;
    unsupportedChrome?: boolean;
    contractVersion?: "control_plane_v1" | "control_plane_v2";
  } = {},
) {
  const database = createDatabaseRuntime(process.env.DATABASE_URL!);
  const publication = createP3PolicyPublicationRepository(database);
  const context = {
    actorType: "SYSTEM" as const,
    correlationId: "e2e-bootstrap",
  };
  const contractVersion = options.contractVersion ?? "control_plane_v1";
  const snapshotVersion =
    contractVersion === "control_plane_v1"
      ? "bootstrap_snapshot_v1"
      : "bootstrap_snapshot_v2";
  const envelopeVersion =
    contractVersion === "control_plane_v1"
      ? "bootstrap_envelope_v1"
      : "bootstrap_envelope_v2";
  const publishedAt = new Date("2026-09-04T00:00:00.000Z");
  try {
    await publication.publishExtensionRelease(
      {
        version: "1.2.3",
        releaseChannel: "stable",
        releasedAt: publishedAt,
        supportedContracts: [contractVersion],
        supportedBrowsers: options.unsupportedChrome
          ? ["yandex_chromium"]
          : ["chrome"],
      },
      context,
    );
    const compatibility = await publication.publishCompatibilityPolicyRevision(
      {
        policyKey: "e2e-bootstrap-policy",
        contractVersion,
        browserFamily: null,
        minimumExtensionVersion: options.minimumExtensionVersion ?? "1.0.0",
        recommendedExtensionVersion:
          options.minimumExtensionVersion === "2.0.0" ? "2.1.0" : "1.1.0",
        minimumBrowserVersion: null,
        maintenanceMode: false,
        maintenanceCode: null,
        blockedVersions: [],
        publishedAt,
      },
      context,
    );
    await publication.createFeatureDefinition(
      { featureKey: "feature-e2e" },
      context,
    );
    const feature = await publication.publishFeatureRuleRevision(
      {
        featureKey: "feature-e2e",
        contractVersion,
        enabled: true,
        browserFamily: null,
        minimumExtensionVersion: "1.0.0",
        publishedAt,
      },
      context,
    );
    const config = await publication.publishConfigRelease(
      {
        contractVersion,
        snapshotVersion,
        envelopeVersion,
        signingKeyId: options.signingKeyId ?? "e2e-config-k1",
        compatibilityPolicyRevisionIds: [compatibility.id],
        featureRuleRevisionIds: [feature.id],
        featureRolloutRevisionIds: [],
        publishedAt,
      },
      context,
    );
    return config.configVersion;
  } finally {
    await database.close();
  }
}
