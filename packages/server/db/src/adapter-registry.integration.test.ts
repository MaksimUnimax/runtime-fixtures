import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdapterRegistryCatalogRepository,
  createDatabaseRuntime,
  createProfileLifecycleRepository,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import { profileRevisionFingerprint } from "@product/adapter-registry";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for integration tests");

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const S1 = "00000000-0000-4000-8000-000000000003";
const S2 = "00000000-0000-4000-8000-000000000004";
const V1 = "00000000-0000-4000-8000-000000000005";
const P1 = "00000000-0000-4000-8000-000000000006";
const R1 = "00000000-0000-4000-8000-000000000007";
const R2 = "00000000-0000-4000-8000-000000000008";
const badProfileRevision = "00000000-0000-4000-8000-000000000009";
const R4 = "00000000-0000-4000-8000-000000000011";
const checksum = "a".repeat(64);
const content = JSON.stringify({ schemaVersion: "adapter_profile_v1" });
const compatibility = JSON.stringify({
  schemaVersion: "profile_compatibility_v1",
});
const validContent = {
  schemaVersion: "adapter_profile_v1" as const,
  page: {
    identityStrategy: "page_identity" as const,
    conversationStrategy: "conversation_root" as const,
    composerStrategy: "composer_root" as const,
  },
  selectors: {
    conversation: {
      strategy: "conversation_root" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "conversation-root" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    composer: {
      strategy: "composer_root" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "composer-root" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    send: {
      strategy: "send_control" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "send-control" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
    assistantResponse: {
      strategy: "assistant_response" as const,
      primary: {
        kind: "packaged_selector_reference" as const,
        reference: "assistant-response" as const,
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling" as const,
    },
  },
  observation: { mode: "polling" as const, intervalMs: 100 },
  contours: [
    {
      key: "page_identity" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "page_identity" as const,
    },
    {
      key: "conversation_root" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "conversation_root" as const,
    },
    {
      key: "composer_root" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "composer_root" as const,
    },
    {
      key: "send_control" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "send_control" as const,
    },
  ],
};
const validCompatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [
    { browserFamily: "chrome" as const, minimumVersion: "120.0" },
  ],
  minimumExtensionVersion: "1.0.0",
};

let runtime: DatabaseRuntime;

async function rejects(statement: ReturnType<typeof sql>): Promise<void> {
  await expect(runtime.db.execute(statement)).rejects.toBeInstanceOf(Error);
}

async function reset(): Promise<void> {
  await runtime.db.execute(sql`DROP SCHEMA public CASCADE`);
  await runtime.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await runtime.db.execute(sql`CREATE SCHEMA public`);
  await runMigrations({ connectionString: connectionString! });
  await runMigrations({ connectionString: connectionString! });
}

describe.sequential("P7.1 adapter registry PostgreSQL boundary", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString!);
    await runtime.ready();
    await reset();
  });

  afterAll(async () => {
    await runtime.close();
  });

  it("enforces fresh and repeated migration installation", async () => {
    const result = await runtime.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM drizzle."__drizzle_migrations"
    `);
    expect(result.rows[0]?.count).toBe("19");
  });

  it("enforces scoped identity uniqueness and hierarchy foreign keys", async () => {
    await runtime.db.execute(
      sql`INSERT INTO ai_adapters (id, machine_key, display_name) VALUES (${A}, 'chatgpt', 'ChatGPT')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO ai_adapters (id, machine_key, display_name) VALUES (${B}, 'alice', 'Alice')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO ai_surfaces (id, adapter_id, machine_key, display_name) VALUES (${S1}, ${A}, 'standard', 'Standard')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO ai_surfaces (id, adapter_id, machine_key, display_name) VALUES (${S2}, ${A}, 'work', 'Work')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO ai_variants (id, surface_id, machine_key, display_name) VALUES (${V1}, ${S1}, 'composer-v1', 'Composer v1')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO adapter_profiles (id, adapter_id, surface_id, machine_key, display_name) VALUES (${P1}, ${A}, ${S1}, 'standard-profile', 'Standard profile')`,
    );
    await rejects(
      sql`INSERT INTO ai_adapters (machine_key, display_name) VALUES ('chatgpt', 'Duplicate')`,
    );
    await rejects(
      sql`INSERT INTO ai_surfaces (adapter_id, machine_key, display_name) VALUES (${A}, 'standard', 'Duplicate')`,
    );
    await rejects(
      sql`INSERT INTO ai_variants (surface_id, machine_key, display_name) VALUES (${S1}, 'composer-v1', 'Duplicate')`,
    );
    await rejects(
      sql`INSERT INTO ai_surfaces (adapter_id, machine_key, display_name) VALUES ('00000000-0000-4000-8000-000000000099', 'orphan', 'Orphan')`,
    );
    await rejects(
      sql`INSERT INTO adapter_profiles (adapter_id, surface_id, machine_key, display_name) VALUES (${B}, ${S1}, 'wrong-family', 'Wrong family')`,
    );
    await rejects(
      sql`INSERT INTO adapter_profiles (adapter_id, surface_id, variant_id, machine_key, display_name) VALUES (${A}, ${S2}, ${V1}, 'wrong-surface', 'Wrong surface')`,
    );
  });

  it("protects stable hierarchy identity from reassignment", async () => {
    await rejects(
      sql`UPDATE ai_adapters SET machine_key = 'renamed' WHERE id = ${A}`,
    );
    await rejects(
      sql`UPDATE ai_surfaces SET adapter_id = ${B} WHERE id = ${S1}`,
    );
    await rejects(
      sql`UPDATE ai_variants SET surface_id = ${S2} WHERE id = ${V1}`,
    );
    await rejects(
      sql`UPDATE adapter_profiles SET adapter_id = ${B} WHERE id = ${P1}`,
    );
  });

  it("enforces positive unique revisions and cross-profile hierarchy coherence", async () => {
    await runtime.db.execute(sql`
      INSERT INTO adapter_profile_revisions
        (id, profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${R1}, ${P1}, ${A}, ${S1}, 1, 'adapter_profile_v1', 'DRAFT', ${content}::jsonb, ${compatibility}::jsonb, ${checksum})
    `);
    await rejects(sql`
      INSERT INTO adapter_profile_revisions
        (profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${P1}, ${A}, ${S1}, 1, 'adapter_profile_v1', 'DRAFT', ${content}::jsonb, ${compatibility}::jsonb, ${checksum})
    `);
    await rejects(sql`
      INSERT INTO adapter_profile_revisions
        (profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${P1}, ${A}, ${S1}, 0, 'adapter_profile_v1', 'DRAFT', ${content}::jsonb, ${compatibility}::jsonb, ${checksum})
    `);
    await rejects(sql`
      INSERT INTO adapter_profile_revisions
        (id, profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${badProfileRevision}, ${P1}, ${B}, ${S2}, 2, 'adapter_profile_v1', 'DRAFT', ${content}::jsonb, ${compatibility}::jsonb, ${checksum})
    `);
  });

  it("computes fingerprints through lifecycle authority and exposes catalog reads", async () => {
    const lifecycle = createProfileLifecycleRepository(runtime);
    const inserted = await lifecycle.createDraftProfileRevision({
      profileId: P1,
      content: validContent,
      compatibility: validCompatibility,
      context: {
        actorType: "SYSTEM",
        correlationId: "p7.1-catalog-test",
        reason: "catalog read regression",
      },
    });
    const expected = profileRevisionFingerprint({
      content: validContent,
      compatibility: validCompatibility,
    });
    expect(inserted.contentSha256).toBe(expected);
    const catalog = createAdapterRegistryCatalogRepository(runtime);
    expect((await catalog.findAdapter(A))?.id).toBe(A);
    expect((await catalog.findProfile(P1))?.id).toBe(P1);
    const readback = await catalog.findProfileRevision(P1, inserted.revision);
    expect(readback?.contentSha256).toBe(expected);
  });

  it("enforces the combined UTF-8 byte payload bound", async () => {
    const utf8Content = JSON.stringify({ text: "\u00e9".repeat(32_000) });
    const utf8Compatibility = JSON.stringify({ text: "\u00e9".repeat(1_000) });
    expect(Buffer.byteLength(utf8Content, "utf8")).toBeLessThan(65_536);
    expect(Buffer.byteLength(utf8Compatibility, "utf8")).toBeLessThan(65_536);
    expect(
      Buffer.byteLength(utf8Content, "utf8") +
        Buffer.byteLength(utf8Compatibility, "utf8"),
    ).toBeGreaterThan(65_536);
    await rejects(sql`
      INSERT INTO adapter_profile_revisions
        (id, profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${R4}, ${P1}, ${A}, ${S1}, 4, 'adapter_profile_v1', 'DRAFT', ${utf8Content}::jsonb, ${utf8Compatibility}::jsonb, ${checksum})
    `);
  });

  it("blocks every direct SQL rewrite and delete of published history", async () => {
    await runtime.db.execute(sql`
      INSERT INTO adapter_profile_revisions
        (id, profile_id, adapter_id, surface_id, revision, schema_version, state, content, compatibility_constraints, content_sha256)
      VALUES (${R2}, ${P1}, ${A}, ${S1}, 3, 'adapter_profile_v1', 'DRAFT', ${content}::jsonb, ${compatibility}::jsonb, ${checksum})
    `);
    await runtime.db.execute(
      sql`UPDATE adapter_profile_revisions SET state = 'CANDIDATE' WHERE id = ${R2}`,
    );
    await rejects(
      sql`UPDATE adapter_profile_revisions SET content = '{"changed": true}'::jsonb WHERE id = ${R2}`,
    );
    await rejects(
      sql`UPDATE adapter_profile_revisions SET state = 'DRAFT' WHERE id = ${R2}`,
    );
    await runtime.db.execute(
      sql`UPDATE adapter_profile_revisions SET state = 'PUBLISHED', published_at = now() WHERE id = ${R2}`,
    );
    await rejects(sql`DELETE FROM adapter_profile_revisions WHERE id = ${R2}`);
    await runtime.db.execute(
      sql`UPDATE adapter_profile_revisions SET state = 'RETIRED' WHERE id = ${R2}`,
    );
    await rejects(
      sql`UPDATE adapter_profile_revisions SET content_sha256 = ${"b".repeat(64)} WHERE id = ${R2}`,
    );
    await rejects(sql`DELETE FROM adapter_profile_revisions WHERE id = ${R2}`);
  });
});
