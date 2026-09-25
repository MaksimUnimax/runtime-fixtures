#!/usr/bin/env node
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const apiPort = process.env.SA_I1_API_PORT ?? "43100";
const portalPort = process.env.SA_I1_PORTAL_PORT ?? "43101";

const output = process.argv[2];
const trustPath = process.argv[3];
if (!output) throw new Error("usage: make-browser-config.mjs PRIVATE_KEY_PATH");
let trustBundle;
if (trustPath) {
  trustBundle = JSON.parse(readFileSync(trustPath, "utf8"));
  writeFileSync(output, Buffer.alloc(0), { mode: 0o600 });
} else {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  writeFileSync(output, pkcs8, { mode: 0o600 });
  const b64 = spki.toString("base64");
  const fingerprintSha256 = createHash("sha256").update(spki).digest("hex");
  trustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "browser-fixture-key",
        publicKey: b64,
        fingerprintSha256,
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
}
process.stdout.write(
  JSON.stringify({
    environment: "LOCAL DEVELOPMENT",
    controlApiOrigin: `http://127.0.0.1:${apiPort}`,
    portalOrigin: `http://127.0.0.1:${portalPort}`,
    extensionVersion: "0.2.4",
    contractVersion: "control_plane_v2",
    trustBundle,
  }),
);
