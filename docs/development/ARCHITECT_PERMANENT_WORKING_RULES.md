# Seller Agents / Octoport — Permanent Working Rules

Status: **PILOT AUTHORITY — SINGLE EXECUTOR / REMOTE DESKTOP**

This file is intentionally replaced on branch:

`docs/single-executor-rdc-autowork-pilot-2026-09-22`

The complete authoritative rules for this pilot are:

`docs/development/autowork/SINGLE_EXECUTOR_RDC_AUTOWORK_GOVERNOR.md`

Current durable state is:

`docs/development/autowork/AUTOWORK_STATE.md`

The previous two-stream / parent-Codex / child-Codex / per-work server-permission
rules are historical on this branch and MUST NOT control the pilot.

Permanent pilot rules, in compact form:

1. **Хуесос is the primary architect, engineer, tester and acceptance
   authority.**
2. **Remote Desktop Commander is the normal server execution channel.**
3. **No per-call or per-work-unit owner permission is required while autowork
   is active and no current owner STOP exists.**
4. **Codex is optional auxiliary tooling only**, not the normal implementation
   layer.
5. **Frontier/secondary models are periodic independent reviewers**, not the
   primary workers.
6. **One unified roadmap / one executor.** Product, monitoring and Telegram may
   remain separate architectural domains, but not separate implementation
   streams.
7. **Every material decision uses the mandatory three-level dependency chain**
   and an explicit "why this is not a hack" analysis at every level.
8. **Unknown production facts require provenance/root-cause recovery before
   repair.**
9. **Owner-required actions are durably deferred, skipped, and do not freeze
   unrelated work.**
10. **No repeated unchanged probes / no busy loops / no fake work.**
11. **Tests escalate to installed/runtime/browser evidence where relevant.**
12. **Хуесос may install and test the real extension through Playwright and
   legitimate browser runtimes.**
13. **One browser/provider/fixture does not imply another.**
14. **Architect-owned roadmap/rules/state documentation is written directly by
   хуесос.**
15. **No force push, blind reset, history rewrite, secret persistence or
   anti-bot bypass.**
16. **Current cursor is never hard-coded into the permanent governor.**
17. **Current truth is reconstructed from Git/repository/runtime/evidence and
   stored in AUTOWORK_STATE.**
18. **Only a current direct owner STOP globally stops autowork.**

If this compact file and the canonical governor differ, the canonical governor
wins for the pilot.
