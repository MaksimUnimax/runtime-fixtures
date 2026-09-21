import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const output = resolve(process.argv[2] ?? "");
if (!output)
  throw new Error(
    "usage: node tooling/b1/prepare-release-candidate.mjs <new-output-dir>",
  );

const chromiumSource =
  process.env.B1_CHROMIUM_PACKAGE ??
  "/root/owner-handoff/seller-agents-owner-test-ready/SELLER_AGENTS_OWNER_TEST_CHROMIUM_FINAL.zip";
const firefoxSource =
  process.env.B1_FIREFOX_PACKAGE ??
  "/root/owner-handoff/seller-agents-owner-test-ready/SELLER_AGENTS_OWNER_TEST_FIREFOX_FINAL.zip";
const sourceHead =
  process.env.B1_SOURCE_HEAD ?? "151b06bf25b8ff6abb2e59c76518c4e615860851";
const sourceTree =
  process.env.B1_SOURCE_TREE ?? "d73179e73b797759398ca2992efa227bc1f6155d";
const buildTimestamp =
  process.env.B1_BUILD_TIMESTAMP ?? new Date().toISOString();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const zipManifest = (archive) =>
  JSON.parse(
    execFileSync("unzip", ["-p", archive, "manifest.json"], {
      encoding: "utf8",
    }),
  );
const zipInventory = (archive) =>
  execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

async function packageReceipt(source, filename, target, browserTarget, status) {
  const bytes = await readFile(source);
  await copyFile(source, join(output, filename));
  const manifest = zipManifest(source);
  return {
    filename,
    sourcePath: source,
    bytes: bytes.length,
    sha256: sha256(bytes),
    inventoryCount: zipInventory(source).length,
    manifestVersion: manifest.version,
    manifestName: manifest.name,
    browserTarget,
    status,
    serverEndpoints: ["https://api.octoport.ru", "https://app.octoport.ru"],
  };
}

await mkdir(output, { recursive: false });
const chromium = await packageReceipt(
  chromiumSource,
  "SELLER_AGENTS_FREE_BETA_RC_0.2.4_CHROMIUM.zip",
  output,
  ["chrome", "opera", "yandex_chromium"],
  {
    chrome: "MANUAL_FOLLOW_UP_REQUIRED",
    opera: "BROWSER_ACCEPTED_BOUNDED_AUTOMATED",
    yandex_chromium: "PACKAGE_READY_RUNTIME_ENVIRONMENT_DEFERRED",
  },
);
const firefox = await packageReceipt(
  firefoxSource,
  "SELLER_AGENTS_FREE_BETA_RC_0.2.4_FIREFOX.zip",
  output,
  ["firefox"],
  "PACKAGE_READY_RUNTIME_ENVIRONMENT_DEFERRED",
);

const manifest = {
  manifestVersion: "b1_free_beta_rc_v1",
  releaseCandidateId: "seller-agents-free-beta-rc-2026-09-21",
  buildTimestamp,
  source: { head: sourceHead, tree: sourceTree },
  productVersion: "0.2.4",
  serverContract: "control_plane_v1",
  migrationLevel: 18,
  bootstrapTrust: {
    keyId: "octoport-preprod-2026-09-19",
    fingerprintSha256:
      "edc47821df296868c7061069ed50fa742f70a75889bd010dadef5166fadc4645",
    privateMaterialPackaged: false,
  },
  packages: { chromium, firefox },
  safari: { status: "MACOS_TOOLING_DEFERRED", packagePrepared: false },
  externalGates: {
    smtp: "WAITING_EXTERNAL_INFRA_ACTION",
    ownerLiveQ1C: "NOT_EXECUTABLE",
    browserPublication: "OWNER_ACTION_REQUIRED",
  },
  productionPublished: false,
};
await writeFile(
  join(output, "B1_RC_MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      output,
      releaseCandidateId: manifest.releaseCandidateId,
      chromium: chromium.sha256,
      firefox: firefox.sha256,
    },
    null,
    2,
  ),
);
