import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createApiApp } from "../../../../apps/api/src/app.js";
import { createAuthRepository, createDatabaseRuntime, createDeviceAuthorizationRepository, createDeviceManagementRepository, createExtensionAuthRepository } from "@product/db";
import { AuthService, deriveAuthKeys } from "@product/auth";
import { DeviceAuthorizationService, deriveDeviceAuthKeys } from "@product/device-auth";
import { DeviceManagementService, PreEntitlementDeviceLimitResolver } from "@product/device-management";
import { ExtensionAuthService, deriveExtensionAuthKeys } from "@product/extension-auth";
import { BootstrapService } from "@product/bootstrap";
import { signBootstrapSnapshotV2 } from "@product/remote-config";

const root = randomBytes(32);
const apiPort = Number(process.env.SA_I1_API_PORT ?? "43100");
const signing = generateKeyPairSync("ed25519");
const accessSigning = { privateKey: signing.privateKey, publicKey: signing.publicKey, keyId: "i1-client-local" };
const database = createDatabaseRuntime(process.env.DATABASE_URL!);
const auth = new AuthService(createAuthRepository(database), deriveAuthKeys(root), undefined, () => "424242");
const deviceAuth = new DeviceAuthorizationService(createDeviceAuthorizationRepository(database), deriveDeviceAuthKeys(root));
const deviceLimitResolver = process.env.SA_I1_ALLOW_TWO_DEVICES === "1"
  ? { resolve: async () => ({ maxActive: 2, source: "R1_INSTALLED_TRANSFER_FIXTURE" }) }
  : new PreEntitlementDeviceLimitResolver();
const deviceManagement = new DeviceManagementService(createDeviceManagementRepository(database), root, accessSigning, deviceLimitResolver);
const extensionAuth = new ExtensionAuthService(createExtensionAuthRepository(database), deriveExtensionAuthKeys(root), undefined, accessSigning);
const bootstrap = new BootstrapService({ resolve: async () => ({ configVersion: 1, signingKeyId: "i1-client-local", sourceFingerprintSha256: createHash("sha256").update(signing.publicKey.export({ format: "der", type: "spki" })).digest("hex"), compatibility: { extension: { status: "SUPPORTED", minimumVersion: null }, browser: { status: "SUPPORTED" } }, features: {} }) }, { signV2: async (keyId, payload) => signBootstrapSnapshotV2(payload, keyId, signing.privateKey) });
const app = createApiApp({ config: { environment: "test", databaseUrl: process.env.DATABASE_URL!, logLevel: "warn", apiPort, workerReadyDelayMs: 0 }, isInfrastructureReady: async () => true, authService: auth, deviceAuthorizationService: deviceAuth, deviceManagementService: deviceManagement, extensionAuthService: extensionAuth, bootstrapService: bootstrap });
function loopbackDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname); } catch { return false; }
}
async function prepareExistingFixtureAccounts(): Promise<void> {
  if (process.env.PRODUCT_CONTROL_PLANE_E2E !== "1") return;
  if (!loopbackDatabaseUrl(process.env.DATABASE_URL)) throw new Error("PRODUCT_CONTROL_PLANE_E2E fixture setup requires a loopback DATABASE_URL");
  const emails = ["i1-client-one@example.test", "i1-client-two@example.test"];
  const betaBefore = await database.query<{ mode: string; capacity: number; admitted: number }>("SELECT mode,capacity,admitted FROM beta_admission_state WHERE id=1");
  if (betaBefore.rows.length !== 1) throw new Error("fixture setup expected one beta admission state row");
  await database.transaction(async (tx) => {
    const existing = await tx.query<{ normalized_identifier: string }>("SELECT normalized_identifier FROM user_identities WHERE provider='EMAIL' AND normalized_identifier=ANY($1::varchar[])", [emails]);
    if (existing.rows.length) throw new Error(`fixture identity collision for ${existing.rows.map(row => row.normalized_identifier).join(",")}`);
    const userIds = [randomUUID(), randomUUID()], accountIds = [randomUUID(), randomUUID()], allIds = [...userIds, ...accountIds];
    const collision = await tx.query<{ table_name: string; id: string }>("SELECT 'users' AS table_name,id::text FROM users WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'accounts' AS table_name,id::text FROM accounts WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'user_identities' AS table_name,id::text FROM user_identities WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'account_memberships' AS table_name,id::text FROM account_memberships WHERE id=ANY($1::uuid[])", [allIds]);
    if (collision.rows.length) throw new Error(`fixture UUID collision in ${collision.rows[0].table_name}`);
    await tx.query("INSERT INTO users(id) VALUES($1),($2)", userIds);
    await tx.query("INSERT INTO accounts(id) VALUES($1),($2)", accountIds);
    await tx.query("INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$3,'OWNER'),($2,$4,'OWNER')", [...accountIds, ...userIds]);
    await tx.query("INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$3,now()),($2,'EMAIL',$4,now())", [...userIds, ...emails]);
  });
  const betaAfter = await database.query<{ mode: string; capacity: number; admitted: number }>("SELECT mode,capacity,admitted FROM beta_admission_state WHERE id=1");
  const before = betaBefore.rows[0], after = betaAfter.rows[0];
  const unchanged = Boolean(after && before.mode === after.mode && Number(before.capacity) === Number(after.capacity) && Number(before.admitted) === Number(after.admitted));
  if (!unchanged) throw new Error("fixture setup changed beta admission mode/capacity/admitted");
  if (process.env.SA_I1_FIXTURE_EVIDENCE_PATH) await writeFile(process.env.SA_I1_FIXTURE_EVIDENCE_PATH, JSON.stringify({ existing_fixture_accounts: 2, beta_unchanged: true }));
}
void (async () => {
  const spki = signing.publicKey.export({ format: "der", type: "spki" });
  const publicTrustBundle = { trustBundleVersion: "bootstrap_trust_bundle_v1", algorithm: "Ed25519", publicKeyFormat: "spki_der", publicKeyEncoding: "base64", fingerprintAlgorithm: "sha256", fingerprintEncoding: "lowercase_hex", keys: [{ keyId: accessSigning.keyId, publicKey: spki.toString("base64"), fingerprintSha256: createHash("sha256").update(spki).digest("hex"), lifecycle: "ACTIVE", trustEligibility: "SIGNING_AND_VERIFICATION" }] };
  if (process.env.SA_I1_PUBLIC_TRUST_BUNDLE_PATH) await writeFile(process.env.SA_I1_PUBLIC_TRUST_BUNDLE_PATH, JSON.stringify(publicTrustBundle));
  await prepareExistingFixtureAccounts();
  await app.listen({ host: "127.0.0.1", port: apiPort });
  process.once("SIGINT", async () => { await app.close(); await database.close(); });
  process.once("SIGTERM", async () => { await app.close(); await database.close(); });
})();
