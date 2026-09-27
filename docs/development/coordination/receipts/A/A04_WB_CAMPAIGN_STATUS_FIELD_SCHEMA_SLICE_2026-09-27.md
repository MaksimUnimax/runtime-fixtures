# A04 — WB campaign status field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA PASS / LIVE VALUES OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE` for `CAP-17`.
Parent A head: `2ded2837f5db7f25b0559a130f1a30e583e9fa1b`.

## Scope

Accepted mapping remains:
- `promo_campaigns`;
- `media_campaigns`.

The slice preserves provider-family-specific campaign status enums. It does not invent one WB-wide numeric status vocabulary.

No runtime, accepted operation mapping, live WB request, credential, owner session, AI call, deployment or shared readiness mutation was performed.

## Provider authority

Pinned mirror:
- repository: `eslazarev/wildberries-sdk`;
- commit: `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`;
- path: `specs/08-promotion.yaml`;
- blob SHA: `30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9`.

Promotion campaigns use `GET /api/advert/v2/adverts`.
Media campaigns use `GET /adv/v1/adverts` and explicit `limit/offset` query fields.
## Status semantics

Promotion campaign status IDs:
- `-1` deleted;
- `4` ready to start;
- `7` finished;
- `8` canceled;
- `9` active;
- `11` paused.

Media campaign status IDs:
- `1` draft;
- `2` moderation;
- `3` rejected / can resubmit;
- `4` ready to start;
- `5` scheduled;
- `6` showing;
- `7` finished;
- `8` canceled;
- `9` paused by seller;
- `10` paused by daily limit;
- `11` paused.

The same integer is therefore not sufficient for a cross-family answer. In particular, `9` means ACTIVE for promotion and PAUSED_BY_SELLER for media.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-campaign-status-field-schema-slice-v1.json`
SHA-256: `8fdc79bb77a41ea27befc1b71c0050194142fe8c95a9eeba4cb52fcc4215d373`.

Validator:
`tests/regression/extension-core/wb-campaign-status-field-schema-slice.mjs`
SHA-256: `6b840ed5b34759f201019dd8803ceec32f8a6391e18f75e787d457fc0d682a13`.

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`
SHA-256: `ec94fb00ea38ffc522404662ae0b991b9229fcf993a9a8494f80614317691036`.
## Verification

Focused validator PASS:
- current registry routes/hosts/query keys match;
- promotion IDs are exactly `[-1,4,7,8,9,11]`;
- media IDs are `1..11`;
- media types 1/2 stay provider-specific;
- unknown provider status is `INCOMPLETE`;
- numeric status 9 is explicitly proven to have different meaning across families.

Business coverage PASS:
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 139 WB operation refs;
- 25 deterministic numeric cases;
- readiness semantic projection unchanged.

Prettier PASS; `git diff --check` PASS.

No full `extension_core` rerun: this is fixture/validator/coverage-import evidence only and runtime/package bytes are unchanged.

## Remaining gates

This is SOURCE evidence, not LIVE_WB or final business acceptance.

Open:
- live WB campaign values and owner gold-set reconciliation;
- real media offset/limit pagination behavior under concurrent campaign changes;
- any future owner-approved cross-marketplace campaign status vocabulary.

Next: continue another uncovered A04 family with no external dependency; prefer evidence reuse/source-only slices until a runtime defect requires a full package gate.
