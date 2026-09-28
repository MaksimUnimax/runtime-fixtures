# A2242 — WB inventory argv import safety — 2026-09-28

Status: **PASS / READY FOR C INTAKE**

Task: `A2242_WB_INVENTORY_ARGV_IMPORT` (A04).
C request: `C-A-A2242-WB-INVENTORY-ARGV-IMPORT-20260928-1412`.
Code commit: `30fcc8a9dfd7b7833cb385e2b2b8a5d5cfb8587b`.

## Change

`wb-inventory-movement-boundary.mjs` now treats `process.argv[2]` as an optional overlay path only when the module itself is the direct CLI entry point.
When imported by `core-contracts.mjs`, unrelated caller argv is ignored.
Pinned overlay SHA, donor/effective registry checks, replacement authority and drift-negative assertions are unchanged.

## Verification

- Direct: `node tests/regression/extension-core/wb-inventory-movement-boundary.mjs` — PASS.
- Imported: `node tests/regression/extension-core/core-contracts.mjs /root/octoport-control/logs/C/store-release-028d5dd5/chromium/runtime` — PASS; WB module does not consume the runtime-directory argv.
- Fresh full gate: `tooling/checks/extension_core.py` via supervised A heavy runner — PASS, D2.4, 139 gate processes, live provider calls 0, installed acceptance false.
- Accepted evidence: `/root/octoport-control/logs/A/a2242-wb-argv-import-b2784bb5-r2/summary.json`.
- Resource job: `729cfd1b09894c8f92f8e1205abfad25`, exit 0, cleanup verified, peak ~174 MiB.

The earlier R1 heavy attempt was infrastructure-cancelled after its owner shell disappeared; it is not acceptance evidence and was rerun as R2.
