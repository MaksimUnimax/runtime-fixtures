/* global Buffer, TextDecoder, URL */

import { createHash, createPublicKey } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const AUTHORITY_SCHEMA = "octoport_release_authority_v1";
const CANDIDATE_SCHEMA = "b1_release_candidate_v2";
const MAX_AUTHORITY_BYTES = 1024 * 1024;
const MAX_CANDIDATE_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
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

  const authorityStat = statSync(authorityPath);
  if (!authorityStat.isFile() || authorityStat.size > MAX_AUTHORITY_BYTES) {
    fail("Authority file is invalid or too large");
  }

  const bytes = readFileSync(authorityPath);
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
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/i.test(filename)
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
    disk !== 0 ||
    centralDisk !== 0 ||
    diskCount !== count ||
    count === 0 ||
    count > MAX_ZIP_ENTRIES ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralStart === 0xffffffff ||
    centralStart + centralSize > eocd
  ) {
    fail("Unsupported ZIP directory");
  }

  const entries = new Map();
  const caseFoldedNames = new Set();
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

    const nameBytes = bytes.subarray(pointer + 46, pointer + 46 + nameLength);
    const name = decodeZipName(nameBytes, Boolean(flags & 0x800));
    const isDirectory = name.endsWith("/");
    const parts = isDirectory ? name.slice(0, -1).split("/") : name.split("/");

    if (
      !name ||
      name.includes("\0") ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      fail("Unsafe ZIP path");
    }

    const folded = name.toLowerCase();
    if (entries.has(name) || caseFoldedNames.has(folded)) {
      fail("Duplicate ZIP entry");
    }
    caseFoldedNames.add(folded);

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & 0xf000;
    if (
      madeBy >> 8 === 3 &&
      fileType !== 0 &&
      fileType !== 0x8000 &&
      fileType !== 0x4000
    ) {
      fail("Unsupported special ZIP entry");
    }

    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      rawSize > MAX_ENTRY_BYTES ||
      compressedSize > MAX_ARCHIVE_BYTES
    ) {
      fail("Unsupported ZIP entry");
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
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
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

    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    try {
      data =
        method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, rawSize + 1),
            });
    } catch {
      fail("Invalid compressed ZIP entry");
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
  const configs = [];
  let offset = 0;

  while (true) {
    const marker = source.indexOf(PACKAGED_CONFIG_MARKER, offset);
    if (marker < 0) break;

    const literalStart = marker + PACKAGED_CONFIG_MARKER.length;
    const tail = source.slice(literalStart);
    const match = tail.match(/^(?:"(?:\\.|[^"\\])*")\s*;/);
    if (!match) fail("Packaged config marker is malformed");

    const literal = match[0].replace(/;\s*$/, "").trim();
    let encoded;
    let config;
    try {
      encoded = JSON.parse(literal);
      config = JSON.parse(encoded);
    } catch {
      fail("Packaged config is invalid JSON");
    }
    configs.push(config);
    offset = literalStart + match[0].length;
  }

  return configs;
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

function readBoundedRegularFile(path, maxBytes) {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) fail("Package input must be a regular file");
    if (before.size > maxBytes) fail("Package input exceeds size limit");

    const bytes = Buffer.allocUnsafe(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = readSync(fd, bytes, total, bytes.length - total, null);
      if (read === 0) break;
      total += read;
    }

    const after = fstatSync(fd);
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      total !== before.size
    ) {
      fail("Package input changed during bounded read");
    }
    if (total > maxBytes) fail("Package input exceeds size limit");
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
    filename: basename(actualPath),
    sha256: sha256(bytes),
    bytes: bytes.length,
    inventoryCount: entries.size,
    version: manifest.version,
    browser,
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

export function prepare({ authorityPath, outputDir, chromium, firefox }) {
  const output = resolve(outputDir);
  if (existsSync(output)) {
    fail("Candidate output directory must not already exist");
  }

  const authorityReceipt = readAuthority(authorityPath, output);
  const authority = authorityReceipt.value;
  const packages = {
    chromium: checkPackage(chromium, "chromium", authority),
    firefox: checkPackage(firefox, "firefox", authority),
  };

  if (packages.chromium.filename === packages.firefox.filename) {
    fail("Package filenames must be distinct");
  }

  mkdirSync(output, { recursive: false });
  for (const source of [chromium, firefox]) {
    const sourcePath = realpathSync(resolve(source));
    copyFileSync(
      sourcePath,
      join(output, basename(sourcePath)),
      fsConstants.COPYFILE_EXCL,
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

  writeFileSync(
    join(output, "B1_RC_MANIFEST.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
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
    const actual = checkPackage(packagePath, browser, authority, candidateRoot);
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
