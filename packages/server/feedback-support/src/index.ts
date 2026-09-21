import { createHash } from "node:crypto";
import {
  FeedbackAggregateQueryV1Schema,
  FeedbackFunnelQueryV1Schema,
  FeedbackCategoryV1Schema,
  FeedbackCaseStatusV1Schema,
  FeedbackCreateBodyV1Schema,
  FeedbackMarketplaceV1Schema,
  FeedbackSignalBodyV1Schema,
  FeedbackSignalEventV1Schema,
  FeedbackSeverityV1Schema,
  type FeedbackAggregateItemV1,
  type FeedbackFunnelQueryV1,
  type FeedbackFunnelResponseV1,
  type FeedbackCaseItemV1,
  type FeedbackCaseStatusV1,
  type FeedbackCategoryV1,
  type FeedbackCreateBodyV1,
  type FeedbackFollowupItemV1,
  type FeedbackSignalBodyV1,
  type FeedbackSignalEventV1,
  type SafeDiagnosticEnvelopeV1,
  SafeDiagnosticEnvelopeV1Schema,
} from "@product/contracts";
import { z } from "zod";

export const FEEDBACK_CLOSED_RETENTION_DAYS = 90;
export const FEEDBACK_SIGNAL_RETENTION_DAYS = 180;
export const FEEDBACK_CASE_LIMIT_PER_USER = 5;
export const FEEDBACK_FOLLOWUP_LIMIT_PER_USER = 20;
const USER_SIGNAL_EVENTS: ReadonlySet<FeedbackSignalEventV1> = new Set([
  "registration_started",
  "account_created",
  "device_activated",
  "first_store_added",
  "first_start",
]);
export const FEEDBACK_TRANSITIONS: Readonly<
  Record<FeedbackCaseStatusV1, readonly FeedbackCaseStatusV1[]>
> = {
  NEW: ["TRIAGED", "NEEDS_INFO", "RESOLVED"],
  TRIAGED: ["NEEDS_INFO", "RESOLVED"],
  NEEDS_INFO: ["TRIAGED", "RESOLVED"],
  RESOLVED: ["CLOSED", "NEEDS_INFO"],
  CLOSED: [],
};

export type FeedbackRole = "USER" | "SUPPORT" | "ADMIN";
export type FeedbackCase = FeedbackCaseItemV1 & {
  followups: FeedbackFollowupItemV1[];
};
export type FeedbackAggregate = FeedbackAggregateItemV1;
export type FeedbackRepository = {
  createCase(input: {
    userId: string;
    body: FeedbackCreateBodyV1;
    description: string;
    diagnostics: SafeDiagnosticEnvelopeV1 | null;
    correlationId: string;
  }): Promise<FeedbackCase | { kind: "RATE_LIMITED" | "ACCOUNT_FORBIDDEN" }>;
  listOwnCases(input: {
    userId: string;
    status?: FeedbackCaseStatusV1;
  }): Promise<FeedbackCaseItemV1[]>;
  getOwnCase(input: {
    userId: string;
    caseId: string;
  }): Promise<FeedbackCase | { kind: "NOT_FOUND" | "FORBIDDEN" }>;
  addFollowup(input: {
    actorType: FeedbackRole;
    actorId: string;
    caseId: string;
    body: string;
    correlationId: string;
  }): Promise<
    | FeedbackFollowupItemV1
    | { kind: "NOT_FOUND" | "FORBIDDEN" | "RATE_LIMITED" }
  >;
  listCases(input: {
    status?: FeedbackCaseStatusV1;
    category?: FeedbackCategoryV1;
    serverVersion?: string;
    extensionVersion?: string;
    browserFamily?: string;
    marketplace?: "NONE" | "OZON" | "WILDBERRIES";
    limit: number;
  }): Promise<FeedbackCaseItemV1[]>;
  getCase(caseId: string): Promise<FeedbackCase | undefined>;
  transitionCase(input: {
    actorType: "SUPPORT" | "ADMIN";
    actorId: string;
    caseId: string;
    status: FeedbackCaseStatusV1;
    resolutionCode?: string;
    correlationId: string;
  }): Promise<
    FeedbackCase | { kind: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN" }
  >;
  recordSignal(input: {
    userId: string;
    body: FeedbackSignalBodyV1;
    correlationId: string;
  }): Promise<"ACCEPTED" | "DUPLICATE" | "CONFLICT" | "RATE_LIMITED">;
  aggregateSignals(
    query: z.infer<typeof FeedbackAggregateQueryV1Schema>,
  ): Promise<FeedbackAggregate[]>;
  aggregateFunnel(
    query: FeedbackFunnelQueryV1,
  ): Promise<FeedbackFunnelResponseV1>;
  purgeExpired(input: {
    now: Date;
    closedRetentionDays: number;
    signalRetentionDays: number;
  }): Promise<{ cases: number; signals: number }>;
  anonymizeAccount(
    accountId: string,
  ): Promise<{ cases: number; signals: number }>;
};

export type FeedbackServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "INVALID_REQUEST"
        | "RATE_LIMITED"
        | "ACCOUNT_FORBIDDEN"
        | "NOT_FOUND"
        | "FORBIDDEN"
        | "INVALID_TRANSITION";
    };

function normalizedText(value: string): string {
  return [...value.normalize("NFC")]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return char === "\n" || char === "\r" || char === "\t" || code >= 0x20;
    })
    .join("")
    .trim();
}

const secretPatterns: readonly [RegExp, string][] = [
  [
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/giu,
    "[REDACTED_PRIVATE_KEY]",
  ],
  [
    /(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+/=-]{12,}/giu,
    "$1[REDACTED_TOKEN]",
  ],
  [/(\bbearer\s+)[A-Za-z0-9._~+/=-]{20,}/giu, "$1[REDACTED_TOKEN]"],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    "[REDACTED_JWT]",
  ],
  [/(cookie\s*[:=]\s*)[^\s;]+(?:\s*;[^\n]*)?/giu, "$1[REDACTED_COOKIE]"],
  [
    /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu,
    "$1=[REDACTED_SECRET]",
  ],
  [
    /(?:ozon|wildberries|wb)[_-]?(?:token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;]+/giu,
    "[REDACTED_MARKETPLACE_SECRET]",
  ],
];

export function redactAccidentalSecrets(input: string): string {
  return secretPatterns.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input,
  );
}

export function sanitizeFeedbackText(input: string): string {
  const normalized = normalizedText(input);
  return redactAccidentalSecrets(normalized);
}

export function sanitizeDiagnostics(
  input: unknown,
): SafeDiagnosticEnvelopeV1 | null {
  if (input === undefined || input === null) return null;
  const parsed = SafeDiagnosticEnvelopeV1Schema.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
}

export function rateKey(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}\0${value}`).digest("hex");
}

export function statusTransitionAllowed(
  from: FeedbackCaseStatusV1,
  to: FeedbackCaseStatusV1,
): boolean {
  return FEEDBACK_TRANSITIONS[from].includes(to);
}

export function retentionConfig(environment: NodeJS.ProcessEnv): {
  closedDays: number;
  signalDays: number;
} {
  const read = (key: string, fallback: number) => {
    const raw = environment[key];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 3650)
      throw new Error(`${key} must be an integer between 1 and 3650`);
    return value;
  };
  return {
    closedDays: read(
      "FEEDBACK_CLOSED_RETENTION_DAYS",
      FEEDBACK_CLOSED_RETENTION_DAYS,
    ),
    signalDays: read(
      "FEEDBACK_SIGNAL_RETENTION_DAYS",
      FEEDBACK_SIGNAL_RETENTION_DAYS,
    ),
  };
}

export class FeedbackSupportService {
  public constructor(
    private readonly repository: FeedbackRepository,
    private readonly correlationId: () => string = () => "feedback",
  ) {}

  async createCase(
    userId: string,
    raw: unknown,
    correlationId = this.correlationId(),
  ): Promise<FeedbackServiceResult<FeedbackCase>> {
    const parsed = FeedbackCreateBodyV1Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
    const body = parsed.data;
    const description = sanitizeFeedbackText(body.description);
    if (!description || description.length > 4000)
      return { ok: false, code: "INVALID_REQUEST" };
    const result = await this.repository.createCase({
      userId,
      body,
      description,
      diagnostics: sanitizeDiagnostics(body.diagnostics),
      correlationId,
    });
    if ("kind" in result) {
      return {
        ok: false,
        code:
          result.kind === "RATE_LIMITED" ? "RATE_LIMITED" : "ACCOUNT_FORBIDDEN",
      };
    }
    return { ok: true, value: result };
  }

  async addUserFollowup(
    userId: string,
    caseId: string,
    raw: unknown,
    correlationId = this.correlationId(),
  ): Promise<FeedbackServiceResult<FeedbackFollowupItemV1>> {
    const parsed = z
      .object({ description: z.string().min(1).max(4000) })
      .strict()
      .safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
    const body = sanitizeFeedbackText(parsed.data.description);
    if (!body) return { ok: false, code: "INVALID_REQUEST" };
    const result = await this.repository.getOwnCase({ userId, caseId });
    if ("kind" in result && result.kind === "NOT_FOUND")
      return { ok: false, code: "NOT_FOUND" };
    if ("kind" in result && result.kind === "FORBIDDEN")
      return { ok: false, code: "FORBIDDEN" };
    const followup = await this.repository.addFollowup({
      actorType: "USER",
      actorId: userId,
      caseId,
      body,
      correlationId,
    });
    if ("kind" in followup) {
      return {
        ok: false,
        code: followup.kind === "RATE_LIMITED" ? "RATE_LIMITED" : followup.kind,
      };
    }
    return { ok: true, value: followup };
  }

  async listOwnCases(input: {
    userId: string;
    status?: FeedbackCaseStatusV1;
  }): Promise<FeedbackCaseItemV1[]> {
    return this.repository.listOwnCases(input);
  }

  async getOwnCase(input: {
    userId: string;
    caseId: string;
  }): Promise<FeedbackServiceResult<FeedbackCase>> {
    const result = await this.repository.getOwnCase(input);
    if ("kind" in result)
      return {
        ok: false,
        code: result.kind === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
      };
    return { ok: true, value: result };
  }

  async listCases(input: {
    status?: FeedbackCaseStatusV1;
    category?: FeedbackCategoryV1;
    serverVersion?: string;
    extensionVersion?: string;
    browserFamily?: string;
    marketplace?: "NONE" | "OZON" | "WILDBERRIES";
    limit: number;
  }): Promise<FeedbackCaseItemV1[]> {
    return this.repository.listCases(input);
  }

  async getCase(caseId: string): Promise<FeedbackCase | undefined> {
    return this.repository.getCase(caseId);
  }

  async addAdminFollowup(
    actorType: "SUPPORT" | "ADMIN",
    actorId: string,
    caseId: string,
    raw: unknown,
    correlationId = this.correlationId(),
  ): Promise<FeedbackServiceResult<FeedbackFollowupItemV1>> {
    const parsed = z
      .object({ description: z.string().min(1).max(4000) })
      .strict()
      .safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
    const body = sanitizeFeedbackText(parsed.data.description);
    if (!body) return { ok: false, code: "INVALID_REQUEST" };
    const result = await this.repository.addFollowup({
      actorType,
      actorId,
      caseId,
      body,
      correlationId,
    });
    if ("kind" in result)
      return {
        ok: false,
        code: result.kind === "RATE_LIMITED" ? "RATE_LIMITED" : result.kind,
      };
    return { ok: true, value: result };
  }

  async transitionCase(
    actorType: "SUPPORT" | "ADMIN",
    actorId: string,
    caseId: string,
    raw: unknown,
    correlationId = this.correlationId(),
  ): Promise<FeedbackServiceResult<FeedbackCase>> {
    const parsed = z
      .object({
        status: FeedbackCaseStatusV1Schema,
        resolutionCode: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9._:-]+$/u)
          .optional(),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
    const result = await this.repository.transitionCase({
      actorType,
      actorId,
      caseId,
      status: parsed.data.status,
      resolutionCode: parsed.data.resolutionCode,
      correlationId,
    });
    if ("kind" in result) {
      return {
        ok: false,
        code:
          result.kind === "INVALID_TRANSITION"
            ? "INVALID_TRANSITION"
            : result.kind === "NOT_FOUND"
              ? "NOT_FOUND"
              : "FORBIDDEN",
      };
    }
    return { ok: true, value: result };
  }

  async aggregateSignals(raw: unknown): Promise<FeedbackAggregate[]> {
    const parsed = FeedbackAggregateQueryV1Schema.safeParse(raw);
    if (!parsed.success) throw new Error("invalid aggregate query");
    return this.repository.aggregateSignals(parsed.data);
  }

  async aggregateFunnel(raw: unknown): Promise<FeedbackFunnelResponseV1> {
    const parsed = FeedbackFunnelQueryV1Schema.safeParse(raw);
    if (!parsed.success) throw new Error("invalid funnel query");
    return this.repository.aggregateFunnel(parsed.data);
  }

  async purgeExpired(input: {
    now: Date;
    closedRetentionDays: number;
    signalRetentionDays: number;
  }) {
    return this.repository.purgeExpired(input);
  }

  async anonymizeAccount(accountId: string) {
    return this.repository.anonymizeAccount(accountId);
  }

  async recordSignal(
    userId: string,
    raw: unknown,
    correlationId = this.correlationId(),
  ): Promise<FeedbackServiceResult<{ accepted: true }>> {
    const parsed = FeedbackSignalBodyV1Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST" };
    if (!USER_SIGNAL_EVENTS.has(parsed.data.event))
      return { ok: false, code: "INVALID_REQUEST" };
    const result = await this.repository.recordSignal({
      userId,
      body: parsed.data,
      correlationId,
    });
    if (result === "RATE_LIMITED") return { ok: false, code: "RATE_LIMITED" };
    if (result === "CONFLICT") return { ok: false, code: "INVALID_REQUEST" };
    return { ok: true, value: { accepted: true } };
  }

  validateCategory(value: unknown): value is FeedbackCategoryV1 {
    return FeedbackCategoryV1Schema.safeParse(value).success;
  }
  validateStatus(value: unknown): value is FeedbackCaseStatusV1 {
    return FeedbackCaseStatusV1Schema.safeParse(value).success;
  }
  validateEvent(value: unknown): value is FeedbackSignalEventV1 {
    return FeedbackSignalEventV1Schema.safeParse(value).success;
  }
  validateMarketplace(value: unknown): boolean {
    return FeedbackMarketplaceV1Schema.safeParse(value).success;
  }
  validateSeverity(value: unknown): boolean {
    return FeedbackSeverityV1Schema.safeParse(value).success;
  }
}

export { FeedbackAggregateQueryV1Schema } from "@product/contracts";
export { FeedbackFunnelQueryV1Schema } from "@product/contracts";
export { calculateFunnel, funnelWindow, FUNNEL_STAGES } from "./funnels.js";
export type { FunnelSignalRecord } from "./funnels.js";
