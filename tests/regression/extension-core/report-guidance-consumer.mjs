import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtime = resolve(process.argv[2]);
const here = dirname(fileURLToPath(import.meta.url));
const members = ["service_worker.js", "shared/application.js",
  "shared/llm_output_report_workflow_patch.js", "shared/bridge_autorun_model.js"];
const input = JSON.stringify({ artifacts: [{ name: "CURRENT_COMPOSED_ARTIFACT",
  files: Object.fromEntries(members.map(name => [name, readFileSync(join(runtime, name), "utf8")])) }] });
const groups = [];
for (const name of ["report-guidance-consumer-group.cjs", "report-guidance-status-precedence-group.cjs"]) {
  const run = spawnSync(process.execPath, ["--max-old-space-size=128", join(here, name)], {
    input, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  let result;
  try { result = JSON.parse(run.stdout); }
  catch { result = { total: 0, passed: 0, failed: 1, safetyTotal: 0, safetyPassed: 0,
    harnessError: run.error?.code || "INVALID_HARNESS_RESULT" }; }
  groups.push({ harness: name, exit: run.status, ...result });
}
const passed = groups.every(group => group.exit === 0 && group.failed === 0 &&
  group.safetyPassed === group.safetyTotal && group.providerCalls === 0);
console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL",
  scope: "ACTUAL_MANUAL_FINALIZER_REPORT_GUIDANCE_AND_DOCUMENT_STATUS",
  total: groups.reduce((n, g) => n + g.total, 0),
  passed: groups.reduce((n, g) => n + g.passed, 0),
  safetyTotal: groups.reduce((n, g) => n + g.safetyTotal, 0),
  safetyPassed: groups.reduce((n, g) => n + g.safetyPassed, 0),
  providerCalls: groups.reduce((n, g) => n + (g.providerCalls || 0), 0), groups }, null, 2));
if (!passed) process.exitCode = 1;
