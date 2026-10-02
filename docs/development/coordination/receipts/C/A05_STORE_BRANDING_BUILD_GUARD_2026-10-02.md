# A05 — store branding build guard

Date: 2026-10-02
Task: `A05-STORE-BRANDING-BUILD-GUARD-20261002`

## Problem

R6 Extension CI exposed a brittle build invariant: store composition required exactly five literal `Seller Agents` occurrences in `popup.html`. Accepted transfer copy reduced that visible count to four, so the store build failed even though the product copy change was intentional. R8 repaired only the magic number.

During this task, the count-free rewrite exposed another real stale-brand surface: `attachment_delivery_port_content.js` still emitted `Seller Agents` into user-visible delivery text. The previous store package contract checked only popup/application surfaces and did not catch it.

## Change

Store branding now declares the visible surfaces once and replaces every occurrence on each surface without asserting a fixed count. The declared set includes popup HTML, popup JS, shared application UI, and the attachment-delivery content surface.

After composition writes the store runtime, a final fail-closed scan rejects any remaining `Seller Agents` bytes. Missing declared visible surfaces also fail. Development-mode behavior is unchanged.
## Verification

Executed from the exact fresh-main task worktree with bytecode disabled and task-local TMPDIR:

- `python3 -m py_compile tooling/build/extension_composed.py tests/regression/extension-core/test-store-branding-build.py` — PASS.
- `python3 tests/regression/extension-core/test-store-branding-build.py` — 5/5 PASS.
- `python3 tests/regression/extension-core/store-package-contract.py` — PASS.
- `python3 tests/regression/extension-core/test-composed-version-policy.py` — 11/11 PASS.
- `git diff --check` — PASS.

The first store-contract run rejected the incomplete visible-target list because `attachment_delivery_port_content.js` still contained the old brand. Readback proved the occurrence was user-visible (`root.textContent`), so that surface was added to the store branding set rather than allowlisted.

The normal Extension CI already executes `store-package-contract.py`, so future stale-brand output remains in the exact CI path. The focused five-test regression additionally proves variable occurrence counts no longer require build-script edits.

## Boundaries

No extension version bump, STORE package replacement, catalog/store mutation, backend change, live browser action, trust/config change, permission change, or release claim is made by this source task. Frozen 0.2.11 bytes remain immutable. Publication requires independent review and the normal guarded exact-five-CI route.
