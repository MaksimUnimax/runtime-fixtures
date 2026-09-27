# Ozon Bridge 0.1.21.4 — current ChatGPT Project UI compatibility

Owner-visible defect: an Ozon command is visibly rendered in a ChatGPT Project code block, while Bridge reports zero assistant messages and zero structural blocks.

Evidence from the owner's 0.1.21.3 diagnostics: binding and Work session are ready, but CODE_BLOCK_SCAN reports assistant_message_count=0, structural_block_count=0, own_button_count=0.

Root compatibility gap:
- assistant discovery depended on explicit role wrappers or a response-actions group with a direct aria-label;
- current Project UI may expose response actions through response-specific controls and a generic outer response container;
- current Writing Block surfaces can use [data-writing-block][data-testid="writing-block-container"] with a ProseMirror body.

Fix boundary:
- infer assistant response containers from response-only controls such as Copy response / Копировать ответ plus assistant content;
- support current standalone Writing Block root and ProseMirror command body;
- allow Copy ownership to resolve at the message/root itself;
- preserve explicit user-turn exclusion and user Copy-message negative controls.
No Ozon API, command grammar, credentials, queue, confirmation, or write behavior was changed.

Regression proof:
- 0.1.21.3 reproduces 0 buttons for current standalone Writing Block and two generic Project-response-action fixtures.
- 0.1.21.4 passes all 44 standalone source cases.
- the deterministic archive is extracted and independently passes the same 44/44 cases.
- composed repository source and extracted native Chromium browser_application gates PASS.
- composed ai_adapters.js SHA-256 exactly matches the separately tested standalone adapter:
  76a05afd8d1202db0f0e359dca52212ff193c439262f9ae26dac3c003feb3297
- real server ChatGPT + native toolbar popup full local HELP cycle PASS; one report; zero Ozon business requests; controls return ready; Finish PASS.

Standalone ZIP SHA-256:
5dd9685f2babcba23b362780913d292024f6ce1e597cd3915ca6d5b7e17025f4

Limit: the owner's local Project tab has not yet run 0.1.21.4, so this receipt does not claim that local acceptance is complete.
