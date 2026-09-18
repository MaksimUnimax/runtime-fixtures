import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./index.js";
import { createHealthDiagnosticsReadRepository } from "./health-diagnostics-read-repository.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const runtime = createDatabaseRuntime(connectionString);
const diagnostics = createHealthDiagnosticsReadRepository(
  runtime,
  () => new Date("2026-09-19T12:00:00.000Z"),
);

describe.sequential(
  "S2-O3 LLM aggregate diagnostics PostgreSQL read model",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
    });
    afterAll(async () => runtime.close());

    it("returns bounded empty aggregates without evidence or write methods", async () => {
      const summary = await diagnostics.getSummary({ window: "24h" });
      const breakdown = await diagnostics.getBreakdown({ window: "24h" });
      expect(summary.stateCounts).toEqual(
        [
          "HEALTHY",
          "DRIFT",
          "DEGRADED",
          "BROKEN",
          "UNKNOWN",
          "MAINTENANCE",
        ].map((state) => ({ state, count: 0 })),
      );
      expect(summary.currentTargets).toEqual([]);
      expect(summary.stale).toBe(true);
      expect(breakdown.providerSurface).toEqual([]);
      expect(breakdown.browsers).toEqual([]);
      expect(JSON.stringify(summary)).not.toMatch(
        /evidence|payload|account|conversation|user/i,
      );
      expect(diagnostics).not.toHaveProperty("claimDue");
      expect(diagnostics).not.toHaveProperty("markDelivered");
    });

    it("keeps exact state, surface, browser, profile, incident, notification, and scheduler dimensions", async () => {
      const adapterIds = [randomUUID(), randomUUID()];
      const surfaceIds = [randomUUID(), randomUUID(), randomUUID()];
      const profileIds = [randomUUID(), randomUUID(), randomUUID()];
      const revisionIds = [randomUUID(), randomUUID(), randomUUID()];
      const suiteId = randomUUID();
      const states = [
        "HEALTHY",
        "DRIFT",
        "DEGRADED",
        "BROKEN",
        "UNKNOWN",
        "MAINTENANCE",
      ];
      const runIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const adapterIndex = index === 2 ? 1 : 0;
        if (index < 2)
          await runtime.query(
            `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,$2,$3)`,
            [
              adapterIds[index],
              index === 0 ? "chatgpt" : "alice",
              `Diagnostics adapter ${index}`,
            ],
          );
        await runtime.query(
          `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,$3,$4)`,
          [
            surfaceIds[index],
            adapterIds[adapterIndex],
            index === 0
              ? "chatgpt_standard"
              : index === 1
                ? "chatgpt_work"
                : "alice_standard",
            `Diagnostics surface ${index}`,
          ],
        );
        await runtime.query(
          `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,$4,$5)`,
          [
            profileIds[index],
            adapterIds[adapterIndex],
            surfaceIds[index],
            `diagnostics_profile_${index}`,
            `Diagnostics profile ${index}`,
          ],
        );
        await runtime.query(
          `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
          [
            revisionIds[index],
            profileIds[index],
            adapterIds[adapterIndex],
            surfaceIds[index],
            String(index + 1).repeat(64),
          ],
        );
      }
      await runtime.query(
        `INSERT INTO health_suite_revisions(id,machine_key,revision,suite_kind,definition,definition_sha256) VALUES($1,'diagnostics_suite',1,'BASELINE_CONTRACT_FIXTURE','{}'::jsonb,$2)`,
        [suiteId, "f".repeat(64)],
      );
      for (let index = 0; index < states.length; index += 1) {
        const target = index % 3;
        const adapter = target === 2 ? 1 : 0;
        const runId = randomUUID();
        runIds.push(runId);
        const at = new Date("2026-09-19T11:00:00.000Z");
        const scopeHash = String(index + 1).repeat(64);
        await runtime.query(
          `INSERT INTO health_runs(id,suite_revision_id,adapter_id,surface_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,operator_maintenance_authority,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,1,'chrome',$7,'1.0.0','1.0.0','H3',$8,'diagnostics-fixture-v1','{}'::jsonb,$9,$10,$11,$12,$13)`,
          [
            runId,
            suiteId,
            adapterIds[adapter],
            surfaceIds[target],
            profileIds[target],
            revisionIds[target],
            `12.${index}`,
            states[index],
            scopeHash,
            states[index] === "MAINTENANCE",
            states[index] === "MAINTENANCE" ? "diagnostics-fixture" : null,
            new Date(at.getTime() - 1000),
            at,
          ],
        );
      }
      const incidentIds = [randomUUID(), randomUUID()];
      await runtime.query(
        `INSERT INTO health_incidents(id,scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,incident_scope_sha256,incident_key_sha256,first_seen_at,last_seen_at,last_observed_run_id,last_observed_at,resolved_by_run_id,resolved_at) VALUES($1,$2,'OPEN',$3,$3,'C05_SEND_CONTROL',$4,$5,$6,$6,$3,$6,NULL,NULL)`,
        [
          incidentIds[0],
          "4".repeat(64),
          runIds[3],
          "a".repeat(64),
          "b".repeat(64),
          new Date("2026-09-19T10:00:00.000Z"),
        ],
      );
      await runtime.query(
        `INSERT INTO health_incidents(id,scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,incident_scope_sha256,incident_key_sha256,first_seen_at,last_seen_at,last_observed_run_id,last_observed_at,resolved_by_run_id,resolved_at) VALUES($1,$2,'RESOLVED',$3,$3,'C07_ASSISTANT_MESSAGE',$4,$5,$6,$7,$3,$7,$3,$7)`,
        [
          incidentIds[1],
          "5".repeat(64),
          runIds[1],
          "c".repeat(64),
          "d".repeat(64),
          new Date("2026-09-19T08:00:00.000Z"),
          new Date("2026-09-19T09:00:00.000Z"),
        ],
      );
      await runtime.query(
        `INSERT INTO health_notification_intents(dedup_key,source_domain,incident_id,health_run_id,event_kind,severity,route_key,state,first_observed_at,latest_observed_at,cooldown_until,payload,delivered_at) VALUES('diag-open','LLM_HEALTH',$1,$2,'INCIDENT_OPENED','CRITICAL','OPS','PENDING',$3,$3,$3,'{}'::jsonb,NULL),('diag-recovered','LLM_HEALTH',$4,$5,'INCIDENT_RECOVERED','INFO','OPS','DELIVERED',$3,$3,$3,'{}'::jsonb,$3)`,
        [
          incidentIds[0],
          runIds[3],
          new Date("2026-09-19T11:30:00.000Z"),
          incidentIds[1],
          runIds[1],
        ],
      );
      const scheduleId = randomUUID();
      await runtime.query(
        `INSERT INTO health_schedules(id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision) VALUES($1,'diagnostics_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',true,'{}'::jsonb,'2026-09-19T11:30:00Z',1)`,
        [scheduleId],
      );
      await runtime.query(
        `INSERT INTO health_scheduled_runs(schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,due_slot_at,idempotency_key,state,attempt,failure_class,failure_code) VALUES($1,'diagnostics_target','chatgpt','CHATGPT_STANDARD','NO_SESSION',1,'2026-09-19T11:00:00Z',$2,'FAILED_RETRYABLE',1,'TRANSIENT_ENVIRONMENT','NETWORK')`,
        [scheduleId, "e".repeat(64)],
      );

      const summary = await diagnostics.getSummary({ window: "24h" });
      const breakdown = await diagnostics.getBreakdown({ window: "24h" });
      expect(
        Object.fromEntries(
          summary.stateCounts.map((item) => [item.state, item.count]),
        ),
      ).toEqual({
        HEALTHY: 1,
        DRIFT: 1,
        DEGRADED: 1,
        BROKEN: 1,
        UNKNOWN: 1,
        MAINTENANCE: 1,
      });
      expect(summary.activeIncidentCount).toBe(1);
      expect(summary.notification).toMatchObject({
        pending: 1,
        delivered: 1,
        recentRecoveryNotifications: 1,
      });
      expect(summary.scheduler.retryingExecutionCount).toBe(1);
      expect(summary.scheduler.overdueDueTargetCount).toBe(1);
      expect(
        breakdown.providerSurface.map(
          (item) => `${item.provider}/${item.surface}`,
        ),
      ).toEqual(
        expect.arrayContaining([
          "chatgpt/chatgpt_standard",
          "chatgpt/chatgpt_work",
        ]),
      );
      expect(breakdown.browsers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            browserFamily: "chrome",
            browserVersion: "12.0",
          }),
        ]),
      );
      expect(breakdown.profiles).toHaveLength(3);
      expect(breakdown.incidentRoots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rootContourKey: "C05_SEND_CONTROL",
            status: "OPEN",
            activeCount: 1,
          }),
          expect.objectContaining({
            rootContourKey: "C07_ASSISTANT_MESSAGE",
            status: "RESOLVED",
            resolvedCount: 1,
          }),
        ]),
      );
    });
  },
);
