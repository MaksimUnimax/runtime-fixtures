import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Audit regression: self-declared integrity/trust is insufficient release evidence.
// C01 must retain this negative case when implementing a real positive validator.
test("non-extension archive and arbitrary trust ID never receive release PASS", () => {
  const dir = mkdtempSync(join(tmpdir(), "octoport-bad-rc-"));
  try {
    const made = spawnSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('NOT_AN_EXTENSION','fixture'); z.close()", join(dir, "fake.zip")]);
    assert.equal(made.status, 0);
    const hash = createHash("sha256").update(readFileSync(join(dir, "fake.zip"))).digest("hex");
    writeFileSync(join(dir, "B1_RC_MANIFEST.json"), JSON.stringify({
      packages: { chromium: {filename:"fake.zip",sha256:hash,serverEndpoints:["https://api.octoport.ru"]},
        firefox:{filename:"fake.zip",sha256:hash}},
      migrationLevel:48, productionPublished:false,
      bootstrapTrust:{keyId:"any-invented-key",privateMaterialPackaged:false},
      externalGates:{ownerLiveQ1C:"NOT_EXECUTABLE"}
    }));
    const result = spawnSync(process.execPath, [resolve("tooling/b1/release-preflight.mjs"), dir], {encoding:"utf8"});
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /"status":\s*"PASS"/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test("retired preparer does not invent release metadata or write a candidate", () => {
  const dir = mkdtempSync(join(tmpdir(), "octoport-retired-rc-"));
  try {
    const result = spawnSync(process.execPath,[resolve("tooling/b1/prepare-release-candidate.mjs"),join(dir,"out")],{encoding:"utf8"});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/LEGACY_RELEASE_TOOL_QUARANTINED/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
