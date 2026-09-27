import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateProfileContent } from "../../packages/server/adapter-registry/src/index.js";
import {
  authorizeAdminMutationInTransaction,
  createDatabaseRuntime,
  createP7AdminAiCommandRepository,
  createProfileLifecycleRepository,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "@product/db";
import { canonicalizeJson } from "../../packages/server/remote-config/src/index.js";
import { loadConfig } from "@product/shared";
import {
  NO_SESSION_TARGETS,
  type NoSessionTarget,
} from "../../apps/health-runner/src/no-session-target-authority.js";
import { NO_SESSION_STRATEGIES } from "../../apps/health-runner/src/no-session-strategies.js";

export const MONITOR_PILOT_DEPLOYED_SOURCE =
  "69db39e795010d0f9acfc9ffcaef76b38f5f59b3" as const;
export const MONITOR_PILOT_EXPECTED_DATABASE =
  "octoport_monitor_pilot" as const;
export const MONITOR_PILOT_MANIFEST_SHA256 =
  "01665888b04717b99ff5564f3e2eaf1f389249dae7cef83c5aa75d79d81ace7e" as const;

const TECHNICAL_BOOTSTRAP_TAG = "monitor-pilot-technical-bootstrap-v1";
const PROVISION_LOCK_KEY =
  "product-control-plane/monitor-pilot-authority/provision/v1";
const REASON = "Isolated no-session monitor pilot authority provisioning";

type DatabaseIdentity = Readonly<{
  expectedDatabaseName: string;
  expectedDatabaseRole: string;
}>;

export type MonitorPilotAuthorityIssue = Readonly<{
  targetKey: string;
  code:
    | "NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND"
    | "NO_SESSION_PROVIDER_AUTHORITY_INACTIVE"
    | "MONITOR_PILOT_PROVIDER_AUTHORITY_AMBIGUOUS"
    | "NO_SESSION_SURFACE_AUTHORITY_NOT_FOUND"
    | "NO_SESSION_SURFACE_AUTHORITY_INACTIVE"
    | "MONITOR_PILOT_SURFACE_AUTHORITY_AMBIGUOUS"
    | "NO_SESSION_PROFILE_AUTHORITY_NOT_FOUND"
    | "NO_SESSION_PROFILE_AUTHORITY_INACTIVE"
    | "MONITOR_PILOT_PROFILE_AUTHORITY_AMBIGUOUS"
    | "MONITOR_PILOT_PROFILE_VARIANT_CONFLICT"
    | "NO_SESSION_PROFILE_REVISION_AUTHORITY_NOT_FOUND"
    | "NO_SESSION_PROFILE_REVISION_AUTHORITY_AMBIGUOUS"
    | "MONITOR_PILOT_PROFILE_REVISION_CONTENT_MISMATCH";
}>;

function manifest() {
  if (NO_SESSION_TARGETS.length !== 9 || NO_SESSION_STRATEGIES.length !== 9)
    throw new Error("MONITOR_PILOT_SOURCE_MANIFEST_DRIFT");
  const strategies = NO_SESSION_STRATEGIES.map((strategy) => ({
    providerId: strategy.providerId,
    surfaceId: strategy.surfaceId,
    strategyId: strategy.strategyId,
    strategyRevision: strategy.strategyRevision,
    profile: strategy.profile,
  })).sort((a, b) => a.surfaceId.localeCompare(b.surfaceId));
  const targets = NO_SESSION_TARGETS.map((target) => ({ ...target })).sort(
    (a, b) => a.targetKey.localeCompare(b.targetKey),
  );
  if (
    targets.some(
      (target) =>
        !strategies.some(
          (strategy) =>
            strategy.providerId === target.providerId &&
            strategy.surfaceId === target.surfaceId &&
            strategy.strategyId === target.strategyId &&
            strategy.strategyRevision === target.strategyRevision,
        ),
    ) ||
    new Set(targets.map((target) => target.targetKey)).size !== 9
  )
    throw new Error("MONITOR_PILOT_SOURCE_MANIFEST_DRIFT");
  return { source: MONITOR_PILOT_DEPLOYED_SOURCE, targets, strategies };
}

export function monitorPilotManifestFingerprint(): string {
  return createHash("sha256")
    .update(canonicalizeJson(manifest()))
    .digest("hex");
}

function assertManifest(): void {
  if (monitorPilotManifestFingerprint() !== MONITOR_PILOT_MANIFEST_SHA256)
    throw new Error("MONITOR_PILOT_SOURCE_MANIFEST_DRIFT");
}

export function assertMonitorPilotSourceFingerprint(observed: string): void {
  if (observed !== MONITOR_PILOT_MANIFEST_SHA256)
    throw new Error("MONITOR_PILOT_SOURCE_MANIFEST_DRIFT");
  assertManifest();
}

function surfaceMachineKey(target: NoSessionTarget): string {
  if (target.surfaceId === "CHATGPT_STANDARD") return "standard";
  if (target.surfaceId === "CHATGPT_WORK") return "work";
  return target.surfaceId.toLowerCase();
}

function expected(value: string): boolean {
  return value === "EXPECTED";
}

function profileDefinition(target: NoSessionTarget) {
  const reference = (
    strategy:
      | "page_identity"
      | "conversation_root"
      | "composer_root"
      | "send_control"
      | "assistant_response",
    ref:
      | "page-root"
      | "conversation-root"
      | "composer-root"
      | "send-control"
      | "assistant-response",
  ) => ({
    strategy,
    primary: {
      kind: "packaged_selector_reference" as const,
      reference: ref,
    },
    fallbacks: [],
    timeoutMs: 1_000,
    observationMode: "polling" as const,
  });
  const capability = target.capabilityExpectation;
  const content = {
    schemaVersion: "adapter_profile_v1" as const,
    page: {
      identityStrategy: "page_identity" as const,
      conversationStrategy: "conversation_root" as const,
      composerStrategy: "composer_root" as const,
    },
    selectors: {
      conversation: reference("conversation_root", "conversation-root"),
      composer: reference("composer_root", "composer-root"),
      send: reference("send_control", "send-control"),
      assistantResponse: reference("assistant_response", "assistant-response"),
    },
    observation: { mode: "polling" as const, intervalMs: 1_000 },
    contours: [
      {
        key: "page_identity" as const,
        required: expected(capability.pageIdentity),
        expectedState: "PRESENT" as const,
        strategy: "page_identity" as const,
      },
      {
        key: "conversation_root" as const,
        required: expected(capability.publicLanding),
        expectedState: "PRESENT" as const,
        strategy: "conversation_root" as const,
      },
      {
        key: "composer_root" as const,
        required:
          expected(capability.publicComposer) ||
          expected(capability.editableInput),
        expectedState: "INTERACTIVE" as const,
        strategy: "composer_root" as const,
      },
      {
        key: "send_control" as const,
        required: expected(capability.sendControl),
        expectedState: "INTERACTIVE" as const,
        strategy: "send_control" as const,
      },
      {
        key: "assistant_response" as const,
        required: false,
        expectedState: "PRESENT" as const,
        strategy: "assistant_response" as const,
      },
    ],
  };
  const compatibility = {
    schemaVersion: "profile_compatibility_v1" as const,
    contractVersion: "control_plane_v1" as const,
    browserFamilies: ["chrome" as const],
    minimumBrowserVersions: [],
    minimumExtensionVersion: null,
  };
  return validateProfileContent({ content, compatibility });
}

async function assertDatabase(
  database: Pick<DatabaseRuntime, "query">,
  identity: DatabaseIdentity,
): Promise<void> {
  if (!identity.expectedDatabaseRole)
    throw new Error("MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED");
  const result = await database.query<{
    databaseName: string;
    databaseRole: string;
  }>(
    'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
  );
  const row = result.rows[0];
  if (!row || row.databaseName !== identity.expectedDatabaseName)
    throw new Error("MONITOR_PILOT_DATABASE_IDENTITY_MISMATCH");
  if (row.databaseRole !== identity.expectedDatabaseRole)
    throw new Error("MONITOR_PILOT_DATABASE_ROLE_MISMATCH");
}

async function authorityCounts(database: Pick<DatabaseRuntime, "query">) {
  const result = await database.query<{
    adapters: string;
    surfaces: string;
    variants: string;
    profiles: string;
    revisions: string;
  }>(`SELECT
    (SELECT count(*) FROM ai_adapters)::text AS adapters,
    (SELECT count(*) FROM ai_surfaces)::text AS surfaces,
    (SELECT count(*) FROM ai_variants)::text AS variants,
    (SELECT count(*) FROM adapter_profiles)::text AS profiles,
    (SELECT count(*) FROM adapter_profile_revisions)::text AS revisions`);
  const row = result.rows[0];
  if (!row) throw new Error("MONITOR_PILOT_CATALOG_READ_FAILED");
  return row;
}

async function inspectTarget(
  database: Pick<DatabaseRuntime, "query">,
  target: NoSessionTarget,
): Promise<MonitorPilotAuthorityIssue | undefined> {
  const adapters = await database.query<{ id: string; status: string }>(
    "SELECT id,status FROM ai_adapters WHERE machine_key=$1",
    [target.providerId],
  );
  if (adapters.rows.length > 1)
    return {
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_PROVIDER_AUTHORITY_AMBIGUOUS",
    };
  const adapter = adapters.rows[0];
  if (!adapter)
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND",
    };
  if (adapter.status !== "ACTIVE")
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROVIDER_AUTHORITY_INACTIVE",
    };

  const surfaces = await database.query<{ id: string; status: string }>(
    "SELECT id,status FROM ai_surfaces WHERE adapter_id=$1 AND machine_key=$2",
    [adapter.id, surfaceMachineKey(target)],
  );
  if (surfaces.rows.length > 1)
    return {
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_SURFACE_AUTHORITY_AMBIGUOUS",
    };
  const surface = surfaces.rows[0];
  if (!surface)
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_SURFACE_AUTHORITY_NOT_FOUND",
    };
  if (surface.status !== "ACTIVE")
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_SURFACE_AUTHORITY_INACTIVE",
    };

  const profiles = await database.query<{
    id: string;
    status: string;
    variantId: string | null;
  }>(
    `SELECT id,status,variant_id AS "variantId"
       FROM adapter_profiles
      WHERE adapter_id=$1 AND surface_id=$2 AND machine_key=$3`,
    [adapter.id, surface.id, target.strategyId],
  );
  if (profiles.rows.length > 1)
    return {
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_PROFILE_AUTHORITY_AMBIGUOUS",
    };
  const profile = profiles.rows[0];
  if (!profile)
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROFILE_AUTHORITY_NOT_FOUND",
    };
  if (profile.status !== "ACTIVE")
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROFILE_AUTHORITY_INACTIVE",
    };
  if (profile.variantId !== null)
    return {
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_PROFILE_VARIANT_CONFLICT",
    };

  const revisions = await database.query<{
    id: string;
    contentSha256: string;
  }>(
    `SELECT id,content_sha256 AS "contentSha256"
       FROM adapter_profile_revisions
      WHERE profile_id=$1 AND adapter_id=$2 AND surface_id=$3
        AND variant_id IS NULL
        AND state='PUBLISHED'
        AND compatibility_constraints->'browserFamilies' ? 'chrome'
      ORDER BY revision`,
    [profile.id, adapter.id, surface.id],
  );
  if (revisions.rows.length === 0)
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROFILE_REVISION_AUTHORITY_NOT_FOUND",
    };
  if (revisions.rows.length > 1)
    return {
      targetKey: target.targetKey,
      code: "NO_SESSION_PROFILE_REVISION_AUTHORITY_AMBIGUOUS",
    };
  const revision = revisions.rows[0]!;
  if (revision.contentSha256 !== profileDefinition(target).contentSha256)
    return {
      targetKey: target.targetKey,
      code: "MONITOR_PILOT_PROFILE_REVISION_CONTENT_MISMATCH",
    };
  return undefined;
}

async function preflightWithIdentity(
  database: Pick<DatabaseRuntime, "query">,
  identity: DatabaseIdentity,
) {
  assertManifest();
  await assertDatabase(database, identity);
  const issues: MonitorPilotAuthorityIssue[] = [];
  for (const target of NO_SESSION_TARGETS) {
    const issue = await inspectTarget(database, target);
    if (issue) issues.push(issue);
  }
  return {
    kind:
      issues.length === 0 ? ("READY" as const) : ("MISSING_AUTHORITY" as const),
    issues,
  };
}

export async function preflightMonitorPilotAuthority(
  database: Pick<DatabaseRuntime, "query">,
  input: { expectedDatabaseRole: string },
) {
  return preflightWithIdentity(database, {
    expectedDatabaseName: MONITOR_PILOT_EXPECTED_DATABASE,
    expectedDatabaseRole: input.expectedDatabaseRole,
  });
}

export async function preflightMonitorPilotAuthorityForTest(
  database: Pick<DatabaseRuntime, "query">,
  identity: DatabaseIdentity,
) {
  if (process.env.VITEST !== "true")
    throw new Error("MONITOR_PILOT_TEST_ONLY_DATABASE_OVERRIDE");
  return preflightWithIdentity(database, identity);
}

async function catalogState(
  database: Pick<DatabaseRuntime, "query">,
  identity: DatabaseIdentity,
) {
  const counts = await authorityCounts(database);
  if (Object.values(counts).every((count) => Number(count) === 0))
    return "EMPTY" as const;
  const expectedCounts = {
    adapters: new Set(NO_SESSION_TARGETS.map((target) => target.providerId))
      .size,
    surfaces: NO_SESSION_TARGETS.length,
    variants: 0,
    profiles: NO_SESSION_TARGETS.length,
    revisions: NO_SESSION_TARGETS.length,
  };
  if (
    Object.entries(expectedCounts).some(
      ([key, value]) => Number(counts[key as keyof typeof counts]) !== value,
    )
  )
    throw new Error("MONITOR_PILOT_CATALOG_CONFLICT");
  const preflight = await preflightWithIdentity(database, identity);
  if (preflight.kind !== "READY")
    throw new Error("MONITOR_PILOT_CATALOG_CONFLICT");
  return "EXACT" as const;
}

function transactionRuntime(
  database: DatabaseRuntime,
  tx: DatabaseQuery,
): DatabaseRuntime {
  return {
    ...database,
    query: (text, values) => tx.query(text, values),
    transaction: async (operation) => operation(tx),
  };
}

async function beginTechnicalBootstrap(
  tx: DatabaseQuery,
  correlationId: string,
): Promise<{ principalId: string; userId: string }> {
  const grants = await tx.query(
    "SELECT 1 FROM admin_role_grants WHERE revoked_at IS NULL LIMIT 1",
  );
  if (grants.rows.length !== 0)
    throw new Error("MONITOR_PILOT_ADMIN_AUTHORITY_CONFLICT");
  const userId = randomUUID();
  const principalId = randomUUID();
  await tx.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await tx.query(
    "INSERT INTO admin_principals(id,user_id,status,revision) VALUES($1,$2,'ACTIVE',1)",
    [principalId, userId],
  );
  await tx.query(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_by_admin_principal_id) VALUES($1,'ADMIN_OPS',NULL)",
    [principalId],
  );
  await tx.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,'MONITOR_PILOT_TECHNICAL_AUTHORITY_GRANTED','ADMIN_PRINCIPAL',$1,$2,$3,$4::jsonb)`,
    [
      principalId,
      correlationId,
      REASON,
      JSON.stringify({ tag: TECHNICAL_BOOTSTRAP_TAG, role: "ADMIN_OPS" }),
    ],
  );
  return { principalId, userId };
}

async function endTechnicalBootstrap(
  tx: DatabaseQuery,
  input: { principalId: string; userId: string; correlationId: string },
): Promise<void> {
  const grant = await tx.query<{ id: string }>(
    `UPDATE admin_role_grants
        SET revoked_at=CURRENT_TIMESTAMP,
            revoked_by_admin_principal_id=$1
      WHERE admin_principal_id=$1
        AND role='ADMIN_OPS'
        AND revoked_at IS NULL
      RETURNING id`,
    [input.principalId],
  );
  if (grant.rows.length !== 1)
    throw new Error("MONITOR_PILOT_TECHNICAL_AUTHORITY_CLEANUP_FAILED");
  const principal = await tx.query<{ id: string }>(
    `UPDATE admin_principals
        SET status='SUSPENDED',revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='ACTIVE'
      RETURNING id`,
    [input.principalId],
  );
  if (principal.rows.length !== 1)
    throw new Error("MONITOR_PILOT_TECHNICAL_AUTHORITY_CLEANUP_FAILED");
  const user = await tx.query<{ id: string }>(
    `UPDATE users
        SET status='SUSPENDED',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='ACTIVE'
      RETURNING id`,
    [input.userId],
  );
  if (user.rows.length !== 1)
    throw new Error("MONITOR_PILOT_TECHNICAL_AUTHORITY_CLEANUP_FAILED");
  await tx.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,'MONITOR_PILOT_TECHNICAL_AUTHORITY_REVOKED','ADMIN_PRINCIPAL',$1,$2,$3,$4::jsonb)`,
    [
      input.principalId,
      input.correlationId,
      REASON,
      JSON.stringify({
        tag: TECHNICAL_BOOTSTRAP_TAG,
        grantRevoked: true,
        principalSuspended: true,
        userSuspended: true,
      }),
    ],
  );
}

async function initializeWithIdentity(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
) {
  assertManifest();
  await assertDatabase(database, identity);
  const before = await catalogState(database, identity);
  if (before === "EXACT")
    return {
      kind: "ALREADY_EXACT" as const,
      targets: NO_SESSION_TARGETS.length,
    };

  return database.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      PROVISION_LOCK_KEY,
    ]);
    const scoped = transactionRuntime(database, tx);
    await assertDatabase(scoped, identity);
    const state = await catalogState(scoped, identity);
    if (state === "EXACT")
      return {
        kind: "ALREADY_EXACT" as const,
        targets: NO_SESSION_TARGETS.length,
      };

    const correlationId = randomUUID();
    const bootstrap = await beginTechnicalBootstrap(tx, correlationId);
    const registry = createP7AdminAiCommandRepository(scoped);
    const lifecycle = createProfileLifecycleRepository(scoped, {
      beforeMutation: authorizeAdminMutationInTransaction,
    });
    const context = {
      actorType: "ADMIN" as const,
      actorId: bootstrap.principalId,
      correlationId,
      reason: REASON,
    };
    const adapterIds = new Map<string, string>();
    const surfaceIds = new Map<string, string>();

    for (const target of NO_SESSION_TARGETS) {
      if (adapterIds.has(target.providerId)) continue;
      const adapter = await registry.createAdapter({
        machineKey: target.providerId,
        displayName: target.providerId,
        description:
          "Provider authority for the isolated nine-target no-session monitor pilot.",
        actorId: bootstrap.principalId,
        correlationId,
        reason: REASON,
      });
      adapterIds.set(target.providerId, adapter.id);
    }
    for (const target of NO_SESSION_TARGETS) {
      const key = `${target.providerId}/${surfaceMachineKey(target)}`;
      if (surfaceIds.has(key)) continue;
      const surface = await registry.createSurface({
        adapterId: adapterIds.get(target.providerId)!,
        machineKey: surfaceMachineKey(target),
        displayName: surfaceMachineKey(target),
        actorId: bootstrap.principalId,
        correlationId,
        reason: REASON,
      });
      surfaceIds.set(key, surface.id);
    }
    for (const target of NO_SESSION_TARGETS) {
      const adapterId = adapterIds.get(target.providerId)!;
      const surfaceId = surfaceIds.get(
        `${target.providerId}/${surfaceMachineKey(target)}`,
      )!;
      const profile = await registry.createProfile({
        adapterId,
        surfaceId,
        variantId: null,
        machineKey: target.strategyId,
        displayName: `No-session monitor authority: ${target.targetKey}`,
        actorId: bootstrap.principalId,
        correlationId,
        reason: REASON,
      });
      const definition = profileDefinition(target);
      const draft = await lifecycle.createDraftProfileRevision({
        profileId: profile.id,
        content: definition.content,
        compatibility: definition.compatibility,
        context,
      });
      await lifecycle.markProfileRevisionCandidate({
        profileId: profile.id,
        revision: draft.revision,
        context,
      });
      await lifecycle.publishProfileRevision({
        profileId: profile.id,
        revision: draft.revision,
        context,
      });
    }

    const check = await preflightWithIdentity(scoped, identity);
    if (check.kind !== "READY")
      throw new Error("MONITOR_PILOT_POSTWRITE_PREFLIGHT_FAILED");

    await endTechnicalBootstrap(tx, {
      ...bootstrap,
      correlationId,
    });
    const activeGrant = await tx.query(
      "SELECT 1 FROM admin_role_grants WHERE admin_principal_id=$1 AND revoked_at IS NULL",
      [bootstrap.principalId],
    );
    if (activeGrant.rows.length !== 0)
      throw new Error("MONITOR_PILOT_TECHNICAL_AUTHORITY_CLEANUP_FAILED");
    return { kind: "INITIALIZED" as const, targets: NO_SESSION_TARGETS.length };
  });
}

export async function initializeMonitorPilotAuthority(
  database: DatabaseRuntime,
  input: { expectedDatabaseRole: string },
) {
  return initializeWithIdentity(database, {
    expectedDatabaseName: MONITOR_PILOT_EXPECTED_DATABASE,
    expectedDatabaseRole: input.expectedDatabaseRole,
  });
}

export async function initializeMonitorPilotAuthorityForTest(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
) {
  if (process.env.VITEST !== "true")
    throw new Error("MONITOR_PILOT_TEST_ONLY_DATABASE_OVERRIDE");
  return initializeWithIdentity(database, identity);
}

export async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const expectedDatabaseRole = process.env.MONITOR_PILOT_EXPECTED_ROLE;
  if (!expectedDatabaseRole)
    throw new Error("MONITOR_PILOT_EXPECTED_DATABASE_ROLE_REQUIRED");
  const database = createDatabaseRuntime(config.databaseUrl);
  try {
    await database.ready();
    const operation = process.argv[2];
    if (operation === "preflight") {
      const testDatabaseName =
        process.env.VITEST === "true"
          ? process.env.MONITOR_PILOT_TEST_DATABASE_NAME
          : undefined;
      const result = testDatabaseName
        ? await preflightMonitorPilotAuthorityForTest(database, {
            expectedDatabaseName: testDatabaseName,
            expectedDatabaseRole,
          })
        : await preflightMonitorPilotAuthority(database, {
            expectedDatabaseRole,
          });
      console.log(
        `MONITOR_PILOT_PREFLIGHT=${result.kind}; issues=${
          result.issues
            .map((issue) => `${issue.targetKey}:${issue.code}`)
            .join(",") || "none"
        }`,
      );
      if (result.kind !== "READY") process.exitCode = 2;
    } else if (operation === "init") {
      const result = await initializeMonitorPilotAuthority(database, {
        expectedDatabaseRole,
      });
      console.log(
        `MONITOR_PILOT_INIT=${result.kind}; targets=${result.targets}`,
      );
    } else {
      throw new Error("MONITOR_PILOT_COMMAND_REQUIRED");
    }
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    const code =
      error instanceof Error && /^MONITOR_PILOT_[A-Z_]+$/.test(error.message)
        ? error.message
        : /^NO_SESSION_[A-Z_]+$/.test(
              error instanceof Error ? error.message : "",
            )
          ? (error as Error).message
          : "MONITOR_PILOT_OPERATION_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
