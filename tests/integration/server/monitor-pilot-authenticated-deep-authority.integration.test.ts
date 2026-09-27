import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabaseRuntime,
  createHealthAuthenticatedDeepScopeRepository,
} from "@product/db";
import { runMigrations } from "@product/db/migrations";
import {
  initializeMonitorPilotAuthorityForTest,
  preflightMonitorPilotAuthorityForTest,
} from "../../../tooling/server/monitor-pilot-authority.js";
import {
  initializeMonitorPilotAuthenticatedDeepAuthority,
  initializeMonitorPilotAuthenticatedDeepAuthorityForTest,
  preflightMonitorPilotAuthenticatedDeepAuthorityForTest,
} from "../../../tooling/server/monitor-pilot-authenticated-deep-authority.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const resolver = createHealthAuthenticatedDeepScopeRepository(runtime);

type Identity = {
  expectedDatabaseName: string;
  expectedDatabaseRole: string;
};

let identity: Identity;

async function counts() {
  const result = await runtime.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM ai_adapters) AS adapters,
    (SELECT count(*)::text FROM ai_surfaces) AS surfaces,
    (SELECT count(*)::text FROM ai_variants) AS variants,
    (SELECT count(*)::text FROM adapter_profiles) AS profiles,
    (SELECT count(*)::text FROM adapter_profile_revisions) AS revisions,
    (SELECT count(*)::text FROM audit_events) AS audits`);
  return result.rows[0]!;
}

async function activeTechnicalAuthority() {
  const result = await runtime.query<Record<string, string>>(`SELECT
    (SELECT count(*)::text FROM admin_role_grants WHERE revoked_at IS NULL) AS grants,
    (SELECT count(*)::text FROM admin_principals WHERE status='ACTIVE') AS principals,
    (SELECT count(*)::text FROM users WHERE status='ACTIVE') AS users`);
  return result.rows[0]!;
}

function resolutionInput(
  surface: "CHATGPT_STANDARD" | "CHATGPT_WORK",
  machineKey: string,
) {
  return {
    surface,
    browserFamily: "chrome" as const,
    browserVersion: "154.0.0.0",
    extensionVersion: "1.0.0",
    adapterEngineVersion: "1.0.0",
    healthSuite: { machineKey, revision: 1 },
  };
}

describe.sequential(
  "B13 monitor pilot authenticated-deep authority provisioning",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      const actual = await runtime.query<{
        databaseName: string;
        databaseRole: string;
      }>(
        'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
      );
      identity = {
        expectedDatabaseName: actual.rows[0]!.databaseName,
        expectedDatabaseRole: actual.rows[0]!.databaseRole,
      };
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
    });

    afterAll(async () => runtime.close());

    it("requires the exact B12 baseline and rolls back H3 bootstrap atomically", async () => {
      await expect(
        initializeMonitorPilotAuthenticatedDeepAuthority(runtime, {
          expectedDatabaseRole: identity.expectedDatabaseRole,
        }),
      ).rejects.toThrow(
        "MONITOR_PILOT_AUTHENTICATED_DEEP_DATABASE_IDENTITY_MISMATCH",
      );

      await expect(
        initializeMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).rejects.toThrow(
        "MONITOR_PILOT_AUTHENTICATED_DEEP_NO_SESSION_BASELINE_REQUIRED",
      );
      expect(await counts()).toMatchObject({
        adapters: "0",
        surfaces: "0",
        variants: "0",
        profiles: "0",
        revisions: "0",
      });

      expect(
        await initializeMonitorPilotAuthorityForTest(runtime, identity),
      ).toEqual({ kind: "INITIALIZED", targets: 9 });
      expect(
        await preflightMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).toEqual({ kind: "MISSING_AUTHORITY", profiles: 0 });

      const baseline = await counts();
      expect(baseline).toMatchObject({
        adapters: "8",
        surfaces: "9",
        variants: "0",
        profiles: "9",
        revisions: "9",
      });
      expect(await activeTechnicalAuthority()).toEqual({
        grants: "0",
        principals: "0",
        users: "0",
      });

      await runtime.query(
        "CREATE FUNCTION b13_fail_work_h3_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.machine_key='work-h3' THEN RAISE EXCEPTION 'B13_FORCED_H3_PROVISION_FAILURE'; END IF; RETURN NEW; END; $$",
      );
      await runtime.query(
        "CREATE TRIGGER b13_fail_work_h3_profile_trigger BEFORE INSERT ON adapter_profiles FOR EACH ROW EXECUTE FUNCTION b13_fail_work_h3_profile()",
      );
      try {
        await expect(
          initializeMonitorPilotAuthenticatedDeepAuthorityForTest(
            runtime,
            identity,
          ),
        ).rejects.toThrow("B13_FORCED_H3_PROVISION_FAILURE");
        expect(await counts()).toEqual(baseline);
        expect(await activeTechnicalAuthority()).toEqual({
          grants: "0",
          principals: "0",
          users: "0",
        });
      } finally {
        await runtime.query(
          "DROP TRIGGER IF EXISTS b13_fail_work_h3_profile_trigger ON adapter_profiles",
        );
        await runtime.query(
          "DROP FUNCTION IF EXISTS b13_fail_work_h3_profile() CASCADE",
        );
      }
    });

    it("adds only Standard rev2 and Work rev1, stays idempotent, and preserves B12 authority", async () => {
      expect(
        await initializeMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).toEqual({ kind: "INITIALIZED", profiles: 2 });

      expect(
        await preflightMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).toEqual({ kind: "READY", profiles: 2 });
      expect(
        (await preflightMonitorPilotAuthorityForTest(runtime, identity)).kind,
      ).toBe("READY");

      const expanded = await counts();
      expect(expanded).toMatchObject({
        adapters: "8",
        surfaces: "9",
        variants: "0",
        profiles: "11",
        revisions: "11",
      });
      expect(await activeTechnicalAuthority()).toEqual({
        grants: "0",
        principals: "0",
        users: "0",
      });

      const h3Rows = await runtime.query<{
        profileKey: string;
        revision: number;
        state: string;
      }>(
        `SELECT p.machine_key AS "profileKey",r.revision,r.state
           FROM adapter_profiles p
           JOIN adapter_profile_revisions r ON r.profile_id=p.id
          WHERE p.machine_key IN ('standard-h3','work-h3')
          ORDER BY p.machine_key`,
      );
      expect(h3Rows.rows).toEqual([
        { profileKey: "standard-h3", revision: 2, state: "PUBLISHED" },
        { profileKey: "work-h3", revision: 1, state: "PUBLISHED" },
      ]);
      expect(
        await initializeMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).toEqual({ kind: "ALREADY_EXACT", profiles: 2 });
      expect(await counts()).toEqual(expanded);
      expect(await activeTechnicalAuthority()).toEqual({
        grants: "0",
        principals: "0",
        users: "0",
      });

      const standard = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_STANDARD", "b13-authdeep-standard-pilot"),
      );
      const work = await resolver.resolveAuthenticatedDeepHealthScope(
        resolutionInput("CHATGPT_WORK", "b13-authdeep-work-pilot"),
      );
      expect(standard.profile.revision).toBe(2);
      expect(work.profile.revision).toBe(1);
      expect(standard.profile.id).not.toBe(work.profile.id);
    });

    it("rejects conflicting H3 catalog state without rewriting B12 authority", async () => {
      const before = await counts();
      await runtime.query(
        "UPDATE adapter_profiles SET status='DISABLED' WHERE machine_key='standard-h3'",
      );
      await expect(
        preflightMonitorPilotAuthenticatedDeepAuthorityForTest(
          runtime,
          identity,
        ),
      ).rejects.toThrow("MONITOR_PILOT_AUTHENTICATED_DEEP_CATALOG_CONFLICT");
      await runtime.query(
        "UPDATE adapter_profiles SET status='ACTIVE' WHERE machine_key='standard-h3'",
      );
      expect(await counts()).toEqual(before);
      expect(
        (await preflightMonitorPilotAuthorityForTest(runtime, identity)).kind,
      ).toBe("READY");
    });
  },
);
