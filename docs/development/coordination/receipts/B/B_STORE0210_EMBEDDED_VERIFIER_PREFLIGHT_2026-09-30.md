# B — STORE 0.2.10 embedded verifier preflight

Task: `C-B-STORE0210-EMBEDDED-VERIFIER-PREFLIGHT-20260930T1141Z`.

Base B HEAD: `f153feb946599c113cc05f90cf2fc59f4bfa060a`.
At task start its tree matched current main `261c015dd53513c21cca2e7f9113cfe4bac30f63`.
A counterpart submitted exact candidate `ad93234948e9c0d36b0d904a80e56f8e5df56407`.

## Change

STORE signature preflight no longer consumes a standalone
`shared/bootstrap_verifier.js` entry.
It requires the exact trusted `packages/control-client/src/crypto.js` source
to occur once inside `service_worker.js`.
A missing/mutated embedded verifier fails closed, and a redundant standalone
verifier entry is rejected.
The generic release-transition test now proves 0.2.9 -> 0.2.10 keeps
migration level 54 and the existing STORE profile content authority.

The exact STORE1 accepted artifact/source constants remain frozen at 0.2.9.
They cannot truthfully be changed until C integrates A+B and freezes the
actual 0.2.10 source/tree/package hash.

## Verification

- `git diff --check`: PASS.
- Focused ESLint on the three changed TypeScript files: PASS.
- Focused Prettier check on the three changed TypeScript files: PASS.
- Vitest: 3 files, 56/56 tests PASS.
- Negative coverage: missing verifier, byte-mutated verifier, redundant
  standalone verifier, development config.
- No DB/schema/migration change. No live/catalog/deploy mutation.
