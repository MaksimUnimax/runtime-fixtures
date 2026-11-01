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
];

// Decode quoted JSON keys before classifying credential fields. Unicode
// escaped keys like "access\u005ftoken" are equivalent to "access_token".
// Match quoted keys and values independently of quote style, including
// truncated values at end of input or line. Preserve closing value quotes.
const quotedStringField =
  /((["'])(?:\\[\s\S]|(?!\2)[^\\])*\2)([\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*(["']))(?:\\.|\\(?=[\r\n]|$)|(?!\4)[^\\\r\n])*(?=\4|[\r\n]|$)/gu;
// Numeric/boolean/null diagnostics can also be truncated or pseudo-JSON.
const quotedJsonScalarField =
  /("(?:\\[\s\S]|[^"\\])*")([\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=[\p{White_Space}\p{Cc}\p{Cf}]*(?:[,}\]]|[\r\n]|$))/gu;
const singleQuotedScalarField =
  /('(?:\\[\s\S]|[^'\\])*')([\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=[\p{White_Space}\p{Cc}\p{Cf}]*(?:[,}\]]|[\r\n]|$))/gu;
const sensitiveJsonKey =
  /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookies?|set[-_]?cookie)$/iu;

function normalizedCredentialKey(key: string): string {
  return key.normalize("NFKC").replace(/[\p{White_Space}\p{Cc}\p{Cf}]/gu, "");
}

// Framing and recursive cleanup share this source-preserving grammar. It
// accepts JSON tokens, single-quoted diagnostic strings and formatting
// separators outside strings. A well-formed truncated prefix can be cleaned,
// but only a complete document with decoded strings may bypass bare scanning.
type DiagnosticString = {
  start: number;
  end: number;
  quote: '"' | "'";
  value: string | null;
  closed: boolean;
  key: boolean;
};
type DiagnosticField = {
  key: DiagnosticString;
  start: number;
  end: number;
};
type DiagnosticDocument = {
  start: number;
  strings: DiagnosticString[];
  fields: DiagnosticField[];
  complete: boolean;
};
const diagnosticWhitespace = /[\p{White_Space}\p{Cc}\p{Cf}]/u;

function readDiagnosticString(input: string, start: number): DiagnosticString {
  const quote = input[start] as '"' | "'";
  let index = start + 1;
  let closed = false;
  while (index < input.length) {
    const char = input[index++]!;
    if (char === "\\") {
      if (index < input.length) index++;
    } else if (char === quote) {
      closed = true;
      break;
    }
  }
  const contentEnd = closed ? index - 1 : index;
  let validation = '"';
  let valid = true;
  for (let cursor = start + 1; cursor < contentEnd; cursor++) {
    const char = input[cursor]!;
    if (char === "\\") {
      const escaped = input[++cursor];
      if (escaped === undefined || cursor >= contentEnd) {
        valid = false;
        break;
      }
      validation += quote === "'" && escaped === "'" ? "'" : "\\" + escaped;
    } else {
      // Diagnostic strings may contain physical line breaks. Decode them
      // without treating a line break as the end of a value; the same token
      // and recursive scrubber cover its whole, proven quoted/EOF range.
      validation +=
        char.charCodeAt(0) < 0x20
          ? JSON.stringify(char).slice(1, -1)
          : char === '"'
            ? '\\"'
            : char;
    }
  }
  let value: string | null = null;
  if (valid) {
    try {
      value = JSON.parse(validation + '"') as string;
    } catch {
      // Undecodable strings are opaque: cleanup masks the whole value.
    }
  }
  return { start, end: index, quote, value, closed, key: false };
}

function readDiagnosticDocument(
  input: string,
  start: number,
): DiagnosticDocument | undefined {
  type Frame = {
    kind: "root" | "object" | "array";
    state:
      | "value"
      | "end"
      | "keyOrEnd"
      | "key"
      | "colon"
      | "commaOrEnd"
      | "valueOrEnd";
    key?: DiagnosticString;
    field?: DiagnosticField;
  };
  const frames: Frame[] = [{ kind: "root", state: "value" }];
  const strings: DiagnosticString[] = [];
  const fields: DiagnosticField[] = [];
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let index = start;
  let started = false;
  while (index < input.length) {
    if (diagnosticWhitespace.test(input[index]!)) {
      index++;
      continue;
    }
    const frame = frames[frames.length - 1]!;
    const char = input[index]!;
    if (frame.state === "end") return undefined;
    if (
      (frame.state === "keyOrEnd" && char === "}") ||
      (frame.state === "valueOrEnd" && char === "]") ||
      (frame.state === "commaOrEnd" &&
        char === (frame.kind === "object" ? "}" : "]"))
    ) {
      index++;
      const ended = frames.pop()!;
      if (ended.field) ended.field.end = index;
      continue;
    }
    if (frame.state === "commaOrEnd") {
      if (char !== ",") return undefined;
      frame.state = frame.kind === "object" ? "key" : "value";
      frame.key = undefined;
      index++;
      continue;
    }
    if (frame.state === "key" || frame.state === "keyOrEnd") {
      if (char !== '"' && char !== "'") return undefined;
      const token = readDiagnosticString(input, index);
      token.key = true;
      strings.push(token);
      frame.key = token;
      frame.state = "colon";
      index = token.end;
      continue;
    }
    if (frame.state === "colon") {
      if (char !== ":") return undefined;
      frame.state = "value";
      index++;
      continue;
    }

    started = true;
    const field =
      frame.kind === "object" && frame.key
        ? { key: frame.key, start: index, end: input.length }
        : undefined;
    if (field) fields.push(field);
    frame.state = frame.kind === "root" ? "end" : "commaOrEnd";
    if (char === "{" || char === "[") {
      frames.push({
        kind: char === "{" ? "object" : "array",
        state: char === "{" ? "keyOrEnd" : "valueOrEnd",
        field,
      });
      index++;
    } else if (char === '"' || char === "'") {
      const token = readDiagnosticString(input, index);
      strings.push(token);
      index = token.end;
      if (field) field.end = index;
    } else {
      number.lastIndex = index;
      const numeric = number.exec(input);
      const literal = ["true", "false", "null"].find((value) =>
        input.startsWith(value, index),
      );
      if (!numeric && !literal) return undefined;
      index = numeric ? number.lastIndex : index + literal!.length;
      if (field) field.end = index;
    }
  }
  if (!started) return undefined;
  return {
    start,
    strings,
    fields,
    complete:
      frames.length === 1 &&
      frames[0]!.state === "end" &&
      strings.every((token) => token.closed),
  };
}

function diagnosticContainerStarts(input: string): number[] {
  const starts = [input.indexOf("{")];
  let index = input.indexOf("[");
  while (index >= 0) {
    // Generated redaction markers and log labels are not array framing.
    const label = input
      .slice(index)
      .match(
        /^\[(?:REDACTED_[A-Z_]+|TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/u,
      );
    if (!label) break;
    index = input.indexOf("[", index + label[0].length);
  }
  starts.push(index);
  return starts.filter((value) => value >= 0);
}

function findDiagnosticDocument(
  input: string,
  framingOnly = false,
): DiagnosticDocument | undefined {
  const starts = [...new Set([0, ...diagnosticContainerStarts(input)])].sort(
    (left, right) => left - right,
  );
  for (const start of starts) {
    const document = readDiagnosticDocument(input, start);
    if (
      document &&
      (!framingOnly ||
        (document.complete &&
          document.strings.every((token) => token.value !== null)))
    )
      return document;
  }
  return undefined;
}

// A bare credential's whitespace/comma/semicolon suffix has no proven end.
// Preserve prose before the assignment and redact the complete private remainder.
// Valid JSON envelopes are handled recursively at decoded string boundaries,
// retaining their siblings and exact numeric lexemes instead of cutting JSON.
function redactUnquotedCredentialValues(input: string): string {
  const envelopeStart =
    findDiagnosticDocument(input, true)?.start ?? input.length;
  const assignment =
    /(?:("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(?<![\p{L}\p{N}_])([\p{L}_][\p{L}\p{N}_\-\p{White_Space}\p{Cc}\p{Cf}]*))[\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*/gu;
  let rewritten = "",
    cursor = 0;
  for (const match of input.matchAll(assignment)) {
    if (match.index < cursor) continue;
    if (match.index >= envelopeStart) break;
    const quotedKey = match[1];
    const key = quotedKey ? null : normalizedCredentialKey(match[2]!);
    if (
      quotedKey
        ? !isSensitiveQuotedKey(quotedKey)
        : !sensitiveJsonKey.test(key!) || /authorization$/iu.test(key!)
    )
      continue;
    const start = match.index + match[0].length;
    // Structured values have their own balanced-delimiter redactor. Typed
    // scalars are safe only inside the complete envelope verified above;
    // otherwise numeric/boolean/null prefixes do not delimit a private tail.
    if (quotedKey && (input[start] === "{" || input[start] === "[")) continue;
    const quoted = input
      .slice(start)
      .match(/^(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/u);
    if (quoted) {
      // A complete single-line quoted value has a verified delimiter. The
      // earlier multiline guard rejects whitespace/ambiguous quoted tails.
      rewritten +=
        input.slice(cursor, start) +
        quoted[1] +
        "[REDACTED_SECRET]" +
        quoted[1];
      cursor = start + quoted[0].length;
      continue;
    }
    return rewritten + input.slice(cursor, start) + "[REDACTED_SECRET]";
  }
  return rewritten + input.slice(cursor);
}

function isSensitiveQuotedKey(encodedKey: string): boolean {
  const token = readDiagnosticString(encodedKey, 0);
  return (
    !token.closed ||
    token.end !== encodedKey.length ||
    token.value === null ||
    sensitiveJsonKey.test(normalizedCredentialKey(token.value))
  );
}

// A sensitive quoted JSON or pseudo-JSON field may hold an array/object,
// not just a scalar. Consume that entire value without swallowing subsequent
// sibling metadata, respecting quotes, escapes and nested delimiters.
const quotedStructuredField =
  /((["'])(?:\\[\s\S]|(?!\2)[^\\])*\2)([\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*)(\{|\[)/gu;

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
const quotedValueStart =
  /((["'])(?:\\[\s\S]|(?!\2)[^\\])*\2)([\p{White_Space}\p{Cc}\p{Cf}]*[:=\uFF1A\uFF1D][\p{White_Space}\p{Cc}\p{Cf}]*(["']))/gu;

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
    if (!sensitiveJsonKey.test(normalizedCredentialKey(match[1]!))) continue;
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
  const stringsRedacted = redactUnquotedCredentialValues(
    redactMultilineQuotedSecrets(input),
  ).replace(
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

function encodeDiagnosticString(
  value: string,
  quote: '"' | "'",
  closed = true,
): string {
  const json = JSON.stringify(value);
  const encoded =
    quote === '"' ? json : "'" + json.slice(1, -1).replace(/'/gu, "\\'") + "'";
  return closed ? encoded : encoded.slice(0, -1);
}

function redactEmbeddedDiagnosticJson(input: string, depth: number): string {
  const basic = redactAccidentalSecretsBasic(input);
  if (depth >= MAX_EMBEDDED_JSON_DEPTH) return "[REDACTED_SECRET]";
  const document = findDiagnosticDocument(basic);
  if (!document) {
    // Unsupported structured forms cannot promise decoded-string coverage.
    // Ordinary prose still uses the unframed, private-through-EOF scrubber.
    if (
      diagnosticContainerStarts(basic).some((start) =>
        /["'=:：＝\\]/u.test(basic.slice(start)),
      )
    )
      return "[REDACTED_SECRET]";
    return basic;
  }

  const privateFields = document.fields
    .filter(
      (field) =>
        field.key.value === null ||
        sensitiveJsonKey.test(normalizedCredentialKey(field.key.value)),
    )
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const field of privateFields) {
    if (
      edits.some((edit) => edit.start <= field.start && edit.end >= field.end)
    )
      continue;
    const first = basic[field.start];
    const quote = first === "'" || first === '"' ? first : field.key.quote;
    edits.push({
      start: field.start,
      end: field.end,
      replacement: encodeDiagnosticString("[REDACTED_SECRET]", quote),
    });
  }
  for (const token of document.strings) {
    if (
      edits.some((edit) => edit.start <= token.start && edit.end >= token.end)
    )
      continue;
    // An undecodable identifier-shaped label may retain its spelling while
    // its entire value is private. Opaque free text or Unicode-escaped labels
    // cannot prove that they contain no assignment/value, so mask them too.
    if (
      token.value === null &&
      token.key &&
      privateFields.some((field) => field.key === token) &&
      /^(?:[\p{L}\p{N}_-]|\\(?!u)[A-Za-z])+$/u.test(
        basic.slice(token.start + 1, token.end - (token.closed ? 1 : 0)),
      )
    )
      continue;
    const sanitized =
      token.value === null
        ? "[REDACTED_SECRET]"
        : redactEmbeddedDiagnosticJson(token.value, depth + 1);
    if (sanitized === token.value) continue;
    edits.push({
      start: token.start,
      end: token.end,
      replacement: encodeDiagnosticString(sanitized, token.quote, token.closed),
    });
  }

  // A strictly shorter prefix is cleaned too; log labels remain ordinary
  // prose. Only string substitutions touch the document: numeric lexemes,
  // original quote styles, separators and untouched metadata are retained.
  let rewritten =
    document.start === 0
      ? ""
      : redactEmbeddedDiagnosticJson(basic.slice(0, document.start), depth);
  let cursor = document.start;
  for (const edit of edits.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    if (edit.start < cursor) continue;
    rewritten += basic.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return rewritten + basic.slice(cursor);
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
