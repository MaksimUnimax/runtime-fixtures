# Octoport B02 — four-map cross-conversation storage race (review packet)

Date: 2026-10-31. Owner: existing Tester-2 task, not a new author. Status: **SOURCE/PACKAGE FIX PROPOSED; NATIVE B02 AND INDEPENDENT REVIEW OPEN**.

## Exact provenance

- Repository: `MaksimUnimax/runtime-fixtures`.
- Base commit: `eebb880d0a3a789710fc8b111e12ec849946972a`, tree `cf1e7fe83450708daf515f89edf437b6e16f772e`.
- Installed **unchanged old** Chrome 147 extension: 0.2.42; installed ZIP SHA256 `5bf2f23bff0b72a344a274f9282b69f5d5cee1c4de871436471cdda783d04d8c`.
- The new modified source is **not installed**, **not server-admitted**, and **not the old ZIP**.
- Original imported donor `apps/extension/src/imported/ozon-v0.1.22/service_worker.js` is immutable and restored to preimage SHA256 `0aefd9b86a9e9adc66b9a6dfb6fa4ef41e786a9988d1a6e8c3cd19fc864b3486`. `extension_baseline.verify_import()` reports PASS for 232 imported files.

## Primary defect and scope

Independent B deterministic negative at `/root/octoport-control/logs/B/B_B02_EEBB_XCONVERSATION_STORAGE_MIGRATION_RACE_20261030/result.json` (exact historical EEBB source/package): while one confirmed dialogue migrates legacy storage keys, an unrelated conversation progresses AUTO_RUNS from `DISPATCH_INTENT_COMMITTED` to `RESPONSE_RECEIVED`. The stale migration can write the old map back over the newer result. This is controlled asynchronous storage reproduction, not proof of native provider replay. Four maps are potentially affected: `MANUAL_MODES`, `AUTO_RUNS`, `REPORT_PREFIXES`, `AUTO_START_PROMPTS`.

**Grouped compatible patch** consists of eight appended service-worker transformations in the existing `apps/extension/application-patches.json`; no imported donor is changed. All four map owners, including manual-mode updates and the new-binding manual reset, share `withConversationMapsWrite`; migration no longer races their map read/modify/write paths. The existing binding lock remains and all dependent AUTO_RUNS mutation after bind runs outside the new shared map lock to prevent lock inversion. Existing 378 transformations are preserved.

New test: `tests/regression/extension-core/client-i1/client-b02-four-map-migration-race.mjs`. Registered inside the standard `tooling/checks/extension_i1.py` source and package matrices. It extracts actual compiled source functions into a bounded VM with delayed storage read; verifies migration with/without old key, other-dialogue AUTO_RUNS transition, all four maps, rejected conflicting identity and continued subsequent write. No real provider request or browser mutation.

## Exact verified results (separate evidence levels)

1. Pinned imported-source integrity: PASS, 232 files unchanged.
2. Development composition 0.2.42: reproducible twice, extracted bytes equal source, repeat ZIP identical. **Local development package**, ZIP SHA256 `d3cec34c3af68cc175af22de291a0e6894261674cb207dd7c6122766e3da822e`. Receipt SHA256 `6396083b67e8f1939a14a3225d040a72556ec524f4aec479c8e5133f3db2cd0a`.
3. Grouped map-race regression: PASS on newly composed SOURCE and extracted PACKAGE, both with/without legacy key, four maps; no real provider calls. These are synthetic SOURCE/PACKAGE results, not live.
4. Isolated Chromium native-extension boot/readback on extracted PACKAGE: PASS, browser 151.0.7922.34, synthetic trust and tamper checks. Receipt SHA256 `54ae9826f4dc502a58a035274d6e5b7f7790fbfa7a59ccff70e02acd263e3a86`.
5. 47/47 extracted-package I1 JavaScript gates PASS in separate exact matrix; receipt SHA256 `4ff1eb43c01677e65caa045f9ba9d02dc7790b45704599ae18694a2edcc2c8a4`.
6. Full standard I1 runner: **FAIL / INCOMPLETE** after 98 PASS and one environment FAIL, `i1-source-i1-d3c-signed-readback`; local `apps/api/node_modules` and `tsx` missing. Initially `SA_PNPM_BIN` pointed to corepack rather than its pnpm shim; corrected shim confirmed, then `pnpm exec tsx --version` demonstrated `Command "tsx" not found`. Original 99-gate receipt SHA256 `1b9bb63ea1f821352e7187393c1833c6e21fb64541e483e3bf824c3cf741fadf`. **Do not claim full CI PASS.** Avoid filling a near-full production disk just to install optional test dependencies; run complete CI on a properly provisioned runner.
7. Source F05 9.3 MB large-report synthetic integrity is covered in these 47 tests; actual same-AI file acceptance **NOT VERIFIED**.

## Installed native B02 remainder (must not be silently promoted)

- On installed **old** eebb880: real ChatGPT Standard Start/HELP and one approved Ozon seller_info command observed, without proven complete native large-file acceptance, Finish/reStart, all-eight cycles or all dialog isolation cases.
- Seven additional surfaces (Alice, DeepSeek, Grok, Claude, Gemini, Qwen, Kimi): HTTP 200 and matching installed content script each; all first opened fresh dialogue identities unknown and `workAllowed=false` before any fresh signed scoped work-admission. No Start/Send/provider requests in this probe. This does not prove seven authorizations invalid.
- Prior ChatGPT Hide click intent: unknown dispatch; later readback `active_visible`; no replay and no proof Hide completed.
- A read-only attempt to inspect three saved old Grok/Claude/Gemini dialogs was blocked **before execution** by OpenAI tool safety; exact refusal in `/root/octoport-control/operator/tester2-state.json` revision 149. Cause not supplied; do not reroute, replay or claim tested.
- The new package has not been installed or published; old 0.2.42 release and signed compatibility record must not be republished, altered or bypassed.

## Mandatory independent review and closure

Reviewer must inspect exact branch commit, full eight composition patches, unchanged donor pin, race regression, conflicting-key and lock-order risks; compare to B original negative and read all source/package receipts. Check that no other writer of the four maps remains unprotected and no nested lock cycle exists. Require full standard CI on exact new SHA and real installed eight-AI owner-authorized scenarios before B02 acceptance. Independent review is **not yet completed**. B14 PR380 and Tester-1 Health remain outside this patch and are preserved.
