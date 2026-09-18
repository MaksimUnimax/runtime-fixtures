(() => {
  "use strict";

  const MAGIC = "seller_agents_store_backup";
  const ENVELOPE_VERSION = 1;
  const PAYLOAD_VERSION = "seller_agents_store_backup_payload_v1";
  const KDF_NAME = "PBKDF2-HMAC-SHA-256";
  const ENCRYPTION_NAME = "AES-256-GCM";
  const KDF_ITERATIONS = 210000;
  const LIMITS = Object.freeze({
    maxFileBytes: 8 * 1024 * 1024,
    minIterations: 100000,
    maxIterations: 600000,
    maxStores: 100,
    maxString: 8192,
    maxLabel: 80,
    maxDepth: 8,
    maxCiphertextBytes: 8 * 1024 * 1024,
  });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const clone = (value) => structuredClone(value);
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const bytes = (value) => encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
  const b64 = (value) => {
    const input = new Uint8Array(value), chunk = 0x8000;
    let output = "";
    for (let index = 0; index < input.length; index += chunk) output += String.fromCharCode(...input.subarray(index, index + chunk));
    return btoa(output);
  };
  const unb64 = (value, max = LIMITS.maxCiphertextBytes) => {
    if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(max / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("BACKUP_ENCODING_INVALID");
    let raw;
    try { raw = atob(value); } catch (_) { fail("BACKUP_ENCODING_INVALID"); }
    if (raw.length > max) fail("BACKUP_RESOURCE_LIMIT");
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  };
  const string = (value, name, max = LIMITS.maxString) => {
    if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`BACKUP_${name}_INVALID`);
    return value;
  };
  const exactKeys = (value, keys, code = "BACKUP_UNKNOWN_FIELDS") => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail(code);
  };
  const object = (value, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`BACKUP_${name}_INVALID`);
    return value;
  };
  function depth(value, level = 0) {
    if (level > LIMITS.maxDepth) fail("BACKUP_RESOURCE_LIMIT");
    if (value && typeof value === "object") for (const child of Object.values(value)) depth(child, level + 1);
  }
  function validRevision(value) { return string(value, "CREDENTIAL_REVISION", 128); }
  function validateCredentials(marketplace, value) {
    object(value, "CREDENTIALS");
    if (marketplace === "ozon") {
      exactKeys(value, ["type", "version", "seller", "performance"]);
      if (value.type !== "ozon" || value.version !== 1) fail("BACKUP_CREDENTIAL_SHAPE_INVALID");
      exactKeys(value.seller, ["clientId", "apiKey"]);
      string(value.seller.clientId, "SELLER_CLIENT_ID"); string(value.seller.apiKey, "SELLER_API_KEY");
      if (value.performance !== null) {
        exactKeys(value.performance, ["clientId", "clientSecret"]);
        string(value.performance.clientId, "PERFORMANCE_CLIENT_ID"); string(value.performance.clientSecret, "PERFORMANCE_CLIENT_SECRET");
      }
      return clone(value);
    }
    if (marketplace === "wildberries") {
      exactKeys(value, ["type", "version", "token", "tokenType"]);
      if (value.type !== "wildberries" || value.version !== 1 || value.tokenType !== "personal") fail("BACKUP_CREDENTIAL_SHAPE_INVALID");
      string(value.token, "WB_TOKEN");
      return clone(value);
    }
    fail("BACKUP_MARKETPLACE_INVALID");
  }
  function validatePayload(value, accountId) {
    object(value, "PAYLOAD"); depth(value);
    exactKeys(value, ["payloadVersion", "accountBinding", "createdAt", "stores"]);
    if (value.payloadVersion !== PAYLOAD_VERSION) fail("BACKUP_VERSION_UNSUPPORTED");
    exactKeys(value.accountBinding, ["accountId"]);
    if (string(value.accountBinding.accountId, "ACCOUNT_ID", 256) !== accountId) fail("BACKUP_ACCOUNT_MISMATCH");
    string(value.createdAt, "CREATED_AT", 64);
    if (!Array.isArray(value.stores) || value.stores.length > LIMITS.maxStores) fail("BACKUP_RESOURCE_LIMIT");
    const ids = new Set();
    const stores = value.stores.map((store) => {
      object(store, "STORE");
      exactKeys(store, ["storeId", "label", "marketplace", "providerAccountId", "providerIdentityState", "credentialRevision", "metadataRevision", "credentials"]);
      const storeId = string(store.storeId, "STORE_ID", 128);
      if (ids.has(storeId)) fail("BACKUP_DUPLICATE_STORE_ID");
      ids.add(storeId);
      const label = string(store.label, "STORE_LABEL", LIMITS.maxLabel);
      if (!["ozon", "wildberries"].includes(store.marketplace)) fail("BACKUP_MARKETPLACE_INVALID");
      if (!["CONFIRMED", "UNCONFIRMED"].includes(store.providerIdentityState)) fail("BACKUP_PROVIDER_IDENTITY_INVALID");
      if (store.providerIdentityState === "CONFIRMED") string(store.providerAccountId, "PROVIDER_ACCOUNT_ID", 128);
      else if (store.providerAccountId !== null) fail("BACKUP_PROVIDER_IDENTITY_INVALID");
      const revision = validRevision(store.credentialRevision);
      if (!Number.isSafeInteger(store.metadataRevision) || store.metadataRevision < 0) fail("BACKUP_METADATA_REVISION_INVALID");
      return { storeId, label, marketplace: store.marketplace, providerAccountId: store.providerIdentityState === "CONFIRMED" ? store.providerAccountId : null, providerIdentityState: store.providerIdentityState, credentialRevision: revision, metadataRevision: store.metadataRevision, credentials: validateCredentials(store.marketplace, store.credentials) };
    });
    return { payloadVersion: PAYLOAD_VERSION, accountBinding: { accountId }, createdAt: value.createdAt, stores };
  }
  function payloadFromStores(accountId, stores) {
    return validatePayload({ payloadVersion: PAYLOAD_VERSION, accountBinding: { accountId }, createdAt: new Date().toISOString(), stores: stores.filter((store) => (store.lifecycleState || "ACTIVE") === "ACTIVE").map((store) => ({
      storeId: store.id, label: store.name, marketplace: store.marketplace, providerAccountId: store.providerIdentityState === "CONFIRMED" ? store.providerAccountId : null, providerIdentityState: store.providerIdentityState === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED", credentialRevision: store.credentialRevision, metadataRevision: Number.isSafeInteger(store.metadataRevision) ? store.metadataRevision : 0,
      credentials: store.marketplace === "ozon" ? { type: "ozon", version: 1, seller: { clientId: store.credentials?.seller?.clientId || "", apiKey: store.credentials?.seller?.apiKey || "" }, performance: store.credentials?.performance?.clientId && store.credentials?.performance?.clientSecret ? { clientId: store.credentials.performance.clientId, clientSecret: store.credentials.performance.clientSecret } : null } : { type: "wildberries", version: 1, token: store.credentials?.token || "", tokenType: "personal" },
    })) }, accountId);
  }
  function headerFromFields(value) {
    return { magic: MAGIC, envelopeVersion: ENVELOPE_VERSION, kdf: { name: KDF_NAME, hash: "SHA-256", iterations: value.kdf.iterations, salt: value.kdf.salt }, encryption: { name: ENCRYPTION_NAME, keyLength: 256, iv: value.encryption.iv, tagLength: 128 } };
  }
  function validateEnvelope(value) {
    object(value, "ENVELOPE"); depth(value);
    exactKeys(value, ["magic", "envelopeVersion", "kdf", "encryption", "ciphertext"]);
    if (value.magic !== MAGIC || value.envelopeVersion !== ENVELOPE_VERSION) fail("BACKUP_VERSION_UNSUPPORTED");
    exactKeys(value.kdf, ["name", "hash", "iterations", "salt"]); exactKeys(value.encryption, ["name", "keyLength", "iv", "tagLength"]);
    if (value.kdf.name !== KDF_NAME || value.kdf.hash !== "SHA-256" || !Number.isSafeInteger(value.kdf.iterations) || value.kdf.iterations < LIMITS.minIterations || value.kdf.iterations > LIMITS.maxIterations) fail("BACKUP_KDF_INVALID");
    const salt = unb64(value.kdf.salt, 64), iv = unb64(value.encryption.iv, 32), ciphertext = unb64(value.ciphertext);
    if (salt.length < 16 || salt.length > 64 || iv.length !== 12 || value.encryption.name !== ENCRYPTION_NAME || value.encryption.keyLength !== 256 || value.encryption.tagLength !== 128 || ciphertext.length < 16) fail("BACKUP_ENVELOPE_INVALID");
    const header = headerFromFields(value);
    return { value, header, salt, iv, ciphertext, aad: encoder.encode(canonical(header)) };
  }
  async function key(password, salt, iterations, usage) {
    if (typeof password !== "string" || password.length < 8 || password.length > 256) fail("BACKUP_PASSWORD_INVALID");
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, usage);
  }
  async function encrypt(payload, password) {
    const normalized = validatePayload(payload, payload.accountBinding.accountId);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const value = { kdf: { iterations: KDF_ITERATIONS, salt: b64(salt) }, encryption: { iv: b64(iv) } };
    const header = headerFromFields(value), aes = await key(password, salt, KDF_ITERATIONS, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(canonical(header)), tagLength: 128 }, aes, encoder.encode(canonical(normalized)));
    const envelope = { magic: MAGIC, envelopeVersion: ENVELOPE_VERSION, kdf: header.kdf, encryption: header.encryption, ciphertext: b64(ciphertext) };
    if (bytes(JSON.stringify(envelope)).byteLength > LIMITS.maxFileBytes) fail("BACKUP_RESOURCE_LIMIT");
    return JSON.stringify(envelope);
  }
  function checksum(value) {
    return crypto.subtle.digest("SHA-256", encoder.encode(canonical(value))).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  async function legacyPayload(value, accountId) {
    object(value, "LEGACY"); depth(value);
    const make = (marketplace, credentials, suffix) => ({ payloadVersion: PAYLOAD_VERSION, accountBinding: { accountId }, createdAt: new Date().toISOString(), stores: [{ storeId: `store-${crypto.randomUUID()}`, label: `Imported ${suffix}`, marketplace, providerAccountId: null, providerIdentityState: "UNCONFIRMED", credentialRevision: `credential-${crypto.randomUUID()}`, metadataRevision: 0, credentials }] });
    const incoming = value.credentials;
    if (value.format === "ozon-bridge-seller-credentials-backup" && value.backup_version === 1) {
      exactKeys(value, ["format", "backup_version", "exported_at", "extension_version", "extension_id", "contains_secrets", "credentials_sha256", "credentials"]);
      exactKeys(incoming, ["seller_client_id", "seller_api_key"]); if (value.contains_secrets !== true) fail("BACKUP_LEGACY_INVALID");
      if (await checksum(incoming) !== String(value.credentials_sha256 || "").toLowerCase()) fail("BACKUP_CHECKSUM_MISMATCH");
      return validatePayload(make("ozon", { type: "ozon", version: 1, seller: { clientId: string(incoming.seller_client_id, "SELLER_CLIENT_ID"), apiKey: string(incoming.seller_api_key, "SELLER_API_KEY") }, performance: null }, "Ozon"), accountId);
    }
    if (value.format === "ozon-bridge-credentials-backup" && value.backup_version === 2) {
      exactKeys(value, ["format", "backup_version", "exported_at", "extension_version", "extension_id", "contains_secrets", "credentials_sha256", "credentials"]);
      exactKeys(incoming, ["seller_client_id", "seller_api_key", "performance_client_id", "performance_client_secret"]); if (value.contains_secrets !== true) fail("BACKUP_LEGACY_INVALID");
      if (await checksum(incoming) !== String(value.credentials_sha256 || "").toLowerCase()) fail("BACKUP_CHECKSUM_MISMATCH");
      const seller = string(incoming.seller_client_id, "SELLER_CLIENT_ID"), apiKey = string(incoming.seller_api_key, "SELLER_API_KEY");
      const performance = incoming.performance_client_id && incoming.performance_client_secret ? { clientId: string(incoming.performance_client_id, "PERFORMANCE_CLIENT_ID"), clientSecret: string(incoming.performance_client_secret, "PERFORMANCE_CLIENT_SECRET") } : null;
      return validatePayload(make("ozon", { type: "ozon", version: 1, seller: { clientId: seller, apiKey }, performance }, "Ozon"), accountId);
    }
    if (value.format === "wildberries-bridge-seller-credentials-backup" && [1, 2].includes(value.backup_version)) {
      exactKeys(value, ["format", "backup_version", "exported_at", "extension_version", "extension_id", "contains_secrets", "credentials_sha256", "credentials"]);
      exactKeys(incoming, ["seller_token", "seller_token_type"]); if (value.contains_secrets !== true || incoming.seller_token_type !== "personal") fail("BACKUP_LEGACY_INVALID");
      if (await checksum(incoming) !== String(value.credentials_sha256 || "").toLowerCase()) fail("BACKUP_CHECKSUM_MISMATCH");
      return validatePayload(make("wildberries", { type: "wildberries", version: 1, token: string(incoming.seller_token, "WB_TOKEN"), tokenType: "personal" }, "Wildberries"), accountId);
    }
    fail("BACKUP_VERSION_UNSUPPORTED");
  }
  async function decrypt(input, password, accountId) {
    if (typeof accountId !== "string" || !accountId) fail("AUTH_REQUIRED");
    if (input instanceof Uint8Array && input.byteLength > LIMITS.maxFileBytes) fail("BACKUP_FILE_TOO_LARGE");
    let text; try { text = input instanceof Uint8Array ? decoder.decode(input) : String(input ?? ""); } catch (_) { fail("BACKUP_ENCODING_INVALID"); }
    if (!text || bytes(text).byteLength > LIMITS.maxFileBytes) fail("BACKUP_FILE_TOO_LARGE");
    let parsed; try { parsed = JSON.parse(text); } catch (_) { fail("BACKUP_JSON_INVALID"); }
    if (parsed?.magic !== MAGIC) return { payload: await legacyPayload(parsed, accountId), legacy: true };
    const checked = validateEnvelope(parsed), aes = await key(password, checked.salt, checked.value.kdf.iterations, ["decrypt"]);
    let plain; try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: checked.iv, additionalData: checked.aad, tagLength: 128 }, aes, checked.ciphertext); } catch (_) { fail("BACKUP_AUTHENTICATION_FAILED"); }
    let value; try { value = JSON.parse(decoder.decode(plain)); } catch (_) { fail("BACKUP_PAYLOAD_INVALID"); }
    return { payload: validatePayload(value, accountId), legacy: false };
  }
  function summary(payload, classifications = []) {
    return { storeCount: payload.stores.length, marketplaces: [...new Set(payload.stores.map((store) => store.marketplace))], conflictCount: classifications.filter((row) => !["IMPORT_NEW", "SAME_CURRENT"].includes(row.kind)).length, safeImportCount: classifications.filter((row) => row.kind === "IMPORT_NEW").length, rejectedCount: classifications.filter((row) => !["IMPORT_NEW", "SAME_CURRENT"].includes(row.kind)).length };
  }
  globalThis.SellerAgentsStoreBackup = Object.freeze({ MAGIC, ENVELOPE_VERSION, PAYLOAD_VERSION, KDF_NAME, ENCRYPTION_NAME, KDF_ITERATIONS, LIMITS, payloadFromStores, validatePayload, encrypt, decrypt, summary });
})();
