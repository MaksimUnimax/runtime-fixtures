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
    batchSize: number;
    statementTimeoutMs: number;
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
    /(\b(?:proxy-)?authorization[ \t]*[:=][ \t]*)[^\r\n]*(?:(?:\r\n|\r|\n)[ \t]+[^\r\n]*)*/giu,
    "$1[REDACTED_AUTHORIZATION]",
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

// Decode quoted JSON keys before classifying credential fields. Unicode
// escaped keys like "access\u005ftoken" are equivalent to "access_token".
// Match quoted keys and values independently of quote style, including
// truncated values at end of input or line. Preserve closing value quotes.
const quotedStringField =
  /((["'])(?:\\.|(?!\2)[^\\\r\n])*\2)(\s*:\s*(["']))(?:\\.|\\(?=[\r\n]|$)|(?!\4)[^\\\r\n])*(?=\4|[\r\n]|$)/gu;
// Numeric/boolean/null diagnostics can also be truncated or pseudo-JSON.
const quotedJsonScalarField =
  /("(?:\\.|[^"\\\r\n])*")(\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=\s*(?:[,}\]]|[\r\n]|$))/gu;
const singleQuotedScalarField =
  /('(?:\\.|[^'\\\r\n])*')(\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=\s*(?:[,}\]]|[\r\n]|$))/gu;
const sensitiveJsonKey =
  /(?:password|passwd|secret|token|api[_-]?key|authorization|cookies?|set[-_]?cookie)$/iu;

function isSensitiveQuotedKey(encodedKey: string): boolean {
  if (encodedKey.startsWith('"')) {
    try {
      const key: unknown = JSON.parse(encodedKey);
      return typeof key !== "string" || sensitiveJsonKey.test(key);
    } catch {
      // Invalid JSON escaping obscures the key identity: fail closed.
      return true;
    }
  }
  const key = encodedKey.slice(1, -1);
  // Single-quoted pseudo-JSON cannot reliably decode arbitrary escapes.
  return key.includes("\\") || sensitiveJsonKey.test(key);
}

// A sensitive quoted JSON or pseudo-JSON field may hold an array/object,
// not just a scalar. Consume that entire value without swallowing subsequent
// sibling metadata, respecting quotes, escapes and nested delimiters.
const quotedStructuredField =
  /((["'])(?:\\.|(?!\2)[^\\\r\n])*\2)(\s*:\s*)(\{|\[)/gu;

function redactStructuredCredentialValues(input: string): string {
  let output = "";
  let cursor = 0;
  quotedStructuredField.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = quotedStructuredField.exec(input)) !== null) {
    const key = match[1]!;
    if (!isSensitiveQuotedKey(key)) continue;

    const valueStart = match.index + match[0].length - 1;
    const stack: string[] = [];
    let quote: string | null = null;
    let escaped = false;
    // An unmatched or truncated container is private through end-of-input.
    let valueEnd = input.length;
    for (let index = valueStart; index < input.length; index++) {
      const char = input[index]!;
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "[" || char === "{") {
        stack.push(char);
        continue;
      }
      if (char === "]" || char === "}") {
        const open = stack.pop();
        if ((char === "]" && open !== "[") || (char === "}" && open !== "{"))
          break;
        if (stack.length === 0) {
          valueEnd = index + 1;
          break;
        }
      }
    }
    const replacementQuote = key.startsWith("'") ? "'" : '"';
    output +=
      input.slice(cursor, valueStart) +
      replacementQuote +
      "[REDACTED_SECRET]" +
      replacementQuote;
    cursor = valueEnd;
    quotedStructuredField.lastIndex = valueEnd;
  }
  return output + input.slice(cursor);
}

// A quoted sensitive value can contain an actual LF/CR even though that is
// malformed JSON. The ordinary line-scoped redactor stops at that line break,
// exposing the remaining credential in the persisted support description.
// Consume the *whole* value, or fail closed on the entire malformed diagnostic
// when its end cannot be established without guessing a safe boundary.
const quotedValueStart = /((["'])(?:\\.|(?!\2)[^\\\r\n])*\2)(\s*:\s*(["']))/gu;

// A bare log-style key such as password: "..." has no quoted JSON key.
// The ordinary line-level regex would mask only the first physical line.
// If its quoted credential spans a raw LF/CR, no trustworthy free-text
// suffix boundary exists: discard the entire diagnostic, never its tail.
// Recognize the entire sensitive bare key, even with a long prefix, and
// the same Unicode whitespace as the fallback first-line secret redactor.
// Also recognize log-escaped quote openers. Fail closed on line breaks,
// including those between the key and value, before redaction can leak a tail.
const bareQuotedCredentialValueStart =
  /\b([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(?:\\*)(["'])/gu;

function hasBareQuotedMultilineCredential(input: string): boolean {
  bareQuotedCredentialValueStart.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = bareQuotedCredentialValueStart.exec(input)) !== null) {
    if (!sensitiveJsonKey.test(match[1]!)) continue;
    // A CR/LF before the opening quote is just as ambiguous as one inside it.
    if (/[\r\n]/u.test(match[0])) return true;
    const quote = match[2]!;
    let escaped = false;
    let closed = false;
    for (
      let index = bareQuotedCredentialValueStart.lastIndex;
      index < input.length;
      index++
    ) {
      const char = input[index]!;
      // The basic token matcher stops at whitespace, commas and semicolons.
      // A partial replacement would disclose the rest of this credential.
      if (/[\s,;]/u.test(char)) return true;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        closed = true;
        break;
      }
    }
    // An unterminated quoted secret has no trustworthy value boundary.
    if (!closed) return true;
  }
  return false;
}

function redactMultilineQuotedSecrets(input: string): string {
  if (hasBareQuotedMultilineCredential(input)) return "[REDACTED_SECRET]";
  let output = "";
  let cursor = 0;
  let changed = false;
  quotedValueStart.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = quotedValueStart.exec(input)) !== null) {
    if (!isSensitiveQuotedKey(match[1]!)) continue;
    const quote = match[4]!;
    const valueStart = match.index + match[0].length - 1;
    let escaped = false;
    let rawNewline = false;
    let closingIndex = -1;
    for (let index = valueStart + 1; index < input.length; index++) {
      const char = input[index]!;
      if (char === "\n" || char === "\r") rawNewline = true;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        closingIndex = index;
        break;
      }
    }
    if (!rawNewline) continue;
    changed = true;
    output +=
      input.slice(cursor, valueStart) +
      quote +
      "[REDACTED_SECRET]" +
      (closingIndex >= 0 ? quote : "");
    cursor = closingIndex >= 0 ? closingIndex + 1 : input.length;
    quotedValueStart.lastIndex = cursor;
  }
  if (!changed) return input;
  output += input.slice(cursor);
  // A well-formed outer envelope or a JSON object pasted after a diagnostic
  // prefix has a provable end. Otherwise an apparent closing quote might be
  // just part of the credential: retaining any residual text would be unsafe.
  const objectStart = output.indexOf("{");
  const arrayStart = output.indexOf("[");
  const firstContainer = Math.min(
    objectStart < 0 ? output.length : objectStart,
    arrayStart < 0 ? output.length : arrayStart,
  );
  // A verified severity prefix like "[ERROR] " is not a JSON array.
  // Strip only these known-safe log labels before validation; arbitrary
  // bracketed text cannot establish a trusted boundary for a damaged secret.
  const safeLogPrefix = output.match(
    /^\[(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\][ \t]+/iu,
  )?.[0];
  const candidate = safeLogPrefix
    ? output.slice(safeLogPrefix.length)
    : firstContainer < output.length
      ? output.slice(firstContainer)
      : output;
  try {
    JSON.parse(candidate);
    return output;
  } catch {
    return "[REDACTED_SECRET]";
  }
}

function redactAccidentalSecretsBasic(input: string): string {
  // A bare credential key followed by an object/array has no trustworthy
  // token boundary. The fallback regex would mask only the opening bracket
  // and persist the nested secret. Discard that diagnostic in full.
  const bareStructuredCredential =
    /\b([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*[\[{]/gu;
  for (const match of input.matchAll(bareStructuredCredential)) {
    if (sensitiveJsonKey.test(match[1]!)) return "[REDACTED_SECRET]";
  }

  const stringsRedacted = redactMultilineQuotedSecrets(input).replace(
    quotedStringField,
    (field, encodedKey: string, _keyQuote: string, delimiter: string) =>
      isSensitiveQuotedKey(encodedKey)
        ? encodedKey + delimiter + "[REDACTED_SECRET]"
        : field,
  );
  const scalarsRedacted = stringsRedacted.replace(
    quotedJsonScalarField,
    (field, encodedKey: string, delimiter: string) =>
      isSensitiveQuotedKey(encodedKey)
        ? encodedKey + delimiter + '"[REDACTED_SECRET]"'
        : field,
  );
  const pseudoScalarsRedacted = scalarsRedacted.replace(
    singleQuotedScalarField,
    (field, encodedKey: string, delimiter: string) =>
      isSensitiveQuotedKey(encodedKey)
        ? encodedKey + delimiter + "'[REDACTED_SECRET]'"
        : field,
  );
  return secretPatterns.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    redactStructuredCredentialValues(pseudoScalarsRedacted),
  );
}

// User-provided diagnostic text may contain a JSON object serialized inside
// another JSON string. Decode only valid JSON envelopes and inspect their
// string values; retain the original formatting when nothing needs masking.
const MAX_EMBEDDED_JSON_DEPTH = 24;

function redactEmbeddedDiagnosticJson(input: string, depth: number): string {
  const basic = redactAccidentalSecretsBasic(input);
  if (depth >= MAX_EMBEDDED_JSON_DEPTH) return "[REDACTED_SECRET]";
  try {
    JSON.parse(basic);
  } catch {
    // A complete JSON envelope preceded by diagnostic prose is still safe
    // to parse independently. The prefix is retained; nested string values
    // are processed by the same bounded redactor as ordinary JSON.
    const objectStart = basic.indexOf("{");
    const arrayStart = basic.indexOf("[");
    const candidateStart = Math.min(
      objectStart < 0 ? basic.length : objectStart,
      arrayStart < 0 ? basic.length : arrayStart,
    );
    if (candidateStart > 0 && candidateStart < basic.length) {
      const candidate = basic.slice(candidateStart);
      try {
        JSON.parse(candidate);
        return (
          basic.slice(0, candidateStart) +
          redactEmbeddedDiagnosticJson(candidate, depth + 1)
        );
      } catch {
        // Damaged or truncated envelopes must not expose escaped embedded
        // JSON credentials whose keys are hidden behind backslash quotes.
      }
    }
    const hasNestedEscapes =
      basic.includes('\\"') ||
      basic.includes("\\'") ||
      /\\u002[27]/iu.test(basic);
    if (hasNestedEscapes && (basic.includes("{") || basic.includes("[")))
      return "[REDACTED_SECRET]";
    // Ordinary text and pseudo-JSON remain covered by the existing scrubbers.
    return basic;
  }

  // Never parse-and-reserialize the entire document after masking an
  // embedded string: JSON.parse loses integer precision above 2^53. Scan
  // validated JSON string tokens instead, replacing only changed string
  // values and leaving numeric fields and untouched lexemes byte-identical.
  // The depth limit counts encoded JSON within strings, not ordinary object
  // nesting, so a deeply nested *safe* document is never erased by the guard.
  let rewritten = "";
  let cursor = 0;
  for (const match of basic.matchAll(/"(?:\\.|[^"\\])*"/gu)) {
    const start = match.index;
    const encoded = match[0];
    let following = start + encoded.length;
    while (following < basic.length && /\s/u.test(basic[following]!))
      following++;
    if (basic[following] === ":") continue; // JSON object key, not value

    const literal = JSON.parse(encoded) as string;
    const sanitized = redactEmbeddedDiagnosticJson(literal, depth + 1);
    if (literal === sanitized) continue;
    rewritten += basic.slice(cursor, start) + JSON.stringify(sanitized);
    cursor = start + encoded.length;
  }
  return cursor === 0 ? basic : rewritten + basic.slice(cursor);
}

export function redactAccidentalSecrets(input: string): string {
  return redactEmbeddedDiagnosticJson(input, 0);
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
    const diagnostics = sanitizeDiagnostics(body.diagnostics);
    const result = await this.repository.createCase({
      userId,
      // Never carry the raw user description across the repository boundary
      // inside an auxiliary copy of the validated request body.
      body: { ...body, description, diagnostics: diagnostics ?? undefined },
      description,
      diagnostics,
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
    if (!body || body.length > 4000)
      return { ok: false, code: "INVALID_REQUEST" };
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
    if (!body || body.length > 4000)
      return { ok: false, code: "INVALID_REQUEST" };
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
    batchSize: number;
    statementTimeoutMs: number;
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
