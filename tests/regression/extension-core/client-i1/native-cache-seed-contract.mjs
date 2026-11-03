import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeWorker } from "../worker-harness.mjs";

// Execute the actual Python fixtures' seed expressions with the composed client.
// Python AST extraction does not import Playwright or start a browser/server.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const runtime = path.resolve(process.argv[2]);
const authKey = "seller_agents_control_auth_v2";
const excluded = [
  "chatgpt",
  "qwen",
  "deepseek",
  "grok",
  "claude",
  "gemini",
  "kimi",
];
const seedPaths = [
  "tests/regression/extension-core/browser_application.py",
  "tests/regression/extension-core/client-i1/browser_c1_acceptance.py",
];
const extract = spawnSync(
  process.env.WB_TEST_PYTHON || "python3",
  [
    "-c",
    `
import ast,json,pathlib,sys
out=[]
for name in sys.argv[2:]:
 source=(pathlib.Path(sys.argv[1])/name).read_text()
 function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='seed_authority')
 expressions=[ast.literal_eval(n.args[0]) for n in ast.walk(function) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='evaluate']
 assert len(expressions)==1
 out.append({'path':name,'expression':expressions[0]})
print(json.dumps(out))
`,
    root,
    ...seedPaths,
  ],
  { encoding: "utf8", timeout: 5000 },
);
assert.equal(extract.status, 0, extract.stderr);
const seeds = JSON.parse(extract.stdout);
const cases = [];
const projection = (status) => ({
  authenticated: status.authenticated,
  workAllowed: status.workAllowed,
  generation: status.generation,
  error: status.lastError?.code || null,
});
async function check(id, fn) {
  try {
    await fn();
    cases.push({ id, status: "PASS" });
  } catch (error) {
    cases.push({ id, status: "FAIL", error: error.message });
  }
}
async function restore(
  seed,
  { family = "alice", unconfigured = false, mutate } = {},
) {
  const backing = { local: {}, session: {} };
  const first = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    aiFamily: family,
  });
  let saved;
  try {
    await first.call("(" + seed.expression + ")", {
      pkcs8: backing.local.__seller_agents_fixture_signing_key.privateKey,
      fixtureKeyId: "fixture-key",
      aiFamily: family,
      profileRevision: 1,
      composerReference: "composer-root",
      composerKind: "packaged_selector_reference",
      composerRole: null,
      initialAiUnconfigured: unconfigured,
    });
    saved = structuredClone(backing.local[authKey]);
    mutate?.(backing.local[authKey]);
    assert.equal(first.network.length, 0);
    assert.equal(first.controlNetwork.length, 0);
  } finally {
    first.close();
  }
  const resumed = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    aiFamily: family,
  });
  try {
    const status = await resumed.call("SellerAgentsControlClient.status");
    assert.equal(
      resumed.network.length,
      0,
      "restore must not fetch provider data",
    );
    assert.equal(
      resumed.controlNetwork.length,
      0,
      "restore must use cached signed authority",
    );
    return { status, saved, current: structuredClone(backing.local[authKey]) };
  } finally {
    resumed.close();
  }
}
for (const seed of seeds) {
  await check(seed.path + "/Alice-signed-cache-restores", async () => {
    const { status, saved, current } = await restore(seed);
    assert.deepEqual(projection(status), {
      authenticated: true,
      workAllowed: true,
      generation: 1,
      error: null,
    });
    assert.equal(current.credentials.deviceId, saved.credentials.deviceId);
    assert.equal(current.credentials.sessionId, saved.credentials.sessionId);
    assert.deepEqual(current.authority.envelope, saved.authority.envelope);
    assert.deepEqual(
      current.authority.cacheBinding,
      saved.authority.cacheBinding,
    );
    assert.equal(
      current.cacheClock.trustedServerTimeMs,
      saved.cacheClock.trustedServerTimeMs,
    );
  });
  for (const [id, mutate, code] of [
    [
      "legacy-v1",
      (auth) => {
        auth.authority.cacheBinding.cacheVersion = "control_cache_binding_v1";
        delete auth.authority.cacheBinding.aiReleaseScopeSha256;
      },
      "STORED_CACHE_BINDING_INVALID",
    ],
    [
      "missing-scope",
      (auth) => {
        delete auth.authority.cacheBinding.aiReleaseScopeSha256;
      },
      "STORED_CACHE_BINDING_INVALID",
    ],
    [
      "wrong-scope",
      (auth) => {
        auth.authority.cacheBinding.aiReleaseScopeSha256 = "0".repeat(64);
      },
      "STORED_CACHE_BINDING_INVALID",
    ],
  ])
    await check(seed.path + "/rejects-" + id, async () => {
      const { status } = await restore(seed, { mutate });
      assert.equal(status.workAllowed, false);
      assert.equal(status.lastError?.code, code);
    });
  for (const family of excluded)
    await check(seed.path + "/denies-retained-" + family, async () => {
      const { status } = await restore(seed, { family });
      assert.equal(status.workAllowed, false);
    });
}
await check(
  "native-start-entry/account-only-UNCONFIGURED-restores",
  async () => {
    const { status, current } = await restore(seeds[1], { unconfigured: true });
    assert.equal(
      status.authenticated,
      true,
      JSON.stringify(projection(status)),
    );
    assert.equal(status.workAllowed, false);
    assert.equal(status.lastError, null);
    assert.equal(current.authority.payload.ai.status, "UNCONFIGURED");
    assert.equal(current.authority.cacheBinding.detectedAi, null);
  },
);
console.log(
  JSON.stringify(
    {
      scope:
        "actual native fixture seed JS and actual composed client restore in Node VM; no browser, DB or network",
      seeds: seeds.map((seed) => ({
        path: seed.path,
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join(root, seed.path)))
          .digest("hex"),
      })),
      cases,
      summary: {
        PASS: cases.filter((c) => c.status === "PASS").length,
        FAIL: cases.filter((c) => c.status === "FAIL").length,
      },
    },
    null,
    2,
  ),
);
if (cases.some((c) => c.status === "FAIL")) process.exitCode = 1;
