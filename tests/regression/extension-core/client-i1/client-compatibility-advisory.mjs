import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Execute the actual existing popup projection, not a separately rewritten
// approximation. The signed authority is tested independently by
// client-support-snapshot.mjs; this test covers only user-visible rendering.
export function verifyCompatibilityAdvisory(runtimePath) {
  const runtime = path.resolve(runtimePath);
  const html = readFileSync(path.join(runtime, "popup.html"), "utf8");
  const js = readFileSync(path.join(runtime, "popup.js"), "utf8");
  assert.match(html, /<p id="compatibility-note"[^>]*role="status"[^>]*hidden>/);

  const renderStart = js.indexOf("function render() {");
  const startMarker = "  const extensionCompatibility = state.auth?.compatibility?.extension;";
  const start = js.indexOf(startMarker, renderStart);
  const end = js.indexOf("\n  renderOnboarding();", start);
  assert.ok(renderStart >= 0 && start > renderStart && end > start,
    "advisory must remain inside the current popup render path");
  assert.equal(js.indexOf(startMarker, start + startMarker.length), -1,
    "the popup must have one advisory projection");
  assert.match(js.slice(renderStart, start),
    /const authenticated = state\.auth\?\.authenticated === true;/);

  const source = js.slice(start, end);
  assert.match(source, /UPDATE_RECOMMENDED/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  // Source comes only from the checked-in extension runtime. Do not evaluate
  // external pages, diagnostic logs, serialized account state, or user data.
  const project = new Function("state", "$",
    '"use strict"; const authenticated = state.auth?.authenticated === true;\n' + source);

  const node = { hidden: false, textContent: "stale advisory" };
  let observedAccess = 0;
  const $ = id => {
    assert.equal(id, "compatibility-note", "projection may only access its own node");
    observedAccess++;
    return node;
  };
  function check(authenticated, compatibility, hidden, expectedText) {
    observedAccess = 0;
    project({ auth: { authenticated, compatibility: { extension: compatibility } } }, $);
    assert.equal(observedAccess, 2, "visibility and status text both updated");
    assert.equal(node.hidden, hidden, "visibility follows signed compatibility and auth");
    if (hidden) {
      assert.equal(node.textContent, "", "no stale minimum-version text after context change");
    } else {
      assert.ok(node.textContent.includes(expectedText));
      assert.match(node.textContent,
        /Подписанная конфигурация рекомендует обновить расширение/);
      assert.match(node.textContent, /Текущая версия пока разрешена/);
    }
  }

  const recommended = { status: "UPDATE_RECOMMENDED", minimumVersion: "0.2.37" };
  check(false, recommended, true, "");
  check(true, { status: "SUPPORTED", minimumVersion: "0.2.37" }, true, "");
  check(true, recommended, false, "Минимально допустимая версия: 0.2.37");
  check(true, { status: "UPDATE_RECOMMENDED" }, false,
    "Подписанная конфигурация рекомендует обновить расширение");
  assert.doesNotMatch(node.textContent, /Минимально допустимая версия:/,
    "unknown minimum must not reuse the previous account's minimum");
  check(true, { status: "UPDATE_REQUIRED", minimumVersion: "0.2.38" }, true, "");
  check(true, recommended, false, "0.2.37");
  check(false, recommended, true, "");
  check(true, { status: "SUPPORTED" }, true, "");

  return Object.freeze({
    status: "PASS",
    scope: "A06_COMPATIBILITY_ADVISORY_UI_PROJECTION_ONLY",
    cases: 8,
    changedProductSource: false,
    verified: ["visible_only_on_authenticated_UPDATE_RECOMMENDED",
      "signed_minimum_is_displayed_as_text",
      "missing_minimum_does_not_retain_old_value",
      "required_and_supported_do_not_claim_current_version_allowed",
      "auth_loss_clears_the_notice"],
    signedInputVerification: "SEPARATE_CLIENT_SUPPORT_SNAPSHOT_TEST",
    ownerInstallationOrStore: "NOT_TESTED",
  });
}
