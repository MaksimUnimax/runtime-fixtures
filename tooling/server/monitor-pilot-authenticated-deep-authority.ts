import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateProfileContent } from "../../packages/server/adapter-registry/src/index.js";
import { canonicalizeJson } from "../../packages/server/remote-config/src/index.js";
import { loadConfig } from "@product/shared";
import {
  AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY,
  authorizeAdminMutationInTransaction,
  createDatabaseRuntime,
  createP7AdminAiCommandRepository,
  createProfileLifecycleRepository,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "@product/db";
import { getPackagedH3Profile } from "../../apps/health-runner/src/h3-actions.js";
import {
  preflightMonitorPilotAuthority,
  preflightMonitorPilotAuthorityForTest,
} from "./monitor-pilot-authority.js";

export const MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE =
  "octoport_monitor_pilot" as const;
export const MONITOR_PILOT_AUTHENTICATED_DEEP_MANIFEST_SHA256 =
  "9f06770d0ae20f682f695729ac482b068cc94d9ecb551dd7d55a8e9d84eb6e94" as const;

const PROVISION_LOCK_KEY =
  "product-control-plane/monitor-pilot-authenticated-deep-authority/provision/v1";
const TECHNICAL_BOOTSTRAP_TAG =
  "monitor-pilot-authenticated-deep-technical-bootstrap-v1";
const REASON =
  "Isolated authenticated-deep monitor pilot authority provisioning";
type DatabaseIdentity = Readonly<{
  expectedDatabaseName: string;
  expectedDatabaseRole: string;
}>;

const H3_AUTHORITIES = Object.freeze([
  Object.freeze({
    surface: "CHATGPT_STANDARD" as const,
    ...AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY.CHATGPT_STANDARD,
    expectedRevision:
      AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY.CHATGPT_STANDARD
        .packagedProfileRevision,
    profileDisplayName: "ChatGPT Standard H3",
    packaged: getPackagedH3Profile("CHATGPT_STANDARD"),
  }),
  Object.freeze({
    surface: "CHATGPT_WORK" as const,
    ...AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY.CHATGPT_WORK,
    expectedRevision:
      AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY.CHATGPT_WORK
        .packagedProfileRevision,
    profileDisplayName: "ChatGPT Work H3",
    packaged: getPackagedH3Profile("CHATGPT_WORK"),
  }),
]);

function profileDefinition() {
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

  return validateProfileContent({
    content: {
      schemaVersion: "adapter_profile_v1",
      page: {
        identityStrategy: "page_identity",
        conversationStrategy: "conversation_root",
        composerStrategy: "composer_root",
      },
      selectors: {
        conversation: reference("conversation_root", "conversation-root"),
        composer: reference("composer_root", "composer-root"),
        send: reference("send_control", "send-control"),
        assistantResponse: reference(
          "assistant_response",
          "assistant-response",
        ),
      },
      observation: { mode: "polling", intervalMs: 1_000 },
      contours: [
        {
          key: "page_identity",
          required: true,
          expectedState: "PRESENT",
          strategy: "page_identity",
        },
        {
          key: "conversation_root",
          required: true,
          expectedState: "PRESENT",
          strategy: "conversation_root",
        },
        {
          key: "composer_root",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "composer_root",
        },
        {
          key: "send_control",
          required: true,
          expectedState: "INTERACTIVE",
          strategy: "send_control",
        },
        {
          key: "assistant_response",
          required: true,
          expectedState: "PRESENT",
          strategy: "assistant_response",
        },
      ],
    },
    compatibility: {
      schemaVersion: "profile_compatibility_v1",
      contractVersion: "control_plane_v1",
      browserFamilies: ["chrome"],
      minimumBrowserVersions: [],
      minimumExtensionVersion: null,
    },
  });
}

function manifest() {
  const definition = profileDefinition();
  return {
    authorities: H3_AUTHORITIES.map((authority) => {
      if (
        authority.packaged.surface !== authority.surface ||
        authority.packaged.profileRevision !== authority.expectedRevision ||
        authority.targetKey !==
          (authority.surface === "CHATGPT_STANDARD"
            ? "chatgpt_standard_health"
            : "chatgpt_work_health")
      ) {
        throw new Error(
          "MONITOR_PILOT_AUTHENTICATED_DEEP_SOURCE_MANIFEST_DRIFT",
        );
      }
      return {
        surface: authority.surface,
        targetKey: authority.targetKey,
        surfaceMachineKey: authority.surfaceMachineKey,
        profileMachineKey: authority.profileMachineKey,
        packagedProfileId: authority.packaged.profileId,
        packagedProfileRevision: authority.packaged.profileRevision,
        p7ContentSha256: definition.contentSha256,
        p7Compatibility: definition.compatibility,
      };
    }),
  };
}

export function monitorPilotAuthenticatedDeepManifestFingerprint(): string {
  return createHash("sha256")
    .update(canonicalizeJson(manifest()))
    .digest("hex");
}
function assertManifest(): void {
  if (
    monitorPilotAuthenticatedDeepManifestFingerprint() !==
    MONITOR_PILOT_AUTHENTICATED_DEEP_MANIFEST_SHA256
  ) {
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_SOURCE_MANIFEST_DRIFT");
  }
}

export function assertMonitorPilotAuthenticatedDeepSourceFingerprint(
  observed: string,
): void {
  if (observed !== MONITOR_PILOT_AUTHENTICATED_DEEP_MANIFEST_SHA256)
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_SOURCE_MANIFEST_DRIFT");
  assertManifest();
}

async function assertDatabase(
  database: Pick<DatabaseRuntime, "query">,
  identity: DatabaseIdentity,
): Promise<void> {
  if (!identity.expectedDatabaseRole)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE_ROLE_REQUIRED",
    );
  const result = await database.query<{
    databaseName: string;
    databaseRole: string;
  }>(
    'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
  );
  const row = result.rows[0];
  if (!row || row.databaseName !== identity.expectedDatabaseName)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_DATABASE_IDENTITY_MISMATCH",
    );
  if (row.databaseRole !== identity.expectedDatabaseRole)
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_DATABASE_ROLE_MISMATCH");
}

async function catalogCounts(database: Pick<DatabaseRuntime, "query">) {
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
  if (!row)
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_READ_FAILED");
  return row;
}
function countsEqual(
  counts: Awaited<ReturnType<typeof catalogCounts>>,
  expected: {
    adapters: number;
    surfaces: number;
    variants: number;
    profiles: number;
    revisions: number;
  },
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => Number(counts[key as keyof typeof counts]) === value,
  );
}

async function requireNoSessionBaseline(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
): Promise<void> {
  const result =
    identity.expectedDatabaseName ===
    MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE
      ? await preflightMonitorPilotAuthority(database, {
          expectedDatabaseRole: identity.expectedDatabaseRole,
        })
      : process.env.VITEST === "true"
        ? await preflightMonitorPilotAuthorityForTest(database, identity)
        : (() => {
            throw new Error(
              "MONITOR_PILOT_AUTHENTICATED_DEEP_TEST_ONLY_OVERRIDE",
            );
          })();
  if (result.kind !== "READY")
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_NO_SESSION_BASELINE_REQUIRED",
    );
}

async function inspectAuthority(
  database: Pick<DatabaseRuntime, "query">,
  authority: (typeof H3_AUTHORITIES)[number],
): Promise<void> {
  const definition = profileDefinition();
  const adapters = await database.query<{ id: string; status: string }>(
    "SELECT id,status FROM ai_adapters WHERE machine_key='chatgpt'",
  );
  if (adapters.rows.length !== 1 || adapters.rows[0]?.status !== "ACTIVE")
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  const adapterId = adapters.rows[0]!.id;

  const surfaces = await database.query<{ id: string; status: string }>(
    "SELECT id,status FROM ai_surfaces WHERE adapter_id=$1 AND machine_key=$2",
    [adapterId, authority.surfaceMachineKey],
  );
  if (surfaces.rows.length !== 1 || surfaces.rows[0]?.status !== "ACTIVE")
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  const surfaceId = surfaces.rows[0]!.id;

  const profiles = await database.query<{
    id: string;
    status: string;
    adapterId: string;
    surfaceId: string;
    variantId: string | null;
  }>(
    'SELECT id,status,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId" FROM adapter_profiles WHERE machine_key=$1',
    [authority.profileMachineKey],
  );
  const profile = profiles.rows[0];
  if (
    profiles.rows.length !== 1 ||
    !profile ||
    profile.status !== "ACTIVE" ||
    profile.adapterId !== adapterId ||
    profile.surfaceId !== surfaceId ||
    profile.variantId !== null
  ) {
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  }

  const revisions = await database.query<{
    revision: number;
    state: string;
    content: unknown;
    compatibility: unknown;
    contentSha256: string;
  }>(
    'SELECT revision,state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256" FROM adapter_profile_revisions WHERE profile_id=$1 ORDER BY revision',
    [profile.id],
  );
  if (revisions.rows.length !== 1)
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  const revision = revisions.rows[0]!;
  const validated = validateProfileContent({
    content: revision.content,
    compatibility: revision.compatibility,
  });
  if (
    revision.revision !== authority.expectedRevision ||
    revision.state !== "PUBLISHED" ||
    validated.contentSha256 !== revision.contentSha256 ||
    validated.contentSha256 !== definition.contentSha256 ||
    canonicalizeJson(validated.compatibility).compare(
      canonicalizeJson(definition.compatibility),
    ) !== 0
  ) {
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  }
}

async function preflightWithIdentity(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
) {
  assertManifest();
  await assertDatabase(database, identity);
  await requireNoSessionBaseline(database, identity);
  const counts = await catalogCounts(database);

  if (
    countsEqual(counts, {
      adapters: 8,
      surfaces: 9,
      variants: 0,
      profiles: 9,
      revisions: 9,
    })
  ) {
    return { kind: "MISSING_AUTHORITY" as const, profiles: 0 };
  }
  if (
    !countsEqual(counts, {
      adapters: 8,
      surfaces: 9,
      variants: 0,
      profiles: 11,
      revisions: 11,
    })
  ) {
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
  }

  for (const authority of H3_AUTHORITIES) {
    await inspectAuthority(database, authority);
  }
  return { kind: "READY" as const, profiles: H3_AUTHORITIES.length };
}

export async function preflightMonitorPilotAuthenticatedDeepAuthority(
  database: DatabaseRuntime,
  input: { expectedDatabaseRole: string },
) {
  return preflightWithIdentity(database, {
    expectedDatabaseName: MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE,
    expectedDatabaseRole: input.expectedDatabaseRole,
  });
}

export async function preflightMonitorPilotAuthenticatedDeepAuthorityForTest(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
) {
  if (process.env.VITEST !== "true")
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_TEST_ONLY_OVERRIDE");
  return preflightWithIdentity(database, identity);
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
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_ADMIN_AUTHORITY_CONFLICT",
    );
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
     VALUES('SYSTEM',NULL,'MONITOR_PILOT_AUTHDEEP_TECHNICAL_AUTHORITY_GRANTED','ADMIN_PRINCIPAL',$1,$2,$3,$4::jsonb)`,
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
      WHERE admin_principal_id=$1 AND role='ADMIN_OPS' AND revoked_at IS NULL
      RETURNING id`,
    [input.principalId],
  );
  if (grant.rows.length !== 1)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_TECHNICAL_AUTHORITY_CLEANUP_FAILED",
    );
  const principal = await tx.query<{ id: string }>(
    `UPDATE admin_principals
        SET status='SUSPENDED',revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='ACTIVE' RETURNING id`,
    [input.principalId],
  );
  const user = await tx.query<{ id: string }>(
    `UPDATE users
        SET status='SUSPENDED',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='ACTIVE' RETURNING id`,
    [input.userId],
  );
  if (principal.rows.length !== 1 || user.rows.length !== 1)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_TECHNICAL_AUTHORITY_CLEANUP_FAILED",
    );
  await tx.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,'MONITOR_PILOT_AUTHDEEP_TECHNICAL_AUTHORITY_REVOKED','ADMIN_PRINCIPAL',$1,$2,$3,$4::jsonb)`,
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

async function createExplicitStandardDraftRevision(
  tx: DatabaseQuery,
  input: {
    profileId: string;
    adapterId: string;
    surfaceId: string;
    actorId: string;
    correlationId: string;
  },
): Promise<void> {
  const definition = profileDefinition();
  const result = await tx.query<{ id: string }>(
    `INSERT INTO adapter_profile_revisions(
       id,profile_id,adapter_id,surface_id,variant_id,revision,schema_version,state,
       content,compatibility_constraints,content_sha256,created_by_admin_principal_id
     ) VALUES($1,$2,$3,$4,NULL,2,'adapter_profile_v1','DRAFT',$5::jsonb,$6::jsonb,$7,$8)
     RETURNING id`,
    [
      randomUUID(),
      input.profileId,
      input.adapterId,
      input.surfaceId,
      JSON.stringify(definition.content),
      JSON.stringify(definition.compatibility),
      definition.contentSha256,
      input.actorId,
    ],
  );
  if (result.rows.length !== 1)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_STANDARD_DRAFT_INSERT_FAILED",
    );
  await tx.query(
    `INSERT INTO audit_events(
       actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata
     ) VALUES('ADMIN',$1,'MONITOR_PILOT_AUTHDEEP_EXPLICIT_DRAFT_CREATED',
       'ADAPTER_PROFILE_REVISION',$2,$3,$4,$5::jsonb)`,
    [
      input.actorId,
      result.rows[0]!.id,
      input.correlationId,
      REASON,
      JSON.stringify({
        profileId: input.profileId,
        revision: 2,
        reason: "packaged Standard authority starts at revision 2",
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
  const before = await preflightWithIdentity(database, identity);
  if (before.kind === "READY")
    return { kind: "ALREADY_EXACT" as const, profiles: H3_AUTHORITIES.length };

  return database.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      PROVISION_LOCK_KEY,
    ]);
    const scoped = transactionRuntime(database, tx);
    const lockedState = await preflightWithIdentity(scoped, identity);
    if (lockedState.kind === "READY")
      return {
        kind: "ALREADY_EXACT" as const,
        profiles: H3_AUTHORITIES.length,
      };

    const chatgpt = await tx.query<{ id: string }>(
      "SELECT id FROM ai_adapters WHERE machine_key='chatgpt' AND status='ACTIVE'",
    );
    if (chatgpt.rows.length !== 1)
      throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
    const adapterId = chatgpt.rows[0]!.id;
    const surfaces = await tx.query<{ id: string; machineKey: string }>(
      "SELECT id,machine_key AS \"machineKey\" FROM ai_surfaces WHERE adapter_id=$1 AND machine_key=ANY($2::text[]) AND status='ACTIVE' ORDER BY machine_key",
      [adapterId, ["standard", "work"]],
    );
    if (surfaces.rows.length !== 2)
      throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
    const surfaceIds = new Map(
      surfaces.rows.map((surface) => [surface.machineKey, surface.id]),
    );

    const correlationId = randomUUID();
    const bootstrap = await beginTechnicalBootstrap(tx, correlationId);
    const registry = createP7AdminAiCommandRepository(scoped);
    const lifecycle = createProfileLifecycleRepository(scoped, {
      beforeMutation: authorizeAdminMutationInTransaction,
    });
    for (const authority of H3_AUTHORITIES) {
      const surfaceId = surfaceIds.get(authority.surfaceMachineKey);
      if (!surfaceId)
        throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");

      const profile = await registry.createProfile({
        adapterId,
        surfaceId,
        variantId: null,
        machineKey: authority.profileMachineKey,
        displayName: authority.profileDisplayName,
        actorId: bootstrap.principalId,
        correlationId,
        reason: REASON,
      });

      if (authority.expectedRevision === 2) {
        await createExplicitStandardDraftRevision(tx, {
          profileId: profile.id,
          adapterId,
          surfaceId,
          actorId: bootstrap.principalId,
          correlationId,
        });
      } else {
        const definition = profileDefinition();
        const draft = await lifecycle.createDraftProfileRevision({
          profileId: profile.id,
          content: definition.content,
          compatibility: definition.compatibility,
          context: {
            actorType: "ADMIN",
            actorId: bootstrap.principalId,
            correlationId,
            reason: REASON,
          },
        });
        if (draft.revision !== authority.expectedRevision)
          throw new Error(
            "MONITOR_PILOT_AUTHENTICATED_DEEP_UNEXPECTED_DRAFT_REVISION",
          );
      }

      const context = {
        actorType: "ADMIN" as const,
        actorId: bootstrap.principalId,
        correlationId,
        reason: REASON,
      };
      await lifecycle.markProfileRevisionCandidate({
        profileId: profile.id,
        revision: authority.expectedRevision,
        context,
      });
      await lifecycle.publishProfileRevision({
        profileId: profile.id,
        revision: authority.expectedRevision,
        context,
      });
    }

    const ready = await preflightWithIdentity(scoped, identity);
    if (ready.kind !== "READY")
      throw new Error(
        "MONITOR_PILOT_AUTHENTICATED_DEEP_POSTWRITE_PREFLIGHT_FAILED",
      );
    await endTechnicalBootstrap(tx, { ...bootstrap, correlationId });
    const activeGrant = await tx.query(
      "SELECT 1 FROM admin_role_grants WHERE admin_principal_id=$1 AND revoked_at IS NULL",
      [bootstrap.principalId],
    );
    if (activeGrant.rows.length !== 0)
      throw new Error(
        "MONITOR_PILOT_AUTHENTICATED_DEEP_TECHNICAL_AUTHORITY_CLEANUP_FAILED",
      );
    return { kind: "INITIALIZED" as const, profiles: H3_AUTHORITIES.length };
  });
}

export async function initializeMonitorPilotAuthenticatedDeepAuthority(
  database: DatabaseRuntime,
  input: { expectedDatabaseRole: string },
) {
  return initializeWithIdentity(database, {
    expectedDatabaseName: MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE,
    expectedDatabaseRole: input.expectedDatabaseRole,
  });
}

export async function initializeMonitorPilotAuthenticatedDeepAuthorityForTest(
  database: DatabaseRuntime,
  identity: DatabaseIdentity,
) {
  if (process.env.VITEST !== "true")
    throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_TEST_ONLY_OVERRIDE");
  return initializeWithIdentity(database, identity);
}

export function reportMonitorPilotAuthenticatedDeepPreflightResult(
  result: Readonly<{
    kind: "READY" | "MISSING_AUTHORITY";
    profiles: number;
  }>,
  writeLine: (line: string) => void = console.log,
): number {
  writeLine(
    `MONITOR_PILOT_AUTHENTICATED_DEEP_PREFLIGHT=${result.kind}; profiles=${result.profiles}`,
  );
  return result.kind === "READY" ? 0 : 2;
}

export async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const expectedDatabaseRole =
    process.env.MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_ROLE;
  if (!expectedDatabaseRole)
    throw new Error(
      "MONITOR_PILOT_AUTHENTICATED_DEEP_EXPECTED_DATABASE_ROLE_REQUIRED",
    );
  const database = createDatabaseRuntime(config.databaseUrl);
  try {
    await database.ready();
    const operation = process.argv[2];
    if (operation === "preflight") {
      const result = await preflightMonitorPilotAuthenticatedDeepAuthority(
        database,
        { expectedDatabaseRole },
      );
      process.exitCode =
        reportMonitorPilotAuthenticatedDeepPreflightResult(result);
    } else if (operation === "init") {
      const result = await initializeMonitorPilotAuthenticatedDeepAuthority(
        database,
        { expectedDatabaseRole },
      );
      console.log(
        `MONITOR_PILOT_AUTHENTICATED_DEEP_INIT=${result.kind}; profiles=${result.profiles}`,
      );
    } else {
      throw new Error("MONITOR_PILOT_AUTHENTICATED_DEEP_COMMAND_REQUIRED");
    }
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const code =
      /^MONITOR_PILOT_AUTHENTICATED_DEEP_[A-Z_]+$/.test(message) ||
      /^MONITOR_PILOT_[A-Z_]+$/.test(message)
        ? message
        : "MONITOR_PILOT_AUTHENTICATED_DEEP_OPERATION_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
