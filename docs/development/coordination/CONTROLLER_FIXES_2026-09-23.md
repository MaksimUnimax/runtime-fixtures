# Controller correction after live audit — 2026-09-23

Owner authorized server/docs/prompt corrections while A/B/C continue. Base: dc63fc6290b0ecd78d8b31452811dc5a93d89f38. Isolated worktree: /root/octoport-controller-fixes; branch controller/live-audit-20260923.

Controller owns this bounded correction: .github/workflows/* CI triggers/preparation; tooling/coordination/*; tests/integration/server/s2-q1-llm-ops-prebeta-acceptance.integration.test.ts; tests/regression/extension-core/client-i1/installed_local_integration.py; tooling/checks/extension_i1.py; C3H browser evidence reader and its dedicated tests; coordination docs/prompts. A continues A01 (application patches and work admission test); B continues DB lineage work. C continues its own release validator and must independently review its child result.

Known main failures: Server CI 35821400755 notification delivery (one of 1622); Extension I1 35821400766 AUT-47 absent browser evidence and OTP BETA_CLOSED from mismatched fixture namespace. Prior successful component runs do not erase newer failures at the current main SHA.

No product auth relaxation, live DB mutation, sandbox bypass, model change or release authorization. Pending old B01 legacy database corruption/lineage remains a separate review boundary; no journal surgery or live restore is authorized.
