import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = process.argv[2] || "/root/octoport-b-backend";
const preservedAliceTest =
  "/root/octoport-control/logs/A/a03-alice-universal-binding-installed-parity-r1-20261005/WIP_browser_conversation_binding_alice.py";
const preservedAliceTestSha256 =
  "171c58ee74b26a4812d877f135c6a444450c02a424b2832318368ab66a5510fb";
const preservedResult =
  "/root/octoport-control/logs/A/a03-alice-universal-binding-installed-parity-r1-20261005/OWNER_RETRY_RESULT_R1.json";
const ownerStartSource = "86d1573ea48493336d06773c77d86cee3d76e244";

function git(...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}
const main = git("rev-parse", "origin/main");
const show = (path) => git("show", `${main}:${path}`);
function section(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing section end: ${end}`);
  return source.slice(from, to);
}
const failure = JSON.parse(fs.readFileSync(preservedResult, "utf8"));
assert.equal(failure.source.sha, "6311d021223d1839f78b5d5861c632028e5ebb61");
assert.equal(failure.test.sha256, preservedAliceTestSha256, "preserved retry fixture identity drift");
assert.equal(failure.test.result, "FAIL");
assert.match(failure.test.failure, /Timed out: Alice active work/);
assert.deepEqual(failure.test.passed_cases, [
  "alice-explicit-active-id-confirms-without-route-grammar",
]);

const oldAliceBytes = fs.readFileSync(preservedAliceTest);
assert.equal(
  createHash("sha256").update(oldAliceBytes).digest("hex"),
  preservedAliceTestSha256,
  "preserved executed Alice fixture hash drift",
);
const oldAlice = oldAliceBytes.toString("utf8");
const sendHook = section(oldAlice, "def install_send_hook(page):", "\n\ndef append_help_block");
assert.match(sendHook, /node\.dataset\.messageRole\s*=\s*['"]user['"]/);
assert.doesNotMatch(sendHook, /node\.dataset\.messageRole\s*=\s*['"]alice['"]/);
assert.doesNotMatch(sendHook, /data-message-role=.alice.|dataset\.messageRole\s*=\s*['"]alice['"]/);
assert.match(sendHook, /globalThis\.sent\.push\(value\)/);
assert.match(sendHook, /composer\.value\s*=\s*['"]/);

const patches = JSON.parse(show("apps/extension/application-patches.json"));
const rawContent = show("apps/extension/src/imported/ozon-v0.1.22/content_script.js");
assert.equal(
  patches.some((row) =>
    row.target === "content_script.js" &&
    String(row.old).includes("function startWorkStartResponseWatch")
  ),
  false,
  "current application patches unexpectedly rewrite the response-watch function",
);
const content = rawContent;
const watch = section(
  content,
  "  function startWorkStartResponseWatch(",
  "\n\n  async function sendWorkSessionPrompt(",
);
assert.match(watch, /assistantMessages\(\)\.filter/);
assert.match(watch, /!watch\.assistant_baseline_ids\.has\(id\)/);
assert.match(watch, /const complete = Boolean\(last && assistantTurnComplete\(last\)\)/);
assert.match(watch, /first_response_complete: complete/);

const rawWorker = show("apps/extension/src/imported/ozon-v0.1.22/service_worker.js");
const pendingPatches = patches.filter((row) =>
  row.target === "service_worker.js" &&
  String(row.old).includes("if (message.first_response_complete !== true)")
);
assert.equal(pendingPatches.length, 1, "expected one current pending-response patch");
const rawPendingIdentity = section(
  rawWorker,
  '      case "OZ_WORK_PENDING_IDENTITY": {',
  '      case "OZ_WORK_PENDING_TIMEOUT": {',
);
assert.equal(rawPendingIdentity.split(pendingPatches[0].old).length - 1, 1);
const pendingIdentity = rawPendingIdentity.replace(
  pendingPatches[0].old,
  pendingPatches[0].new,
);
assert.match(pendingIdentity, /if \(message\.first_response_complete !== true\)/);
assert.match(pendingIdentity, /return \{ ok: true, waiting: true \}/);
assert.match(pendingIdentity, /OzonWorkSessionModel\.STATES\.ACTIVE_VISIBLE/);

const admission = show(
  "tests/regression/extension-core/client-i1/client-c2-3c1-online-work-admission.mjs",
);
assert.match(admission, /"C1-02", "WB\/Alice historical-unbound Start proceeds"/);
assert.match(admission, /workSessionFor", f\.key\)\)\.state, "active_visible"/);

const extensionDrift = git(
  "diff",
  "--name-only",
  ownerStartSource,
  main,
  "--",
  "apps/extension",
  "packages/ai-adapters",
  "packages/control-client",
  "packages/marketplaces",
);
assert.equal(extensionDrift, "", "current main changed extension runtime after accepted owner Start source");

const result = {
  status: "PASS",
  evidence_level: "SOURCE_LOCAL_CONTRACT",
  current_main: main,
  accepted_owner_start_source: ownerStartSource,
  preserved_failure_source: failure.source.sha,
  preserved_executed_fixture_sha256: preservedAliceTestSha256,
  classification: "TEST_FIXTURE_RESPONSE_GATE_INCAPABLE",
  preserved_run_stage: "UNPROVEN_AFTER_IDENTITY_CONFIRMATION",
  deterministic_contract_stage: "response_gate_requires_new_complete_assistant_turn_fixture_never_creates",
  facts: [
    "Preserved installed-synthetic run confirmed Alice identity and later timed out waiting for active_visible.",
    "The preserved run evidence does not prove that its Send hook fired or that its content watcher reached the response gate.",
    "The exact executed fixture's Send hook appends only a user turn and clears the composer; it has no code path that creates a new Alice assistant turn.",
    "Current content runtime requires a new complete assistant turn before sending first_response_complete=true.",
    "Current worker stays waiting while first_response_complete is not true and only then binds and transitions active_visible.",
    "Current source contains a worker-level WB/Alice historical-unbound Start regression whose expected final state is active_visible.",
    "No extension/runtime inputs changed from accepted owner Start source 86d1573e to current main.",
  ],
  non_claims: [
    "This does not prove that the fixture limitation caused the preserved browser timeout.",
    "This does not prove which runtime stage the preserved failed run reached after identity confirmation.",
    "This does not prove INSTALLED_SYNTHETIC Alice PASS.",
    "This does not rerun the consumed browser retry.",
    "This does not prove live Alice/provider behavior.",
    "No product source defect is established by the preserved timeout.",
  ],
  next: "Correct the Alice installed-synthetic fixture in a separate successor so one generated complete assistant response follows the one-shot send, then run a separately governed browser acceptance; do not change product runtime solely to satisfy the old incomplete fixture.",
};
console.log(JSON.stringify(result, null, 2));
