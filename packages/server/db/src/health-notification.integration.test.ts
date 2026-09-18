import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DeterministicNotificationTestSink,
  deriveLlmHealthNotificationEvent,
} from "@product/health";
import {
  createDatabaseRuntime,
  createHealthNotificationRepository,
  recordLlmHealthNotificationInTransaction,
  resumeLlmHealthProductNotificationInTransaction,
  suppressLlmHealthProductNotificationsInTransaction,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const workerA = createDatabaseRuntime(connectionString);
const workerB = createDatabaseRuntime(connectionString);
const notificationsA = createHealthNotificationRepository(workerA);
const notificationsB = createHealthNotificationRepository(workerB);

async function seedEpisode(): Promise<{
  incidentId: string;
  healthRunId: string;
  event: NonNullable<ReturnType<typeof deriveLlmHealthNotificationEvent>>;
}> {
  const ids = {
    adapter: randomUUID(),
    surface: randomUUID(),
    profile: randomUUID(),
    profileRevision: randomUUID(),
    suite: randomUUID(),
    run: randomUUID(),
    incident: randomUUID(),
  };
  const key = `notification_${ids.adapter.replaceAll("-", "").slice(0, 16)}`;
  const at = new Date("2026-09-19T10:00:00.000Z");
  const scope = {
    adapterFamilyId: ids.adapter,
    adapterFamilyKey: "chatgpt",
    surfaceId: ids.surface,
    surfaceKey: "WORK",
    variant: null,
    browserFamily: "chrome",
    browserVersion: "120.0",
    extensionVersion: "1.0.0",
    adapterEngineVersion: "1.0.0",
    profile: { id: ids.profile, revision: 1 },
    healthSuite: { machineKey: key, revision: 1 },
  };
  await runtime.query(
    `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,$2,'Notification fixture')`,
    [ids.adapter, key],
  );
  await runtime.query(
    `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'notification_surface','Notification fixture')`,
    [ids.surface, ids.adapter],
  );
  await runtime.query(
    `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,$4,'Notification fixture')`,
    [ids.profile, ids.adapter, ids.surface, `${key}_profile`],
  );
  await runtime.query(
    `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
    [
      ids.profileRevision,
      ids.profile,
      ids.adapter,
      ids.surface,
      "0".repeat(64),
    ],
  );
  await runtime.query(
    `INSERT INTO health_suite_revisions(id,machine_key,revision,suite_kind,definition,definition_sha256) VALUES($1,$2,1,'BASELINE_CONTRACT_FIXTURE',$3::jsonb,$4)`,
    [ids.suite, key, JSON.stringify({ scope }), "1".repeat(64)],
  );
  await runtime.query(
    `INSERT INTO health_runs(id,suite_revision_id,adapter_id,surface_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,1,'chrome','120.0','1.0.0','1.0.0','H3','BROKEN','notification-fixture-v1',$7::jsonb,$8,false,$9,$10)`,
    [
      ids.run,
      ids.suite,
      ids.adapter,
      ids.surface,
      ids.profile,
      ids.profileRevision,
      JSON.stringify(scope),
      "2".repeat(64),
      new Date(at.getTime() - 1000),
      at,
    ],
  );
  await runtime.query(
    `INSERT INTO health_incidents(id,scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,incident_scope_sha256,incident_key_sha256,first_seen_at,last_seen_at,last_observed_run_id,last_observed_at) VALUES($1,$2,'OPEN',$3,$3,'C05_SEND_CONTROL',$4,$5,$6,$6,$3,$6)`,
    [
      ids.incident,
      "2".repeat(64),
      ids.run,
      "3".repeat(64),
      `${ids.incident.replaceAll("-", "")}00000000000000000000000000000000`,
      at,
    ],
  );
  const event = deriveLlmHealthNotificationEvent({
    incidentId: ids.incident,
    healthRunId: ids.run,
    eventKind: "INCIDENT_OPENED",
    healthState: "BROKEN",
    provider: "chatgpt",
    surface: "WORK",
    healthLevel: "H3",
    rootContourKey: "C05_SEND_CONTROL",
    observedAt: at,
  });
  if (!event) throw new Error("notification fixture did not derive");
  return { incidentId: ids.incident, healthRunId: ids.run, event };
}

describe.sequential(
  "S2-O2 LLM Health notification PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await runMigrations({ connectionString });
    });
    beforeEach(() => runtime.query("DELETE FROM health_notification_intents"));
    afterAll(async () => {
      await workerA.close();
      await workerB.close();
      await runtime.close();
    });

    it("uses a unique dedup key under concurrent producers", async () => {
      const fixture = await seedEpisode();
      await Promise.all([
        workerA.transaction((q) =>
          recordLlmHealthNotificationInTransaction(q, fixture.event),
        ),
        workerB.transaction((q) =>
          recordLlmHealthNotificationInTransaction(q, fixture.event),
        ),
      ]);
      const rows = await runtime.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM health_notification_intents WHERE dedup_key=$1`,
        [fixture.event.dedupKey],
      );
      expect(rows.rows[0]?.count).toBe(1);
    });

    it("claims once, reclaims an expired lease, and rejects stale finalization", async () => {
      const fixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, fixture.event),
      );
      const now = new Date("2026-09-19T10:01:00.000Z");
      const [left, right] = await Promise.all([
        notificationsA.claimDue({ ownerId: "worker-a", now }),
        notificationsB.claimDue({ ownerId: "worker-b", now }),
      ]);
      const first = left ?? right;
      expect(first).toBeDefined();
      expect(left && right).toBeFalsy();
      if (!first?.claimToken) throw new Error("missing first claim token");
      const reclaimed = await notificationsB.claimDue({
        ownerId: "worker-b-reclaim",
        now: new Date("2026-09-19T10:03:01.000Z"),
      });
      expect(reclaimed?.id).toBe(first.id);
      if (!reclaimed?.claimToken) throw new Error("missing reclaim token");
      await expect(
        notificationsA.markDelivered({
          id: first.id,
          claimToken: first.claimToken,
          providerAdapterKey: "deterministic-test-sink",
          providerDeliveryId: "stale",
        }),
      ).rejects.toThrow("NOTIFICATION_CLAIM_STALE");
      await notificationsB.markDelivered({
        id: reclaimed.id,
        claimToken: reclaimed.claimToken,
        providerAdapterKey: "deterministic-test-sink",
        providerDeliveryId: "valid",
      });
      expect((await notificationsB.getIntent(reclaimed.id))?.state).toBe(
        "DELIVERED",
      );
    });

    it("persists bounded retry, terminal rejection, and disabled suppression", async () => {
      const transientFixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, transientFixture.event),
      );
      const transient = await notificationsA.claimDue({
        ownerId: "retry-a",
        now: new Date("2026-09-19T10:05:00.000Z"),
      });
      if (!transient?.claimToken) throw new Error("missing retry claim");
      const retry = await notificationsA.failClaim({
        id: transient.id,
        claimToken: transient.claimToken,
        code: "TRANSIENT_PROVIDER_FAILURE",
        now: new Date("2026-09-19T10:04:00.000Z"),
      });
      expect(retry.state).toBe("FAILED_RETRYABLE");

      const terminalFixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, terminalFixture.event),
      );
      const terminal = await notificationsA.claimDue({
        ownerId: "terminal-a",
        now: new Date("2026-09-19T10:05:00.000Z"),
      });
      if (!terminal?.claimToken) throw new Error("missing terminal claim");
      expect(
        (
          await notificationsA.failClaim({
            id: terminal.id,
            claimToken: terminal.claimToken,
            code: "PERMANENT_PROVIDER_REJECTION",
          })
        ).state,
      ).toBe("FAILED_TERMINAL");

      const disabledFixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, disabledFixture.event),
      );
      const disabled = await notificationsA.claimDue({
        ownerId: "disabled-a",
        now: new Date("2026-09-19T10:05:00.000Z"),
      });
      if (!disabled?.claimToken) throw new Error("missing disabled claim");
      expect(
        (
          await notificationsA.failClaim({
            id: disabled.id,
            claimToken: disabled.claimToken,
            code: "DISABLED_ROUTE",
          })
        ).state,
      ).toBe("SUPPRESSED");
    });

    it("does not persist provider payload bytes and keeps the sink idempotent", async () => {
      const fixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, fixture.event),
      );
      const row = await runtime.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM health_notification_intents WHERE dedup_key=$1`,
        [fixture.event.dedupKey],
      );
      expect(JSON.stringify(row.rows[0]?.payload)).not.toMatch(
        /cookie|storageState|authorization|password|assistant|screenshot|\bdom\b/i,
      );
      const sink = new DeterministicNotificationTestSink();
      const request = {
        intentId: "intent-crash-replay",
        idempotencyKey: fixture.event.dedupKey,
        routeKey: fixture.event.routeKey,
        payload: fixture.event.payload,
      };
      expect(await sink.deliver(request)).toEqual(await sink.deliver(request));
      expect(sink.deliveries.size).toBe(1);
    });

    it("suppresses an undelivered product alert in maintenance and resumes it without a new OPEN key", async () => {
      const fixture = await seedEpisode();
      await runtime.transaction((q) =>
        recordLlmHealthNotificationInTransaction(q, fixture.event),
      );
      await runtime.transaction((q) =>
        suppressLlmHealthProductNotificationsInTransaction(
          q,
          fixture.incidentId,
        ),
      );
      const suppressed = await runtime.query<{
        state: string;
        suppressionReason: string | null;
        dedupKey: string;
      }>(
        `SELECT state,suppression_reason AS "suppressionReason",dedup_key AS "dedupKey" FROM health_notification_intents WHERE incident_id=$1 AND event_kind='INCIDENT_OPENED'`,
        [fixture.incidentId],
      );
      expect(suppressed.rows[0]).toMatchObject({
        state: "SUPPRESSED",
        suppressionReason: "MAINTENANCE_ENTERED",
      });
      await runtime.transaction((q) =>
        resumeLlmHealthProductNotificationInTransaction(
          q,
          fixture.incidentId,
          new Date("2026-09-19T10:05:00.000Z"),
        ),
      );
      const resumed = await runtime.query<{ state: string; dedupKey: string }>(
        `SELECT state,dedup_key AS "dedupKey" FROM health_notification_intents WHERE incident_id=$1 AND event_kind='INCIDENT_OPENED'`,
        [fixture.incidentId],
      );
      expect(resumed.rows[0]).toMatchObject({
        state: "PENDING",
        dedupKey: fixture.event.dedupKey,
      });
    });
  },
);
