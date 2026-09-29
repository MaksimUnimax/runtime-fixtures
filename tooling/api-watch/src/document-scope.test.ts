import { describe, expect, it } from "vitest";
import {
  createPostgresProductCrosswalkStore,
  InMemoryProductCrosswalkStore,
} from "./crosswalk.js";
import {
  createPostgresApiWatchIncidentStore,
  incidentKey,
  InMemoryApiWatchIncidentStore,
} from "./incident.js";
import type {
  ApiWatchIncident,
  ApiWatchSqlRuntime,
  ProductCrosswalkRow,
} from "./types.js";

function sqlRuntime() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  const runtime = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.startsWith("INSERT INTO api_watch_product_crosswalk")) {
        rows.set(String(values[0]), {
          crosswalkId: values[0],
          reportId: values[1],
          sourceFamily: values[2],
          documentKey: values[3],
          sourceIdentity: values[4],
          runtimeAlias: values[5],
          crosswalkState: values[6],
          reviewState: values[7],
          executionEnabled: values[8],
          impactSeverity: values[9],
          diffSha256: values[10],
          createdAt: values[11],
        });
      }
      if (text.startsWith("INSERT INTO api_watch_incidents")) {
        rows.set(String(values[1]), {
          incidentId: values[0],
          incidentKey: values[1],
          incidentType: values[2],
          sourceFamily: values[3],
          documentKey: values[4],
          operationIdentity: values[5],
          firstSeenAt: values[6],
          lastSeenAt: values[7],
          resolvedAt: null,
          occurrenceCount: values[8],
          severity: values[9],
          latestReportId: values[10],
          latestDiffSha256: values[11],
          safeSummaryCode: values[12],
          state: "OPEN",
        });
      }
      if (text.startsWith("SELECT")) {
        const key = String(values[0]);
        const row = text.includes("api_watch_product_crosswalk")
          ? [...rows.values()].find((value) => value.reportId === key)
          : rows.get(key);
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async transaction<T>(operation: (query: ApiWatchSqlRuntime) => Promise<T>) {
      return operation(runtime as unknown as ApiWatchSqlRuntime);
    },
  };
  return { runtime: runtime as unknown as ApiWatchSqlRuntime, queries };
}

const crosswalk: ProductCrosswalkRow = {
  crosswalkId: "cw",
  reportId: "r",
  sourceFamily: "OZON_SELLER",
  documentKey: "seller-v2",
  sourceIdentity: "OZON_SELLER:GET:/x",
  runtimeAlias: null,
  crosswalkState: "SOURCE_ONLY",
  reviewState: "REVIEW_REQUIRED",
  executionEnabled: null,
  impactSeverity: null,
  diffSha256: null,
  createdAt: new Date(1),
};

const incident: Omit<
  ApiWatchIncident,
  "incidentId" | "occurrenceCount" | "state" | "resolvedAt"
> = {
  incidentKey: incidentKey(
    "API_CHANGE_BLOCKING",
    "OZON_SELLER",
    "OZON_SELLER:GET:/x",
    "seller-v2",
  ),
  incidentType: "API_CHANGE_BLOCKING",
  sourceFamily: "OZON_SELLER",
  documentKey: "seller-v2",
  operationIdentity: "OZON_SELLER:GET:/x",
  firstSeenAt: new Date(1),
  lastSeenAt: new Date(1),
  severity: "BLOCKING_RISK",
  latestReportId: "r",
  latestDiffSha256: null,
  safeSummaryCode: "API_CHANGE_BLOCKING",
};

describe("document scope persistence", () => {
  it("round-trips crosswalk scope in memory and through PostgreSQL queries", async () => {
    const memory = new InMemoryProductCrosswalkStore();
    expect((await memory.saveRows([crosswalk]))[0]?.documentKey).toBe(
      "seller-v2",
    );
    const { runtime, queries } = sqlRuntime();
    const postgres = createPostgresProductCrosswalkStore(runtime);
    await postgres.saveRows([crosswalk]);
    expect((await postgres.listRows("r"))[0]?.documentKey).toBe("seller-v2");
    expect(queries[0]?.text).toContain("document_key");
    expect(queries[1]?.text).toContain('document_key AS "documentKey"');
  });

  it("round-trips incident scope in memory and through PostgreSQL queries", async () => {
    const memory = new InMemoryApiWatchIncidentStore();
    expect((await memory.observe(incident)).incident.documentKey).toBe(
      "seller-v2",
    );
    const { runtime, queries } = sqlRuntime();
    const postgres = createPostgresApiWatchIncidentStore(runtime);
    expect((await postgres.observe(incident)).incident.documentKey).toBe(
      "seller-v2",
    );
    expect(queries.some(({ text }) => text.includes("document_key"))).toBe(
      true,
    );
    expect(
      queries.find(({ text }) =>
        text.startsWith("INSERT INTO api_watch_incidents"),
      )?.values[4],
    ).toBe("seller-v2");
  });
});
