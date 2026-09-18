# S2-L3 Alice non-live H3 foundation

Work ID: `S2_L3_ALICE_NONLIVE_H3_FOUNDATION_2026-09-18_R1`

Verdict: `ALICE_H3_NONLIVE_CURRENT_STREAM2_CANDIDATE`

This record is non-live only. It does not establish `LIVE_ALICE_PASS`, Alice
authentication readiness, S2-L3 completion, S2-L2 live pass, or P8.5.

## Lineage and repository state

- Parent: `d107287e7a9cf82290a5a6afad89e67c10e00494`
- Parent tree: `fdbd550f1d9bd2703729a538e99fcde1bf1a143a`
- Branch: `feature/stream2-health-l3-alice-nonlive-2026-09-18`
- Remote integration re-verified: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Historical Health reference re-verified: `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95`
- Current remote `main` observed during fetch: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`

The original checkout had unrelated untracked material. Work was isolated in
a clean worktree at the exact accepted parent; no unrelated material was
modified.

## Alice source-authority inventory

The source copies were read in full for the relevant modules. Blob IDs below
are from the accepted parent.

| Classification | Source and blob | Authority result |
| --- | --- | --- |
| `CURRENT_PRODUCT_AUTHORITY` | `apps/extension/src/imported/ozon-v0.1.22/shared/ai_adapters.js` — `4c750308712fa630990e2cb20407240c5907d63a` | Current imported product baseline: Alice origin, composer shell, message ownership/IDs, `oknyx` state classifier, `.CodeBlock`, native Copy, and stop/generation state. |
| `CURRENT_PRODUCT_AUTHORITY` | `apps/extension/src/imported/ozon-v0.1.22/content_script.js` — `bc047968246261a078260dee469bf4f435d9b901` | Current imported consumer: active Alice history lookup, `resolveWithEvidence` call, Alice composer/send ownership, and no-op/one-shot delivery behavior. |
| `CURRENT_PRODUCT_AUTHORITY` | `apps/extension/src/imported/ozon-v0.1.22/shared/conversation_identity.js` — `3fe3b99d42eeccc729d003733daac8b377df4066` | Current imported resolver consumer. Its Alice capability fields are incomplete in this copy, so it was not used alone to infer H3 C11. |
| `CURRENT_REFERENCE_AUTHORITY` | `migration/reference/wildberries-v0.3.0/runtime/shared/ai_adapters.js` — `a2fbf5a0ab913bb8fa05e84fd471d8cb6d7a4251` | Explicit Alice adapter reference, including exact selectors and control states. |
| `CURRENT_REFERENCE_AUTHORITY` | `migration/reference/wildberries-v0.3.0/runtime/content_script.js` — `94f541718be48253bad5157cc4a207419f38deb6` | Explicit Alice consumer for active history, identity, composer/send ownership, and response handling. |
| `CURRENT_REFERENCE_AUTHORITY` | `migration/reference/wildberries-v0.3.0/runtime/shared/conversation_identity.js` — `ff205f996b6740584f3d5204a540e3a0481210e4` | Exact Alice `resolveWithEvidence` semantics: `/chat/<UUID>`, active history corroboration, missing/conflict outcomes, and no canonical authority. |
| `CURRENT_REFERENCE_AUTHORITY` | `migration/reference/wildberries-v0.3.0/runtime/shared/ai_delivery_capabilities.js` — `b12a0580734e35d89c8eca06b4ba7e7a58a195e1` | Alice capability profile: `alice.yandex.ru`, `chat` path segment, canonical unsupported, active conversation evidence required, explicit ready/stop control strategy. |
| `REGRESSION_AUTHORITY` | `tests/regression/imported/wildberries-v0.3.0/progress/full_migration_2026-09-13/tests/p6_alice_browser.py` — `447568a7e19247315eb52101c02c8e9af9b020a7` | P6 attachment-only regression: Alice synthetic origin, drag/drop surface, ready state, and stale capability rejection. Not H3 authority. |
| `FIXTURE_ONLY` | `tests/fixtures/imported/ozon-red-309da471/runtime/**` | Frozen imported Ozon copy; used only to compare duplication, not authority. |
| `FIXTURE_ONLY` | `tests/fixtures/imported/wb-donor-e01b051c/runtime/**` | Frozen WB donor copy; not promoted over the accepted migration reference. |
| `NOT_H3_AUTHORITY` | `packages/ai-adapters/alice/README.md` — `eebc9e7296c07e92508fc0d4062bfa1a037d16fc` | Foundation documentation only; no production adapter implementation. |

Identical concepts were resolved in favor of the explicit WB migration
reference for C11 because it is the only inspected copy that declares Alice's
active-history evidence requirement and capability fields completely.

## Contour authority gate

| Contour | Accepted authority used | Non-live sufficiency | Live confirmation |
| --- | --- | --- | --- |
| C01 page/surface identity | Alice `matchesLocation()` and `alice.yandex.ru` capability profile | Sufficient; packaged target is exact | Required for real-page markup |
| C02 conversation root | Active `.ChatListItem[id]` plus Alice-owned message region | Sufficient for bounded fixture | Required for live DOM ownership |
| C03 composer root | `aliceComposerContext()` and Standalone input shell | Sufficient | Required |
| C04 composer input | `[data-testid="inputbase-textarea"]`, fallback `[data-highlight-id="alice-input"] textarea` | Sufficient, unique/visible/editable enforced | Required |
| C05 Send control | `[data-testid="oknyx"]`, `aria-label="Отправить"`, one exact control | Sufficient | Required |
| C06 busy/stop | `aria-label="Алиса, стоп"` on Alice `oknyx` | Sufficient; no ChatGPT busy signal reused | Required |
| C07 assistant message | `[data-message-role="alice"]` | Sufficient with new stable ID | Required |
| C08 completion | Adapter `isGenerating()` stop-state transition plus non-empty owned response | Sufficient for non-live | Required |
| C09 command code surface | Assistant-owned `.CodeBlock` and owned code content | Sufficient | Required |
| C10 native Copy | `.CodeBlock`-owned `[data-testid="codeblock-action-copy"]` | Sufficient | Required |
| C11 conversation identity | WB `resolveWithEvidence`: `/chat/<UUID>` + active history item; canonical excluded | Sufficient for bound existing conversations; fresh `/chat/` fails closed | Required |
| C12 delivery insertion path | Same Alice Standalone shell owns input, input-controls root, and `oknyx` | Sufficient for bounded non-live insertion ownership | Required |
| C13 blocking/environment | Generic Health browser/network reasons only; no provider blocker selectors invented | Generic only | Provider-specific evidence required before live use |

`SOURCE_AUTHORITY_GAP`: provider-specific Alice login, checkpoint, CAPTCHA,
and account-blocker selectors are not established by the inspected authority.
They remain unresolved; missing composer is never relabeled as login. A second
boundary remains for live confirmation of C08/C12 against a controlled Alice
environment. No guessed selector or provider call was added.

## Red-first evidence

On the exact parent, the temporary red matrix failed as expected:

- A-RED-01: `ALICE` was absent from `H3SurfaceSchema`.
- A-RED-02: `alice_health` resolved as `CONTROLLED_TARGET_NOT_REGISTERED`.
- A-RED-03: an Alice plan failed schema validation.
- A-RED-04: the Alice deterministic fixture module was absent.
- A-RED-05: ChatGPT-only contracts rejected an Alice plan.

The temporary red probe was removed after implementation; final tests are
green and do not encode a permanent expected failure.

## Implementation

- Added `ALICE` / `ALICE_H3_V1` revision 1 to the common H3 contract and
  packaged action/profile table.
- Added `alice_health` to the combined registry and a filtered
  `createPackagedAliceH3TargetRegistry`; dedicated Standard/Work factories
  remain ChatGPT-only.
- Added Alice profile and strategy with packaged provenance fencing, one-shot
  Send, no Enter fallback, no retry, stale-node identity checks, active-history
  identity binding, Alice stop-state generation observation, new-message ID
  association, `.CodeBlock`/native Copy ownership, and bounded cleanup.
- Added a loopback-only synthetic fixture and deterministic Chromium config;
  production strategy code reads DOM authority only and never fixture
  bookkeeping.
- Added focused unit, contract, mismatch, registry, profile, and Chromium
  tests. No product adapter, auth/session, bridge, scheduler, DB, or migration
  files were changed.

## Deterministic matrix

The Alice Chromium matrix ran 24 tests successfully. Exact mapping:

| IDs | Covered by |
| --- | --- |
| A01–A02 | Exact packaged target/profile and wrong-origin `about:blank` fail-before-Send test |
| A03–A05 | Unique composer, duplicate composer, missing input/controls cases |
| A06–A07 | Valid prompt readback and exact active `oknyx` Send |
| A08–A10 | Blocked `StandaloneOknyx_error`, Stop, Ready/listening cases |
| A11–A13 | One-send accounting, no Enter path, post-send no-retry cases |
| A14–A17 | Stop transition, new response association, old response rejection, missing response ID |
| A18–A21 | Stable identity, identity drift, idle completion, non-empty response requirement |
| A22–A24 | Alice `.CodeBlock`, owned native Copy, external Copy rejection |
| A25–A27 | Standalone delivery ownership, composer replacement, response replacement |
| A28–A31 | Common H3 engine surface/target/profile/provenance mismatch tests |
| A32–A34 | Sanitized evidence assertions, loopback-only fixture/no provider call, fresh driver/fixture state per test |

## Regression and privacy

- `P6_ATTACHMENT_SURFACE_REGRESSION`: PASS, 4/4, local Chromium, 0 real
  provider calls.
- `NEW_ALICE_H3_DETERMINISTIC_MATRIX`: PASS, 24/24 after the final added
  origin and message-ID cases.
- No Alice credentials, cookies, storage state, owner profile, raw prompt,
  raw response, raw DOM, screenshot, or token was persisted.
- Fixture requests were loopback only. Provider/live Alice call count: 0.
- Stream-1 paths were rechecked; no files under `apps/extension/**`,
  `packages/ai-adapters/**`, `packages/bridge-core/**`,
  `packages/control-client/**`, `packages/marketplaces/**`, or product
  auth/bootstrap/session were modified.

## Deferred ledger

`S2-L3-ALICE-DEDICATED-SESSION-001`: `NOT_STARTED / REQUIRED_BEFORE_LIVE`.
R1 intentionally adds no Alice authenticated-session capability, credentials,
storage state, or live test item.

## Next bounded autonomous step

Before any live Alice work, establish a controlled, credentialed-source capture
for the unresolved provider-specific blocker boundary and live-confirm C08/C12
against the same source-owned identity/composer contract. Do not add Alice auth
or dedicated-session support in this R1 line.
