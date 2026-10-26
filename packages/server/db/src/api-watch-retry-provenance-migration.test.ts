import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsFolder } from "./migrations.js";

const tag = "0062_api_watch_retry_provenance_fence";

describe("C03 retry provenance migration source contract", () => {
  it("is an exact registered next migration and preserves old Swagger timing for diagnosis", async () => {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const last = journal.entries.at(-1);
    const previous = journal.entries.at(-2);
    expect(last?.tag).toBe(tag);
    expect(last?.idx).toBe(50);
    expect(previous?.tag).toBe(
      "0061_credential_transfer_function_acl_hardening",
    );
    expect(last!.when).toBeGreaterThan(previous!.when);

    const sql = await readFile(join(migrationsFolder, tag + ".sql"), "utf8");
    expect(sql).toContain(
      "\"ordinary_due_provenance\" varchar(16) NOT NULL DEFAULT 'UNKNOWN'",
    );
    expect(sql).toContain('"ordinary_next_run_at" timestamp with time zone');
    expect(sql).toContain('"active_run_entered_at" timestamp with time zone');
    expect(sql).not.toContain("WHERE \"lane\" = 'LLM'");
    // The migration must not guess which old lane deadline was periodic.
    expect(sql).not.toMatch(/UPDATE\s+"monitoring_lane_schedules"/i);
    expect(sql).not.toMatch(/"ordinary_next_run_at"\s*=\s*"next_run_at"/i);

    // Prior column declarations guarantee the actual DDL types, not a guess.
    const priorSchedule = await readFile(
      join(migrationsFolder, "0038_s2_tg2_monitoring_lanes.sql"),
      "utf8",
    );
    const priorRetries = await readFile(
      join(migrationsFolder, "0045_s2_api_watch_retry_state.sql"),
      "utf8",
    );
    expect(priorSchedule).toContain(
      '"next_run_at" timestamp with time zone NOT NULL',
    );
    expect(priorSchedule).toContain('"active_run_id" uuid');
    expect(priorRetries).toContain(
      '"source_family" varchar(32) PRIMARY KEY NOT NULL',
    );

    expect(sql).toContain("api_watch_family_attempt_fences");
    expect(sql).toContain("'CLAIMED'");
    expect(sql).toContain("'ENTERED'");
    expect(sql).toContain('"outcome_unknown" boolean NOT NULL DEFAULT false');
    expect(sql).toContain('retry."next_retry_at" IS NOT NULL');
    expect(sql).toContain('"active_run_id" IS NOT NULL');
  });

  it("requires paired claim fields and cannot treat unconfirmed previous executions as success", async () => {
    const sql = await readFile(join(migrationsFolder, tag + ".sql"), "utf8");
    expect(sql).toContain('"api_watch_family_claim_stage_check"');
    expect(sql).toContain('"api_watch_family_unknown_idle_check"');
    expect(sql).toContain('NOT "outcome_unknown" OR "claim_stage" = \'IDLE\'');
    expect(sql).toContain(
      '"ordinary_due_provenance" = \'UNKNOWN\' AND "ordinary_next_run_at" IS NULL',
    );
    expect(sql).not.toMatch(
      /UPDATE\s+"monitoring_lane_schedules"\s+SET\s+"next_run_at"/i,
    );
    // These are source-level assertions only. Real PostgreSQL interleaving,
    // migration history, and operator resolution still require separate tests.
  });

  it("rejects forbidden schedule rewrites even in adversarial SQL variants", async () => {
    const sql = await readFile(join(migrationsFolder, tag + ".sql"), "utf8");
    const overwritesRegular =
      /UPDATE\s+"monitoring_lane_schedules"\s+SET\s+"next_run_at"/i;
    const inventsBaseline = /"ordinary_next_run_at"\s*=\s*"next_run_at"/i;
    expect(overwritesRegular.test(sql)).toBe(false);
    expect(inventsBaseline.test(sql)).toBe(false);
    expect(
      overwritesRegular.test(
        sql + '\nUPDATE "monitoring_lane_schedules" SET "next_run_at" = now();',
      ),
    ).toBe(true);
    expect(
      inventsBaseline.test(
        sql +
          '\nUPDATE "monitoring_lane_schedules" SET "ordinary_next_run_at" = "next_run_at";',
      ),
    ).toBe(true);
  });
});
