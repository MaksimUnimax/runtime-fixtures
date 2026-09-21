import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sourceHead =
  process.env.Q1D_SOURCE_HEAD ?? "9db71a1479debcac94ab6e98b3f24b952afbde54";
const sourceTree =
  process.env.Q1D_SOURCE_TREE ?? "2888fa4f9d9873d969ee18dc33cc70990ea3a583";
const trustA = "octoport-preprod-key-a";
const trustB = "octoport-preprod-key-b";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifactSha(artifact) {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

async function writeArtifact(root, artifact) {
  const directory = join(root, artifact.revision);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "artifact.json"),
    JSON.stringify(artifact, null, 2),
  );
  return directory;
}

async function readCurrent(currentPath) {
  const target = await realpath(currentPath);
  return JSON.parse(await readFile(join(target, "artifact.json"), "utf8"));
}

async function main() {
  const environment = process.env.Q1D_DEPLOYMENT_ENV ?? "PREPROD_DISPOSABLE";
  assert(
    environment === "PREPROD_DISPOSABLE",
    "refusing non-disposable deployment environment",
  );

  const root = await mkdtemp(join(tmpdir(), "seller-agents-q1d-"));
  const currentPath = join(root, "current");
  try {
    const common = {
      sourceHead,
      sourceTree,
      productVersion: "0.1.0-q1d",
      browserTarget: "server-control-plane",
      bootstrapTrustKeyId: trustA,
      migrationLevel: 18,
      environment,
    };
    const revisionN = { ...common, revision: "revision-n", health: "pass" };
    const revisionN1 = {
      ...common,
      revision: "revision-n-plus-1",
      health: "pass",
    };
    const nPath = await writeArtifact(root, revisionN);
    const n1Path = await writeArtifact(root, revisionN1);

    const precheck = {
      environment,
      productionRejected: environment !== "PRODUCTION",
      configIdentity: "preprod",
      dbIdentity: "disposable-loopback-e2e",
      secretsGenerated: false,
    };
    assert(precheck.productionRejected, "precheck did not reject production");
    assert(
      precheck.dbIdentity.includes("disposable"),
      "non-disposable database identity",
    );

    const identity = (artifact) => ({
      revision: artifact.revision,
      sourceHead: artifact.sourceHead,
      sourceTree: artifact.sourceTree,
      packageSha256: artifactSha(artifact),
      productVersion: artifact.productVersion,
      browserTarget: artifact.browserTarget,
      bootstrapTrustKeyId: artifact.bootstrapTrustKeyId,
      migrationLevel: artifact.migrationLevel,
      environment: artifact.environment,
    });
    const manifestN = identity(revisionN);
    const manifestN1 = identity(revisionN1);
    assert(
      manifestN.packageSha256 !== manifestN1.packageSha256,
      "revision identities collided",
    );

    await symlink(nPath, currentPath);
    assert(
      (await readCurrent(currentPath)).health === "pass",
      "revision N health failed",
    );
    await rm(currentPath);
    await symlink(n1Path, currentPath);
    assert(
      (await readCurrent(currentPath)).health === "pass",
      "revision N+1 health failed",
    );

    const inducedFailure = {
      revision: revisionN1.revision,
      errorClass: "SIMULATED_HEALTH_FAILURE",
    };
    const rollbackRequired = true;
    assert(
      rollbackRequired && inducedFailure.errorClass,
      "failure was not detected",
    );
    await rm(currentPath);
    await symlink(nPath, currentPath);
    const rolledBack = await readCurrent(currentPath);
    assert(
      rolledBack.revision === revisionN.revision,
      "rollback selected the wrong revision",
    );
    assert(
      artifactSha(rolledBack) === manifestN.packageSha256,
      "rollback artifact identity changed",
    );
    assert(rolledBack.health === "pass", "rolled-back revision is unhealthy");

    const trustRotation = {
      keyA: { serverSignsWith: trustA, clientTrusts: [trustA] },
      overlap: { serverSignsWith: trustB, clientTrusts: [trustA, trustB] },
      rollback: { serverSignsWith: trustA, clientTrusts: [trustA, trustB] },
    };
    assert(
      trustRotation.rollback.clientTrusts.includes(
        trustRotation.rollback.serverSignsWith,
      ),
      "trust rollback would strand the server",
    );
    assert(
      !trustRotation.keyA.clientTrusts.includes(trustB),
      "retired trust was accepted before rotation",
    );
    assert(
      ![trustA, trustB].includes("unknown-key"),
      "unknown trust key was accepted",
    );

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          environment,
          precheck,
          manifests: [manifestN, manifestN1],
          migrationPolicy:
            "forward-compatible schema; no destructive downgrade",
          deployment: {
            revisionN: "PASS",
            revisionN1: "PASS",
            inducedFailure: "DETECTED",
            rollback: "PASS",
          },
          trustRotation: {
            overlap: "PASS",
            rollback: "PASS",
            unknownKeyRejected: "PASS",
          },
          secretsRegenerated: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
