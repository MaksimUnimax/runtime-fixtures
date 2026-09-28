# C03 API-watch product-baseline source wiring — 2026-09-28

Status: SOURCE CHECKPOINT / NOT ACCEPTED FOR MAIN UNTIL B 0054 REWORK IS INTEGRATED.

Base: `80c7fe6240b2ff53525040531e48fa7986d528a4`.

Controller finding addressed:
- acquisition authority/latest observed snapshot is distinct from product compatibility acceptance;
- repeated breaking acquisition no longer becomes a safe compatibility `NO_CHANGE` when an accepted product baseline exists;
- product incidents recover only from complete, certain return to the accepted baseline;
- transport/authority incident recovery remains separate.

C-owned source changes:
- dependency-injected read-only product-baseline interface matching B repository shape;
- exact `sourceFamily + documentKey` comparison scope;
- observational fallback remains available only with uncertainty codes when no accepted product baseline exists;
- no report path advances the baseline automatically;
- document-scoped snapshot IDs/lookups and report-source TypeScript persistence;
- verified family recovery requires every source row in the family to be accepted, certain, and exactly back at its baseline.

Validation on current source checkpoint:
- `@product/api-watch test`: 11 files / 208 tests PASS;
- invalid accepted-baseline references remain source-local UNKNOWN/BLOCKED evidence and never fall back to latest observed or fail the whole run;
- `@product/api-watch typecheck`: PASS;
- targeted Prettier, ESLint, `git diff --check`: PASS.

Explicit dependency / no-main boundary:
- B exact `9939144986f3f5b91747b88edaf4d0219135210f` is NOT accepted yet.
- Its 0054 baseline primitive is sound for the original contract but predates the second document-scope finding.
- Required B rework before C intake:
  1. snapshot uniqueness must include null-safe document scope instead of legacy `(source_family,sha256)`;
  2. `api_watch_report_sources` must persist nullable `document_key` and be null-safe unique by report+family+document.
- C does not author those migration/schema changes.

No live DB/provider/production action was performed by this source checkpoint.
