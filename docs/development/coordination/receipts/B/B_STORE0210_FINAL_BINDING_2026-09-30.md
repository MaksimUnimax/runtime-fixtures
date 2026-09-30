# B — STORE 0.2.10 final authority binding

Task: `C-B-STORE0210-FINAL-BINDING-20260930T1212Z`.

B base: `011a498dda746adb24161577367fbe3257d8230d`.
Current main at task start: `261c015dd53513c21cca2e7f9113cfe4bac30f63`.

## Frozen identities verified

C supplied and B independently checked the frozen candidate:
- source head `fc05b958e9bb8a2e8b9c7d67fd4f91cdd3a790d5`;
- source tree `ca80a8affa2ed217c388f954ab633886a4c4f1f5`;
- Chromium/Opera SHA-256 `22e6507881bb790ca3b6b7d9fa11ee3177eebe4016e99994462414a383273edc`;
- Chromium/Opera bytes `2241366`;
- version `0.2.10`, contract `control_plane_v2`, migration level `54`.

The source commit exists locally and resolves to the supplied tree.
The frozen ZIP hash and byte count match the manifest.
C static evidence reports 43 ZIP entries, 43/43 reachable, with no missing
declared resources, unsafe paths, duplicates, or external HTTP refs.
## B change

`STORE1_VERSION` is now `0.2.10` and the predecessor is `0.2.9`.
The accepted source head/tree and Chromium artifact hash are bound to the
verified frozen candidate.

Unchanged: browser `opera`, minimum browser `136`, profile minimum extension
`0.2.7`, profile content authority, `control_plane_v2`, and migration 54
semantics. No DB/schema/migration/live/catalog/store-upload/C07/audience change.

## Exact package preflight

Using explicit `/root/.nvm/versions/node/v24.20.0/bin`:
`readStore1PackageSignatureEvidence` accepted the real frozen Chromium ZIP
and proved the trusted verifier is embedded in `service_worker.js`; the
generic transition parser independently returned version 0.2.10,
migration level 54, Opera minimum 136 and the existing profile hash.

Safe output: trust-bundle SHA-256
`c0bce660c6d6c2c1fa2f4cb57c336aa12c5b638ec74fcf56faf4615ca8e3d4c7`.

An earlier ad-hoc command accidentally used PATH Node 22.22.2 and failed at
tsx transformation before product execution. It is discarded evidence.
The check was recreated and rerun successfully under Node 24.20.0.

## Focused verification

Environment: Node `v24.20.0`, pnpm `10.34.5`.

- `git diff --check`: PASS.
- Focused ESLint: PASS.
- Focused Prettier check: PASS.
- Vitest STORE authority/preflight/transition: 3 files, 56/56 PASS.

No live mutation was executed.
