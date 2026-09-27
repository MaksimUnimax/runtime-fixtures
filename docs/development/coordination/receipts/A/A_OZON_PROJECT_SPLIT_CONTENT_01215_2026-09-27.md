# Ozon Bridge 0.1.21.5 — ChatGPT Project split-content ownership

Exact defect in Bridge:
chatgptMessages() required an assistant turn wrapper or inferred assistant ownership by climbing from the response-actions toolbar to a common DOM container that also contained the response content. Current ChatGPT Project UI can render the assistant content branch and response-actions branch separately. In the owner's exact Project accessibility tree, the OZON_HELP_V2 code branch and "Действия с ответом" only converge at a broad generic container with 65 children, not a per-response semantic container.

Why 0.1.21.4 still failed:
it relaxed the allowed ancestor tag, but it retained the same fundamental shared-container assumption. When several response-action groups exist under the transcript container, actionCount is greater than one and the inferred assistant candidate is rejected. allStructuralBindings() therefore never reaches the code-block scan.

Not the cause:
- Ozon credentials / binding / READY state.
- The command parser.
- CodeMirror newline handling.
- The current inlineCopyOnly Copy control: current ChatGPT CopyButton still emits aria-label Copy/Копировать.
- The Ozon API.

Fix:
assistant ownership is now also established from ChatGPT's content-local assistant markers data-assistant-markdown and data-assistant-stream-block, while still rejecting anything nested in a proven user turn. No global OZON_* text search was added.

Reproduction:
- 0.1.21.4 project_split_content_actions: FAIL, 0 buttons.
- 0.1.21.4 project_stream_marker_without_turn: FAIL, 0 buttons.
- user-contained assistant-marker negative control: PASS, 0 buttons.
- 0.1.21.5 same cases: PASS.

Verification:
- standalone source: 47/47 PASS.
- deterministic archive extracted: 47/47 PASS.
- 31 JavaScript files syntax PASS.
- real server ChatGPT native popup full HELP cycle: PASS; one report; zero Ozon business requests.
- repository composed source browser gate: PASS.
- repository composed extracted browser gate: PASS.
- repository composed adapter SHA equals standalone tested adapter SHA:
  a534528986021549b8e5fdf0d3c4e3904b6ca712906ea2ec25df01a9ab788eda

Standalone ZIP SHA-256:
a7318c87a522134ac12d56b8a6580c59afc9225912e6c10469e350ea43911583

Local owner-browser acceptance remains pending until this exact 0.1.21.5 build is installed there.
