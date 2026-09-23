import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeFingerprint, verifyBrowserProof } from "./browser-proof.mjs";
test("native proof binds runtime bytes, source and freshness; an environment slogan is insufficient", () => {
  const root = mkdtempSync(join(tmpdir(), "browser-proof-"));
  const proofFile = root + ".json";
  try {
    writeFileSync(join(root, "manifest.json"), "{}");
    const proof = {status:"PASS",valid:true,tamperRejected:true,browser:"fixture-unit-only",runtimePath:root,runtimeSha256:runtimeFingerprint(root),sourceHead:"a".repeat(40),generatedAt:new Date().toISOString()};
    writeFileSync(proofFile, JSON.stringify(proof));
    assert.equal(verifyBrowserProof(root,proofFile,proof.sourceHead),true);
    assert.throws(() => verifyBrowserProof(root,undefined,proof.sourceHead));
    assert.throws(() => verifyBrowserProof(root,proofFile,"b".repeat(40)));
    writeFileSync(join(root,"manifest.json"),"{\"changed\":true}");
    assert.throws(() => verifyBrowserProof(root,proofFile,proof.sourceHead));
    writeFileSync(join(root,"manifest.json"),"{}");
    writeFileSync(proofFile,JSON.stringify({...proof,generatedAt:"2000-01-01T00:00:00Z"}));
    assert.throws(() => verifyBrowserProof(root,proofFile,proof.sourceHead));
  } finally {rmSync(root,{recursive:true,force:true});rmSync(proofFile,{force:true});}
});
