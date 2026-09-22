# Single-executor Remote Desktop autowork pilot

Branch:

`docs/single-executor-rdc-autowork-pilot-2026-09-22`

Purpose:

test the new Seller Agents / Octoport working model where ChatGPT/хуесос is
both architect and primary engineer and uses Remote Desktop Commander directly.

Canonical files:

- `SINGLE_EXECUTOR_RDC_AUTOWORK_GOVERNOR.md` — universal permanent control
  prefix intended for repeated paste into new architect dialogues.
- `AUTOWORK_STATE.md` — durable current-state/deferred-ledger authority.

The governor replaces the previous execution assumptions:

```text
Business Bridge
→ persistent parent Codex
→ Stream-1 child + Stream-2 child
```

with:

```text
Owner
→ хуесос
→ Remote Desktop Commander
→ real repository/server/browser
```

Important:

- one executor, not two implementation streams;
- product and monitoring remain separate architectural domains where needed,
  but not separate workers;
- Codex is optional auxiliary tooling only;
- server access does not require per-call owner permission while autowork is
  active;
- owner STOP remains the global stop;
- owner-dependent items are durably deferred and skipped;
- installed extension testing may be performed directly with Playwright and
  legitimate browser runtimes;
- every material decision uses the mandatory three-level dependency / non-hack
  analysis;
- the governor contains no current step/SHA/blocker;
- current truth lives in `AUTOWORK_STATE.md` and live repository/runtime
  evidence.

This branch is intentionally isolated for the pilot.

Do not treat the pilot documentation as merged production authority until the
owner accepts the operating model and it is deliberately integrated.
