# C S2 repair operator read API — 2026-09-28

Status: SOURCE ACCEPTANCE CANDIDATE / NO LIVE APPLY.

Base: `d448e41b741561f1516f41df81a60f3c6f5ad9ca`.

Scope:
- expose bounded admin GET list/detail for monitor profile repair cases;
- require `health.read`, `ai.profile.read`, and `ai.assignment.read`;
- keep `executionAuthority=false`; no repair mutation route exists;
- wire the accepted B read repository into API runtime.

Validation:
- `@product/api` test: 24 files / 279 tests PASS;
- first focused run was ENVIRONMENT_RESOURCE_LIMIT at 827 MiB (peak 791 MiB), not product failure;
- rerun at 1536 MiB PASS, peak 1204 MiB, cleanup verified;
- `@product/api typecheck` PASS, peak 697 MiB;
- targeted Prettier, ESLint, `git diff --check`, and `openapi:check` PASS.

Boundary:
- SOURCE/API read path only;
- no operator approval is fabricated;
- no DB/schema/migration authored by C;
- no live 0053 migration, repair decision, rollout, or production publish.
