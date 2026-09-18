/* Privileged extension-context only. No content-script/page API is exposed. */
(() => {
  "use strict";
  const VERSION = "credential_transfer_envelope_v1";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (bytes) => { let value = ""; for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte); return btoa(value); };
  const unb64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const clone = (value) => structuredClone(value);
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
  globalThis.SellerAgentsCredentialTransferCrypto = Object.freeze({ VERSION, generateRecipientKeyPair, encrypt, decrypt });
})();
