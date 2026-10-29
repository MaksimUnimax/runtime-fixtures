import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { z } from "zod";

/**
 * Internal B14 metadata projection, not connected to a public HTTP endpoint.
 * The prepared database reader selects the latest accepted sync entity in the
 * authorized account and extracts only these scalar fields. Passing the raw
 * sync state or a receipt is not supported.
 */
export type B14StoreMetadataInput = Readonly<{
  accountId: unknown;
  entityId: unknown;
  kind: unknown;
  lifecycleState: unknown;
  storeId: unknown;
  marketplace: unknown;
  name: unknown;
  providerAccountId: unknown;
  providerIdentityState: unknown;
  metadataRevision: unknown;
  serverRevision: unknown;
  updatedAt: unknown;
}>;

export type B14StoreMetadata = Readonly<{
  storeId: string;
  marketplace: "ozon" | "wildberries";
  name: string | null;
  providerAccountId: string | null;
  providerIdentityState: "CONFIRMED" | "UNCONFIRMED";
  metadataRevision: number;
  serverRevision: number;
  updatedAt: string;
}>;

export type B14StoreProjectionResult =
  | { kind: "OK"; value: B14StoreMetadata }
  | { kind: "INVALID_STORE_METADATA" };

export type B14StoreCursor = Readonly<{
  v: 1;
  accountId: string;
  entityId: string;
}>;

const MAX_ENTITY_ID_LENGTH = 128;
const MAX_CURSOR_LENGTH = 1024;
const MAX_PG_INTEGER = 2_147_483_647;
const MAX_FOUR_DIGIT_UTC_TIME = 253_402_300_799_999;
const accountIdSchema = z.uuid().transform((value) => value.toLowerCase());

// Reject control/format characters, isolated UTF-16 surrogates and Unicode
// line/paragraph separators. Do not remove them and silently change an ID.
const hiddenOrInvalidText = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function boundedIdentifier(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/\s/u.test(value) &&
    !hiddenOrInvalidText.test(value)
  );
}

function storeEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ENTITY_ID_LENGTH &&
    value.startsWith("store:") &&
    boundedIdentifier(value.slice("store:".length), 128)
  );
}

const timestampTextSchema = z.string().datetime({ offset: true });
const timestampSchema = z
  .preprocess((value) => {
    if (typeof value === "string") {
      const parsed = timestampTextSchema.safeParse(value);
      return parsed.success ? Date.parse(parsed.data) : undefined;
    }
    try {
      return Date.prototype.getTime.call(value);
    } catch {
      // Keep hostile Date-shaped objects out of validation diagnostics too:
      // a union's error formatter may inspect their arrays/prototypes.
      return undefined;
    }
  }, z.number().int().min(0).max(MAX_FOUR_DIGIT_UTC_TIME))
  .transform((value) => new Date(value).toISOString());

// A SQL NULL or unexpected primitive cannot establish a provider identity.
// Structured values are rejected rather than stringified or copied to output.
const scalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const inputSchema = z
  .object({
    accountId: accountIdSchema,
    entityId: z.string().refine(storeEntityId),
    kind: z.literal("STORE_UPSERT"),
    lifecycleState: z.literal("ACTIVE"),
    storeId: z.string().refine((value) => boundedIdentifier(value, 128)),
    marketplace: z.enum(["ozon", "wildberries"]),
    name: z.string().min(1).max(80),
    providerAccountId: scalarSchema,
    providerIdentityState: scalarSchema,
    metadataRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    // Accepted STORE_UPSERT starts at 1; the actual durable column is int4.
    serverRevision: z.number().int().positive().max(MAX_PG_INTEGER),
    // Date is the timestamp-valued scalar returned by node-postgres. A string
    // must be a strict timestamp with a timezone, not Date.parse's loose input.
    updatedAt: timestampSchema,
  })
  .strict()
  .refine((value) => value.entityId === `store:${value.storeId}`);

// A narrow safeguard for recognizable credential-shaped labels. This is not
// a general secret detector and does not prove arbitrary user text is safe.
const explicitCredentialLabel =
  /(?:\b(?:api[ _-]?key|private[ _-]?key|secret[ _-]?key|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|password|authorization|secret)["']?\s*[:=]|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;

function hasExplicitCredential(value: string): boolean {
  // Compatibility normalization is for detection only. Never normalize an ID
  // into validity or replace the user's public spelling with this value.
  return explicitCredentialLabel.test(value.normalize("NFKC"));
}

function publicStoreLabel(value: string): string | null {
  if (hiddenOrInvalidText.test(value)) return null;
  const normalized = value.trim().normalize("NFC");
  if (
    !normalized ||
    normalized.length > 80 ||
    hiddenOrInvalidText.test(normalized) ||
    hasExplicitCredential(normalized)
  )
    return null;
  return normalized;
}

/**
 * Explicit output allowlist. The name is the designated public store label,
 * not arbitrary diagnostics: render it as plain text. Unsafe labels are wholly
 * withheld (null); a normal-looking string can still contain user-entered
 * sensitive data, which this projection cannot reliably recognize.
 *
 * CONFIRMED repeats accepted client metadata only when accompanied by a valid
 * bounded ID. It does not mean the server contacted a marketplace, verified a
 * credential, or knows whether credentials exist on any installation.
 */
export function projectB14StoreMetadata(
  input: unknown,
  expectedAccountId: unknown,
): B14StoreProjectionResult {
  const account = accountIdSchema.safeParse(expectedAccountId);
  const parsed = inputSchema.safeParse(input);
  if (
    !account.success ||
    !parsed.success ||
    parsed.data.accountId !== account.data
  )
    return { kind: "INVALID_STORE_METADATA" };
  const value = parsed.data;
  const confirmed =
    value.providerIdentityState === "CONFIRMED" &&
    boundedIdentifier(value.providerAccountId, 128) &&
    // Same identifier alphabet as confirmProviderIdentity in store catalog.
    /^[A-Za-z0-9._:-]{1,128}$/u.test(value.providerAccountId) &&
    !hasExplicitCredential(value.providerAccountId);
  return {
    kind: "OK",
    value: {
      storeId: value.storeId,
      marketplace: value.marketplace,
      name: publicStoreLabel(value.name),
      providerAccountId: confirmed ? (value.providerAccountId as string) : null,
      providerIdentityState: confirmed ? "CONFIRMED" : "UNCONFIRMED",
      metadataRevision: value.metadataRevision,
      serverRevision: value.serverRevision,
      updatedAt: value.updatedAt,
    },
  };
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    accountId: accountIdSchema,
    entityId: z.string().refine(storeEntityId),
  })
  .strict();

function cursorJson(value: B14StoreCursor): string {
  return JSON.stringify({
    v: 1,
    accountId: value.accountId,
    entityId: value.entityId,
  });
}

export function encodeB14StoreCursor(
  accountId: unknown,
  entityId: unknown,
): string | null {
  const value = cursorSchema.safeParse({ v: 1, accountId, entityId });
  if (!value.success) return null;
  const cursor = Buffer.from(cursorJson(value.data), "utf8").toString(
    "base64url",
  );
  return cursor.length <= MAX_CURSOR_LENGTH ? cursor : null;
}

/**
 * Canonical, unpadded base64url of exactly {v:1,accountId,entityId}. Rejects
 * unknown/duplicate keys, invalid UTF-8, alternate encodings and account reuse.
 * Opaque means a client must round-trip it; it is not encrypted, signed, or an
 * authorization token. A repository must still check that the cursor
 * exists in the requested account's ACTIVE STORE_UPSERT SQL result set.
 */
export function decodeB14StoreCursor(
  cursor: unknown,
  expectedAccountId: unknown,
): B14StoreCursor | null {
  const account = accountIdSchema.safeParse(expectedAccountId);
  if (
    !account.success ||
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(cursor)
  )
    return null;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) return null;
    // Keep a BOM visible so JSON parsing rejects it instead of silently
    // accepting a second byte representation of the canonical cursor.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const parsed = cursorSchema.safeParse(JSON.parse(text) as unknown);
    if (
      !parsed.success ||
      parsed.data.accountId !== account.data ||
      cursorJson(parsed.data) !== text
    )
      return null;
    return {
      v: 1,
      accountId: parsed.data.accountId,
      entityId: parsed.data.entityId,
    };
  } catch {
    // Never reflect malformed cursor contents or parser errors into output.
    return null;
  }
}
