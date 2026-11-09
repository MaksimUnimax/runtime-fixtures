# Model answers and editable prompts — 2026-11-09

Status: implemented and independently source-reviewed; full regression and rollout are in progress. This file is not an installation receipt.

Owner contract: `docs/alisa/architecture/ANSWER_MODEL_CONTRACT_20261109.md`.

Runtime base: `alisa-ozon-subscription-access-r1-20261109`.
Station base: `station-auto-r8-model-usage-r8`.
Copy the entire installed base, then overlay only the files in `source-hashes.json`; do not install a historical partial runtime directory as a complete package.

Three OWNER settings: `request_planning_prompt`, `answer_prompt`, `answer_extra_instruction` (empty by default). Original user text and clarification turns remain intact. Final generation receives permitted full API responses with operation/store/request parameters; no final JSON, DSL, facts or acknowledgement format.

Successful reads and final generation use the same durable job and call ledger. Retryable API failures use the shared queue/backoff first; unresolved responses become data for the model. Confirmed 401/403 notices contain only safe refusal details and are bound to the same job's received HTTP error receipt. They never permit another API read. Delivery, replay, expiry, pagination and tenant/store revocation remain enforced.

Provider denial classification reuses the parallel paid-response work (`provider_denial.py`, `provider_access_result.py`); its JSON model-acknowledgement/fixed-server-answer path is not part of this overlay, because the owner's new contract requires ordinary model text. No files in the parallel executor's candidate were changed.

Verified so far: 20 focused whole-job tests, 46 station/admin tests, 6 installer fault tests; one further revocation-race test and one cold-auth test are included in the full regression now running. Source review APPROVE; installed/live verification pending.

Limits: ordinary model text can contain factual or arithmetic mistakes. Full source sets may exceed a provider context window; they are not silently sampled. Existing structured collection/planning remains separate from final text generation. A deterministic preselected template does not incur an extra model planning call.
