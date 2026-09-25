# M10D full-volume QA

WORK_ID = OCTOPORT_SEO_M10D_SEARCH_VS_AI_RECONCILIATION_2026-09-25_R1
START_HEAD = 5caa7d500f3d3857c4b627e18147f8e2bcc81b07
END_OBSERVED_HEAD = 5caa7d500f3d3857c4b627e18147f8e2bcc81b07
AUTHORITY_DRIFT_STATUS = NONE_FROZEN_INPUTS_UNCHANGED
LOCAL_VERDICT = PASS_LOCAL_M10D_RECONCILIATION / MAIN_CHAT_ACCEPTANCE_PENDING

## Accounting

CANONICAL_PROMPT_BLOB_MATCH = true
INPUT_MANIFEST_BLOB_MATCH = true
PRE_HANDOFF_BLOB_MATCH = true
STEP_PREPARATION_BLOB_MATCH = true
M10A_M10B_M10C_PRODUCT_TRUTH_FROZEN_BLOBS_MATCH = true
LEVEL1_READ = PASS
LEVEL2_READ = PASS
FAILURE_HISTORY_READ = PASS
CASE_ROWS = 15/15
OUTCOME_COUNTS = {"CHANGE": 0, "ENRICH": 6, "DE_RISK": 4, "NO_CHANGE": 0, "HOLD": 5}
RAW_SNAPSHOTS_ACCOUNTED = 27/27
TERMINAL_CASES_ACCOUNTED = 15/15
CLUSTER_XREF_ROWS = 184/184
BOUNDARY_XREF_ROWS = 166/166
UNIQUE_BOUNDARY_PAIR_IDS = 155/155
M10A_CLUSTER_ROWS = 104/104
M10A_BOUNDARY_ROWS = 1399/1399
SHARED_CLUSTER_TARGETS = 63/63
SHARED_BOUNDARY_TARGETS = 11/11
CROSS_CASE_ROWS = 74/74
ADVERSARIAL_ROWS = 20/20
ADVERSARIAL_PASS = 20/20

## Effects / conflict audit

CLUSTER_EFFECT_COUNTS = {"HOLD": 5, "PRESERVE": 166, "NARROW_HOLD": 5, "ENRICH_ONLY": 8}
BOUNDARY_EFFECT_COUNTS = {"HOLD": 75, "NARROW_HOLD": 35, "ENRICH_ONLY": 56}
CROSS_CASE_STATES = {"COMPLEMENTARY": 5, "HOLD": 8, "CONSISTENT": 61}
CROSS_CASE_MATERIAL_CONFLICT = 0
A shared target with at least one HOLD effect is itself cross-case HOLD. Other observations do not silently resolve it. Distinct exact query wording and third-party source absence are not contradictory official market facts.

## Every case HOLD

- CASE01 M10BCASE_e5e5533784063649: Both snapshots repeatedly combine seller-report assistance with third-party card export, promotions and broad management; no consistent read-only-versus-autonomous answer separates the primary helper task from adjacent agent tasks.
- CASE06 M10BCASE_9ef8cb07387160b6: Both snapshots mix seller-marketplace connector evidence with a Bitrix24 app-marketplace referent and file-report work; unresolved referent contamination prevents a safe material boundary narrowing.
- CASE08 M10BCASE_d3950384418e3bbd: Both snapshots reproduce an own-store/external-intelligence mix but use just one roundup for answer synthesis; no reliable separation of these incompatible product-fit tasks follows for the frozen material HOLDs.
- CASE12 M10BCASE_905d903673405cdf: Two third-party-only answers mix seller report reading with payout, tax/accounting and year-specific claims; absent official Wildberries used help cannot validate the report or separate the frozen Search task boundaries.
- CASE15 M10BCASE_d7c8eaf031abe40a: Both third-party sources steer the Ozon seller-report query toward tax/accounting realization while the second answer also cites Ozon corporate financial results; no official Ozon seller help supports the seller-report interpretation.

## Every MATERIAL_CONFLICT

- None: differences between query scopes or official-source presence/absence have not been misrepresented as contradictory market facts.

## Positional XREF schema

Both frozen M10B XREF inputs already have a column named evidence_refs. The required appended evidence_refs therefore creates a duplicate field name. The output retains all first 12 cluster / first 10 boundary columns exactly by position, then appends the five required columns; the final evidence_refs holds M10C/M10A delta citations. Inspect by position to retain both columns. Three M10B cluster XREF rows repeat the same case/cluster via different M5 hypotheses: all are retained; cross-case counts each distinct case once.

## Hard boundaries

M10A_MUTATIONS = 0
M10B_MUTATIONS = 0
M10C_MUTATIONS = 0
NEW_PROVIDER_CALLS = 0
NEW_GENSEARCH_CALLS = 0
NEW_ALICE_CALLS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION_BY_WORK = 0
GITHUB_WRITES_BY_WORK = 0
SITE_MUTATIONS = 0
FINAL_PAGE_OWNER_ASSIGNMENTS = 0
FINAL_KEEP_OPTIMIZE_CREATE_ROUTE_DECISIONS = 0
FINAL_URL_H1_TITLE_IA_DECISIONS = 0
M11_EXECUTION = 0
OPEN_CRITICAL_DEFECTS = 0

The M10A 104 owner/page-role HOLDs and 1399 page boundaries remain frozen. Case-level DE_RISK only narrows a named diagnostic question; it grants neither same-page nor separate-page authority. ENRICH carries useful context; HOLD preserves unresolved provenance/role ambiguity.
ZIP self-reference: a ZIP cannot embed its own final SHA-256 in its contained manifest without changing the ZIP hash. The return manifest records SHA-256/size for its eight non-self files; the SHA-256 of the final ZIP is given in the terminal delivery report.
