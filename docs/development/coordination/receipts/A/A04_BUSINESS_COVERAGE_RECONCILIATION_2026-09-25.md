# A04 — business coverage reconciliation — 2026-09-25

Status: **45/45 OPERATION-LEVEL MAPPING + DETERMINISTIC FIXTURES PASS / WB FIELD-SCHEMA + LIVE BUSINESS ACCEPTANCE OPEN**

## Boundary

Role/task: `A / A04_BUSINESS_COVERAGE` under `CONTINUOUS-ROADMAP-20260925`.

Source A head at start of this block:
`44ee420662dd7fe035247ee3d7e274c96e72fcbd`.

This block does **not** add a runtime business planner. `MINIMUM_SPEC.md` says the selected AI uses known HELP/API operations and produces the analysis; the extension remains an explicit-command read executor. A therefore adds only test/evidence infrastructure for scenario coverage and deterministic interpretation rules.

Shared readiness TSV files were read but **not edited**. Their status columns remain C-owned integration/readiness state.

## Pinned authorities

Ozon current imported registry:
- `apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js`;
- SHA-256 `b42b51f815c0f88e89e1cd193d28cc4f72949d5dd1738ab35d473b226fd0a832`.

WB current composed reference:
- composition source `migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`;
- frozen source commit recorded by the reference README: `006af2724aafdf6589c16881c1ed06eb01cca281`;
- registry SHA-256 `08e8a2ad1f325a4bdc0a909b37220b7abaa0be1d94d6b53192666ed5f22c2c75`;
- registry rows: 188 total / 172 execution-enabled READ operations.

The WB source is a pinned migration/reference authority, **not proof of a fresh official 2026-09-25 OpenAPI snapshot or live-account availability**. No WB OpenAPI YAML bundle is present in this repository boundary. That freshness/schema gate remains explicit.

## Machine-readable coverage

Manifest:
`tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`.

Validator:
`tests/regression/extension-core/business-scenario-coverage.mjs`.

The manifest accounts for all 45 `BUSINESS_SCENARIOS.tsv` rows in exact order and binds to a semantic projection of:
- scenario ID;
- WB adaptation;
- candidate data family;
- verifiable result.

This intentionally does **not** hash mutable readiness/status columns, so C may update status without breaking the mapping test. Semantic projection SHA-256:
`4013ffaf678697ed1ed940c89fa3cd7cb0dbaf08e947597e02f071d8eff04c4a`.

Validator is imported by the existing A-owned `tests/regression/extension-core/core-contracts.mjs`, so the normal `extension_core` source/package contract path executes it without changing C/tooling ownership.

Validator result:
- scenarios accounted: **45/45**;
- Ozon operation references: **101**, all existing/current/enabled/READ;
- WB operation references: **137**, all existing/current/enabled/READ and none `blocked_pii`;
- WB host families exercised by the mapping: **12** (`advert`, `advert_media`, `analytics`, `calendar`, `content`, `feedbacks`, `finance`, `marketplace`, `prices`, `returns`, `statistics`, `supplies`);
- registry drift is fail-closed by exact hashes;
- continuation must remain explicit;
- missing row / 403 / unready report may not become zero;
- identifier grain and metric/unit intent are mandatory per row.

WB operation-level coverage states:
- `DIRECT`: 2;
- `COMPOSITE`: 32;
- `BOUNDARY`: 6;
- `EXTERNAL_CONTEXT`: 3;
- `CONTRIBUTION_ONLY`: 1;
- `LOCAL_FILE_HISTORY`: 1.

The non-feature/full-boundary rows are deliberately visible:
- `STD-10` — public incident context required;
- `STD-11` — WB stock/sales/finance/returns signals do not prove inventory movement/write-off event semantics;
- `STD-14`, `STD-15` — buyer-specific delivery availability is not inferred from generic WB signals;
- `CAP-12` — WB return signals and order-status routes do not yet prove cancellation event semantics;
- `CAP-02` — no single WB equivalent is claimed for Ozon product visibility;
- `CAP-15` — no exact WB analogue is invented for Ozon FBS error index;
- `CAP-20` — public research belongs to the AI/web evidence layer;
- `CAP-22` — competitor evidence requires public pages or owner links;
- `CAP-24` — only platform contribution is in beta scope; COGS/tax/external costs are not called net profit;
- `CAP-25` — prior-month history remains owner-managed local files.

## Deterministic interpretation fixtures

Fixture set:
`tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json`.

The validator executes **25 deterministic cases** covering the business rules that must not depend on model creativity:
- complete vs incomplete sales totals, including missing/null numeric fields;
- daily best/worst with deterministic tie-break;
- percentage change including zero-base → `null`/unknown, not invented infinity;
- warehouse sorting;
- days-of-cover with missing/zero demand not treated as a valid zero result;
- DRR = ad spend / comparable revenue, with zero/incomplete revenue denied;
- platform contribution after marketplace expenses, explicitly `isNetProfit=false`, with incomplete/missing cost inputs denied;
- top-N join with duplicate-key rejection on both catalog and sales sides;
- CAP-25 business-key dedup where `pageCount` does not prove completeness;
- causal factors remain `HYPOTHESIS_NOT_PROVEN_CAUSE`.

These are normalized synthetic fixtures. They prove formulas/boundaries, **not field-level interpretation of every live WB/Ozon provider payload**.

## Local verification

Against the current composed runtime built for A03 R12:
- `business-scenario-coverage.mjs`: **PASS**;
- `core-contracts.mjs`: **9/9 PASS** with the coverage validator imported;
- `wb-adapter.mjs`: **22/22 PASS**.

No live provider calls were made.

## Existing WB execution safety preserved

Existing composed-worker regression was run against the current built runtime:
`tests/regression/extension-core/wb-adapter.mjs`.

Result: **22/22 PASS**, `live_provider_calls=0`, including:
- all 188 registry rows isolated behind the WB reference;
- mixed HELP/API ordering;
- no hidden provider requests;
- context/account/token fences;
- restart UNKNOWN/no replay;
- privacy denial before request;
- durable 429 quota and WB `X-Ratelimit-Retry` precedence;
- confirmed-cabinet sharing and isolation;
- binary byte preservation;
- secret redaction.

The adapter's current successful provider result still labels verification as `STRUCTURAL_ONLY_WB_SCHEMA_PENDING`. Therefore this receipt does **not** upgrade operation mapping into live metric/schema acceptance.

## OWNER_Q1_CROSSWALK reconciliation handoff

The shared Q1 TSV contains several historical browser gates that are now stale enough for C to reconsider, without A silently editing shared readiness state:

- `Q1C-OPERA-29`: current real Opera + disposable API RESOLVED-v2 evidence is PASS (A03 R8).
- `Q1C-FIREFOX-31`: current Firefox 155 real developer add-on grant/deny/revoke + RESOLVED-v2 evidence is PASS (A03 R10); store/AMO is separate.
- `Q1C-YANDEX-30`: current real Yandex Beta vendor development route + RESOLVED-v2 evidence is PASS (A03 R12); stable/store route remains open.
- `Q1C-CHROME-28`: still environment-gated. Current Chrome 147 exact-runtime probe registered zero Seller Agents targets and the old unpacked automation flag is explicitly rejected; no Chromium evidence is relabeled as Chrome.
- `Q1C-RESTART-13`, `Q1C-CACHE-20`, `Q1C-UNKNOWN-21`, `Q1C-429-22`, `Q1C-FINISH-23`: current automated preservation/no-replay/quota evidence exists and should be distinguished from later owner/live UX confirmation rather than left as undifferentiated owner blockers.
- `Q1C-PRIVACY-33`: A03 R8/R10/R12 safe evidence paths contain no token/session/OTP/email value/raw payload and normalize authorization IDs.

Real OTP, real marketplace credentials, real AI sessions, second real installation, Chrome legitimate installed route and live semantic business results remain external/shared-window gates.

## C handoff for BUSINESS_SCENARIOS.tsv

A recommends that C **not** convert the current mapping into `PASS_FEATURE` yet.

A source evidence supports these machine states conceptually:
- 34 WB `DIRECT|COMPOSITE` rows: `PINNED_OPERATION_MAPPING_READY__FIELD_SCHEMA_LIVE_REQUIRED`;
- 6 `BOUNDARY` rows: `PINNED_MAPPING_BOUNDARY__NO_FALSE_EQUIVALENT`;
- 3 `EXTERNAL_CONTEXT` rows: `EXTERNAL_CONTEXT_REQUIRED`;
- `CAP-24`: `CONTRIBUTION_ONLY__FULL_PROFIT_DEFERRED`;
- `CAP-25`: `LOCAL_FILE_HISTORY__SEARCH_ENTITLEMENT_REQUIRED`.

Exact wording/status-column mutation belongs to C. The existing `API_MAPPING_REQUIRED` may remain until C chooses the shared readiness vocabulary and WB official/source freshness + field-level schema evidence are resolved.

## Independent review correction

Read-only Luna review evidence: `/root/octoport-control/logs/A/a04-business-coverage-review-result.md`. The review of exact candidate `87d523d6146dbdac837f286bec76dd92731671af` found two High and two Medium evidence defects: nullable numeric coercion, duplicate join-key acceptance, overclaimed WB movement coverage for `STD-11`, and overclaimed WB cancellation coverage for `CAP-12`. The follow-up candidate fixes all four by failing incomplete numeric inputs closed, rejecting duplicate keys on both sides, and downgrading those two WB scenarios to explicit `BOUNDARY` states. No runtime/provider behavior is added.

## Remaining gates

This block does not prove:
- fresh official WB OpenAPI/schema authority;
- exact response-field semantics/units for all 45 WB cases;
- live Ozon/WB business values or owner gold-set agreement;
- the six AI-surface scenario matrix;
- owner marketplace credentials or live provider calls;
- store/reviewer/deployment acceptance.

Those are separate readiness layers. No owner action is requested by this source-only block.
