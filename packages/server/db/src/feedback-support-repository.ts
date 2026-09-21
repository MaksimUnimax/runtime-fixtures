import {
  FeedbackAggregateQueryV1Schema,
  type FeedbackCaseItemV1,
  type FeedbackFollowupItemV1,
  type FeedbackSignalBodyV1,
  SafeDiagnosticEnvelopeV1Schema,
} from "@product/contracts";
import {
  FEEDBACK_CASE_LIMIT_PER_USER,
  FEEDBACK_FOLLOWUP_LIMIT_PER_USER,
  type FeedbackAggregate,
  type FeedbackCase,
  type FeedbackRepository,
  rateKey,
  statusTransitionAllowed,
} from "@product/feedback-support";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type CaseRow = {
  id: string;
  account_id: string | null;
  created_by_user_id: string | null;
  device_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  category: FeedbackCaseItemV1["category"];
  severity: FeedbackCaseItemV1["severity"];
  status: FeedbackCaseItemV1["status"];
  description: string;
  diagnostics: unknown;
  server_version: string | null;
  portal_version: string | null;
  extension_version: string | null;
  browser_family: string | null;
  browser_version: string | null;
  marketplace: FeedbackCaseItemV1["marketplace"];
  support_code: string | null;
  release_identity: string | null;
  assigned_admin_principal_id: string | null;
  resolution_code: string | null;
};
type FollowupRow = {
  id: string;
  author_type: "USER" | "SUPPORT" | "ADMIN";
  body: string;
  created_at: Date | string;
};

const caseColumns = `id,account_id,created_by_user_id,device_id,created_at,updated_at,category,severity,status,description,diagnostics,server_version,portal_version,extension_version,browser_family,browser_version,marketplace,support_code,release_identity,assigned_admin_principal_id,resolution_code`;
const iso = (value: Date | string) => new Date(value).toISOString();

function mapCase(row: CaseRow): FeedbackCaseItemV1 {
  const diagnostics = SafeDiagnosticEnvelopeV1Schema.safeParse(row.diagnostics);
  return {
    caseId: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    category: row.category,
    severity: row.severity,
    status: row.status,
    description: row.description,
    diagnostics: diagnostics.success ? diagnostics.data : null,
    serverVersion: row.server_version,
    portalVersion: row.portal_version,
    extensionVersion: row.extension_version,
    browserFamily: row.browser_family,
    browserVersion: row.browser_version,
    marketplace: row.marketplace,
    supportCode: row.support_code,
    releaseIdentity: row.release_identity,
    assignedAdminPrincipalId: row.assigned_admin_principal_id,
    resolutionCode: row.resolution_code,
  };
}

function mapFollowup(row: FollowupRow): FeedbackFollowupItemV1 {
  return {
    followupId: row.id,
    authorType: row.author_type,
    body: row.body,
    createdAt: iso(row.created_at),
  };
}

async function loadCase(
  query: DatabaseQuery,
  caseId: string,
  forUpdate = false,
): Promise<CaseRow | undefined> {
  const result = await query.query<CaseRow>(
    `SELECT ${caseColumns} FROM feedback_cases WHERE id=$1${forUpdate ? " FOR UPDATE" : ""}`,
    [caseId],
  );
  return result.rows[0];
}

async function followups(
  query: DatabaseQuery,
  caseId: string,
): Promise<FeedbackFollowupItemV1[]> {
  const result = await query.query<FollowupRow>(
    `SELECT id,author_type,body,created_at FROM feedback_followups WHERE case_id=$1 ORDER BY created_at ASC,id ASC`,
    [caseId],
  );
  return result.rows.map(mapFollowup);
}

function withFollowups(
  row: CaseRow,
  rows: FeedbackFollowupItemV1[],
): FeedbackCase {
  return { ...mapCase(row), followups: rows };
}

async function consumeRate(
  query: DatabaseQuery,
  action: string,
  key: string,
  limit: number,
): Promise<boolean> {
  const now = new Date();
  const windowStarted = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
  const result = await query.query<{ count: number | string }>(
    `INSERT INTO auth_rate_limit_buckets(action,key_hash,window_started_at,count,updated_at) VALUES($1,$2,$3,1,$4) ON CONFLICT(action,key_hash) DO UPDATE SET count=CASE WHEN auth_rate_limit_buckets.window_started_at=EXCLUDED.window_started_at THEN LEAST(auth_rate_limit_buckets.count+1,1000000) ELSE 1 END,window_started_at=EXCLUDED.window_started_at,updated_at=EXCLUDED.updated_at RETURNING count`,
    [action, key, windowStarted, now],
  );
  return Number(result.rows[0]?.count ?? limit + 1) <= limit;
}

async function audit(
  query: DatabaseQuery,
  actorType: "USER" | "SUPPORT" | "ADMIN",
  actorId: string,
  action: string,
  caseId: string,
  correlationId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await query.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,safe_metadata) VALUES($1,$2,$3,'FEEDBACK_CASE',$4,$5,$6::jsonb)`,
    [
      actorType,
      actorId,
      action,
      caseId,
      correlationId,
      JSON.stringify(metadata),
    ],
  );
}

async function recordSignal(
  query: DatabaseQuery,
  body: FeedbackSignalBodyV1,
): Promise<void> {
  await query.query(
    `INSERT INTO feedback_signal_events(event,product_version,extension_version,browser_family,category,status) VALUES($1,$2,$3,$4,$5,$6)`,
    [
      body.event,
      body.productVersion ?? null,
      body.extensionVersion ?? null,
      body.browserFamily ?? null,
      body.category ?? null,
      body.status ?? null,
    ],
  );
}

export function createFeedbackSupportRepository(
  runtime: DatabaseRuntime,
): FeedbackRepository {
  return {
    async createCase(input) {
      return runtime.transaction(async (tx) => {
        const account = await tx.query<{ id: string }>(
          `SELECT a.id FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND a.status='ACTIVE' AND m.user_id=$2`,
          [input.body.accountId, input.userId],
        );
        if (!account.rows[0]) return { kind: "ACCOUNT_FORBIDDEN" as const };
        if (input.body.deviceId) {
          const device = await tx.query<{ id: string }>(
            `SELECT id FROM devices WHERE id=$1 AND account_id=$2`,
            [input.body.deviceId, input.body.accountId],
          );
          if (!device.rows[0]) return { kind: "ACCOUNT_FORBIDDEN" as const };
        }
        if (
          !(await consumeRate(
            tx,
            "FEEDBACK_CASE_USER",
            rateKey("user", input.userId),
            FEEDBACK_CASE_LIMIT_PER_USER,
          ))
        )
          return { kind: "RATE_LIMITED" as const };
        const result = await tx.query<CaseRow>(
          `INSERT INTO feedback_cases(account_id,created_by_user_id,device_id,category,severity,status,description,diagnostics,server_version,portal_version,extension_version,browser_family,browser_version,marketplace,support_code,release_identity) VALUES($1,$2,$3,$4,$5,'NEW',$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${caseColumns}`,
          [
            input.body.accountId,
            input.userId,
            input.body.deviceId ?? null,
            input.body.category,
            input.body.severity,
            input.description,
            input.diagnostics ? JSON.stringify(input.diagnostics) : null,
            input.body.serverVersion ?? null,
            input.body.portalVersion ?? null,
            input.body.extensionVersion ?? null,
            input.body.browserFamily ?? null,
            input.body.browserVersion ?? null,
            input.body.marketplace,
            input.body.supportCode ?? null,
            input.body.releaseIdentity ?? null,
          ],
        );
        const row = result.rows[0]!;
        await audit(
          tx,
          "USER",
          input.userId,
          "SUPPORT_CASE_CREATED",
          row.id,
          input.correlationId,
          {
            category: row.category,
            severity: row.severity,
            marketplace: row.marketplace,
          },
        );
        await recordSignal(tx, {
          event: "feedback_case_created",
          productVersion: input.body.serverVersion,
          extensionVersion: input.body.extensionVersion,
          browserFamily: input.body.browserFamily,
          category: input.body.category,
          status: "NEW",
        });
        return withFollowups(row, []);
      });
    },
    async listOwnCases(input) {
      const result = await runtime.query<CaseRow>(
        `SELECT ${caseColumns} FROM feedback_cases WHERE created_by_user_id=$1 AND ($2::feedback_case_status IS NULL OR status=$2) ORDER BY created_at DESC,id DESC LIMIT 100`,
        [input.userId, input.status ?? null],
      );
      return result.rows.map(mapCase);
    },
    async getOwnCase(input) {
      const row = await loadCase(runtime, input.caseId);
      if (!row) return { kind: "NOT_FOUND" as const };
      if (row.created_by_user_id !== input.userId)
        return { kind: "FORBIDDEN" as const };
      return withFollowups(row, await followups(runtime, input.caseId));
    },
    async addFollowup(input) {
      return runtime.transaction(async (tx) => {
        const row = await loadCase(tx, input.caseId, true);
        if (!row) return { kind: "NOT_FOUND" as const };
        if (
          input.actorType === "USER" &&
          row.created_by_user_id !== input.actorId
        )
          return { kind: "FORBIDDEN" as const };
        if (
          !(await consumeRate(
            tx,
            "FEEDBACK_FOLLOWUP_ACTOR",
            rateKey(input.actorType, input.actorId),
            FEEDBACK_FOLLOWUP_LIMIT_PER_USER,
          ))
        )
          return { kind: "RATE_LIMITED" as const };
        const result = await tx.query<FollowupRow>(
          `INSERT INTO feedback_followups(case_id,author_type,author_user_id,author_admin_principal_id,body) VALUES($1,$2,$3,$4,$5) RETURNING id,author_type,body,created_at`,
          [
            input.caseId,
            input.actorType,
            input.actorType === "USER" ? input.actorId : null,
            input.actorType === "USER" ? null : input.actorId,
            input.body,
          ],
        );
        await tx.query(
          `UPDATE feedback_cases SET updated_at=now() WHERE id=$1`,
          [input.caseId],
        );
        if (input.actorType !== "USER")
          await audit(
            tx,
            input.actorType,
            input.actorId,
            "SUPPORT_CASE_FOLLOWUP_ADDED",
            input.caseId,
            input.correlationId,
          );
        return mapFollowup(result.rows[0]!);
      });
    },
    async listCases(input) {
      const clauses: string[] = [];
      const values: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        clauses.push(sql.replace("?", `$${values.length}`));
      };
      if (input.status) add("status=?", input.status);
      if (input.category) add("category=?", input.category);
      if (input.serverVersion) add("server_version=?", input.serverVersion);
      if (input.extensionVersion)
        add("extension_version=?", input.extensionVersion);
      if (input.browserFamily) add("browser_family=?", input.browserFamily);
      if (input.marketplace) add("marketplace=?", input.marketplace);
      values.push(input.limit);
      const result = await runtime.query<CaseRow>(
        `SELECT ${caseColumns} FROM feedback_cases${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapCase);
    },
    async getCase(caseId) {
      const row = await loadCase(runtime, caseId);
      return row
        ? withFollowups(row, await followups(runtime, caseId))
        : undefined;
    },
    async transitionCase(input) {
      return runtime.transaction(async (tx) => {
        const row = await loadCase(tx, input.caseId, true);
        if (!row) return { kind: "NOT_FOUND" as const };
        if (!statusTransitionAllowed(row.status, input.status))
          return { kind: "INVALID_TRANSITION" as const };
        const closedAt = input.status === "CLOSED" ? new Date() : null;
        const result = await tx.query<CaseRow>(
          `UPDATE feedback_cases SET status=$2,resolution_code=$3,closed_at=$4,updated_at=now() WHERE id=$1 RETURNING ${caseColumns}`,
          [input.caseId, input.status, input.resolutionCode ?? null, closedAt],
        );
        const next = result.rows[0]!;
        await audit(
          tx,
          input.actorType,
          input.actorId,
          "SUPPORT_CASE_STATUS_CHANGED",
          input.caseId,
          input.correlationId,
          {
            from: row.status,
            to: next.status,
            resolutionCode: next.resolution_code,
          },
        );
        if (input.status === "RESOLVED")
          await recordSignal(tx, {
            event: "feedback_case_resolved",
            category: next.category,
            status: next.status,
          });
        return withFollowups(next, await followups(tx, input.caseId));
      });
    },
    async recordSignal(input) {
      return runtime.transaction(async (tx) => {
        if (
          !(await consumeRate(
            tx,
            "FEEDBACK_SIGNAL_USER",
            rateKey("user", input.userId),
            50,
          ))
        )
          return "RATE_LIMITED" as const;
        await recordSignal(tx, input.body);
        return "ACCEPTED" as const;
      });
    },
    async aggregateSignals(rawQuery) {
      const query = FeedbackAggregateQueryV1Schema.parse(rawQuery);
      const clauses: string[] = [];
      const values: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        clauses.push(sql.replace("?", `$${values.length}`));
      };
      if (query.from) add("occurred_at >= ?", new Date(query.from));
      if (query.to) add("occurred_at < ?", new Date(query.to));
      if (query.productVersion)
        add("product_version = ?", query.productVersion);
      if (query.extensionVersion)
        add("extension_version = ?", query.extensionVersion);
      if (query.browserFamily) add("browser_family = ?", query.browserFamily);
      if (query.category) add("category = ?", query.category);
      if (query.status) add("status = ?", query.status);
      const result = await runtime.query<{
        day: string;
        event: FeedbackAggregate["event"];
        count: string | number;
        product_version: string | null;
        extension_version: string | null;
        browser_family: string | null;
        category: FeedbackAggregate["category"];
        status: FeedbackAggregate["status"];
      }>(
        `SELECT to_char(date_trunc('day',occurred_at),'YYYY-MM-DD') AS day,event::text AS event,count(*)::int AS count,product_version,extension_version,browser_family,category::text AS category,status::text AS status FROM feedback_signal_events${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} GROUP BY 1,2,4,5,6,7,8 ORDER BY 1 DESC,2 ASC`,
        values,
      );
      return result.rows.map((row) => ({
        day: row.day,
        event: row.event,
        count: Number(row.count),
        productVersion: row.product_version,
        extensionVersion: row.extension_version,
        browserFamily: row.browser_family,
        category: row.category,
        status: row.status,
      }));
    },
    async purgeExpired(input) {
      const closedBefore = new Date(
        input.now.getTime() - input.closedRetentionDays * 86_400_000,
      );
      const signalBefore = new Date(
        input.now.getTime() - input.signalRetentionDays * 86_400_000,
      );
      return runtime.transaction(async (tx) => {
        const cases = await tx.query<{ id: string }>(
          `DELETE FROM feedback_cases WHERE status='CLOSED' AND updated_at < $1 RETURNING id`,
          [closedBefore],
        );
        const signals = await tx.query<{ id: string }>(
          `DELETE FROM feedback_signal_events WHERE occurred_at < $1 RETURNING id`,
          [signalBefore],
        );
        return { cases: cases.rows.length, signals: signals.rows.length };
      });
    },
    async anonymizeAccount(accountId) {
      const result = await runtime.query<{ id: string }>(
        `UPDATE feedback_cases SET account_id=NULL,created_by_user_id=NULL,device_id=NULL,description='[Feedback removed after account deletion]',diagnostics=NULL,updated_at=now() WHERE account_id=$1 RETURNING id`,
        [accountId],
      );
      return { cases: result.rows.length };
    },
  };
}
