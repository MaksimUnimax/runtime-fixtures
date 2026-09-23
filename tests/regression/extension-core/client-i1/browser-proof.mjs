import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
export function runtimeFingerprint(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (lstatSync(file).isSymbolicLink()) throw new Error("Runtime symlink is not accepted");
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  walk(root);
  const rows = files.map(file => [relative(root, file).split("\\").join("/"), createHash("sha256").update(readFileSync(file)).digest("hex")]);
  rows.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return createHash("sha256").update(rows.map(([name,hash]) => name + "\0" + hash + "\n").join("")).digest("hex");
}
export function verifyBrowserProof(runtime, file, sourceHead) {
  if (!file) throw new Error("Native browser proof file is required");
  const proof = JSON.parse(readFileSync(file, "utf8"));
  const age = Date.now() - Date.parse(proof.generatedAt);
  if (proof.status !== "PASS" || proof.valid !== true || proof.tamperRejected !== true ||
      typeof proof.browser !== "string" || !proof.browser ||
      proof.runtimePath !== resolve(runtime) || proof.runtimeSha256 !== runtimeFingerprint(runtime) ||
      proof.sourceHead !== sourceHead || !Number.isFinite(age) || age < 0 || age > 30 * 60 * 1000) {
    throw new Error("Native browser proof is stale or does not match this runtime/source");
  }
  return true;
}
export function currentSourceHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
}
