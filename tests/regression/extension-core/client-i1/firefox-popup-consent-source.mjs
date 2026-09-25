import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const runtime = path.resolve(process.argv[2]);
const html = fs.readFileSync(path.join(runtime, "popup.html"), "utf8");
const source = fs.readFileSync(path.join(runtime, "popup.js"), "utf8");

assert.match(html, /id="firefox-technical-consent"[^>]*hidden/);
assert.match(html, /id="firefox-technical-grant"/);
assert.match(html, /id="firefox-technical-revoke"/);
assert.match(html, /Без него основная работа Октопорта остаётся доступной/);

const grant = source.match(/function requestFirefoxTechnicalConsentFromClick\(\) \{([\s\S]*?)\n\}/);
assert.ok(grant, "direct Firefox grant click handler exists");
assert.match(grant[1], /permissions\.request\(\{ data_collection: \[FIREFOX_TECHNICAL_CATEGORY\] \}\)/);
assert.doesNotMatch(grant[1], /\bawait\b/, "no await may precede Firefox permissions.request user gesture");
assert.doesNotMatch(grant[1], /runtime\.sendMessage|request\("SA_/, "grant is not relayed through background messaging");
assert.match(source, /\$\("firefox-technical-grant"\)\.onclick = requestFirefoxTechnicalConsentFromClick/);
assert.match(source, /permissions\.remove\(\{ data_collection: \[FIREFOX_TECHNICAL_CATEGORY\] \}\)/);
assert.match(source, /onAdded\?\.addListener/);
assert.match(source, /onRemoved\?\.addListener/);

console.log(JSON.stringify({
  status: "PASS",
  cases: [
    "firefox_optional_consent_ui",
    "grant_direct_user_gesture",
    "no_background_relay",
    "revoke_control",
    "permission_events_refresh_ui",
  ],
}));
