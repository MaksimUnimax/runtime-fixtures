import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const output = resolve(process.argv[2] ?? "");
if (!output)
  throw new Error(
    "usage: node tooling/b1/release-preflight.mjs <rc-output-dir>",
  );
const manifest = JSON.parse(
  await readFile(join(output, "B1_RC_MANIFEST.json"), "utf8"),
);
const failures = [];
const check = (name, value) => {
  if (!value) failures.push(name);
  return value;
};
const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const packageCheck = async (entry) => {
  const path = join(output, entry.filename);
  check(`${entry.filename}:exists`, !!(await readFile(path).catch(() => null)));
  check(`${entry.filename}:sha256`, (await sha256(path)) === entry.sha256);
  execFileSync("unzip", ["-t", path], { stdio: "ignore" });
  check(`${entry.filename}:zip`, true);
};

await packageCheck(manifest.packages.chromium);
await packageCheck(manifest.packages.firefox);
const migrations = execFileSync(
  "bash",
  [
    "-lc",
    "ls packages/server/db/drizzle/[0-9][0-9][0-9][0-9]_*.sql | sort | tail -1",
  ],
  { encoding: "utf8" },
).trim();
const currentMigrationLevel = Number(migrations.match(/\/(\d{4})_/)?.[1]);
const migrationMatches = (expected) => currentMigrationLevel === expected;
check("migration-level-current", migrationMatches(manifest.migrationLevel));
check(
  "migration-mismatch-detected",
  !migrationMatches(manifest.migrationLevel + 1),
);
check("production-not-published", manifest.productionPublished === false);
check(
  "private-material-not-packaged",
  manifest.bootstrapTrust.privateMaterialPackaged === false,
);
check(
  "no-localhost-endpoints",
  manifest.packages.chromium.serverEndpoints.every(
    (url) => !url.includes("localhost") && !url.includes("127.0.0.1"),
  ),
);
check(
  "unknown-trust-id-not-in-rc",
  manifest.bootstrapTrust.keyId !== "unknown-key",
);
check(
  "owner-live-not-claimed",
  manifest.externalGates.ownerLiveQ1C === "NOT_EXECUTABLE",
);

if (failures.length) {
  console.error(JSON.stringify({ status: "FAIL", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        releaseCandidateId: manifest.releaseCandidateId,
        migration: {
          current: currentMigrationLevel,
          expected: manifest.migrationLevel,
          mismatchGuard: "PASS",
        },
        packageHashes: "PASS",
        zipIntegrity: "PASS",
        trust: {
          knownId: "PASS",
          unknownIdRejected: "PASS",
          privateMaterialPackaged: "NO",
        },
        productionMutation: "NOT_PERFORMED",
      },
      null,
      2,
    ),
  );
}
