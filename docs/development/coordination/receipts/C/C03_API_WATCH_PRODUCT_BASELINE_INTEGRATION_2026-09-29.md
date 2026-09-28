# C03/C04 API-watch product baseline + structured coverage integration — 2026-09-29

Status: SOURCE + DISPOSABLE_POSTGRESQL CANDIDATE. NO LIVE DB APPLY / NO SERVICE DEPLOYMENT.

Base main:
- `80c7fe6240b2ff53525040531e48fa7986d528a4` (post-main required workflows 5/5 PASS).

Integrated source checkpoints:
- C03 source policy checkpoint: `d5774b05672d0ebbab7849b7e27ba7abfe0440cc`.
- C04 structured monitoring coverage checkpoint: `8094d4cf340a4fba9b7f851be35cb3569485a895`.
- B baseline durability original: `9939144986f3f5b91747b88edaf4d0219135210f`, cherry-picked as `89959821`.
- B document-scope follow-up: `5fc3ad669fca0f4c97c222c111acf22f36e11aa9`, cherry-picked as `720039c8`.
- B final conflict-authority superseding rework: `a5dc6084efeda5b42a878b34b9337f643212ef53`, cherry-picked as `fe4cf3b7`. It replaces predicate-specific partial indexes with PostgreSQL 18 inferable `UNIQUE ... NULLS NOT DISTINCT` constraints for exact nullable document scope.
- Published candidate `3d6cd9e547986b96d1533e544c6fee5b41498d8d` is superseded and MUST NOT be promoted.

Behavior:
- latest authority/acquisition observation is separated from accepted product-compatible baseline;
- repeated breaking acquisition remains compared to the accepted baseline instead of becoming compatibility NO_CHANGE against itself;
- no automatic baseline advancement from AUTHORITY_ACCEPTED, COMPLETED, acquisition, NO_CHANGE, or empty diff;
- invalid/missing baseline references fail source-locally with UNKNOWN evidence rather than falling back to a different product baseline;
- product recovery remains distinct from transport/source recovery;
- source/report/snapshot scope carries nullable documentKey;
- snapshots with identical bytes may coexist in distinct document scopes;
- report-source persistence retains sibling WB documents independently;
- Telegram operator injects B's durable baseline repository into API-watch; the report path reads it only;
- structured monitoring coverage carries observed time, check depth, tested/unverified targets, comparison state, and severity without inferring full compatibility from SUCCEEDED.

B 0054 durability:
- current pointer scoped by source_family + nullable document_key;
- existing snapshot FK only; no duplicated artifact bytes;
- exact expected-revision CAS;
- append-only revision audit;
- DB guards for scope, history, stale revision, missing snapshot, uniqueness, concurrent snapshot scope drift;
- 0054 remains unapplied to live/pilot DB in this acceptance.

C validation on combined candidate:
- API-watch + monitoring scheduler + Telegram runner focused tests: 13 files / 224 tests PASS.
- @product/db typecheck PASS.
- @product/api-watch typecheck PASS.
- @product/monitoring-control typecheck PASS.
- @product/telegram-operator typecheck PASS.
- @product/db non-integration suite: 6 files / 32 tests PASS.
- Telegram runtime/security wiring: 7/7 PASS, including read-only baseline wiring and no automatic accept path.
- C disposable PostgreSQL, sequential:
  - api-watch-product-baseline.integration.test.ts: 9/9 PASS;
  - canonical-lineage.integration.test.ts: 7/7 PASS;
  - postgres.integration.test.ts: 3/3 PASS;
  - adapter-registry.integration.test.ts: 7/7 PASS;
  - health-retention-upgrade.integration.test.ts: 10/10 PASS;
  - total: 36/36 PASS;
  - all supervised jobs exit 0 with cleanup verified.
- migration-level release safety: 42/42 PASS.
- additional C disposable PostgreSQL migration-count acceptance:
  - P2 auth: 14/14 PASS;
  - P5 final acceptance: 80/80 PASS;
  - P6 admin security: 77/77 PASS;
  - all supervised jobs exit 0 with cleanup verified.
- final conflict-authority C revalidation after `a5dc6084`:
  - API-watch source suite: 11 files / 209 tests PASS;
  - @product/api-watch typecheck PASS;
  - @product/db non-integration suite: 32/32 PASS;
  - corrected product-baseline PostgreSQL suite: 9/9 PASS, including no-predicate conflict inference for family-null and document scopes;
  - corrected canonical-lineage PostgreSQL suite: 7/7 PASS.
- C report writer uses exact `ON CONFLICT (report_id,source_family,document_key)` with no predicate; source regression forbids returning to predicate-specific targets.
- targeted Prettier/ESLint and git diff --check PASS before final checkpoint.

Open boundaries:
- no production/live migration 0054;
- no automatic creation of a product baseline;
- explicit compatible-baseline acceptance action remains separate and must carry authoritative compatibility evidence;
- user-facing Russian monitoring explanation is a separate C04 slice; structured coverage only provides truthful producer data;
- owner H3 dedicated ChatGPT Standard session remains a separate owner-gated live prerequisite and is not synthesized here.
