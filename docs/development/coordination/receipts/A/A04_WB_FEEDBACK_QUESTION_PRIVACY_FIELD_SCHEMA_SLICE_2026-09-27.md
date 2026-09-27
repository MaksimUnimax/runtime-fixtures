# A04 — WB feedback/question privacy field-schema slice — 2026-09-27

Status: **SOURCE PRIVACY/COUNT/PAGINATION PASS / LIVE VALUES + AI FREE-TEXT POLICY OPEN**

Task: `A04_CAP16_WB_FEEDBACK_QUESTION_PRIVACY_SCHEMA`.
Parent A head: `d1ec3d7ad1b01dc75b5bcb1a14a60f1f278c1dd8`.

## Scope

CAP-16 keeps the accepted WB operations `feedbacks_list` and `questions_list`.
This slice pins provider count meanings, pagination limits, product identity, and the actual `customer_safe_v1` projection already used by the composed WB contract.

No runtime, operation-map, frozen donor, live WB, credential, owner session, AI call, deployment, or shared readiness mutation was performed.

## Current provider authority

Pinned current mirror:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- path: `specs/09-communications.yaml`;
- blob SHA: `b59903fe6f5e9efef76d433b8f6430781b44c0b8`.

The mirror exposes current WB communications methods and generated descriptions:
- feedback list: `GET /api/v1/feedbacks`;
- question list: `GET /api/v1/questions`;
- list responses carry `countUnanswered` and `countArchive`;
- feedback `countArchive` means processed feedback, including rating-only feedback without text/photo;
- question `countArchive` means answered questions;
- feedback pagination supports `take <= 5000`, `skip <= 199990`;
- question pagination is bounded by `take + skip <= 10000`.

This is pinned mirror evidence, not a live seller-account response.
## Actual privacy contract

Current frozen WB contract marks both list operations `privacy=customer_safe_v1`.

The actual sanitizer:
- replaces PII-key values such as `userName` with `[REDACTED]`;
- redacts e-mail addresses in strings to `[REDACTED_EMAIL]`;
- redacts phone-like strings to `[REDACTED_PHONE]`;
- leaves other free text present after those substitutions.

Therefore sanitized feedback/question text must not be described as anonymous, public, or free of all personal information. Any policy to send sanitized customer free text to an AI surface remains a separate product/privacy decision.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-feedback-question-privacy-field-schema-slice-v1.json`
SHA-256: `f419c0a03212882cce279cd0c61521ddfca77feeab78d1d8f0f17047deaefb1d`.

Validator:
`tests/regression/extension-core/wb-feedback-question-privacy-field-schema-slice.mjs`
SHA-256: `48a14745e50997d986d5d1f0a7973e5982d6195812936533b0eb2227044f928a`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `ee72b6f44cec8af2208ec9aa3390d52775f0aa21c580f6b078bdff35859ea8b3`.
## Verification

Focused validator PASS:
- provider operation/path/privacy metadata pinned;
- provider counts preserved separately;
- feedback processed count not relabeled as answered count;
- actual `customer_safe_v1` redacts synthetic `userName`, e-mail and phone values;
- free text is proven to remain after targeted redaction;
- incomplete feedback enumeration stays incomplete;
- question provider count above the 10k window stays incomplete.

Business coverage PASS:
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Prettier PASS and `git diff --check` PASS.

No full `extension_core` rerun: this slice changes only fixture/validator/coverage-import evidence and exercises the existing frozen contract in-process; runtime/package bytes are unchanged.

## Remaining gates

This is SOURCE privacy/schema evidence, not LIVE_WB, LIVE_OWNER or final business acceptance.

Open:
- live WB values and real pagination stability;
- owner/business policy for when sanitized customer free text may be sent to an AI;
- media URL/privacy review for provider fields outside this slice;
- future provider schema additions after the pinned communications blob.

Next: continue the next uncovered independent A04 family from current state; do not expand CAP-16 privacy authority without an explicit product decision.
