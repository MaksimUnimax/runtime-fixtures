import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const runtime = path.resolve(process.argv[2]);
const html = readFileSync(path.join(runtime, "popup.html"), "utf8");
const js = readFileSync(path.join(runtime, "popup.js"), "utf8");

for (const id of [
  "onboarding",
  "onboarding-auth",
  "onboarding-store",
  "onboarding-ai",
  "onboarding-work",
]) assert.match(html, new RegExp(`id="${id}"`));

assert.match(html, /не означают подтверждение поддержки конкретного браузера/);
const start = js.indexOf("function onboardingModel(value)");
const end = js.indexOf("\nfunction renderOnboarding()", start);
assert.ok(start >= 0 && end > start, "onboardingModel must be a standalone pure helper");
const source = js.slice(start, end);
const onboardingModel = new Function(`${source}; return onboardingModel;`)();

const flags = state => onboardingModel(state).map(step => step.done);
assert.deepEqual(flags({
  auth: { authenticated: false },
  stores: [],
  identity: { ai_id: null },
  context: { work_active: false },
  work: null,
}), [false, false, false, false]);

assert.deepEqual(flags({
  auth: { authenticated: true },
  stores: [],
  identity: { ai_id: null },
  context: { work_active: false },
  work: null,
}), [true, false, false, false]);

assert.deepEqual(flags({
  auth: { authenticated: true },
  stores: [{ id: "private-store", marketplace: "ozon" }],
  identity: { ai_id: "chatgpt" },
  context: { work_active: false },
  work: { state: "inactive" },
}), [true, true, true, false]);
assert.deepEqual(flags({
  auth: { authenticated: true },
  stores: [{ id: "private-store", marketplace: "wildberries" }],
  identity: { ai_id: "alice" },
  context: { work_active: true },
  work: { state: "active_visible" },
}), [true, true, true, true]);

assert.deepEqual(flags({
  auth: { authenticated: true },
  stores: [{ id: "private-store", marketplace: "wildberries" }],
  identity: { ai_id: "gemini" },
  context: { work_active: false },
  work: { state: "inactive" },
}), [true, true, false, false]);

assert.match(js, /renderOnboarding\(\);\s*if \(!authenticated\) return;/);
console.log(JSON.stringify({
  status: "PASS",
  scope: "A06_FIRST_RUN_ONBOARDING",
  steps: 4,
  persistentState: false,
  browserSupportClaim: false,
  executionAuthority: false,
}, null, 2));
