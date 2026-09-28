import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { DatabaseRuntime } from "@product/db";
import {
  isMonitorPilotRetentionCliEntry,
  MONITOR_PILOT_RETENTION_APPLY_CONFIRM,
  MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS,
  parseMonitorPilotRetentionArgs,
  reportMonitorPilotRetentionResult,
  runMonitorPilotRetentionMaintenance,
  type MonitorPilotRetentionResult,
} from "./monitor-pilot-retention.js";

const fakeDatabase = {
  query: async () => {
    throw new Error("UNEXPECTED_DATABASE_QUERY");
  },
} as unknown as DatabaseRuntime;

function result(
  kind: MonitorPilotRetentionResult["kind"],
): MonitorPilotRetentionResult {
  return {
    schemaVersion: "monitor_pilot_retention_maintenance_v1",
    mode: "inspect",
    kind,
    startedAt: "2026-09-28T00:00:00.000Z",
    finishedAt: "2026-09-28T00:00:01.000Z",
    cutoffs: {
      rawPayloadBefore: "2026-09-27T23:00:00.000Z",
      replayReceiptBefore: "2026-09-20T00:00:00.000Z",
    },
    pendingBefore: null,
    pendingAfter: null,
    actions: {
      projected: 0,
      reconciled: 0,
      pruned: 0,
      receiptRetired: 0,
      terminalRetired: 0,
    },
    inventory: { scanned: 0, reasons: {}, nextCursor: null },
    blocked: {},
    deadlineReached: false,
    deadlineSemantics: MONITOR_PILOT_RETENTION_DEADLINE_SEMANTICS,
    supervisorHardTimeoutRequired: true,
    authorityIssues: [],
  };
}

describe("monitor pilot retention CLI contract", () => {
  it("requires explicit apply confirmation and accepts inspect without it", () => {
    expect(parseMonitorPilotRetentionArgs(["inspect"]).confirm).toBe(true);
    expect(parseMonitorPilotRetentionArgs(["apply"]).confirm).toBe(false);
    expect(
      parseMonitorPilotRetentionArgs([
        "apply",
        `--confirm=${MONITOR_PILOT_RETENTION_APPLY_CONFIRM}`,
      ]).confirm,
    ).toBe(true);
  });

  it("validates caps and keyset cursor as one bounded pair", () => {
    expect(() =>
      parseMonitorPilotRetentionArgs(["inspect", "--max-inventory=5001"]),
    ).toThrow("MONITOR_PILOT_RETENTION_LIMIT_INVALID");
    expect(() =>
      parseMonitorPilotRetentionArgs(["inspect", "--max-inventory=0"]),
    ).toThrow("MONITOR_PILOT_RETENTION_LIMIT_INVALID");
    expect(() =>
      parseMonitorPilotRetentionArgs([
        "inspect",
        "--cursor-run-id=00000000-0000-4000-8000-000000000001",
      ]),
    ).toThrow("MONITOR_PILOT_RETENTION_CURSOR_INVALID");
    const parsed = parseMonitorPilotRetentionArgs([
      "inspect",
      "--max-prune=17",
      "--deadline-ms=45000",
      "--cursor-completed-at=2026-09-20T00:00:00.000Z",
      "--cursor-run-id=00000000-0000-4000-8000-000000000001",
    ]);
    expect(parsed.input.limits).toMatchObject({
      maxPrune: 17,
      deadlineMs: 45_000,
    });
    expect(parsed.input.inventoryCursor?.runId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("maps incomplete authority and bounded partial work to nonzero exit codes", () => {
    const writes: string[] = [];
    expect(
      reportMonitorPilotRetentionResult(
        result("INSPECTED"),
        writes.push.bind(writes),
      ),
    ).toBe(0);
    expect(reportMonitorPilotRetentionResult(result("APPLIED"), () => {})).toBe(
      0,
    );
    expect(
      reportMonitorPilotRetentionResult(result("MISSING_AUTHORITY"), () => {}),
    ).toBe(2);
    expect(reportMonitorPilotRetentionResult(result("PARTIAL"), () => {})).toBe(
      3,
    );
    expect(writes[0]).toContain("MONITOR_PILOT_RETENTION_RESULT=");
    expect(result("INSPECTED")).toMatchObject({
      deadlineSemantics: "COOPERATIVE_BETWEEN_AWAITS",
      supervisorHardTimeoutRequired: true,
    });
  });

  it("does not touch retention tables when authority is missing", async () => {
    const output = await runMonitorPilotRetentionMaintenance(
      fakeDatabase,
      { mode: "apply" },
      {
        preflight: async () => ({
          kind: "MISSING_AUTHORITY",
          issues: [
            {
              targetKey: "nosession_chatgpt_standard",
              code: "NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND",
            },
          ],
        }),
        clock: () => new Date("2026-09-28T00:00:00.000Z"),
        nowMs: () => 0,
      },
    );
    expect(output.kind).toBe("MISSING_AUTHORITY");
    expect(output.actions).toEqual({
      projected: 0,
      reconciled: 0,
      pruned: 0,
      receiptRetired: 0,
      terminalRetired: 0,
    });
  });

  it("runs only as its dedicated CLI entry", () => {
    const cli = "/tmp/tooling/server/monitor-pilot-retention.ts";
    const bundled = "/tmp/apps/worker/dist/main.js";
    expect(isMonitorPilotRetentionCliEntry(cli, pathToFileURL(cli).href)).toBe(
      true,
    );
    expect(
      isMonitorPilotRetentionCliEntry(bundled, pathToFileURL(bundled).href),
    ).toBe(false);
    expect(
      isMonitorPilotRetentionCliEntry(cli, pathToFileURL(bundled).href),
    ).toBe(false);
  });
});
