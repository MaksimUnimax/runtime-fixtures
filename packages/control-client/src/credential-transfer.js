/* Privileged extension-context only. No content-script/page API is exposed. */
(() => {
  "use strict";
  const VERSION = "credential_transfer_envelope_v1";
  const VAULT_VERSION = "credential_transfer_recipient_v1";
  const VAULT_DB = "seller_agents_credential_transfer_v1";
  const VAULT_STORE = "recipient_requests";
  const VAULT_PHASES = Object.freeze(["PREPARED", "ACTIVE", "RECEIVING", "IMPORTED_PENDING_ACK", "ACKED_RESULT"]);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (bytes) => { let value = ""; for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte); return btoa(value); };
  const unb64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const clone = (value) => structuredClone(value);
  const vaultError = (code) => Object.assign(new Error(code), { code });
  function aad(input) { return { version: VERSION, accountId: String(input.accountId), requestId: String(input.requestId), sourceDeviceId: String(input.sourceDeviceId), recipientDeviceId: String(input.recipientDeviceId), packetId: String(input.packetId) }; }
  function aadBytes(value) { return enc.encode(JSON.stringify(aad(value))); }
  async function importRecipientPublicKey(spki) { return crypto.subtle.importKey("spki", unb64(spki), { name: "ECDH", namedCurve: "P-256" }, false, []); }
  async function deriveAesKey(privateKey, publicKey, salt, info) {
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
    const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function generateRecipientKeyPair() {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    return { privateKey: pair.privateKey, publicKeySpki: b64(spki) };
  }
  async function encrypt(input) {
    if (!input?.payload || typeof input.payload !== "object") throw new Error("TRANSFER_PAYLOAD_INVALID");
    const recipientPublicKey = await importRecipientPublicKey(input.recipientPublicKeySpki);
    const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const ephemeralSpki = await crypto.subtle.exportKey("spki", ephemeral.publicKey);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const header = aad(input), key = await deriveAesKey(ephemeral.privateKey, recipientPublicKey, salt, aadBytes(header));
    const plaintext = enc.encode(JSON.stringify(clone(input.payload)));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadBytes(header), tagLength: 128 }, key, plaintext);
    return JSON.stringify({ envelopeVersion: VERSION, keyAgreement: "ECDH-P256", kdf: "HKDF-SHA-256", encryption: "AES-256-GCM", ephemeralPublicKeySpki: b64(ephemeralSpki), salt: b64(salt), iv: b64(iv), aad: header, ciphertext: b64(ciphertext) });
  }
  async function decrypt(input) {
    const envelope = typeof input.envelope === "string" ? JSON.parse(input.envelope) : input.envelope;
    if (!envelope || envelope.envelopeVersion !== VERSION || envelope.keyAgreement !== "ECDH-P256" || envelope.kdf !== "HKDF-SHA-256" || envelope.encryption !== "AES-256-GCM") throw new Error("TRANSFER_ENVELOPE_INVALID");
    const expected = aad(input), actual = JSON.stringify(envelope.aad);
    if (actual !== JSON.stringify(expected)) throw new Error("TRANSFER_AAD_MISMATCH");
    const sourcePublicKey = await crypto.subtle.importKey("spki", unb64(envelope.ephemeralPublicKeySpki), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await deriveAesKey(input.privateKey, sourcePublicKey, unb64(envelope.salt), aadBytes(expected));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv), additionalData: aadBytes(expected), tagLength: 128 }, key, unb64(envelope.ciphertext));
    return JSON.parse(dec.decode(plaintext));
  }

  let vaultDbFlight = null, vaultMutationQueue = Promise.resolve();
  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || vaultError("TRANSFER_VAULT_REQUEST_FAILED"));
    });
  }
  function idbTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => reject(transaction.error || vaultError("TRANSFER_VAULT_TRANSACTION_ABORTED"));
      transaction.onerror = () => reject(transaction.error || vaultError("TRANSFER_VAULT_TRANSACTION_FAILED"));
    });
  }
  async function settleIdb(request, done) {
    try { const result = await idbRequest(request); await done; return result; }
    catch (failure) { try { await done; } catch (_) {} throw failure; }
  }
  async function openVault() {
    if (!globalThis.indexedDB?.open) throw vaultError("TRANSFER_VAULT_UNAVAILABLE");
    if (!vaultDbFlight) {
      vaultDbFlight = new Promise((resolve, reject) => {
        const request = indexedDB.open(VAULT_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE, { keyPath: "requestId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || vaultError("TRANSFER_VAULT_OPEN_FAILED"));
        request.onblocked = () => reject(vaultError("TRANSFER_VAULT_BLOCKED"));
      }).catch((failure) => { vaultDbFlight = null; throw failure; });
    }
    return vaultDbFlight;
  }
  function queueVaultMutation(fn) {
    const run = vaultMutationQueue.then(fn);
    vaultMutationQueue = run.catch(() => {});
    return run;
  }
  function validPrivateKey(key) {
    return Boolean(key && key.type === "private" && key.extractable === false && key.algorithm?.name === "ECDH" && key.algorithm?.namedCurve === "P-256");
  }
  function validateVaultRecord(record) {
    if (!record || record.vaultVersion !== VAULT_VERSION || typeof record.requestId !== "string" || typeof record.accountId !== "string" || typeof record.recipientDeviceId !== "string" || typeof record.sessionId !== "string" || !VAULT_PHASES.includes(record.phase) || typeof record.publicKeySpki !== "string" || !Array.isArray(record.selectedStoreIds) || !record.selectedStoreIds.every((value) => typeof value === "string") || !Number.isInteger(record.expiresInSeconds) || record.expiresInSeconds < 60 || record.expiresInSeconds > 900 || typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt))) throw vaultError("TRANSFER_VAULT_RECORD_INVALID");
    if (record.phase === "ACKED_RESULT") {
      if (record.privateKey !== null || !record.result || record.result.importState !== "IMPORTED") throw vaultError("TRANSFER_VAULT_RECORD_INVALID");
    } else if (!validPrivateKey(record.privateKey)) throw vaultError("TRANSFER_VAULT_KEY_INVALID");
    return record;
  }
  async function readUnlocked(requestId) {
    const db = await openVault(), tx = db.transaction(VAULT_STORE, "readonly"), done = idbTransaction(tx);
    const value = await settleIdb(tx.objectStore(VAULT_STORE).get(requestId), done);
    return value || null;
  }
  async function writeUnlocked(record) {
    validateVaultRecord(record);
    const db = await openVault(), tx = db.transaction(VAULT_STORE, "readwrite"), done = idbTransaction(tx);
    await settleIdb(tx.objectStore(VAULT_STORE).put(record), done);
    return record;
  }
  async function listUnlocked() {
    const db = await openVault(), tx = db.transaction(VAULT_STORE, "readonly"), done = idbTransaction(tx);
    const values = await settleIdb(tx.objectStore(VAULT_STORE).getAll(), done);
    return Array.isArray(values) ? values : [];
  }
  async function removeUnlocked(requestId) {
    const db = await openVault(), tx = db.transaction(VAULT_STORE, "readwrite"), done = idbTransaction(tx);
    await settleIdb(tx.objectStore(VAULT_STORE).delete(requestId), done);
    return true;
  }
  async function clearUnlocked() {
    const db = await openVault(), tx = db.transaction(VAULT_STORE, "readwrite"), done = idbTransaction(tx);
    const store = tx.objectStore(VAULT_STORE);
    await settleIdb(store.clear(), done);
    return true;
  }
  async function pruneUnlocked(nowMs) {
    const values = await listUnlocked();
    let removed = 0;
    for (const record of values) {
      if (!Number.isFinite(Date.parse(record?.expiresAt)) || Date.parse(record.expiresAt) > nowMs) continue;
      await removeUnlocked(record.requestId); removed += 1;
    }
    return removed;
  }
  const vault = Object.freeze({
    VERSION: VAULT_VERSION,
    phases: VAULT_PHASES,
    get: (requestId) => queueVaultMutation(() => readUnlocked(String(requestId || ""))).then(value => value ? clone(value) : null),
    list: () => queueVaultMutation(() => listUnlocked()).then(values => values.map(clone)),
    put: (record) => queueVaultMutation(() => writeUnlocked(clone(record))).then(value => clone(value)),
    update: (requestId, mutate) => queueVaultMutation(async () => {
      const current = await readUnlocked(String(requestId || ""));
      if (!current) throw vaultError("TRANSFER_VAULT_RECORD_MISSING");
      const next = mutate(clone(current));
      if (!next || next.requestId !== current.requestId) throw vaultError("TRANSFER_VAULT_RECORD_INVALID");
      await writeUnlocked(next);
      return clone(next);
    }),
    remove: (requestId) => queueVaultMutation(() => removeUnlocked(String(requestId || ""))),
    clear: () => queueVaultMutation(clearUnlocked),
    prune: (nowMs = Date.now()) => queueVaultMutation(() => pruneUnlocked(Number(nowMs))),
  });

  globalThis.SellerAgentsCredentialTransferCrypto = Object.freeze({ VERSION, generateRecipientKeyPair, encrypt, decrypt });
  globalThis.SellerAgentsCredentialTransferVault = vault;
})();
