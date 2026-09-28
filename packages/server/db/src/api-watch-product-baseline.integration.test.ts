import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createApiWatchProductBaselineRepository,
  createDatabaseRuntime,
  type ApiWatchProductBaselineSourceFamily,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const concurrentRuntime = createDatabaseRuntime(connectionString);
const repository = createApiWatchProductBaselineRepository(runtime);
const BASE = new Date("2026-09-28T19:00:00.000Z");

async function resetDatabase(): Promise<void> {
  await runtime.query(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
  );
  await runMigrations({ connectionString: connectionString! });
}

async function seedSnapshot(input: {
  snapshotId: string;
  sourceFamily: ApiWatchProductBaselineSourceFamily;
  documentKey: string | null;
  shaChar: string;
}): Promise<void> {
  const authorityRecordId = randomUUID();
  const sha256 = input.shaChar.repeat(64);
  await runtime.query(
    `INSERT INTO api_watch_authority_records(
       record_id,source_family,official_url,acquisition_mode,authority_status,
       sha256,size_bytes,spec_version,acquired_at,validated_at,artifact_extension,safe_provenance
     ) VALUES($1,$2,$3,'AUTOMATIC','AUTHORITY_ACCEPTED',$4,128,'v1',$5,$5,'json','{}'::jsonb)`,
    [
      authorityRecordId,
      input.sourceFamily,
      `https://example.invalid/${input.snapshotId}`,
      sha256,
      BASE,
    ],
  );
  await runtime.query(
    `INSERT INTO api_watch_snapshots(
       snapshot_id,source_family,sha256,size_bytes,spec_version,official_url,
       acquisition_mode,created_at,authority_record_id,artifact_path,document_key
     ) VALUES($1,$2,$3,128,'v1',$4,'AUTOMATIC',$5,$6,$7,$8)`,
    [
      input.snapshotId,
      input.sourceFamily,
      sha256,
      `https://example.invalid/${input.snapshotId}`,
      BASE,
      authorityRecordId,
      `/safe/${input.snapshotId}.json`,
      input.documentKey,
    ],
  );
}

describe.sequential("API-watch product baseline durability", () => {
  beforeAll(async () => {
    await Promise.all([runtime.ready(), concurrentRuntime.ready()]);
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await Promise.all([runtime.close(), concurrentRuntime.close()]);
  });

  it("creates an explicit family baseline without auto-advancing from snapshot persistence", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-family-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "a",
    });

    await expect(
      repository.read({ sourceFamily: "OZON_SELLER", documentKey: null }),
    ).resolves.toBeUndefined();

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('OZON_SELLER',NULL,'snapshot-family-v1',1,$1,'direct-sql','missing-history')`,
        [BASE],
      ),
    ).rejects.toThrow(/requires matching audit history/);

    await expect(
      repository.read({ sourceFamily: "OZON_SELLER", documentKey: null }),
    ).resolves.toBeUndefined();

    const acceptedAt = new Date(BASE.valueOf() + 1_000);
    const created = await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v1",
      expectedRevision: null,
      acceptedAt,
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:compatible:v1",
    });

    expect(created).toMatchObject({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v1",
      snapshotSha256: "a".repeat(64),
      snapshotSpecVersion: "v1",
      revision: 1,
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:compatible:v1",
    });
    expect(created.acceptedAt.toISOString()).toBe(acceptedAt.toISOString());

    const history = await runtime.query<{
      revision: number;
      previous_snapshot_id: string | null;
      snapshot_id: string;
    }>(
      `SELECT revision,previous_snapshot_id,snapshot_id
         FROM api_watch_product_baseline_revisions
        WHERE baseline_id=$1
        ORDER BY revision`,
      [created.baselineId],
    );
    expect(history.rows).toEqual([
      {
        revision: 1,
        previous_snapshot_id: null,
        snapshot_id: "snapshot-family-v1",
      },
    ]);
  });

  it("updates by exact CAS revision and appends immutable audit history", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-family-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "a",
    });
    await seedSnapshot({
      snapshotId: "snapshot-family-v2",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "b",
    });
    const first = await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v1",
      expectedRevision: null,
      acceptedAt: new Date(BASE.valueOf() + 1_000),
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:compatible:v1",
    });

    await expect(
      runtime.query(
        `UPDATE api_watch_product_baselines
            SET revision=2,accepted_by='direct-sql'
          WHERE baseline_id=$1`,
        [first.baselineId],
      ),
    ).rejects.toThrow(/requires matching audit history/);

    await expect(
      runtime.query(
        `UPDATE api_watch_product_baselines
            SET snapshot_id='snapshot-family-v2',revision=2,
                accepted_at=$2,accepted_by='direct-sql',
                acceptance_reference='missing-history'
          WHERE baseline_id=$1`,
        [first.baselineId, new Date(BASE.valueOf() + 2_000)],
      ),
    ).rejects.toThrow(/requires matching audit history/);

    await expect(
      runtime.transaction(async (tx) => {
        await tx.query(
          `UPDATE api_watch_product_baselines
              SET snapshot_id='snapshot-family-v2',revision=2,
                  accepted_at=$2,accepted_by='direct-sql',
                  acceptance_reference='wrong-previous'
            WHERE baseline_id=$1`,
          [first.baselineId, new Date(BASE.valueOf() + 2_000)],
        );
        await tx.query(
          `INSERT INTO api_watch_product_baseline_revisions(
             baseline_id,revision,source_family,document_key,previous_snapshot_id,
             snapshot_id,accepted_at,accepted_by,acceptance_reference
           ) VALUES($1,2,'OZON_SELLER',NULL,'snapshot-family-v2',
                    'snapshot-family-v2',$2,'direct-sql','wrong-previous')`,
          [first.baselineId, new Date(BASE.valueOf() + 2_000)],
        );
      }),
    ).rejects.toThrow(/previous snapshot does not match prior revision/);

    const second = await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v2",
      expectedRevision: first.revision,
      acceptedAt: new Date(BASE.valueOf() + 2_000),
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:compatible:v2",
    });

    expect(second).toMatchObject({
      baselineId: first.baselineId,
      snapshotId: "snapshot-family-v2",
      snapshotSha256: "b".repeat(64),
      revision: 2,
      acceptanceReference: "evidence:compatible:v2",
    });

    const history = await runtime.query<{
      revision: number;
      previous_snapshot_id: string | null;
      snapshot_id: string;
      acceptance_reference: string;
    }>(
      `SELECT revision,previous_snapshot_id,snapshot_id,acceptance_reference
         FROM api_watch_product_baseline_revisions
        WHERE baseline_id=$1
        ORDER BY revision`,
      [first.baselineId],
    );
    expect(history.rows).toEqual([
      {
        revision: 1,
        previous_snapshot_id: null,
        snapshot_id: "snapshot-family-v1",
        acceptance_reference: "evidence:compatible:v1",
      },
      {
        revision: 2,
        previous_snapshot_id: "snapshot-family-v1",
        snapshot_id: "snapshot-family-v2",
        acceptance_reference: "evidence:compatible:v2",
      },
    ]);

    await expect(
      runtime.query(
        `UPDATE api_watch_product_baseline_revisions
            SET acceptance_reference='tampered'
          WHERE baseline_id=$1 AND revision=1`,
        [first.baselineId],
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      runtime.query("TRUNCATE TABLE api_watch_product_baseline_revisions"),
    ).rejects.toThrow(/append-only/);

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baseline_revisions(
           baseline_id,revision,source_family,document_key,previous_snapshot_id,
           snapshot_id,accepted_at,accepted_by,acceptance_reference
         ) VALUES($1,3,'OZON_SELLER',NULL,'snapshot-family-v2',
                  'snapshot-family-v1',$2,'direct-sql','fake-audit')`,
        [first.baselineId, new Date(BASE.valueOf() + 3_000)],
      ),
    ).rejects.toThrow(/does not match current pointer/);
  });

  it("rejects a stale expected revision without changing pointer or history", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-family-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "a",
    });
    await seedSnapshot({
      snapshotId: "snapshot-family-v2",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "b",
    });
    const first = await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v1",
      expectedRevision: null,
      acceptedAt: BASE,
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:compatible:v1",
    });

    await expect(
      repository.accept({
        sourceFamily: "OZON_SELLER",
        documentKey: null,
        snapshotId: "snapshot-family-v2",
        expectedRevision: 2,
        acceptedAt: new Date(BASE.valueOf() + 1_000),
        acceptedBy: "c-api-watch",
        acceptanceReference: "evidence:stale",
      }),
    ).rejects.toThrow("API_WATCH_PRODUCT_BASELINE_REVISION_MISMATCH");

    await expect(
      repository.read({ sourceFamily: "OZON_SELLER", documentKey: null }),
    ).resolves.toMatchObject({
      baselineId: first.baselineId,
      snapshotId: "snapshot-family-v1",
      revision: 1,
    });
    expect(
      (
        await runtime.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM api_watch_product_baseline_revisions
            WHERE baseline_id=$1`,
          [first.baselineId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it("rejects a missing snapshot and creates no baseline", async () => {
    await expect(
      repository.accept({
        sourceFamily: "WILDBERRIES",
        documentKey: null,
        snapshotId: "missing-snapshot",
        expectedRevision: null,
        acceptedAt: BASE,
        acceptedBy: "c-api-watch",
        acceptanceReference: "evidence:missing",
      }),
    ).rejects.toThrow("API_WATCH_PRODUCT_BASELINE_SNAPSHOT_NOT_FOUND");

    expect(
      (
        await runtime.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM api_watch_product_baselines",
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  it("rejects family and document scope mismatches", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-ozon-family",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "a",
    });
    await seedSnapshot({
      snapshotId: "snapshot-ozon-doc",
      sourceFamily: "OZON_SELLER",
      documentKey: "seller-api",
      shaChar: "b",
    });

    await expect(
      repository.accept({
        sourceFamily: "WILDBERRIES",
        documentKey: null,
        snapshotId: "snapshot-ozon-family",
        expectedRevision: null,
        acceptedAt: BASE,
        acceptedBy: "c-api-watch",
        acceptanceReference: "evidence:wrong-family",
      }),
    ).rejects.toThrow("API_WATCH_PRODUCT_BASELINE_SCOPE_MISMATCH");

    await expect(
      repository.accept({
        sourceFamily: "OZON_SELLER",
        documentKey: "performance-api",
        snapshotId: "snapshot-ozon-doc",
        expectedRevision: null,
        acceptedAt: BASE,
        acceptedBy: "c-api-watch",
        acceptanceReference: "evidence:wrong-document",
      }),
    ).rejects.toThrow("API_WATCH_PRODUCT_BASELINE_SCOPE_MISMATCH");

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('WILDBERRIES',NULL,'snapshot-ozon-family',1,$1,'direct-sql','wrong-family')`,
        [BASE],
      ),
    ).rejects.toThrow(/snapshot scope mismatch/);

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('OZON_SELLER','performance-api','snapshot-ozon-doc',1,$1,'direct-sql','wrong-document')`,
        [BASE],
      ),
    ).rejects.toThrow(/snapshot scope mismatch/);

    expect(
      (
        await runtime.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM api_watch_product_baselines",
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  it("serializes a direct baseline insert against concurrent snapshot scope drift", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-race-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "e",
    });

    let releaseBaseline!: () => void;
    let markBaselineReady!: () => void;
    const holdBaseline = new Promise<void>((resolve) => {
      releaseBaseline = resolve;
    });
    const baselineReady = new Promise<void>((resolve) => {
      markBaselineReady = resolve;
    });

    const baselineTransaction = runtime.transaction(async (tx) => {
      const inserted = await tx.query<{ baseline_id: string }>(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('OZON_SELLER',NULL,'snapshot-race-v1',1,$1,'direct-sql','race-baseline')
         RETURNING baseline_id`,
        [BASE],
      );
      const baselineId = inserted.rows[0]?.baseline_id;
      if (!baselineId) throw new Error("TEST_BASELINE_INSERT_FAILED");
      await tx.query(
        `INSERT INTO api_watch_product_baseline_revisions(
           baseline_id,revision,source_family,document_key,previous_snapshot_id,
           snapshot_id,accepted_at,accepted_by,acceptance_reference
         ) VALUES($1,1,'OZON_SELLER',NULL,NULL,
                  'snapshot-race-v1',$2,'direct-sql','race-baseline')`,
        [baselineId, BASE],
      );
      markBaselineReady();
      await holdBaseline;
    });

    await baselineReady;
    let updateSettled = false;
    const updateResult = concurrentRuntime
      .query(
        `UPDATE api_watch_snapshots
            SET source_family='WILDBERRIES'
          WHERE snapshot_id='snapshot-race-v1'`,
      )
      .then(
        () => {
          updateSettled = true;
          return { kind: "resolved" as const, error: undefined };
        },
        (error: unknown) => {
          updateSettled = true;
          return { kind: "rejected" as const, error };
        },
      );

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(updateSettled).toBe(false);

    releaseBaseline();
    await baselineTransaction;
    const update = await updateResult;
    expect(update.kind).toBe("rejected");
    expect(String(update.error)).toMatch(/snapshot scope is immutable/);

    await expect(
      repository.read({ sourceFamily: "OZON_SELLER", documentKey: null }),
    ).resolves.toMatchObject({
      snapshotId: "snapshot-race-v1",
      revision: 1,
    });
  });

  it("enforces null-safe uniqueness while allowing family and document scopes to coexist", async () => {
    await seedSnapshot({
      snapshotId: "snapshot-family-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "a",
    });
    await seedSnapshot({
      snapshotId: "snapshot-family-v2",
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      shaChar: "b",
    });
    await seedSnapshot({
      snapshotId: "snapshot-doc-v1",
      sourceFamily: "OZON_SELLER",
      documentKey: "seller-api",
      shaChar: "c",
    });
    await seedSnapshot({
      snapshotId: "snapshot-doc-v2",
      sourceFamily: "OZON_SELLER",
      documentKey: "seller-api",
      shaChar: "d",
    });

    await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: null,
      snapshotId: "snapshot-family-v1",
      expectedRevision: null,
      acceptedAt: BASE,
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:family",
    });
    await repository.accept({
      sourceFamily: "OZON_SELLER",
      documentKey: "seller-api",
      snapshotId: "snapshot-doc-v1",
      expectedRevision: null,
      acceptedAt: BASE,
      acceptedBy: "c-api-watch",
      acceptanceReference: "evidence:document",
    });

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('OZON_SELLER',NULL,'snapshot-family-v2',1,$1,'test','duplicate-family')`,
        [BASE],
      ),
    ).rejects.toThrow();

    await expect(
      runtime.query(
        `INSERT INTO api_watch_product_baselines(
           source_family,document_key,snapshot_id,revision,accepted_at,accepted_by,acceptance_reference
         ) VALUES('OZON_SELLER','seller-api','snapshot-doc-v2',1,$1,'test','duplicate-document')`,
        [BASE],
      ),
    ).rejects.toThrow();

    expect(
      (
        await runtime.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM api_watch_product_baselines",
        )
      ).rows[0]?.count,
    ).toBe(2);
  });
});
