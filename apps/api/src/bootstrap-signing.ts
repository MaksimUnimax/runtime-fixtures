import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";
import {
  type BootstrapSnapshotPayloadV1,
  type BootstrapSnapshotPayloadV2,
  type HealthClaimV1,
} from "@product/contracts";
import { StableMachineIdentifierV1Schema } from "@product/shared";
import {
  resolveSigningKeyLifecycle,
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
  signHealthClaimV1,
  type P3BootstrapPolicyCatalog,
  type SigningKeyMetadata,
} from "@product/remote-config";
import type { BootstrapSnapshotSigningService } from "@product/bootstrap";

const RingSchema = z
  .object({
    version: z.literal(1),
    keys: z
      .array(
        z
          .object({
            keyId: StableMachineIdentifierV1Schema,
            privateKeyPemB64: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export type ConfigSigningKeyMaterial = {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicKeySpkiDer: Buffer;
  readonly publicKeySha256: string;
};

export type ConfigSigningMaterial = {
  readonly keys: ReadonlyMap<string, ConfigSigningKeyMaterial>;
  /** Compatibility projection for the P3.4 singleton loader contract. */
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicKeySpkiDer: Buffer;
  readonly publicKeySha256: string;
  readonly sign: (
    payload: BootstrapSnapshotPayloadV1,
  ) => ReturnType<typeof signBootstrapSnapshot>;
};

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error("invalid base64");
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value)
    throw new Error("non-canonical base64");
  return decoded;
}

function parseEntry(keyId: string, encoded: string): ConfigSigningKeyMaterial {
  if (!StableMachineIdentifierV1Schema.safeParse(keyId).success)
    throw new Error("invalid key id");
  const pem = decodeCanonicalBase64(encoded);
  const privateKey = createPrivateKey({
    key: pem.toString("utf8"),
    format: "pem",
    type: "pkcs8",
  });
  if (
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "ed25519"
  )
    throw new Error("not Ed25519 private key");
  const publicKey = createPublicKey(privateKey);
  const publicKeySpkiDer = publicKey.export({ format: "der", type: "spki" });
  return {
    keyId,
    privateKey,
    publicKey,
    publicKeySpkiDer,
    publicKeySha256: createHash("sha256")
      .update(publicKeySpkiDer)
      .digest("hex"),
  };
}

/** API-only composition: private config signing material never enters AppConfig or PostgreSQL. */
export function loadConfigSigningMaterial(
  environment: NodeJS.ProcessEnv,
): ConfigSigningMaterial {
  try {
    const ringConfigured =
      environment.CONFIG_SIGNING_KEY_RING_JSON !== undefined;
    const legacyId = environment.CONFIG_SIGNING_KEY_ID;
    const legacyPem = environment.CONFIG_SIGNING_PRIVATE_KEY_PEM_B64;
    const legacyConfigured = legacyId !== undefined || legacyPem !== undefined;
    if (ringConfigured && legacyConfigured)
      throw new Error("ambiguous config signing configuration");

    const entries = ringConfigured
      ? RingSchema.parse(
          JSON.parse(environment.CONFIG_SIGNING_KEY_RING_JSON!),
        ).keys.map((entry) => parseEntry(entry.keyId, entry.privateKeyPemB64))
      : legacyId !== undefined || legacyPem !== undefined
        ? legacyId !== undefined && legacyPem !== undefined
          ? [parseEntry(legacyId, legacyPem)]
          : (() => {
              throw new Error("incomplete legacy config signing configuration");
            })()
        : (() => {
            throw new Error("missing config signing configuration");
          })();
    const byId = new Map<string, ConfigSigningKeyMaterial>();
    const fingerprints = new Set<string>();
    for (const entry of entries) {
      if (byId.has(entry.keyId) || fingerprints.has(entry.publicKeySha256))
        throw new Error("duplicate config signing key");
      byId.set(entry.keyId, entry);
      fingerprints.add(entry.publicKeySha256);
    }
    const first = entries[0]!;
    return {
      keys: byId,
      keyId: first.keyId,
      privateKey: first.privateKey,
      publicKey: first.publicKey,
      publicKeySpkiDer: first.publicKeySpkiDer,
      publicKeySha256: first.publicKeySha256,
      sign: (payload) =>
        signBootstrapSnapshot(payload, first.keyId, first.privateKey),
    };
  } catch {
    throw new Error("bootstrap signing configuration is invalid");
  }
}

export function bindConfigSigningKeyMaterial(
  material: ConfigSigningKeyMaterial,
  metadata: SigningKeyMetadata | undefined,
): void {
  if (
    !metadata ||
    metadata.keyId !== material.keyId ||
    metadata.algorithm !== "Ed25519" ||
    !Buffer.from(metadata.publicKeySpkiDer).equals(material.publicKeySpkiDer) ||
    metadata.publicKeySha256 !== material.publicKeySha256
  )
    throw new Error("bootstrap signing key metadata binding is invalid");
}

/** Backward-compatible singleton binding helper retained for the P3.4 tests. */
export function bindConfigSigningMaterial(
  material: ConfigSigningMaterial,
  metadata: SigningKeyMetadata | undefined,
): void {
  bindConfigSigningKeyMaterial(
    {
      keyId: material.keyId,
      privateKey: material.privateKey,
      publicKey: material.publicKey,
      publicKeySpkiDer: material.publicKeySpkiDer,
      publicKeySha256: material.publicKeySha256,
    },
    metadata,
  );
}

export function bindConfigSigningRing(
  material: ConfigSigningMaterial,
  metadataFor: (keyId: string) => Promise<SigningKeyMetadata | undefined>,
): Promise<void> {
  return Promise.all(
    [...material.keys.values()].map(async (entry) =>
      bindConfigSigningKeyMaterial(entry, await metadataFor(entry.keyId)),
    ),
  ).then(() => undefined);
}

export function createConfigSigningService(
  material: ConfigSigningMaterial,
  catalog: Pick<
    P3BootstrapPolicyCatalog,
    "findSigningKey" | "listSigningKeyEvents"
  >,
): BootstrapSnapshotSigningService {
  return {
    async sign(keyId, payload) {
      const entry = material.keys.get(keyId);
      const metadata = await catalog.findSigningKey(keyId);
      if (!entry || !metadata) throw new Error("signing key unavailable");
      bindConfigSigningKeyMaterial(entry, metadata);
      const lifecycle = resolveSigningKeyLifecycle(
        await catalog.listSigningKeyEvents(keyId),
      );
      if (lifecycle.state !== "ACTIVE")
        throw new Error("signing key is not active");
      return signBootstrapSnapshot(payload, keyId, entry.privateKey);
    },
    async signV2(keyId, payload: BootstrapSnapshotPayloadV2) {
      const entry = material.keys.get(keyId);
      const metadata = await catalog.findSigningKey(keyId);
      if (!entry || !metadata) throw new Error("signing key unavailable");
      bindConfigSigningKeyMaterial(entry, metadata);
      const lifecycle = resolveSigningKeyLifecycle(
        await catalog.listSigningKeyEvents(keyId),
      );
      if (lifecycle.state !== "ACTIVE")
        throw new Error("signing key is not active");
      return signBootstrapSnapshotV2(payload, keyId, entry.privateKey);
    },
    async signHealth(keyId: string, claim: HealthClaimV1) {
      const entry = material.keys.get(keyId);
      const metadata = await catalog.findSigningKey(keyId);
      if (!entry || !metadata) throw new Error("signing key unavailable");
      bindConfigSigningKeyMaterial(entry, metadata);
      const lifecycle = resolveSigningKeyLifecycle(
        await catalog.listSigningKeyEvents(keyId),
      );
      if (lifecycle.state !== "ACTIVE")
        throw new Error("signing key is not active");
      return signHealthClaimV1(claim, keyId, entry.privateKey);
    },
  };
}
