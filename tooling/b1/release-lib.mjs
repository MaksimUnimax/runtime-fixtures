/* global Buffer, TextDecoder, URL */

import { createHash, createPublicKey } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const AUTHORITY_SCHEMA = "octoport_release_authority_v1";
const CANDIDATE_SCHEMA = "b1_release_candidate_v2";
const MAX_AUTHORITY_BYTES = 1024 * 1024;
const MAX_CANDIDATE_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
// Bound ancestor-prefix work for portable cross-browser release archives.
const MAX_ZIP_PATH_SEGMENTS = 128;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const PACKAGED_CONFIG_MARKER = "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=";
const FIREFOX_STORE_ID = "octoport@octoport.ru";
const STORE_REVIEW_ENVIRONMENT = "PREPRODUCTION";
const STORE_BACKGROUND_FORBIDDEN_MARKERS = [
  Buffer.from("LOCAL DEVELOPMENT"),
  Buffer.from("http://127.0.0.1:43100"),
  Buffer.from("http://127.0.0.1:43101"),
  Buffer.from("config-local-development"),
];
const STORE_POPUP_FORBIDDEN_MARKERS = [
  Buffer.from("LOCAL DEVELOPMENT"),
  Buffer.from("Локальная разработка"),
];
const PRIVATE_KEY_MARKER = Buffer.from("-----BEGIN");

const fail = (message) => {
  throw new Error(message);
};

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function canonical(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("Non-canonical numeric value");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  fail("Invalid canonical value");
}

function canonicalCandidatePath(candidateDir) {
  const target = resolve(candidateDir);
  if (existsSync(target)) return realpathSync(target);
  return join(realpathSync(dirname(target)), basename(target));
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + sep);
}

export function sourceIdentity() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  return {
    head: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
  };
}

export function productFacts() {
  const composition = JSON.parse(
    readFileSync(resolve(ROOT, "apps/extension/composition.json"), "utf8"),
  );
  const config = readFileSync(
    resolve(ROOT, "packages/control-client/src/config.js"),
    "utf8",
  );
  const contractVersion = config.match(/contractVersion:\s*"([^"]+)"/)?.[1];
  const journal = JSON.parse(
    readFileSync(
      resolve(ROOT, "packages/server/db/drizzle/meta/_journal.json"),
      "utf8",
    ),
  );
  const last = journal.entries?.at(-1);
  const migrationMatch =
    typeof last?.tag === "string" ? last.tag.match(/^(\d{4})_/) : null;
  const migrationLevel = migrationMatch ? Number(migrationMatch[1]) : NaN;
  const migrationFile = Number.isSafeInteger(migrationLevel)
    ? resolve(ROOT, "packages/server/db/drizzle", `${last.tag}.sql`)
    : "";

  if (
    typeof composition.version !== "string" ||
    !contractVersion ||
    !Number.isSafeInteger(migrationLevel) ||
    !existsSync(migrationFile)
  ) {
    fail("Repository release facts are incomplete");
  }

  return {
    productVersion: composition.version,
    contractVersion,
    migrationLevel,
  };
}

function canonicalHttpsOrigin(value) {
  if (typeof value !== "string") fail("Invalid authority origin");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("Invalid authority origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    fail("Invalid authority origin");
  }
  return value;
}

function validateTrustBundle(bundle) {
  if (
    !exactKeys(bundle, [
      "trustBundleVersion",
      "algorithm",
      "publicKeyFormat",
      "publicKeyEncoding",
      "fingerprintAlgorithm",
      "fingerprintEncoding",
      "keys",
    ]) ||
    bundle.trustBundleVersion !== "bootstrap_trust_bundle_v1" ||
    bundle.algorithm !== "Ed25519" ||
    bundle.publicKeyFormat !== "spki_der" ||
    bundle.publicKeyEncoding !== "base64" ||
    bundle.fingerprintAlgorithm !== "sha256" ||
    bundle.fingerprintEncoding !== "lowercase_hex" ||
    !Array.isArray(bundle.keys) ||
    bundle.keys.length < 1 ||
    bundle.keys.length > 8
  ) {
    fail("Invalid authority trust bundle");
  }

  const keyIds = new Set();
  const fingerprints = new Set();
  let active = 0;

  for (const key of bundle.keys) {
    if (
      !exactKeys(key, [
        "keyId",
        "publicKey",
        "fingerprintSha256",
        "lifecycle",
        "trustEligibility",
      ]) ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key.keyId) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(key.publicKey) ||
      key.publicKey.length % 4 !== 0 ||
      !/^[a-f0-9]{64}$/.test(key.fingerprintSha256) ||
      !["ACTIVE", "RETIRED"].includes(key.lifecycle) ||
      key.trustEligibility !==
        (key.lifecycle === "ACTIVE"
          ? "SIGNING_AND_VERIFICATION"
          : "VERIFICATION_OVERLAP") ||
      keyIds.has(key.keyId) ||
      fingerprints.has(key.fingerprintSha256)
    ) {
      fail("Invalid authority trust key");
    }

    const der = Buffer.from(key.publicKey, "base64");
    if (
      !der.length ||
      der.toString("base64") !== key.publicKey ||
      sha256(der) !== key.fingerprintSha256
    ) {
      fail("Authority trust key fingerprint mismatch");
    }

    let publicKey;
    try {
      publicKey = createPublicKey({
        key: der,
        format: "der",
        type: "spki",
      });
    } catch {
      fail("Authority trust key is not valid SPKI");
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      fail("Authority trust key is not Ed25519");
    }

    keyIds.add(key.keyId);
    fingerprints.add(key.fingerprintSha256);
    if (key.lifecycle === "ACTIVE") active += 1;
  }

  if (!active) fail("Authority trust bundle has no active signing key");
  return bundle;
}

export function readAuthority(file, candidateDir) {
  const suppliedAuthorityPath = resolve(file);
  const candidatePath = canonicalCandidatePath(candidateDir);

  if (isInside(suppliedAuthorityPath, candidatePath)) {
    fail("Authority must be outside the candidate directory");
  }
  if (lstatSync(suppliedAuthorityPath).isSymbolicLink()) {
    fail("Authority symlink is not accepted");
  }

  const authorityPath = realpathSync(suppliedAuthorityPath);
  if (isInside(authorityPath, candidatePath)) {
    fail("Authority must be outside the candidate directory");
  }

  // Read the same bounded regular-file descriptor once. A size check before
  // readFileSync(path) can reopen a replaced or growing authority without a cap.
  const bytes = readBoundedRegularFile(
    authorityPath,
    MAX_AUTHORITY_BYTES,
    "Authority file",
  );
  let authority;
  try {
    authority = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Authority is invalid JSON");
  }

  if (
    !exactKeys(authority, [
      "schemaVersion",
      "source",
      "productVersion",
      "contractVersion",
      "migrationLevel",
      "environment",
      "origins",
      "trustBundle",
    ]) ||
    authority.schemaVersion !== AUTHORITY_SCHEMA ||
    !exactKeys(authority.source, ["head", "tree"]) ||
    !/^[a-f0-9]{40}$/.test(authority.source.head) ||
    !/^[a-f0-9]{40}$/.test(authority.source.tree) ||
    typeof authority.productVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(authority.productVersion) ||
    typeof authority.contractVersion !== "string" ||
    !/^[A-Za-z0-9_]{1,80}$/.test(authority.contractVersion) ||
    !Number.isSafeInteger(authority.migrationLevel) ||
    authority.migrationLevel < 0 ||
    authority.environment !== STORE_REVIEW_ENVIRONMENT ||
    !exactKeys(authority.origins, ["controlApiOrigin", "portalOrigin"])
  ) {
    fail("Invalid authority schema");
  }

  canonicalHttpsOrigin(authority.origins.controlApiOrigin);
  canonicalHttpsOrigin(authority.origins.portalOrigin);
  if (authority.origins.controlApiOrigin === authority.origins.portalOrigin) {
    fail("Control API and portal origins must be distinct");
  }
  validateTrustBundle(authority.trustBundle);

  const source = sourceIdentity();
  const facts = productFacts();
  if (
    authority.source.head !== source.head ||
    authority.source.tree !== source.tree
  ) {
    fail("Authority source identity is stale");
  }
  if (
    authority.productVersion !== facts.productVersion ||
    authority.contractVersion !== facts.contractVersion ||
    authority.migrationLevel !== facts.migrationLevel
  ) {
    fail("Authority product facts are stale");
  }

  return {
    value: authority,
    sha256: sha256(bytes),
  };
}

function safeDeclaredPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    path.includes("\\")
  ) {
    return false;
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return !parts.includes("..") && !parts.includes(".") && !parts.includes("");
}

function safePackageFilename(filename) {
  return (
    typeof filename === "string" &&
    filename === basename(filename) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/i.test(filename) &&
    // The output ZIP filename is a Windows path segment too.
    !unsafeWindowsZipSegment(filename)
  );
}

// Apply the same portable filename identity at preparation and preflight.
function collidingPackageFilenames(first, second) {
  return (
    typeof first === "string" &&
    typeof second === "string" &&
    first.normalize("NFC").toLowerCase() ===
      second.normalize("NFC").toLowerCase()
  );
}

function decodeZipName(bytes, utf8) {
  if (!utf8) return bytes.toString("latin1");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("Invalid UTF-8 ZIP entry name");
  }
}

// Minimal ZIP reader: no extraction, duplicate-preserving central-directory walk.
// Browser-release ZIP entry names use portable printable ASCII. This avoids
// Unicode casefold/normalization aliases between Windows extraction and ZIP
// duplicate detection while keeping non-ASCII file CONTENT fully supported.
// Win32 also treats device names, streams and trailing dots/spaces specially.
function unsafeWindowsZipSegment(segment) {
  if (/[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) {
    return true;
  }
  const deviceStem = segment.split(".", 1)[0].replace(/ +$/u, "");
  // Includes the console input/output devices and all one-digit port aliases
  // recognized by Win32's DOS-device name predicate.
  return /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9]|LPT[0-9])$/iu.test(
    deviceStem,
  );
}

export function readZip(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 22 ||
    bytes.length > MAX_ARCHIVE_BYTES
  ) {
    fail("Invalid ZIP size");
  }

  let eocd = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset -= 1
  ) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) {
    fail("Invalid ZIP end record");
  }

  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskCount = bytes.readUInt16LE(eocd + 8);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralStart = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);

  if (
    eocd + 22 + commentLength !== bytes.length ||
    // Store releases must not carry unchecked arbitrary comment bytes.
    commentLength !== 0 ||
    disk !== 0 ||
    centralDisk !== 0 ||
    diskCount !== count ||
    count === 0 ||
    count > MAX_ZIP_ENTRIES ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralStart === 0xffffffff ||
    // No unaccounted bytes may appear between the directory and EOCD.
    centralStart + centralSize !== eocd
  ) {
    fail("Unsupported ZIP directory");
  }

  const entries = new Map();
  const caseFoldedNames = new Set();
  // One segment node per distinct directory component; never retain O(depth²)
  // ancestor-prefix strings for each ZIP entry.
  const pathTree = new Map();
  const localRanges = [];
  let pointer = centralStart;
  let totalUncompressed = 0;

  for (let index = 0; index < count; index += 1) {
    if (
      pointer + 46 > centralStart + centralSize ||
      bytes.readUInt32LE(pointer) !== 0x02014b50
    ) {
      fail("Invalid ZIP central directory");
    }

    const madeBy = bytes.readUInt16LE(pointer + 4);
    const flags = bytes.readUInt16LE(pointer + 8);
    const method = bytes.readUInt16LE(pointer + 10);
    const crc = bytes.readUInt32LE(pointer + 16);
    const compressedSize = bytes.readUInt32LE(pointer + 20);
    const rawSize = bytes.readUInt32LE(pointer + 24);
    const nameLength = bytes.readUInt16LE(pointer + 28);
    const extraLength = bytes.readUInt16LE(pointer + 30);
    const commentEntryLength = bytes.readUInt16LE(pointer + 32);
    const externalAttributes = bytes.readUInt32LE(pointer + 38);
    const localOffset = bytes.readUInt32LE(pointer + 42);
    const end = pointer + 46 + nameLength + extraLength + commentEntryLength;

    if (end > centralStart + centralSize) {
      fail("Invalid ZIP central entry bounds");
    }
    // Only release file payloads are inspected for private material. Do not
    // permit opaque per-entry comments or extras outside those inspected bytes.
    if (extraLength !== 0 || commentEntryLength !== 0) {
      fail("Unsupported ZIP entry metadata");
    }

    const nameBytes = bytes.subarray(pointer + 46, pointer + 46 + nameLength);
    const name = decodeZipName(nameBytes, Boolean(flags & 0x800));
    const isDirectory = name.endsWith("/");
    const parts = isDirectory ? name.slice(0, -1).split("/") : name.split("/");

    if (
      !name ||
      /[^\x20-\x7e]/u.test(name) ||
      name.includes("\0") ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      parts.length > MAX_ZIP_PATH_SEGMENTS ||
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          unsafeWindowsZipSegment(part),
      )
    ) {
      fail("Unsafe ZIP path");
    }

    const folded = name.toLowerCase();
    if (entries.has(name) || caseFoldedNames.has(folded)) {
      fail("Duplicate ZIP entry");
    }
    caseFoldedNames.add(folded);

    // Enforce the case-insensitive extraction tree in either entry order.
    // A trie shares ancestor nodes between paths and bounds memory by the
    // archive's input segments instead of cumulative joined prefixes.
    let children = pathTree;
    for (let depth = 0; depth < parts.length; depth += 1) {
      const segment = parts[depth].toLowerCase();
      let node = children.get(segment);
      if (!node) {
        node = { children: new Map(), isFile: false, isDirectory: false };
        children.set(segment, node);
      }
      if (depth === parts.length - 1) {
        if (isDirectory) {
          if (node.isFile) fail("ZIP path hierarchy collision");
          node.isDirectory = true;
        } else {
          if (node.isDirectory || node.children.size > 0) {
            fail("ZIP path hierarchy collision");
          }
          node.isFile = true;
        }
      } else {
        if (node.isFile) fail("ZIP path hierarchy collision");
        children = node.children;
      }
    }

    // Only DOS/FAT creator host 0 gives the low external-attribute byte
    // DOS directory semantics. Unix-created ZIPs may use this byte differently.
    // Reject DOS-marked directories masquerading as files, but do not require
    // the optional flag on slash-terminated directory entries.
    if (
      madeBy >>> 8 === 0 &&
      !isDirectory &&
      (externalAttributes & 0x10) !== 0
    ) {
      fail("ZIP DOS directory attribute/path mismatch");
    }

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & 0xf000;
    // OS X (ZIP creator host 19) also uses POSIX file type bits.
    const unixLikeCreator = [3, 19].includes(madeBy >>> 8);
    if (
      unixLikeCreator &&
      fileType !== 0 &&
      fileType !== 0x8000 &&
      fileType !== 0x4000
    ) {
      fail("Unsupported special ZIP entry");
    }

    // An explicit Unix type must agree with the entry name. Otherwise a ZIP
    // can pass preflight as a file but be installed as a directory (or vice versa).
    if (
      unixLikeCreator &&
      ((fileType === 0x4000 && !isDirectory) ||
        (fileType === 0x8000 && isDirectory))
    ) {
      fail("ZIP Unix type/path mismatch");
    }

    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      rawSize > MAX_ENTRY_BYTES ||
      compressedSize > MAX_ARCHIVE_BYTES
    ) {
      fail("Unsupported ZIP entry");
    }
    // A browser ZIP installer must not assign different semantics to bytes
    // we have accepted. Permit only streaming descriptors (bit 3), UTF-8
    // names (bit 11), and standard deflate level hints (bits 1/2 for method 8).
    // In particular reject strong encryption, masked headers, patch records
    // and reserved flags even when local and central records agree.
    const recognizedFlags = 0x0808 | (method === 8 ? 0x0006 : 0);
    if ((flags & ~recognizedFlags) !== 0) {
      fail("Unsupported ZIP general-purpose flags");
    }
    totalUncompressed += rawSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      fail("ZIP uncompressed size exceeds limit");
    }

    if (
      localOffset + 30 > centralStart ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      fail("Invalid ZIP local header");
    }

    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCrc = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localRawSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if (localExtraLength !== 0) {
      fail("Unsupported ZIP local entry metadata");
    }
    const localName = bytes.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength,
    );
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;

    if (
      localFlags !== flags ||
      localMethod !== method ||
      !localName.equals(nameBytes) ||
      dataStart + compressedSize > centralStart
    ) {
      fail("ZIP local and central records differ");
    }

    // Account for every byte in the local-record section. A ZIP with an
    // executable prefix, unreferenced local data, overlap, or a hidden gap
    // must not be published merely because its central directory looks valid.
    const compressedEnd = dataStart + compressedSize;
    let possibleLocalEnds = [compressedEnd];
    if (flags & 0x08) {
      // Streaming ZIP writers use either three zero placeholders or three
      // complete local values. Mixed local metadata is not a supported form.
      const emptyLocal =
        localCrc === 0 && localCompressedSize === 0 && localRawSize === 0;
      const completeLocal =
        localCrc === crc &&
        localCompressedSize === compressedSize &&
        localRawSize === rawSize;
      if (!emptyLocal && !completeLocal) {
        fail("ZIP local and central records differ");
      }
      const descriptorCandidates = [compressedEnd];
      if (
        compressedEnd + 4 <= centralStart &&
        bytes.readUInt32LE(compressedEnd) === 0x08074b50
      ) {
        descriptorCandidates.push(compressedEnd + 4);
      }
      possibleLocalEnds = descriptorCandidates
        .filter(
          (offset) =>
            offset + 12 <= centralStart &&
            bytes.readUInt32LE(offset) === crc &&
            bytes.readUInt32LE(offset + 4) === compressedSize &&
            bytes.readUInt32LE(offset + 8) === rawSize,
        )
        .map((offset) => offset + 12);
      if (!possibleLocalEnds.length) {
        fail("Invalid ZIP data descriptor");
      }
    } else if (
      localCrc !== crc ||
      localCompressedSize !== compressedSize ||
      localRawSize !== rawSize
    ) {
      fail("ZIP local and central records differ");
    }
    // Defer signed/unsigned descriptor selection until the physical next
    // record boundary is known; CRC may itself equal the signature magic.
    localRanges.push({ start: localOffset, possibleEnds: possibleLocalEnds });

    const compressed = bytes.subarray(dataStart, compressedEnd);
    let data;
    let compressedBytesConsumed = compressed.length;
    try {
      if (method === 0) {
        data = compressed;
      } else {
        // inflateRawSync normally accepts a valid deflate stream followed by
        // unchecked garbage. Require the parser to consume every declared
        // compressed byte, not only to produce the expected raw CRC/length.
        const decoded = inflateRawSync(compressed, {
          maxOutputLength: Math.max(1, rawSize + 1),
          info: true,
        });
        data = decoded.buffer;
        compressedBytesConsumed = decoded.engine.bytesWritten;
      }
    } catch {
      fail("Invalid compressed ZIP entry");
    }
    if (compressedBytesConsumed !== compressed.length) {
      fail("Unconsumed compressed ZIP entry data");
    }

    if (data.length !== rawSize || crc32(data) !== crc) {
      fail("Corrupt ZIP entry");
    }
    if (isDirectory && data.length !== 0) {
      fail("ZIP directory entry contains data");
    }

    entries.set(name, data);
    pointer = end;
  }

  if (pointer !== centralStart + centralSize) {
    fail("Invalid ZIP directory size");
  }
  // The central directory can list entries in a different order from the
  // local records, so sort byte ranges before checking exact coverage.
  localRanges.sort((left, right) => left.start - right.start);
  let nextLocalOffset = 0;
  for (let index = 0; index < localRanges.length; index += 1) {
    const range = localRanges[index];
    const physicalEnd =
      index + 1 < localRanges.length
        ? localRanges[index + 1].start
        : centralStart;
    if (
      range.start !== nextLocalOffset ||
      physicalEnd <= range.start ||
      !range.possibleEnds.includes(physicalEnd)
    ) {
      fail("Unaccounted ZIP local data");
    }
    nextLocalOffset = physicalEnd;
  }
  if (nextLocalOffset !== centralStart) {
    fail("Unaccounted ZIP local data");
  }
  return entries;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_ICON_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DECLARED_ICON_BYTES = 2 * 1024 * 1024;
const MAX_DECLARED_ICON_DIMENSION = 512;

function validatePngIcon(data, declaredSize) {
  if (
    !Buffer.isBuffer(data) ||
    data.length < PNG_ICON_SIGNATURE.length + 12 ||
    data.length > MAX_DECLARED_ICON_BYTES ||
    !data.subarray(0, 8).equals(PNG_ICON_SIGNATURE)
  ) {
    fail("Declared PNG icon is invalid");
  }
  let offset = 8,
    width = null,
    imageDataLength = 0,
    endFound = false;
  const imageChunks = [];
  let chunks = 0,
    sawIdat = false,
    finishedIdat = false,
    sawPalette = false,
    sawBackground = false;
  while (offset < data.length) {
    if (++chunks > 256 || data.length - offset < 12) {
      fail("Declared PNG icon is invalid");
    }
    const length = data.readUInt32BE(offset);
    const stop = offset + length + 12;
    if (length > MAX_DECLARED_ICON_BYTES || stop > data.length) {
      fail("Declared PNG icon is invalid");
    }
    // Node's "ascii" decoder drops the high bit, accepting invalid PNG type
    // bytes as known critical chunks. Latin-1 preserves all byte values so the
    // alphabetic/reserved-bit check below fails closed.
    const type = data.toString("latin1", offset + 4, offset + 8);
    // Unknown critical chunks and out-of-order IDAT are not valid PNG images.
    // Ancillary metadata after a finished IDAT run is allowed, but no more IDAT.
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) {
      fail("Declared PNG icon chunk type invalid");
    }
    if (
      /^[A-Z]/.test(type) &&
      !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)
    ) {
      fail("PNG icon unsupported critical chunk");
    }
    // The Octoport STORE icon pipeline emits a deliberately constrained PNG
    // subset. Do not silently trust tRNS, tEXt or other ancillary payloads
    // whose format and placement are not verified by this release validator.
    if (!["IHDR", "PLTE", "bKGD", "IDAT", "IEND"].includes(type)) {
      fail("PNG icon unsupported chunk");
    }
    if (type !== "IDAT" && sawIdat) finishedIdat = true;
    if (
      crc32(data.subarray(offset + 4, offset + 8 + length)) !==
      data.readUInt32BE(offset + 8 + length)
    ) {
      fail("Declared PNG icon CRC invalid");
    }
    const payload = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (offset !== 8 || width !== null || length !== 13) {
        fail("Declared PNG icon header invalid");
      }
      width = payload.readUInt32BE(0);
      const height = payload.readUInt32BE(4);
      if (
        width < 1 ||
        width > MAX_DECLARED_ICON_DIMENSION ||
        width !== height ||
        (declaredSize !== null && declaredSize !== width) ||
        payload[8] !== 8 ||
        payload[9] !== 6 ||
        payload[10] !== 0 ||
        payload[11] !== 0 ||
        payload[12] !== 0
      ) {
        fail("Declared PNG icon dimensions or format invalid");
      }
    } else if (type === "PLTE") {
      if (
        width === null ||
        sawPalette ||
        sawIdat ||
        sawBackground ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768
      ) {
        fail("PNG icon palette order invalid");
      }
      sawPalette = true;
    } else if (type === "bKGD") {
      // For our non-interlaced RGBA8 release icons, bKGD is an optional
      // 6-byte truecolor RGB sample (zero high bytes), once and before IDAT.
      if (
        width === null ||
        sawIdat ||
        sawBackground ||
        length !== 6 ||
        payload[0] !== 0 ||
        payload[2] !== 0 ||
        payload[4] !== 0
      ) {
        fail("PNG icon background metadata invalid");
      }
      sawBackground = true;
    } else if (type === "IDAT") {
      if (width === null) fail("Declared PNG icon header invalid");
      if (finishedIdat) fail("PNG icon IDAT order invalid");
      sawIdat = true;
      imageDataLength += length;
      if (imageDataLength > MAX_DECLARED_ICON_BYTES) {
        fail("Declared PNG icon is invalid");
      }
      imageChunks.push(payload);
    } else if (type === "IEND") {
      if (
        width === null ||
        imageDataLength === 0 ||
        length !== 0 ||
        stop !== data.length
      ) {
        fail("Declared PNG icon is invalid");
      }
      endFound = true;
    }
    offset = stop;
    if (endFound) break;
  }
  if (!endFound || width === null) fail("Declared PNG icon is invalid");
  const stride = width * 4 + 1;
  const expectedBytes = stride * width;
  let decoded;
  let compressedBytesConsumed;
  try {
    const result = inflateSync(Buffer.concat(imageChunks), {
      maxOutputLength: expectedBytes + 1,
      info: true,
    });
    decoded = result.buffer;
    compressedBytesConsumed = result.engine.bytesWritten;
  } catch {
    fail("PNG icon pixel data invalid");
  }
  // Inflating to the expected pixel count alone is not enough: malformed IDAT
  // can carry unconsumed bytes after the zlib end marker with valid PNG CRC.
  if (compressedBytesConsumed !== imageDataLength) {
    fail("PNG icon compressed stream contains trailing bytes");
  }
  if (decoded.length !== expectedBytes) {
    fail("PNG icon pixel data invalid");
  }
  for (let row = 0; row < width; row += 1) {
    if (decoded[row * stride] > 4) fail("PNG icon filter invalid");
  }
}

function ensureDeclaredIcons(entries, manifest) {
  const declarations = [];
  for (const raw of [manifest.icons, manifest.action?.default_icon]) {
    if (raw === undefined) continue;
    if (typeof raw === "string") {
      declarations.push({ path: raw, size: null });
      continue;
    }
    if (
      !record(raw) ||
      Object.keys(raw).length === 0 ||
      Object.keys(raw).length > 16
    ) {
      fail("Declared icon map invalid");
    }
    for (const [sizeText, path] of Object.entries(raw)) {
      if (!/^[1-9][0-9]{0,3}$/.test(sizeText)) {
        fail("Declared icon size invalid");
      }
      const size = Number(sizeText);
      if (size > MAX_DECLARED_ICON_DIMENSION) {
        fail("Declared icon size invalid");
      }
      declarations.push({ path, size });
    }
  }
  for (const { path, size } of declarations) {
    if (!safeDeclaredPath(path) || !path.endsWith(".png")) {
      fail("Declared icon path invalid");
    }
    const data = entries.get(path);
    if (!data?.length) fail("Declared icon resource missing");
    validatePngIcon(data, size);
  }
}

const forbiddenSecretPath =
  /(^|[/])(?:\.env(?:\..*)?|[^/]*\.(?:pem|key|p8|p12|pfx)|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|secrets?\.json)$/i;
const privateKeyText = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;

function ensureNoPrivateMaterial(entries) {
  for (const [name, data] of entries) {
    if (name.endsWith("/")) continue;
    if (forbiddenSecretPath.test(name)) {
      fail("Package contains forbidden private-material path");
    }
    if (
      data.includes(PRIVATE_KEY_MARKER) &&
      privateKeyText.test(data.toString("utf8"))
    ) {
      fail("Package contains private key material");
    }
  }
}

function ensureNoStoreDevelopmentMaterial(entries, manifest, reachable) {
  for (const path of reachable) {
    const data = entries.get(path);
    if (
      STORE_BACKGROUND_FORBIDDEN_MARKERS.some((marker) => data.includes(marker))
    ) {
      fail("Package background contains development-only material");
    }
  }

  const popupPath = manifest.action?.default_popup;
  if (popupPath !== undefined) {
    if (!safeDeclaredPath(popupPath)) {
      fail("Extension popup declaration is invalid");
    }
    const popup = entries.get(popupPath);
    if (!popup?.length) {
      fail("Declared extension popup is missing or empty");
    }

    const popupResources = new Set([popupPath]);
    const popupSource = popup.toString("utf8");
    const referenceRegex = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi;
    for (const match of popupSource.matchAll(referenceRegex)) {
      const reference = match[2];
      if (!safeDeclaredPath(reference)) {
        fail("Popup references an unsafe resource path");
      }
      const resolved = join(dirname(popupPath), reference);
      if (!safeDeclaredPath(resolved) || !entries.get(resolved)?.length) {
        fail("Popup referenced resource is missing or unsafe");
      }
      popupResources.add(resolved);
    }

    for (const resource of popupResources) {
      const data = entries.get(resource);
      if (
        STORE_POPUP_FORBIDDEN_MARKERS.some((marker) => data.includes(marker))
      ) {
        fail("Package popup surface contains development-only material");
      }
    }
  }

  // Popup modules and styles can import additional packaged code that the
  // immediate HTML src/href scan does not enumerate. Check every executable
  // text asset, rather than trusting a partial import graph. ZIP entries and
  // total unpacked bytes are already bounded by readZip.
  for (const [name, data] of entries) {
    if (!/\.(?:js|mjs|cjs|html?|css)$/i.test(name)) continue;
    if (
      STORE_BACKGROUND_FORBIDDEN_MARKERS.some((marker) =>
        data.includes(marker),
      ) ||
      STORE_POPUP_FORBIDDEN_MARKERS.some((marker) => data.includes(marker))
    ) {
      fail("Package executable asset contains development-only material");
    }
  }
}

function escapedIdentifierChar(source, offset, expected) {
  if (source[offset] === expected) {
    return { next: offset + 1, escaped: false };
  }
  if (source[offset] !== "\\" || source[offset + 1] !== "u") return null;

  let end;
  let hex;
  if (source[offset + 2] === "{") {
    end = source.indexOf("}", offset + 3);
    if (end < 0) return null;
    hex = source.slice(offset + 3, end);
    if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
    end += 1;
  } else {
    hex = source.slice(offset + 2, offset + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
    end = offset + 6;
  }
  const codePoint = Number.parseInt(hex, 16);
  if (codePoint > 0x10ffff || String.fromCodePoint(codePoint) !== expected) {
    return null;
  }
  return { next: end, escaped: true };
}

function containsEscapedImportScriptsIdentifier(source) {
  const expected = "importScripts";
  for (let start = 0; start < source.length; start += 1) {
    let cursor = start;
    let escaped = false;
    let matched = true;
    for (const character of expected) {
      const part = escapedIdentifierChar(source, cursor, character);
      if (!part) {
        matched = false;
        break;
      }
      cursor = part.next;
      escaped ||= part.escaped;
    }
    if (matched && escaped) return true;
  }
  return false;
}

function backgroundScripts(entries, manifest, browser) {
  const queue = [];
  if (browser === "chromium") {
    const serviceWorker = manifest.background?.service_worker;
    if (!safeDeclaredPath(serviceWorker)) {
      fail("Chromium service worker declaration is invalid");
    }
    if (manifest.background?.type !== undefined) {
      fail(
        "Chromium module service worker is not accepted by this release gate",
      );
    }
    queue.push(serviceWorker);
  } else {
    const scripts = manifest.background?.scripts;
    if (
      !Array.isArray(scripts) ||
      !scripts.length ||
      scripts.some((path) => !safeDeclaredPath(path))
    ) {
      fail("Firefox background scripts declaration is invalid");
    }
    queue.push(...scripts);
  }

  const visited = new Set();
  while (queue.length) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    const data = entries.get(path);
    if (!data?.length) fail("Declared extension runtime is missing or empty");
    visited.add(path);

    const source = data.toString("utf8");
    if (containsEscapedImportScriptsIdentifier(source)) {
      fail("Background runtime contains escaped importScripts identifier");
    }
    const tokenRegex = /\bimportScripts\b/g;
    for (const token of source.matchAll(tokenRegex)) {
      const tail = source.slice(token.index + token[0].length);
      const call = tail.match(/^\(([^)]*)\);/);
      if (!call) {
        fail("Background runtime contains unsupported importScripts syntax");
      }
      let imported;
      try {
        imported = JSON.parse(`[${call[1]}]`);
      } catch {
        fail("Background runtime contains non-static importScripts");
      }
      if (
        !Array.isArray(imported) ||
        imported.some((item) => !safeDeclaredPath(item))
      ) {
        fail("Background runtime imports an unsafe path");
      }
      for (const item of imported) {
        if (!entries.get(item)?.length) {
          fail("Background runtime import is missing or empty");
        }
        queue.push(item);
      }
    }
  }

  return visited;
}

function parsePackagedConfigFromScript(source) {
  // The supported packager writes the config assignment as the first bytes
  // of the script. Never accept an identical-looking marker inside a comment,
  // string or template literal: it would not initialize the browser runtime.
  if (!source.startsWith(PACKAGED_CONFIG_MARKER)) return [];
  if (
    source.indexOf(PACKAGED_CONFIG_MARKER, PACKAGED_CONFIG_MARKER.length) >= 0
  ) {
    fail("Release package contains duplicate config markers");
  }

  const tail = source.slice(PACKAGED_CONFIG_MARKER.length);
  const match = tail.match(/^(?:"(?:\\.|[^"\\])*")\s*;/);
  if (!match) fail("Packaged config marker is malformed");

  let encoded;
  let config;
  try {
    encoded = JSON.parse(match[0].replace(/;\s*$/, "").trim());
    config = JSON.parse(encoded);
  } catch {
    fail("Packaged config is invalid JSON");
  }
  return [config];
}

function validatePackagedConfig(config, authority) {
  if (
    !exactKeys(config, [
      "environment",
      "controlApiOrigin",
      "portalOrigin",
      "extensionVersion",
      "contractVersion",
      "trustBundle",
    ]) ||
    config.environment !== authority.environment ||
    config.controlApiOrigin !== authority.origins.controlApiOrigin ||
    config.portalOrigin !== authority.origins.portalOrigin ||
    config.extensionVersion !== authority.productVersion ||
    config.contractVersion !== authority.contractVersion
  ) {
    fail("Packaged config does not match release authority");
  }

  validateTrustBundle(config.trustBundle);
  if (canonical(config.trustBundle) !== canonical(authority.trustBundle)) {
    fail("Packaged trust bundle does not match release authority");
  }
}

function readBoundedRegularFile(path, maxBytes, label = "Package input") {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  // Opening a FIFO for read blocks before fstat can reject non-regular input.
  const nonBlock = fsConstants.O_NONBLOCK ?? 0;
  const fd = openSync(path, fsConstants.O_RDONLY | noFollow | nonBlock);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) fail(`${label} must be a regular file`);
    if (before.size > BigInt(maxBytes)) fail(`${label} exceeds size limit`);

    const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = readSync(fd, bytes, total, bytes.length - total, null);
      if (read === 0) break;
      total += read;
    }

    const after = fstatSync(fd, { bigint: true });
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      BigInt(total) !== before.size
    ) {
      fail(`${label} changed during bounded read`);
    }
    if (total > maxBytes) fail(`${label} exceeds size limit`);
    return bytes.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}

function checkPackage(file, browser, authority, expectedRoot = null) {
  const supplied = resolve(file);
  if (lstatSync(supplied).isSymbolicLink()) {
    fail("Package symlink is not accepted");
  }
  const actualPath = realpathSync(supplied);
  if (expectedRoot && !isInside(actualPath, expectedRoot)) {
    fail("Candidate package escapes candidate directory");
  }

  const bytes = readBoundedRegularFile(actualPath, MAX_ARCHIVE_BYTES);
  const entries = readZip(bytes);
  ensureNoPrivateMaterial(entries);

  const rawManifest = entries.get("manifest.json");
  if (!rawManifest || rawManifest.length > MAX_CANDIDATE_MANIFEST_BYTES) {
    fail("Package has no valid manifest.json");
  }

  let manifest;
  try {
    manifest = JSON.parse(rawManifest.toString("utf8"));
  } catch {
    fail("Package manifest is invalid JSON");
  }

  if (
    manifest.manifest_version !== 3 ||
    manifest.version !== authority.productVersion
  ) {
    fail("Package manifest version does not match release authority");
  }
  if (
    browser === "firefox" &&
    manifest.browser_specific_settings?.gecko?.id !== FIREFOX_STORE_ID
  ) {
    fail("Firefox package stable extension ID mismatch");
  }
  // A manifest declaration is not evidence that its icon exists or decodes.
  // Check the same bounded ZIP member bytes the browser would install.
  ensureDeclaredIcons(entries, manifest);

  const hosts = manifest.host_permissions;
  if (
    !Array.isArray(hosts) ||
    !hosts.every((host) => typeof host === "string")
  ) {
    fail("Package host permissions are invalid");
  }
  if (
    hosts.some((host) =>
      /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(host),
    )
  ) {
    fail("Package contains local control-plane host permission");
  }

  for (const origin of [
    authority.origins.controlApiOrigin,
    authority.origins.portalOrigin,
  ]) {
    if (!hosts.includes(`${origin}/*`)) {
      fail("Package endpoint evidence does not match release authority");
    }
  }

  const reachable = backgroundScripts(entries, manifest, browser);
  ensureNoStoreDevelopmentMaterial(entries, manifest, reachable);
  const configs = [];
  for (const path of reachable) {
    configs.push(
      ...parsePackagedConfigFromScript(entries.get(path).toString("utf8")),
    );
  }
  if (!configs.length) {
    fail("Release package has no reachable packaged config");
  }

  const canonicalConfigs = new Set();
  for (const config of configs) {
    validatePackagedConfig(config, authority);
    canonicalConfigs.add(canonical(config));
  }
  if (canonicalConfigs.size !== 1) {
    fail("Release package contains conflicting packaged configs");
  }

  return {
    metadata: {
      filename: basename(actualPath),
      sha256: sha256(bytes),
      bytes: bytes.length,
      inventoryCount: entries.size,
      version: manifest.version,
      browser,
    },
    // The same bytes are published; do not reopen mutable input ZIP files.
    validatedBytes: bytes,
  };
}

function candidateManifestPath(candidateDir) {
  const candidateRoot = realpathSync(resolve(candidateDir));
  const path = join(candidateRoot, "B1_RC_MANIFEST.json");
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
    fail("Candidate manifest is missing or is a symlink");
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_CANDIDATE_MANIFEST_BYTES) {
    fail("Candidate manifest is invalid or too large");
  }
  return { candidateRoot, path };
}

// Track exactly the files created by this prepare call. On a write error,
// never delete a pre-existing file or a replacement placed by another writer.
function writeExclusiveCandidateOutput(path, bytes, ownedFiles) {
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags, 0o666);
  try {
    const identity = fstatSync(fd);
    ownedFiles.push({ path, dev: identity.dev, ino: identity.ino });
    writeFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

function discardOwnedCandidateOutput(output, directoryIdentity, ownedFiles) {
  for (const owned of ownedFiles.reverse()) {
    try {
      const current = lstatSync(owned.path);
      if (
        current.isFile() &&
        !current.isSymbolicLink() &&
        current.dev === owned.dev &&
        current.ino === owned.ino
      ) {
        unlinkSync(owned.path);
      }
    } catch {
      // Preserve the original prepare error; leave unverified material intact.
    }
  }
  try {
    const current = lstatSync(output);
    if (
      current.isDirectory() &&
      current.dev === directoryIdentity.dev &&
      current.ino === directoryIdentity.ino
    ) {
      // This succeeds only if the directory contains no other files.
      rmdirSync(output);
    }
  } catch {
    // Unknown external files/consumers must never be cleaned recursively.
  }
}

export function prepare({ authorityPath, outputDir, chromium, firefox }) {
  const output = resolve(outputDir);
  if (existsSync(output)) {
    fail("Candidate output directory must not already exist");
  }

  const authorityReceipt = readAuthority(authorityPath, output);
  const authority = authorityReceipt.value;
  const checked = {
    chromium: checkPackage(chromium, "chromium", authority),
    firefox: checkPackage(firefox, "firefox", authority),
  };
  const packages = {
    chromium: checked.chromium.metadata,
    firefox: checked.firefox.metadata,
  };

  // A reserved DOS device basename (for example CON.zip) can be written
  // on POSIX but cannot be safely materialized on a Windows release host.
  // Validate both filenames before creating any output directory.
  if (
    !safePackageFilename(packages.chromium.filename) ||
    !safePackageFilename(packages.firefox.filename)
  ) {
    fail("Unsafe package filename");
  }

  // Reject output basenames that collide on case-insensitive filesystems.
  // The same candidate must remain portable across release hosts.
  if (collidingPackageFilenames(packages.chromium.filename, packages.firefox.filename)) {
    fail("Package filenames have a case-insensitive collision");
  }

  mkdirSync(output, { recursive: false });
  const directoryIdentity = lstatSync(output);
  const ownedFiles = [];
  try {
    for (const browser of ["chromium", "firefox"]) {
      const { metadata, validatedBytes } = checked[browser];
      writeExclusiveCandidateOutput(
        join(output, metadata.filename),
        validatedBytes,
        ownedFiles,
      );
    }

    const result = {
      schemaVersion: CANDIDATE_SCHEMA,
      authoritySha256: authorityReceipt.sha256,
      source: authority.source,
      productVersion: authority.productVersion,
      contractVersion: authority.contractVersion,
      migrationLevel: authority.migrationLevel,
      packages,
    };

    writeExclusiveCandidateOutput(
      join(output, "B1_RC_MANIFEST.json"),
      Buffer.from(JSON.stringify(result, null, 2) + "\n"),
      ownedFiles,
    );
    return result;
  } catch (error) {
    discardOwnedCandidateOutput(output, directoryIdentity, ownedFiles);
    throw error;
  }
}

export function preflight({ authorityPath, candidateDir }) {
  const { candidateRoot, path } = candidateManifestPath(candidateDir);
  const authorityReceipt = readAuthority(authorityPath, candidateRoot);
  const authority = authorityReceipt.value;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("Candidate manifest is invalid JSON");
  }

  if (
    !exactKeys(manifest, [
      "schemaVersion",
      "authoritySha256",
      "source",
      "productVersion",
      "contractVersion",
      "migrationLevel",
      "packages",
    ]) ||
    manifest.schemaVersion !== CANDIDATE_SCHEMA ||
    manifest.authoritySha256 !== authorityReceipt.sha256 ||
    !exactKeys(manifest.source, ["head", "tree"]) ||
    canonical(manifest.source) !== canonical(authority.source) ||
    manifest.productVersion !== authority.productVersion ||
    manifest.contractVersion !== authority.contractVersion ||
    manifest.migrationLevel !== authority.migrationLevel ||
    !exactKeys(manifest.packages, ["chromium", "firefox"])
  ) {
    fail("Candidate source, authority, or product facts are stale");
  }

  // A modified candidate can bypass prepare(), so revalidate both names
  // together before accepting files on a case-sensitive host for a Win32 release.
  if (
    collidingPackageFilenames(
      manifest.packages.chromium?.filename,
      manifest.packages.firefox?.filename,
    )
  ) {
    fail("Package filenames have a case-insensitive collision");
  }

  for (const browser of ["chromium", "firefox"]) {
    const row = manifest.packages[browser];
    if (
      !exactKeys(row, [
        "filename",
        "sha256",
        "bytes",
        "inventoryCount",
        "version",
        "browser",
      ]) ||
      row.browser !== browser ||
      !safePackageFilename(row.filename) ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes <= 0 ||
      !Number.isSafeInteger(row.inventoryCount) ||
      row.inventoryCount <= 0 ||
      row.version !== authority.productVersion
    ) {
      fail("Invalid package metadata");
    }

    const packagePath = join(candidateRoot, row.filename);
    if (!existsSync(packagePath)) {
      fail("Candidate package is missing");
    }
    const actual = checkPackage(
      packagePath,
      browser,
      authority,
      candidateRoot,
    ).metadata;
    if (
      row.filename !== actual.filename ||
      row.sha256 !== actual.sha256 ||
      row.bytes !== actual.bytes ||
      row.inventoryCount !== actual.inventoryCount ||
      row.version !== actual.version
    ) {
      fail("Package metadata differs from archive bytes");
    }
  }

  return {
    status: "PASS",
    productionMutation: "NOT_PERFORMED",
    evidenceLevel: "PACKAGE",
    source: authority.source,
    productVersion: authority.productVersion,
    contractVersion: authority.contractVersion,
    migrationLevel: authority.migrationLevel,
    authoritySha256: authorityReceipt.sha256,
    externalAcceptance: "NOT_CLAIMED",
  };
}
