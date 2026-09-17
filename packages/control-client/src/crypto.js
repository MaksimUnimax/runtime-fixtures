/* Browser-only strict verifier for bootstrap_snapshot_v2. No Node imports. */
(() => {
  "use strict";
  const textEncoder = new TextEncoder();
  const DOMAIN = textEncoder.encode("product-control-plane/bootstrap-snapshot/v1\0");
  /* Must remain byte-for-byte compatible with StableMachineIdentifierV1. */
  const MACHINE = /^[a-z0-9][a-z0-9._-]*$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  /* Browser-safe copy of packages/shared/src/index.ts SemVerV1Schema. */
  const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  function semver(value) { return typeof value === "string" && value.length >= 1 && value.length <= 64 && SEMVER.test(value); }
  const B64URL = /^[A-Za-z0-9_-]+$/;
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
  function fail(error) { return { ok: false, error }; }
  function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
  function exact(value, keys) {
    if (!record(value)) return false;
    const expected = new Set(keys);
    return Object.keys(value).every(k => expected.has(k)) && Object.keys(value).length === expected.size;
  }
  function exactWithOptional(value, required, optional) {
    if (!record(value)) return false;
    const allowed = new Set(required.concat(optional));
    const actual = Object.keys(value);
    return actual.every(k => allowed.has(k)) && required.every(k => Object.hasOwn(value, k));
  }
  function b64url(value) {
    if (typeof value !== "string" || !value || !B64URL.test(value)) return null;
    try {
      const pad = value.length % 4 ? "=".repeat(4 - value.length % 4) : "";
      const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad), c => c.charCodeAt(0));
      const encoded = b64urlEncode(bytes);
      return encoded === value ? bytes : null;
    } catch (_) { return null; }
  }
  function b64(value) {
    if (typeof value !== "string" || !value || !B64.test(value) || value.length % 4) return null;
    try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch (_) { return null; }
  }
  function b64urlEncode(bytes) {
    let result = "";
    for (let i = 0; i < bytes.length; i += 0x8000) result += btoa(String.fromCharCode(...bytes.slice(i, i + 0x8000)));
    return result.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function canonical(value) {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("NON_CANONICAL_NUMBER");
      return String(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    throw new Error("INVALID_CANONICAL_VALUE");
  }
  /* JSON.parse silently accepts duplicate names. This small parser rejects
   * duplicates before parsing, then canonical byte equality rejects all other
   * spelling/ordering changes. */
  function parseStrictJson(source) {
    let i = 0;
    const ws = () => { while (/\s/.test(source[i] || "")) i++; };
    const string = () => {
      const start = i++; let escaped = false;
      while (i < source.length) {
        const c = source[i++];
        if (escaped) {
          escaped = false;
          if (c === "u") {
            if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i, i + 4))) throw new Error("INVALID_JSON");
            i += 4;
          } else if (!/["\\/bfnrt]/.test(c)) throw new Error("INVALID_JSON");
          continue;
        }
        if (c === "\\") { escaped = true; continue; }
        if (c < " ") throw new Error("INVALID_JSON");
        if (c === '"') return JSON.parse(source.slice(start, i));
      }
      throw new Error("INVALID_JSON");
    };
    const value = () => {
      ws(); const c = source[i];
      if (c === '"') return string();
      if (c === "{") {
        i++; ws(); const out = Object.create(Object.prototype), seen = new Set();
        if (source[i] === "}") { i++; return out; }
        while (true) {
          ws(); if (source[i] !== '"') throw new Error("INVALID_JSON");
          const key = string(); if (seen.has(key)) throw new Error("DUPLICATE_FIELD"); seen.add(key);
          ws(); if (source[i++] !== ":") throw new Error("INVALID_JSON"); out[key] = value(); ws();
          if (source[i] === "}") { i++; return out; }
          if (source[i++] !== ",") throw new Error("INVALID_JSON");
        }
      }
      if (c === "[") {
        i++; ws(); const out = []; if (source[i] === "]") { i++; return out; }
        while (true) { out.push(value()); ws(); if (source[i] === "]") { i++; return out; } if (source[i++] !== ",") throw new Error("INVALID_JSON"); }
      }
      const match = source.slice(i).match(/^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
      if (!match) throw new Error("INVALID_JSON"); i += match[0].length; return JSON.parse(match[0]);
    };
    const result = value(); ws(); if (i !== source.length) throw new Error("INVALID_JSON"); return result;
  }
  function iso(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }
  function machine(value) { return typeof value === "string" && value.length <= 64 && MACHINE.test(value); }
  function detected(value) { return exact(value, ["family", "surface", "variant"]) && machine(value.family) && machine(value.surface) && (value.variant === null || machine(value.variant)); }
  function jsonObject(value) { return record(value) && Object.keys(value).length <= 128; }
  function ai(value) {
    if (!record(value) || typeof value.status !== "string") return false;
    if (value.status === "UNCONFIGURED") return exact(value, ["status"]);
    if (value.status === "UNAVAILABLE") return exact(value, ["status", "detected", "reason"]) && detected(value.detected) && ["UNSUPPORTED_DETECTED_AI", "AI_DISABLED", "NO_PROFILE", "PROFILE_INCOMPATIBLE"].includes(value.reason);
    if (value.status !== "RESOLVED" || !exact(value, ["status", "detected", "profile"]) || !detected(value.detected)) return false;
    const p = value.profile;
    return exact(p, ["profileKey", "revision", "scopeVariant", "schemaVersion", "contentSha256", "content", "compatibility"]) && machine(p.profileKey) && Number.isSafeInteger(p.revision) && p.revision > 0 && (p.scopeVariant === null || machine(p.scopeVariant)) && p.schemaVersion === "adapter_profile_v1" && /^[0-9a-f]{64}$/.test(p.contentSha256) && jsonObject(p.content) && jsonObject(p.compatibility);
  }
  function payload(value) {
    const keys = ["snapshotVersion", "contractVersion", "configVersion", "issuedAt", "expiresAt", "offlineGraceUntil", "serverTime", "accessBasis", "account", "subscription", "devicePolicy", "compatibility", "entitlements", "features", "ai"];
    if (!exactWithOptional(value, keys.filter(k => k !== "accessBasis"), ["accessBasis"]) || value.snapshotVersion !== "bootstrap_snapshot_v2" || value.contractVersion !== "control_plane_v2" || !exact(value.account, ["id", "status"]) || !UUID.test(value.account.id) || value.account.status !== "ACTIVE") return false;
    if (!Number.isSafeInteger(value.configVersion) || value.configVersion <= 0 || !["BETA", "COMMERCIAL", "NONE", undefined].includes(value.accessBasis) || !iso(value.issuedAt) || !iso(value.expiresAt) || !iso(value.offlineGraceUntil) || !iso(value.serverTime)) return false;
    const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt), grace = Date.parse(value.offlineGraceUntil), server = Date.parse(value.serverTime);
    if (issued > server || issued >= expires || expires >= grace) return false;
    if (!exact(value.subscription, ["state", "planRevision"]) || !["NONE", "TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "CANCELED", "EXPIRED", "SUSPENDED"].includes(value.subscription.state) || (value.subscription.state === "NONE" ? value.subscription.planRevision !== null : !machine(value.subscription.planRevision))) return false;
    if (!exact(value.devicePolicy, ["status"]) || value.devicePolicy.status !== "ACTIVE") return false;
    if (!exact(value.compatibility, ["extension", "browser"]) || !exact(value.compatibility.extension, ["status", "minimumVersion"]) || !["SUPPORTED", "UPDATE_RECOMMENDED", "UPDATE_REQUIRED"].includes(value.compatibility.extension.status) || (value.compatibility.extension.minimumVersion !== null && !semver(value.compatibility.extension.minimumVersion)) || !exact(value.compatibility.browser, ["status"]) || !["SUPPORTED", "UNSUPPORTED_BROWSER", "MAINTENANCE"].includes(value.compatibility.browser.status)) return false;
    if (!record(value.entitlements) || Object.keys(value.entitlements).length > 128 || !Object.entries(value.entitlements).every(([k, v]) => machine(k) && (typeof v === "boolean" || (Number.isSafeInteger(v) && !Object.is(v, -0)) || machine(v)))) return false;
    if (!record(value.features) || Object.keys(value.features).length > 128 || !Object.entries(value.features).every(([k, v]) => machine(k) && typeof v === "boolean")) return false;
    return ai(value.ai);
  }
  function validateBundle(bundle) {
    if (!exact(bundle, ["trustBundleVersion", "algorithm", "publicKeyFormat", "publicKeyEncoding", "fingerprintAlgorithm", "fingerprintEncoding", "keys"]) || bundle.trustBundleVersion !== "bootstrap_trust_bundle_v1" || bundle.algorithm !== "Ed25519" || bundle.publicKeyFormat !== "spki_der" || bundle.publicKeyEncoding !== "base64" || bundle.fingerprintAlgorithm !== "sha256" || bundle.fingerprintEncoding !== "lowercase_hex" || !Array.isArray(bundle.keys) || bundle.keys.length > 8) throw new Error("INVALID_TRUST_BUNDLE");
    const ids = new Set(), fingerprints = new Set();
    for (const entry of bundle.keys) {
      if (!exact(entry, ["keyId", "publicKey", "fingerprintSha256", "lifecycle", "trustEligibility"]) || !machine(entry.keyId) || !B64.test(entry.publicKey) || entry.publicKey.length % 4 || !/^[0-9a-f]{64}$/.test(entry.fingerprintSha256) || !["ACTIVE", "RETIRED"].includes(entry.lifecycle) || entry.trustEligibility !== (entry.lifecycle === "ACTIVE" ? "SIGNING_AND_VERIFICATION" : "VERIFICATION_OVERLAP") || ids.has(entry.keyId) || fingerprints.has(entry.fingerprintSha256)) throw new Error("INVALID_TRUST_BUNDLE");
      ids.add(entry.keyId); fingerprints.add(entry.fingerprintSha256);
    }
    return bundle;
  }
  async function makeKeyRing(bundle) {
    validateBundle(bundle); const map = new Map();
    for (const entry of bundle.keys) {
      const der = b64(entry.publicKey); if (!der) throw new Error("INVALID_TRUST_KEY");
      const fingerprint = hex(await crypto.subtle.digest("SHA-256", der)); if (fingerprint !== entry.fingerprintSha256) throw new Error("TRUST_FINGERPRINT_MISMATCH");
      try { map.set(entry.keyId, await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"])); } catch (_) { throw new Error("UNSUPPORTED_CRYPTO"); }
    }
    return map;
  }
  async function verifyBootstrapV2(input, bundle) {
    let envelope;
    if (!exact(input, ["envelopeVersion", "algorithm", "keyId", "payload", "signature"]) || input.envelopeVersion !== "bootstrap_envelope_v2" || input.algorithm !== "Ed25519" || !machine(input.keyId) || typeof input.payload !== "string" || input.payload.length > 32768 || typeof input.signature !== "string" || input.signature.length > 256) return fail("INVALID_ENVELOPE");
    const keyRing = await makeKeyRing(bundle), key = keyRing.get(input.keyId); if (!key) return fail("UNKNOWN_SIGNING_KEY");
    const payloadBytes = b64url(input.payload), signature = b64url(input.signature); if (!payloadBytes || !signature) return fail("INVALID_PAYLOAD_ENCODING");
    let valid = false; try { const data = new Uint8Array(DOMAIN.length + input.keyId.length + 1 + payloadBytes.length); data.set(DOMAIN); data.set(textEncoder.encode(input.keyId), DOMAIN.length); data[DOMAIN.length + input.keyId.length] = 0; data.set(payloadBytes, DOMAIN.length + input.keyId.length + 1); valid = await crypto.subtle.verify("Ed25519", key, signature, data); } catch (_) { return fail("INVALID_SIGNATURE"); }
    if (!valid) return fail("INVALID_SIGNATURE");
    let json; try { json = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)); } catch (error) { return fail(error.message === "DUPLICATE_FIELD" ? "INVALID_PAYLOAD_JSON" : "INVALID_PAYLOAD_JSON"); }
    if (!payload(json)) return fail("INVALID_PAYLOAD_SCHEMA");
    try { if (new TextEncoder().encode(canonical(json)).byteLength !== payloadBytes.byteLength || !cryptoEqual(new TextEncoder().encode(canonical(json)), payloadBytes)) return fail("NON_CANONICAL_PAYLOAD"); } catch (_) { return fail("INVALID_PAYLOAD_SCHEMA"); }
    return { ok: true, payload: json, envelope: input };
  }
  const HEALTH_DOMAIN = textEncoder.encode("product-control-plane/health-authority/v1\0");
  const HEALTH_REASONS = ["PRODUCER_UNAVAILABLE", "PRODUCER_DENIED", "PROVENANCE_MISSING", "STALE_OBSERVATION", "INVALID_CONTEXT", "AI_UNAVAILABLE"];
  function healthAi(value) { return exact(value, ["family", "surface", "variant", "profileKey", "revision", "scopeVariant", "contentSha256"]) && machine(value.family) && machine(value.surface) && (value.variant === null || machine(value.variant)) && machine(value.profileKey) && Number.isSafeInteger(value.revision) && value.revision > 0 && (value.scopeVariant === null || machine(value.scopeVariant)) && /^[0-9a-f]{64}$/.test(value.contentSha256); }
  function healthContext(value) { return exact(value, ["accountId", "deviceId", "sessionId", "contractVersion", "configVersion", "bootstrapSnapshotSha256", "ai"]) && UUID.test(value.accountId) && UUID.test(value.deviceId) && UUID.test(value.sessionId) && value.contractVersion === "control_plane_v2" && Number.isSafeInteger(value.configVersion) && value.configVersion > 0 && /^[0-9a-f]{64}$/.test(value.bootstrapSnapshotSha256) && healthAi(value.ai); }
  function healthClaim(value) {
    if (!record(value) || value.healthClaimVersion !== "health_claim_v1" || value.target !== "WORK" || value.executionAuthority !== false) return false;
    if (value.status === "PASS") return exact(value, ["healthClaimVersion", "status", "target", "context", "observedAt", "expiresAt", "executionAuthority"]) && healthContext(value.context) && iso(value.observedAt) && iso(value.expiresAt) && Date.parse(value.observedAt) < Date.parse(value.expiresAt);
    return (value.status === "DENY" || value.status === "UNAVAILABLE") && exact(value, ["healthClaimVersion", "status", "target", "reason", "observedAt", "executionAuthority"]) && HEALTH_REASONS.includes(value.reason) && iso(value.observedAt);
  }
  async function verifyHealthV1(input, bundle) {
    if (!exact(input, ["healthEnvelopeVersion", "algorithm", "keyId", "payload", "signature"]) || input.healthEnvelopeVersion !== "health_envelope_v1" || input.algorithm !== "Ed25519" || !machine(input.keyId) || typeof input.payload !== "string" || input.payload.length > 32768 || typeof input.signature !== "string" || input.signature.length > 256) return fail("INVALID_ENVELOPE");
    const keyRing = await makeKeyRing(bundle), key = keyRing.get(input.keyId); if (!key) return fail("UNKNOWN_SIGNING_KEY");
    const payloadBytes = b64url(input.payload), signature = b64url(input.signature); if (!payloadBytes || !signature) return fail("INVALID_PAYLOAD_ENCODING");
    let valid = false; try { const data = new Uint8Array(HEALTH_DOMAIN.length + input.keyId.length + 1 + payloadBytes.length); data.set(HEALTH_DOMAIN); data.set(textEncoder.encode(input.keyId), HEALTH_DOMAIN.length); data[HEALTH_DOMAIN.length + input.keyId.length] = 0; data.set(payloadBytes, HEALTH_DOMAIN.length + input.keyId.length + 1); valid = await crypto.subtle.verify("Ed25519", key, signature, data); } catch (_) { return fail("INVALID_SIGNATURE"); }
    if (!valid) return fail("INVALID_SIGNATURE");
    let json; try { json = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)); } catch (_) { return fail("INVALID_PAYLOAD_JSON"); }
    if (!healthClaim(json)) return fail("INVALID_PAYLOAD_SCHEMA");
    try { const canonicalBytes = new TextEncoder().encode(canonical(json)); if (canonicalBytes.byteLength !== payloadBytes.byteLength || !cryptoEqual(canonicalBytes, payloadBytes)) return fail("NON_CANONICAL_PAYLOAD"); } catch (_) { return fail("INVALID_PAYLOAD_SCHEMA"); }
    return { ok: true, payload: json, envelope: input };
  }
  function cryptoEqual(a, b) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i]; return result === 0; }
  globalThis.SellerAgentsBootstrapVerifier = Object.freeze({ verifyV2: verifyBootstrapV2, verifyHealthV1, validateBundle, canonicalJson: value => canonical(value), base64urlEncode: b64urlEncode });
})();
