# Stream 2 — Architect / Codex working rules

Status: **PERMANENT WORKING AUTHORITY**

Date: 2026-09-22

## Roles

### Architect

The architect owns and decides:

- architecture;
- roadmap;
- methods;
- work order;
- exact scope;
- acceptance criteria;
- PASS / FAIL;
- rework decisions;
- next roadmap step;
- permanent rules;
- architecture and roadmap documentation.

Architecture decisions, roadmap changes, permanent working rules, evidence policy, and operator-workflow decisions MUST be recorded directly in GitHub authority documents by the architect. Chat text is not the authoritative storage location.

### Codex

Codex is implementation and test execution only.

Codex may:

- write explicitly assigned code/config/tests;
- run explicitly assigned commands/tests;
- commit and push explicitly assigned implementation;
- report factual results.

Codex MUST NOT decide:

- architecture;
- roadmap;
- methods;
- scope changes;
- acceptance;
- PASS / FAIL;
- blocker strategy;
- next roadmap step;
- permanent working rules;
- architecture documentation.

Codex does not replace architect-owned documentation work.

## Stream isolation

- Terminal 1 = Stream 1 only.
- Terminal 2 = Stream 2 only.
- Do not mix stream ownership or mutations.
- Stream 2 monitoring has no authority to mutate Stream 1 product/auth state.

## Forward-only Git safety

- no force push;
- no blind reset;
- no history rewrite;
- no unrequested rebase;
- remote/live facts override stale static context;
- secrets, tokens, cookies, OTPs, sessions, raw private reports, and private keys are never persisted in evidence.

## Decision persistence rule

When the architect changes:

- roadmap;
- architecture;
- permanent working rule;
- evidence rule;
- operator workflow;
- source-authority model;

the architect must persist that decision in GitHub immediately rather than leaving it only in chat or delegating the decision/documentation to Codex.
