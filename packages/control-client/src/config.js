/* Build-time input for the browser control client. This checked-in profile is
 * intentionally LOCAL DEVELOPMENT; production packages must replace it from
 * the release trust export and origin receipt. */
(() => {
  "use strict";
  const override = globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__;
  const value = typeof override === "string" ? JSON.parse(override) : override || {
    environment: "LOCAL DEVELOPMENT",
    controlApiOrigin: "http://127.0.0.1:43100",
    portalOrigin: "http://127.0.0.1:43101",
    extensionVersion: "0.2.4",
    contractVersion: "control_plane_v2",
    aiReleaseScope: globalThis.__SELLER_AGENTS_PACKAGED_AI_RELEASE_SCOPE__ || null,
    trustBundle: {
      trustBundleVersion: "bootstrap_trust_bundle_v1",
      algorithm: "Ed25519",
      publicKeyFormat: "spki_der",
      publicKeyEncoding: "base64",
      fingerprintAlgorithm: "sha256",
      fingerprintEncoding: "lowercase_hex",
      keys: [{
        keyId: "config-local-development",
        publicKey: "MCowBQYDK2VwAyEAFG3DxyJOAU0cI1T50i6+tDUonQ74Qzw1Ra6USuEWYRg=",
        fingerprintSha256: "69e2ddf7c78d4221d06b65be0212063b923e4e827c2e271385fef0d04cce85dc",
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION"
      }]
    }
  };
  globalThis.SellerAgentsControlConfig = Object.freeze(value);
})();
