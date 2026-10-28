import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  AuthService,
  deriveAuthKeys,
} from "../../../packages/server/auth/src/index.js";
import { createApiApp } from "../../../apps/api/src/app.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConnectionCodeService,
  DeviceManagementService,
  type DeviceLimitResolver,
} from "../../../packages/server/device-management/src/index.js";
import {
  createEphemeralAccessTokenSigningKey,
  ExtensionAuthService,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
  deviceCodeArtifact,
  generateDeviceCode,
} from "../../../packages/server/device-auth/src/index.js";
import {
  createDeviceAuthorizationRepository,
  createAuthRepository,
  createConnectionCodeRepository,
  createDatabaseRuntime,
  createDeviceManagementRepository,
  createExtensionAuthRepository,
  createCredentialTransferRepository,
  createCredentialTransferEpochFence,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { TRANSFER_FENCE_RUNTIME_CHECK_SQL } from "../../../packages/server/db/src/credential-transfer-fence-readiness.js";
import { validateIsolatedDatabaseUrl } from "../../../tooling/server/isolated-auth-lifecycle.js";

const connectionString = validateIsolatedDatabaseUrl(
  process.env.DATABASE_URL ?? "",
);
const root = Buffer.alloc(32, 61);
const signing = createEphemeralAccessTokenSigningKey("connection-isolated");
let db: DatabaseRuntime;
let clock = new Date();
const query = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => db.query<T>(sql, values);
const limits: DeviceLimitResolver = {
  resolve: async () => ({ maxActive: 20, source: "ISOLATED_CONNECTION_TEST" }),
};
const service = (override = limits) =>
  new ConnectionCodeService(
    createConnectionCodeRepository(db),
    root,
    signing,
    override,
    () => clock,
  );
const extension = () =>
  new ExtensionAuthService(
    createExtensionAuthRepository(db),
    deriveExtensionAuthKeys(root),
    () => clock,
    signing,
  );
async function owner() {
  clock = new Date();
  const accountId = randomUUID(),
    userId = randomUUID(),
    sessionId = randomUUID();
  await query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await query(
    "INSERT INTO account_memberships(id,account_id,user_id,role) VALUES($1,$2,$3,'OWNER')",
    [randomUUID(), accountId, userId],
  );
  await query(
    "INSERT INTO portal_sessions(id,user_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
    [
      sessionId,
      userId,
      "synthetic:" + randomUUID(),
      clock,
      new Date(clock.getTime() + 86400000),
    ],
  );
  return {
    accountId,
    principal: { userId, sessionId, authenticatedAt: clock },
  };
}
async function issue(state: Awaited<ReturnType<typeof owner>>) {
  const input = {
    accountId: state.accountId,
    expectedGeneration: 0,
    mode: "CREATE" as const,
    idempotencyKey: randomUUID(),
  };
  const result = await service().issue(input, state.principal, randomUUID());
  if (result.kind !== "CREATED")
    throw new Error("issue fixture: " + result.kind);
  return { input, ...result };
}
async function activate(
  code: string,
  idempotencyKey = randomUUID(),
  chosen = service(),
) {
  const result = await chosen.exchange(
    { code, idempotencyKey, deviceLabel: "Synthetic browser" },
    "198.51.100.61",
    randomUUID(),
  );
  if (result.kind !== "ACTIVATED")
    throw new Error("activation fixture: " + result.kind);
  return { idempotencyKey, ...result };
}
async function legacy(state: Awaited<ReturnType<typeof owner>>) {
  const id = randomUUID(),
    code = generateDeviceCode();
  await query(
    "INSERT INTO device_authorizations(id,device_code_hash,user_code_hash,status,requested_client_type,approved_account_id,approved_user_id,expires_at,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag) VALUES($1,$2,$3,'APPROVED','browser_extension',$4,$5,$6,$7,$8,$9)",
    [
      id,
      deviceCodeArtifact(deriveDeviceAuthKeys(root), code),
      "synthetic:" + id,
      state.accountId,
      state.principal.userId,
      new Date(clock.getTime() + 60000),
      Buffer.from("fixture"),
      Buffer.alloc(12),
      Buffer.alloc(16),
    ],
  );
  const result = await new DeviceManagementService(
    createDeviceManagementRepository(db),
    root,
    signing,
    limits,
    () => clock,
  ).exchange(code, randomUUID(), "198.51.100.62", randomUUID());
  if (result.kind !== "ACTIVATED")
    throw new Error("legacy fixture: " + result.kind);
  return result;
}
describe.sequential(
  "account connection code: real isolated PostgreSQL transactions",
  () => {
    let upgradeDevice: string;
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString);
      await db.ready();
      const target = await query<{ name: string }>(
        "SELECT current_database() name",
      );
      expect(target.rows[0]?.name).toBe(
        new URL(connectionString).pathname.slice(1),
      );
      // Unique fixture rows only: no global TRUNCATE, DROP, grants or epoch reset.
      const state = await owner();
      upgradeDevice = randomUUID();
      await query(
        "INSERT INTO devices(id,account_id,created_by_user_id,status,label) VALUES($1,$2,$3,'ACTIVE','pre-upgrade legacy fixture')",
        [upgradeDevice, state.accountId, state.principal.userId],
      );
      await runMigrations({ connectionString });
      await runMigrations({ connectionString });
    });
    afterAll(async () => {
      await db?.close();
    });

    it("revocation shape rejects every partial pair and migration preserves invalid data on failure", async () => {
      const state = await owner();
      await issue(state);
      const row = (
        await query<{ id: string }>(
          "SELECT id FROM account_connection_credentials WHERE account_id=$1",
          [state.accountId],
        )
      ).rows[0]!;
      for (const expression of [
        "revoked_at=NULL,revocation_reason='REPLACED'",
        "revoked_at=created_at,revocation_reason=NULL",
        "revoked_at=created_at-interval '1 second',revocation_reason='REPLACED'",
      ]) {
        await expect(
          query(
            "UPDATE account_connection_credentials SET " +
              expression +
              " WHERE id=$1",
            [row.id],
          ),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "account_connection_credentials_revocation_shape",
        });
      }
      expect(
        (
          await query(
            "SELECT revoked_at,revocation_reason FROM account_connection_credentials WHERE id=$1",
            [row.id],
          )
        ).rows[0],
      ).toEqual({ revoked_at: null, revocation_reason: null });
      const correction = readFileSync(
        new URL(
          "../../../packages/server/db/drizzle/0063_connection_revocation_shape.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            "ALTER TABLE account_connection_credentials DROP CONSTRAINT account_connection_credentials_revocation_shape, ADD CONSTRAINT account_connection_credentials_revocation_shape CHECK((revoked_at IS NULL AND revocation_reason IS NULL) OR (revoked_at >= created_at AND revocation_reason IS NOT NULL))",
          );
          await tx.query(
            "UPDATE account_connection_credentials SET revocation_reason='REPLACED' WHERE id=$1",
            [row.id],
          );
          const retained = await tx.query(
            "SELECT revoked_at,revocation_reason FROM account_connection_credentials WHERE id=$1",
            [row.id],
          );
          expect(retained.rows[0]).toEqual({
            revoked_at: null,
            revocation_reason: "REPLACED",
          });
          await tx.query(correction);
        }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "account_connection_credentials_revocation_shape",
      });
      expect(
        (
          await query(
            "SELECT revoked_at,revocation_reason FROM account_connection_credentials WHERE id=$1",
            [row.id],
          )
        ).rows[0],
      ).toEqual({ revoked_at: null, revocation_reason: null });
      await query(
        "UPDATE account_connection_credentials SET revoked_at=created_at,revocation_reason='REPLACED' WHERE id=$1",
        [row.id],
      );
      expect(
        (
          await query(
            "SELECT revoked_at IS NOT NULL AS revoked,revocation_reason FROM account_connection_credentials WHERE id=$1",
            [row.id],
          )
        ).rows[0],
      ).toEqual({ revoked: true, revocation_reason: "REPLACED" });
    });

    it("runtime admission requires both migration guards and rejects altered layouts", async () => {
      const current = await query(TRANSFER_FENCE_RUNTIME_CHECK_SQL);
      expect(current.rows[0]?.mandatory_statement_trigger).toBe(true);
      const mutations = [
        "ALTER FUNCTION public.octoport_guard_connection_transfer_approval() RENAME TO octoport_guard_connection_transfer_approval_probe",
        "ALTER TABLE public.credential_transfer_requests DISABLE TRIGGER credential_transfer_epoch_guard",
        "ALTER TABLE public.credential_transfer_requests DISABLE TRIGGER connection_transfer_approval_guard",
        "DROP TRIGGER connection_transfer_approval_guard ON public.credential_transfer_requests",
        "CREATE TRIGGER connection_extra_test_guard BEFORE INSERT ON public.credential_transfer_requests FOR EACH STATEMENT EXECUTE FUNCTION octoport_transfer_fence.guard_transfer_statement()",
      ];
      for (const mutation of mutations) {
        const rollback = new Error("ROLL_BACK_ISOLATED_GUARD_PROBE");
        try {
          await db.transaction(async (tx) => {
            await tx.query(mutation);
            const probe = await tx.query(TRANSFER_FENCE_RUNTIME_CHECK_SQL);
            expect(probe.rows[0]?.mandatory_statement_trigger).toBe(false);
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
        const restored = await query(TRANSFER_FENCE_RUNTIME_CHECK_SQL);
        expect(restored.rows[0]?.mandatory_statement_trigger).toBe(true);
      }
    });

    it("additive migration preserves existing legacy device and runs idempotently", async () => {
      const row = await query(
        "SELECT status,label,connection_credential_id,credential_transfer_approved_at FROM devices WHERE id=$1",
        [upgradeDevice],
      );
      expect(row.rows[0]).toEqual({
        status: "ACTIVE",
        label: "pre-upgrade legacy fixture",
        connection_credential_id: null,
        credential_transfer_approved_at: null,
      });
    });
    it("persists only a verifier; repeated issue reveals no code; changed intent conflicts", async () => {
      const state = await owner(),
        created = await issue(state);
      const rows = await query(
        "SELECT * FROM account_connection_credentials WHERE account_id=$1",
        [state.accountId],
      );
      expect(JSON.stringify(rows.rows)).not.toContain(created.code);
      const replay = await service().issue(
        created.input,
        state.principal,
        randomUUID(),
      );
      expect(replay.kind).toBe("ALREADY_ISSUED");
      expect(replay).not.toHaveProperty("code");
      expect(
        (
          await service().issue(
            {
              ...created.input,
              mode: "REPLACE_KEEP_DEVICES",
              expectedGeneration: 1,
            },
            state.principal,
            randomUUID(),
          )
        ).kind,
      ).toBe("CONFLICT");
    });
    it("two concurrent issue operations create one generation, never two active codes", async () => {
      const state = await owner();
      const results = await Promise.all(
        [1, 2].map(() =>
          service().issue(
            {
              accountId: state.accountId,
              expectedGeneration: 0,
              mode: "CREATE",
              idempotencyKey: randomUUID(),
            },
            state.principal,
            randomUUID(),
          ),
        ),
      );
      expect(results.map((r) => r.kind).sort()).toEqual([
        "CONFLICT",
        "CREATED",
      ]);
      expect(
        (
          await query(
            "SELECT id FROM account_connection_credentials WHERE account_id=$1 AND revoked_at IS NULL",
            [state.accountId],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("same attempt concurrently commits one device and returns the same session and refresh", async () => {
      const state = await owner(),
        code = await issue(state),
        key = randomUUID();
      const [a, b] = await Promise.all([
        activate(code.code, key),
        activate(code.code, key),
      ]);
      expect([a.deviceId, a.sessionId, a.refreshToken]).toEqual([
        b.deviceId,
        b.sessionId,
        b.refreshToken,
      ]);
      expect(a.accountId).toBe(state.accountId);
      expect(
        (
          await query("SELECT id FROM devices WHERE account_id=$1", [
            state.accountId,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(await extension().authenticateAccess(a.accessToken)).toMatchObject(
        {
          ok: true,
          value: {
            accountId: state.accountId,
            deviceId: a.deviceId,
            sessionId: a.sessionId,
          },
        },
      );
    });
    it("same saved code enrolls a second independent browser without another portal authentication", async () => {
      const state = await owner(),
        code = await issue(state),
        a = await activate(code.code);
      await query("UPDATE portal_sessions SET revoked_at=$2 WHERE id=$1", [
        state.principal.sessionId,
        clock,
      ]);
      const b = await activate(code.code);
      expect(a.accountId).toBe(b.accountId);
      expect(a.deviceId).not.toBe(b.deviceId);
      expect(a.sessionId).not.toBe(b.sessionId);
      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
    it("expired or changed attempt and consumed initial refresh never create another device", async () => {
      const state = await owner(),
        code = await issue(state),
        a = await activate(code.code);
      expect(
        (
          await service().exchange(
            {
              code: code.code,
              idempotencyKey: a.idempotencyKey,
              deviceLabel: "Different",
            },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("CONFLICT");
      await query(
        "UPDATE refresh_tokens SET consumed_at=$2 WHERE session_id=$1",
        [a.sessionId, clock],
      );
      expect(
        (
          await service().exchange(
            {
              code: code.code,
              idempotencyKey: a.idempotencyKey,
              deviceLabel: "Synthetic browser",
            },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("CLOSED");
      clock = new Date(clock.getTime() + 121000);
      expect(
        (
          await service().exchange(
            {
              code: code.code,
              idempotencyKey: a.idempotencyKey,
              deviceLabel: "Synthetic browser",
            },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("CLOSED");
      expect(
        (
          await query("SELECT id FROM devices WHERE account_id=$1", [
            state.accountId,
          ])
        ).rows,
      ).toHaveLength(1);
    });
    it("ordinary replacement closes old enrollment but keeps prior devices and sessions", async () => {
      const state = await owner(),
        code = await issue(state),
        a = await activate(code.code);
      const rotated = await service().issue(
        {
          accountId: state.accountId,
          mode: "REPLACE_KEEP_DEVICES",
          expectedGeneration: 1,
          idempotencyKey: randomUUID(),
        },
        state.principal,
        randomUUID(),
      );
      expect(rotated.kind).toBe("CREATED");
      if (rotated.kind !== "CREATED") return;
      expect(
        (
          await service().exchange(
            { code: code.code, idempotencyKey: randomUUID() },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("CLOSED");
      expect(await extension().authenticateAccess(a.accessToken)).toMatchObject(
        { ok: true },
      );
      expect((await activate(rotated.code)).accountId).toBe(state.accountId);
    });
    it("emergency replacement revokes both legacy and code devices and their sessions", async () => {
      const state = await owner(),
        code = await issue(state),
        a = await activate(code.code),
        old = await legacy(state);
      const rotated = await service().issue(
        {
          accountId: state.accountId,
          mode: "REPLACE_REVOKE_DEVICES",
          expectedGeneration: 1,
          idempotencyKey: randomUUID(),
        },
        state.principal,
        randomUUID(),
      );
      expect(rotated).toMatchObject({ kind: "CREATED", revokedDevices: 2 });
      expect(await extension().authenticateAccess(a.accessToken)).toMatchObject(
        { ok: false },
      );
      expect(
        await extension().authenticateAccess(old.accessToken),
      ).toMatchObject({ ok: false });
      expect(
        (
          await query(
            "SELECT id FROM sessions WHERE account_id=$1 AND status='ACTIVE'",
            [state.accountId],
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("concurrent emergency replacement serializes with enrollment; no old-code survivor", async () => {
      const state = await owner(),
        code = await issue(state);
      await Promise.all([
        service().exchange(
          { code: code.code, idempotencyKey: randomUUID() },
          "198.51.100.61",
          randomUUID(),
        ),
        service().issue(
          {
            accountId: state.accountId,
            mode: "REPLACE_REVOKE_DEVICES",
            expectedGeneration: 1,
            idempotencyKey: randomUUID(),
          },
          state.principal,
          randomUUID(),
        ),
      ]);
      expect(
        (
          await query(
            "SELECT id FROM devices WHERE account_id=$1 AND status='ACTIVE'",
            [state.accountId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await service().exchange(
            { code: code.code, idempotencyKey: randomUUID() },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("CLOSED");
    });
    it("DB rechecks real portal freshness, owner membership and account status", async () => {
      const state = await owner(),
        outsider = await owner();
      expect(
        (
          await service().issue(
            {
              accountId: state.accountId,
              mode: "CREATE",
              expectedGeneration: 0,
              idempotencyKey: randomUUID(),
            },
            outsider.principal,
            randomUUID(),
          )
        ).kind,
      ).toBe("FORBIDDEN");
      await query("UPDATE portal_sessions SET created_at=$2 WHERE id=$1", [
        state.principal.sessionId,
        new Date(clock.getTime() - 360000),
      ]);
      expect(
        (
          await service().issue(
            {
              accountId: state.accountId,
              mode: "CREATE",
              expectedGeneration: 0,
              idempotencyKey: randomUUID(),
            },
            state.principal,
            randomUUID(),
          )
        ).kind,
      ).toBe("REAUTH_REQUIRED");
      await query("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
        state.accountId,
      ]);
      expect(
        (await service().status(state.accountId, state.principal)).kind,
      ).toBe("forbidden");
    });
    it("new and legacy enrollment preserve the same finite, beta and subscription admission", async () => {
      const state = await owner(),
        code = await issue(state);
      const finite: DeviceLimitResolver = {
        resolve: async () => ({ maxActive: 1, source: "TEST" }),
      };
      await activate(code.code, randomUUID(), service(finite));
      expect(
        (
          await service(finite).exchange(
            { code: code.code, idempotencyKey: randomUUID() },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("DEVICE_LIMIT_REACHED");
      const denied: DeviceLimitResolver = {
        resolve: async () => ({
          kind: "INELIGIBLE",
          reason: "NO_CURRENT_SUBSCRIPTION",
        }),
      };
      expect(
        (
          await service(denied).exchange(
            { code: code.code, idempotencyKey: randomUUID() },
            "198.51.100.61",
            randomUUID(),
          )
        ).kind,
      ).toBe("SUBSCRIPTION_REQUIRED");
      const beta: DeviceLimitResolver = {
        resolve: async () => ({ kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" }),
      };
      expect(
        (await activate(code.code, randomUUID(), service(beta))).kind,
      ).toBe("ACTIVATED");
      const old = await legacy(state);
      expect(
        (
          await query(
            "SELECT connection_credential_id FROM devices WHERE id=$1",
            [old.deviceId],
          )
        ).rows[0]?.connection_credential_id,
      ).toBeNull();
    });
    it("code alone cannot request keys; foreign and stale confirmation fail; owner confirmation is idempotent", async () => {
      const state = await owner(),
        other = await owner(),
        code = await issue(state),
        a = await activate(code.code);
      const transfer = createCredentialTransferRepository(db);
      const input = {
        principal: {
          accountId: state.accountId,
          deviceId: a.deviceId,
          sessionId: a.sessionId,
        },
        request: {
          requestId: randomUUID(),
          recipientDeviceId: a.deviceId,
          recipientPublicKeySpki: "synthetic-unused",
          sourceDeviceId: null,
          selectedStores: [],
          expiresInSeconds: 60,
        },
        now: clock,
      };
      await expect(transfer.create(input)).rejects.toMatchObject({
        code: "CONNECTION_TRANSFER_APPROVAL_REQUIRED",
      });
      expect(
        (
          await service().approveTransfer(
            { accountId: state.accountId, deviceId: a.deviceId },
            other.principal,
            randomUUID(),
          )
        ).kind,
      ).toBe("FORBIDDEN");
      expect(
        (
          await service().approveTransfer(
            { accountId: state.accountId, deviceId: a.deviceId },
            {
              ...state.principal,
              authenticatedAt: new Date(clock.getTime() - 360000),
            },
            randomUUID(),
          )
        ).kind,
      ).toBe("REAUTH_REQUIRED");
      const approval = await service().approveTransfer(
        { accountId: state.accountId, deviceId: a.deviceId },
        state.principal,
        randomUUID(),
      );
      expect(approval.kind).toBe("APPROVED");
      expect(
        await service().approveTransfer(
          { accountId: state.accountId, deviceId: a.deviceId },
          state.principal,
          randomUUID(),
        ),
      ).toEqual(approval);
      expect(
        (
          await query(
            "SELECT id FROM audit_events WHERE target_id=$1 AND action='CONNECTION_DEVICE_TRANSFER_APPROVED'",
            [a.deviceId],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("DB trigger rejects an old writer bypassing the new recipient check", async () => {
      const state = await owner(),
        code = await issue(state),
        a = await activate(code.code);
      const fence = createCredentialTransferEpochFence(db, randomUUID());
      await fence.claim(); // Existing isolated DB function; no new role, grant or trigger bypass.
      const insert = () =>
        fence.fencedTransaction((tx) =>
          tx.query(
            "INSERT INTO credential_transfer_requests(request_id,account_id,recipient_device_id,recipient_public_key_spki,selected_store_ids,state,revision,created_at,expires_at) VALUES($1,$2,$3,'synthetic-unused','{}','REQUESTED',1,$4,$5)",
            [
              randomUUID(),
              state.accountId,
              a.deviceId,
              clock,
              new Date(clock.getTime() + 60000),
            ],
          ),
        );
      await expect(insert()).rejects.toMatchObject({
        code: "23514",
        message: "CONNECTION_TRANSFER_APPROVAL_REQUIRED",
      });
      await service().approveTransfer(
        { accountId: state.accountId, deviceId: a.deviceId },
        state.principal,
        randomUUID(),
      );
      await expect(insert()).resolves.toMatchObject({ rowCount: 1 });
      fence.deactivate();
    });
    it.skipIf(!process.env.SA_CONNECTION_BROWSER_ROOT)(
      process.env.SA_CONNECTION_BROWSER_SCENARIO === "legacy_upgrade"
        ? "actual browser cabinet -> old040 legacy activation -> preserved profile upgrade"
        : process.env.SA_CONNECTION_BROWSER_SCENARIO === "auth_recovery"
          ? "actual browser cabinet -> lost exchange restart -> account switch key isolation"
          : process.env.SA_CONNECTION_BROWSER_SCENARIO === "work_cycle"
            ? "actual browser cabinet -> code -> Start-command-result-Finish -> new Start"
            : process.env.SA_CONNECTION_BROWSER_SCENARIO === "key_transfer"
              ? "actual browser cabinet -> confirmed key recipient -> encrypted transfer and ACK"
              : process.env.SA_CONNECTION_BROWSER_SCENARIO === "owner_lifecycle"
                ? "actual browser cabinet -> recipient approval, replacement, unknown outcome and emergency revoke"
                : "actual browser cabinet -> two independent installed connections -> restart",
      async () => {
        const { runConnectionBrowser } = await import(
          "./helpers/connection-browser.js"
        );
        const result = await runConnectionBrowser(db, connectionString);
        expect(result.status).toBe("PASS");
        expect(Object.values(result.checks).every(Boolean)).toBe(true);
      },
      160_000,
    );
    it("existing account OTP -> connection exchange -> independent sessions uses the real repositories", async () => {
      clock = new Date();
      // Enrollment belongs to an existing account. Seed only this test's
      // verified identity, without changing the shared beta admission policy.
      const existing = await owner();
      const email = "connection-" + randomUUID() + "@example.test";
      await query(
        "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,$3)",
        [existing.principal.userId, email, clock],
      );
      const auth = new AuthService(
        createAuthRepository(db),
        deriveAuthKeys(root),
        () => clock,
        () => "424242",
      );
      const app = createApiApp({
        config: {
          environment: "test",
          databaseUrl: connectionString,
          logLevel: "silent" as AppConfig["logLevel"],
          apiPort: 0,
          workerReadyDelayMs: 0,
        },
        isInfrastructureReady: async () => true,
        authService: auth,
        connectionCodeService: service(),
        extensionAuthService: extension(),
        deviceAuthorizationService: new DeviceAuthorizationService(
          createDeviceAuthorizationRepository(db),
          deriveDeviceAuthKeys(root),
        ),
      });
      try {
        const challenge = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/request",
          payload: { email },
        });
        expect(challenge.statusCode).toBe(202);
        const login = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/verify",
          headers: { "idempotency-key": randomUUID() },
          payload: {
            challengeId: challenge.json().challengeId,
            code: "424242",
          },
        });
        expect(login.statusCode).toBe(200);
        const cookies = login.cookies;
        const cookie = cookies.map((c) => c.name + "=" + c.value).join("; ");
        const csrf = decodeURIComponent(
          cookies.find((c) => c.name === "pcp_csrf")!.value,
        );
        const headers = {
          cookie,
          "x-csrf-token": csrf,
          "idempotency-key": randomUUID(),
        };
        const accounts = await app.inject({
          method: "GET",
          url: "/v1/accounts",
          headers,
        });
        expect(accounts.statusCode).toBe(200);
        const accountId = accounts.json().accounts[0].id;
        expect(accountId).toBe(existing.accountId);
        clock = new Date();
        const issued = await app.inject({
          method: "POST",
          url: "/v1/connection-codes",
          headers,
          payload: { accountId, expectedGeneration: 0, mode: "CREATE" },
        });
        expect(issued.statusCode, issued.json().error?.code).toBe(200);
        const { code } = issued.json();
        const status = await app.inject({
          method: "GET",
          url: "/v1/connection-codes?accountId=" + accountId,
          headers,
        });
        expect(status.body).not.toContain(code);
        const enroll = async () =>
          app.inject({
            method: "POST",
            url: "/v1/connection-codes/exchange",
            headers: { "idempotency-key": randomUUID() },
            payload: { code },
          });
        const a = await enroll();
        expect(a.statusCode).toBe(200);
        expect(a.json()).toMatchObject({
          accountId,
          authenticationMethod: "ACCOUNT_CONNECTION_CODE",
        });
        const client = a.json();
        expect(
          await extension().authenticateAccess(client.accessToken),
        ).toMatchObject({
          ok: true,
          value: {
            accountId,
            deviceId: client.deviceId,
            sessionId: client.sessionId,
          },
        });
        const unauthorizedApproval = await app.inject({
          method: "POST",
          url: "/v1/connection-codes/devices/approve-transfer",
          headers: { authorization: "Bearer " + client.accessToken },
          payload: { accountId, deviceId: client.deviceId },
        });
        expect(unauthorizedApproval.statusCode).toBe(401);
        const approved = await app.inject({
          method: "POST",
          url: "/v1/connection-codes/devices/approve-transfer",
          headers,
          payload: { accountId, deviceId: client.deviceId },
        });
        expect(approved.statusCode).toBe(200);
        const logout = await app.inject({
          method: "POST",
          url: "/v1/auth/logout",
          headers,
        });
        expect(logout.statusCode).toBeLessThan(300);
        const b = await enroll();
        expect(b.statusCode).toBe(200);
        expect(b.json().accountId).toBe(accountId);
        expect(b.json().deviceId).not.toBe(client.deviceId);
        expect(b.json().sessionId).not.toBe(client.sessionId);
        const devices = await query(
          "SELECT id,credential_transfer_approved_at FROM devices WHERE account_id=$1 ORDER BY created_at",
          [accountId],
        );
        expect(devices.rows).toHaveLength(2);
        expect(
          devices.rows.find((d) => d.id === client.deviceId)
            ?.credential_transfer_approved_at,
        ).not.toBeNull();
        expect(
          devices.rows.find((d) => d.id === b.json().deviceId)
            ?.credential_transfer_approved_at,
        ).toBeNull();
      } finally {
        await app.close();
      }
    });
  },
);
