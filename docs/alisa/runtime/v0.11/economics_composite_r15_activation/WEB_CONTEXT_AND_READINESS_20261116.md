# Preserved WEB context and readiness diagnostic correction — 16 November 2026

## Actual boundaries

The installed WEB root changed to `alisa-r5-preview-5e5e8cc8922342ca`, manifest `789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655`. Its source commit `5e5e8cc8922342cab0bed90073da6942a5b8f284` changes three client lines in the coefficient view: preview acknowledgement, actual/requested period display and a help-text correction. Its source/docs CI completed successfully. That parallel WEB switch was not performed by this installer continuation.

A full read-only check on Alisa verified all four current base manifests and every listed file, the original WEB manifest, all97 source inputs, dependency locks, interpreter/venv and publisher pins, plus every existing R15 candidate file. The41 changed paths are all under ui/web; all other base observations are identical. The original package was not modified by this check.

Only three baseline leaves change: `bases.web.root`, `bases.web.manifest_sha256`, and the literal `bases.web.venv_link`. The resolved environment remains the same. The four executable/review builder files and all97 product source bytes are unchanged. No generic wildcard acceptance, unknown source hash, dynamic baseline discovery or removal of a CAS guard was introduced.

The new plan is `982d137e067c533374e7254b5ac04008d0f7483e4c38c45e8d98f97e268ba422`; the baseline hash is `b92030a430861fa68882317fce56a78b3132ed243a60963c94bbb49af9e5d241`. The activation contract now pins this plan and baseline. It does not accept the former PLAN733a2d1... as current. Source product remains cafb743c; the unchanged97-file source index remains7342caa1.... Four new metadata-only tests freeze this exact WEB tuple, all non-WEB baseline bytes, the five-file builder closure and unchanged product source, and refusal of the old bindings or unrelated baseline deltas.

This source change is a DRAFT pending independent review; tests/package preparation are not deployment approval. The existing open service-adapter review remains open. The previously safety-blocked reviewer invocation was not retried or routed elsewhere.

## Corrected diagnostic cause, not a product change

The previous ad-hoc native-count command added `ProtectSystem=strict`, unlike the existing reviewed native sampler. Both databases were readable but had no -wal/-shm files, and their directories were read-only inside that diagnostic namespace. The underlying redacted SQLite error was SQLITE_CANTOPEN14. The readiness.py contract already explicitly requires ordinary WAL shared-memory locking and forbids immutable mode, stale copies and Repository/GapStore constructors.

Reusing the installed exact reviewed sampler restored the intended invocation contract. No database permission, installed service, database setting, query or logical record was changed. SQLite mode=ro/query_only remain enforced; ordinary WAL auxiliary coordination is permitted exactly as in the accepted sampler. No production security guard was removed or repinned. SQLite's documented read-only WAL conditions agree with this result: https://sqlite.org/wal.html#read_only_databases

At09:54:42UTC all three existing-identity samplers completed: native_unknown_jobs4; the other nine readiness counts0. The full aggregate verdict is READINESS_BUSY, not IDLE. All three finite sampler units are not-found/PID0/empty-cgroup. No UNKNOWN was cleared or replayed, and absence of a fresh count is no longer the blocker. Individual primary outcomes of those four historical jobs are still needed before an authorized reconciliation.

## Current work remains bounded

The new context requires its own package receipt and separate verification. The old PREPARED is not silently claimed to belong to the new PLAN. Keep one current physical payload set: only after the new package passes full verification, exact payload equality and no-consumer checks may the superseded package be retired with its unique metadata preserved. No obsolete browser installations or eighteen old archive copies are recreated. Final source review, current readiness and fresh coordination remain prerequisites for live program-apply/R15 APPLY. InstalledSynthetic and LiveOwner are separate and not claimed here.

## New package results

Actual BUILD completed09:57:15UTC and a separate official full VERIFY completed09:57:45UTC. New PREPARED SHA256 `494a43ddb9fa918f1b32e31322f67b4fdfefab5dceb3c9642ce1497682946860`, PLAN `982d137e067c533374e7254b5ac04008d0f7483e4c38c45e8d98f97e268ba422`, product source `cafb743c94672104d4afa2c471398e5c81d904f5`. Status CANDIDATE_VERIFIED_NOT_ACTIVATED. New package path: `/root/alisa-r15-wb-cafb743c-20261116/web-preview-context-20261116/candidate`. This is not a new model/provider call, installation or owner acceptance.

The first command failed before any staging because Python -I excludes the script directory. The corrected invocation explicitly supplied the already-verified builder directory and ran the unchanged CLI. No source dependency or safety check was changed; both outcomes are retained. The superseded package may be removed only after separate exact payload/metadata-preservation and no-consumer checks, whose result is recorded outside this source commit.

## Exact test pin correction and superseded-package retirement

The first Activation CI43844579030 on239496fc ran203 unit methods and found one old exact-plan expectation in test_program_pair. Only that expectation was updated to the measured new PLAN982d137e...; no assertion, denial test or production guard was removed. The targeted method passed after the correction. The failed run remains preserved; final CI must be checked on the subsequent exact head.

At09:59:15UTC, after full separate VERIFY, the two package trees were compared in full:11,783 payload entries, modes, owners and links are identical; only PLAN.json and PREPARED.json differ. Original unique PLAN/PREPARED and all three manifests were preserved with a complete content map and restoration instructions. No open file/mapping consumers were found, all own build/verify units were finished, and the old superseded candidate was removed. Reclaimed288,567,296bytes; available5,865,840,640bytes after retirement. The replacement candidate was unchanged. There is one current unpacked candidate, not another permanent duplicate/archive. Original inode/timestamp identity is not a restoration guarantee.
