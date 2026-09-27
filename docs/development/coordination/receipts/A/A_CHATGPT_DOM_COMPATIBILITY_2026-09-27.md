# A — urgent ChatGPT DOM compatibility — 2026-09-27

## P2 correction — Response-actions Copy

Status: **PASS — SOURCE + EXTRACTED ADAPTER / C REPRODUCER / NATIVE CHROMIUM USEFUL FLOW**

Task: `A_CHATGPT_RESPONSE_COPY_P2`.

Verified code commit: `13f09ef4ca6a72cacc7c4ca6541c21847dd115a7`.
Preserved pre-transfer checkpoint: `6faaa9249580153c788a175f7fca5e129e558b8b`.
Fresh `origin/main` was merged without rewriting A history at merge commit
`3f9c30c6d02434717078ecdccdec19f8749de1cb`; the saved checkpoint remains an ancestor.

C rejected the earlier `315b2a5e` compatibility candidate and its descendants after
reproducing a false code block: a response-level `Copy` inside `Response actions`
claimed a sibling plain `<code>`. That earlier acceptance is **superseded** by this
P2 correction and must not be used for release/store intake.

### Repair boundary

The imported Ozon v0.1.22 baseline remains unchanged. In
`apps/extension/application-patches.json` the ChatGPT adapter now:
- rejects any Copy-like button whose nearest ancestor matches the existing exact
  Response-actions selector before checking `data-code-copy-state`, aria/title, or text;
- independently rejects such controls in `chatgptCopyOwnedBlock()`;
- preserves ordinary code-toolbar Copy ownership, plain-code ownership, fenced
  `pre > code` fallback, canonical assistant ordering, and composer exclusions.

### Regression and package evidence

Pre-fix reproduction on the current branch package returned:
`[{"text":"WB_API_V1 {}","anchor":"response-copy","root":"shared"}]`
and failed the expected empty result. The supervised pre-fix job was
`1d25733295ee435eadd96ae5de6ffb53`.

Final R2 evidence:
`/root/octoport-control/logs/A/A_RESPONSE_COPY_P2_R2/summary.json`.

- package SHA-256:
  `c9ed546ffb71a61a5618e414fd4100d507b81c2c6d5071a3319c96e72cea1e3e`;
- deterministic rebuild: `repeat_archive_match=true`;
- runtime/extracted byte parity: `source_extracted_bytes_match=true`;
- focused adapter regression: source **PASS**, extracted **PASS**;
- exact C reproducer: source `[]`, extracted `[]`;
- required cases cover response-copy-only plain code, misleading
  `data-code-copy-state`, localized/text-only response Copy, fenced fallback,
  real code-copy + response-copy anchor precedence, nested/order/user/editor/
  ambiguity cases;
- native useful flow: source **PASS**, extracted **PASS**, Chromium
  `151.0.7922.34`, `live_provider_calls=0`, `installed_acceptance=false`;
- native regression explicitly covers response-actions Copy exclusion,
  response-copy rerender without stale action, fenced fallback, real code-copy
  precedence, and the existing exact synthetic WB operation path.

Supervised resource jobs:
- focused source/extracted + C reproducer:
  `5aa53a6d323e4994b67c399fd8a4b5e4`, PASS, cleanup verified;
- native extracted:
  `01d8bf714ddc4b02acbeca623e6afe05`, PASS, OOM 0, cleanup verified;
- native source:
  `cb0979118d424edf9c7a084184623f8d`, PASS, OOM 0, cleanup verified.

This P2 receipt does **not** claim owner-authenticated ChatGPT Work, owner Opera,
installed-store acceptance, live marketplace calls, store publication, or production
acceptance.

Status: **SOURCE/PACKAGE/NATIVE CHROMIUM FIXTURE PASS / REAL GUEST DOM CONFIRMED / OWNER AUTHENTICATED + OPERA NOT CLAIMED**

Task: `A_URGENT_CHATGPT_DOM_COMPATIBILITY_20260927`.
Parent handoff before repair: `8f4603c299b098e22af12f8bc6a7b233cee26b98`.
DOM repair commit: `21f8e8538b150790133b911244a68af61c86cd58`.
Merged tested code head: `26a486578d6d23918a0b89b49838e8f9e9c2c138`.
Merged `origin/main`: `714f674dc269ea115d6e6d2233b8740f36847367`.

## Incident and real guest evidence

The owner reported that the extension execution button disappeared after a ChatGPT UI change.

A separate real ChatGPT guest diagnostic on Easyscript/Chromium 151 observed:
- assistant turn: `li[data-message-role="assistant"]`;
- code: `pre > code`;
- code-copy control: `button[aria-label="Copy code"][data-code-copy-state="idle"]`;
- response actions: `[data-assistant-message-actions][data-message-actions][role="group"][aria-label="Response actions"]`.

The pre-fix adapter returned zero assistant messages on that real guest response. A bounded selector prototype recognized one message / one code block / one extension button. Evidence remains under:
`/root/octoport-diagnostics/ozon-button-20260927T0908Z/`.

This is **REAL GUEST DOM evidence only**. It is not owner-authenticated ChatGPT Work, owner Opera, installed-store, or production acceptance.
## Implementation boundary

The frozen imported Ozon v0.1.22 source remains unchanged. The compatibility repair is carried only by `apps/extension/application-patches.json`.

Assistant ownership now supports:
- legacy `data-turn=assistant`;
- `data-message-author-role=assistant`;
- current `data-message-role=assistant`;
- unmarked response containers only when a structural turn has exactly one Response-actions group plus ChatGPT assistant-content markers.

Canonicalization is fail-closed:
- an explicit nested assistant root wins over an inferred ancestor;
- canonical roots are returned in DOM/document order;
- equal command text in two distinct assistant messages is not deduplicated;
- user descendants, ambiguous/two Response-actions groups, and unrelated action groups do not become assistant messages.

Code ownership supports:
- `pre > code`;
- plain `code` when paired one-to-one with a bounded code-copy control;
- existing CodeMirror/writing-block/code-viewer surfaces;
- `data-code-copy-state`;
- Copy / Copy code / Копировать / Копировать код through aria/title or exact button text.

A code-copy anchor must resolve to exactly one code surface. Message-level copy controls do not claim multiple independent code blocks. `readCodeText()` returns code text only, not button/action text.
## Composer/editor safety

The composer guard is present in both the shared ChatGPT adapter and content script.

It rejects:
- explicit assistant turns;
- writing-block/code-viewer editor surfaces;
- current `data-message-role=assistant`;
- unmarked assistant content only when bounded by the same Response-actions + assistant-content evidence.

Message inference uses direct assistant markers rather than recursively calling the composer guard, avoiding recursive ownership detection. Generic `article` / `section` containers are not treated as assistant messages by themselves.

Work/Standard identity, auth, tokens, marketplace queueing, v3 subscription logic, manual no-replay semantics and frozen STORE 0.2.4 were not broadened by this repair.
## Focused adapter regression

New regression:
`tests/regression/extension-core/chatgpt-dom-compat.py`.

Final merged package:
`/tmp/a-chatgpt-dom-final-r22/package`.

Package:
- archive SHA-256: `0efbee66595047ac50945273885796f365098f52b7ab9eeefce919e0f1692642`;
- repeat archive match: true;
- source/extracted bytes match: true.

Assembled `shared/ai_adapters.js` SHA-256:
`1772d0483feeb8e243f41ca631e0e54217a4656bd96e2e85736099507e8b1cce`.

The adapter regression PASSed on both source and extracted package:
- nested explicit assistant + inferred outer actions => one canonical `inner` response;
- inferred first + explicit last => `first,last` in document order;
- legacy + current messages with identical command text remain two distinct responses;
- plain code + text-only localized Copy preserves exact multiline text;
- `pre>code` remains discoverable before a late Copy control;
- legacy code viewer and CodeMirror surfaces remain recognized;
- user, nested-user ambiguity, unrelated Response-actions and two-actions ambiguity are rejected.
## Native extension useful-flow verification

Supervised browser job:
`29e051ffc6f9474b85278129ca68adba`.

Resource result:
- systemd result: success;
- command exit: 0;
- cleanup verified: true;
- OOM kills: 0;
- peak bytes: 454033408.

`browser_application.py` PASSed on both final merged source and extracted package under Chromium `151.0.7922.34`.

Verified flow includes:
- old-history/legacy assistant baseline;
- current `li[data-message-role=assistant]` fenced code;
- multiple assistant blocks and localized Copy;
- rejection of user/editor/ambiguous/unrelated actions;
- unmarked Response-actions assistant + plain `code` exact extraction;
- one extension action enters the existing manual-operation queue with the exact raw command text;
- DOM rerender/replacement does not duplicate the action;
- no-replay remains enforced;
- existing binary File/IndexedDB/port delivery flow still passes;
- live marketplace/provider calls: 0.

The native test uses a synthetic AI page/fetch and a fixture trust key. `installed_acceptance=false`.
## Evidence boundary / handoff

This candidate fixes the measured ChatGPT DOM compatibility gap and is ready for C integration into a **new** immutable store candidate.

It does not claim:
- owner-authenticated ChatGPT Work PASS;
- Opera PASS;
- live marketplace execution;
- production/store publication;
- mutation of the existing immutable STORE 0.2.4 ZIP.

C owns the new immutable store version and later store/reviewer acceptance. A may continue independent work after exact submit.
