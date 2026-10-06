# A06 Chrome 0.2.13 authenticated-helper prepare guard — R1 — 2026-10-06

Task: `A06-CHROME0213-AUTH-HELPER-PREFLIGHT-VERSION-GUARD-R1-20261006`

Evidence level: **SOURCE + RESOURCE-LIGHT PREPARE PREFLIGHT**. This is not an installed/authenticated Chrome acceptance.

## Why this change is needed

The existing governed `exact-store-authenticated-controls.py` helper is already the ordinary/technical authentication and post-login control helper, so Chrome-first work must reuse it rather than create a second authentication path.

Two preflight defects were reproduced on current main `9c7795cc58e827165476821e7682ae6bdef73f06`:

1. `prepare()` accepted `--expected-version` but did not compare it to the inert package `manifest.json` until the later browser-worker phase. A caller could therefore receive `PREPARED` while naming the wrong expected extension version.
2. The exact browser-product guard accepted only a bare four-part version string. Real `/usr/bin/google-chrome --version` returns `Google Chrome 147.0.7727.116`, so the existing authenticated helper could not pass its own Chrome preflight even though exact 0.2.13 signed-out Chrome evidence already exists.

No extension/runtime product bytes are changed by this task.

## Source correction

`prepare()` now reads only the inert `manifest.json` from the SHA-bound ZIP and requires its version to equal `--expected-version` before browser-product inspection, runtime extraction or profile creation.

The manifest read is fail-closed:

- exactly one non-directory `manifest.json` is required;
- manifest payload is bounded to 256 KiB;
- a symlink manifest is rejected;
- malformed JSON, non-object/missing/blank version and duplicate manifest entries are rejected as `PACKAGE_MANIFEST_INVALID`;
- an otherwise valid package with a different requested version is rejected as `EXTENSION_VERSION_MISMATCH`.

Both codes are included in the helper's privacy-safe fixed error allowlist, so malformed input cannot leak arbitrary exception text.

The browser product guard remains exact equality and now accepts only these expected shapes:

- a bare four-part version, preserving the existing Opera owner-test contract;
- `Google Chrome <four-part-version>`, enabling the real Chrome-first path.

`Chromium ...`, arbitrary browser names, suffixes and version substrings remain rejected.

## Focused source checks

Final focused checks on the task worktree:

- `test-exact-store-helper-guards.py`: **31/31 PASS**;
- `py_compile` for the helper and guard test: PASS;
- repository documentation check: PASS;
- exact staged `git diff --check`: PASS.

Evidence:

- `/root/octoport-control/logs/B/a06-chrome0213-auth-helper-preflight-version-guard-r1-20261006/FOCUSED_TESTS.log`
  - SHA-256 `37d0f5971292c6d1dfbc7c6b4c835f9ae4d75065686d1277a53a959044463e9f`;
- `PY_COMPILE.log`
  - SHA-256 `e145d427ddf321def9378af9f595adc6ef2d3823044fd16911e8b96394baf6ec`;
- `DOCS_CHECK.log`
  - SHA-256 `28fb49d90f6ff63ba567da53987a78001ce3f81d2f2eb20635e7a5c5660577d1`;
- `DIFF_CHECK_FINAL.log`
  - SHA-256 `261148629ef1ed2ab24c6eaf24674cc080b42f9deda8fd0f019a3e2a74c141f1`.

The regressions explicitly prove that a wrong expected version fails before browser-product inspection, runtime extraction and profile creation; malformed/missing/duplicate manifests fail closed; exact Google Chrome is accepted while Chromium/FakeBrowser/suffixed lookalikes are rejected.

## Exact Chrome 0.2.13 prepare evidence

The corrected helper was then run in `--mode prepare` only against the immutable candidate:

- package: `OCTOPORT_v0.2.13_CHROMIUM_STORE.zip`;
- SHA-256: `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`;
- package manifest version: `0.2.13`;
- browser executable: `/usr/bin/google-chrome`;
- actual exact browser product: `Google Chrome 147.0.7727.116`.

Result: **PREPARED**.

The preflight extracted 43 exact runtime files into a task-local temporary root, created a fresh private profile directory, observed no existing profile user and recorded `manifestVersion=0.2.13`. The immutable ZIP SHA-256 was identical before and after preparation.

Evidence:
- `PREPARE_RESULT.json`, SHA-256 `54639ef381ac870602195be6302f02e2601a35053fda991f65404344775c1a7d`.

A second resource-light run deliberately requested `--expected-version 0.2.12` against the same exact 0.2.13 ZIP. It exited nonzero with only `EXTENSION_VERSION_MISMATCH`; the requested runtime/profile root did not exist afterward.

Evidence:
- `WRONG_VERSION_RESULT.json`, SHA-256 `f6881167cc81710e537054409655873865b161b31c1ec7692450f206f5e6c684`.

Neither prepare run invokes `launch_persistent_context`; no browser session, portal login, provider/marketplace request, AI send, server mutation or DB mutation is part of this evidence.

The task-local extracted runtime/profile and generated Python bytecode cache were removed after evidence capture; the wrong-version root was never created. Cleanup evidence: `/root/octoport-control/logs/B/a06-chrome0213-auth-helper-preflight-version-guard-r1-20261006/PREPARE_TEMP_CLEANUP.json`, SHA-256 `f03171344ac1fc6739ef996c1fcc6bb502ac1872834cc6e35f2c0514c518d273`.

## Remaining Chrome gates

This result establishes only that the existing authenticated-control helper can now honestly prepare the exact 0.2.13 ZIP for real Google Chrome 147 and fails closed on version/browser identity errors.

It does **not** establish:

- ordinary Chrome authentication or `workAllowed=true`;
- logout/relogin/revoke;
- authenticated store controls;
- transfer/export/import;
- ChatGPT Standard/Work or Alice Start/result/Finish;
- browser-store installation/update;
- LIVE_OWNER usefulness;
- READY_FOR_OPERATOR, deployment or production.

A real Chrome browser phase remains separately gated by the standard `browser` resource profile (1536 MiB) and legitimate authentication authority. Those gates must not be replaced by this prepare evidence.
