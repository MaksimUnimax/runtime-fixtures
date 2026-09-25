# Repository Maintenance Rules

## Current authorized program

Octoport uses one canonical main and three scoped worktrees. Read docs/development/coordination/README.md, PROTOCOL.md, PLAN.md and OWNERSHIP.json before work. This owner-authorized program supersedes older single-executor/Stream-1/Stream-2 scheduling instructions, without changing product/security requirements or historical evidence. Each stream may select the next ready task within its assigned PLAN queue; it must not invent adjacent scope. Only C integrates main; only B authors DB/migration changes after the baseline. Explicit STOP always wins over an automatic governor repeat. Review requests are durable and do not block independent permitted work. Owner decision 2026-09-25: continue the approved roadmap until explicit STOP; a publication candidate, submission, moderation or deployment wait never ends the development queue. Follow docs/development/coordination/CONTINUOUS_ROADMAP_POLICY.md and prove that every remaining authorized task is blocked before whole-stream WAITING_INPUT.

## Entry point

Read `README.md`, `docs/README.md`, and the documentation for the subsystem you are changing. If the task changes a shared contract, read `docs/architecture/CONTRACTS.md` before editing it.

Current maintainer instructions for the active task take priority over historical notes. Existing code is evidence of implementation, not automatic proof that a behavior is still intended.

## Scope discipline

- Work only inside the explicitly requested subsystem.
- Do not start adjacent roadmap work because a preceding step finished.
- Do not redesign shared contracts, authentication/session behavior, migrations, deployment topology, or cross-component interfaces unless the task explicitly includes them.
- Prefer the smallest complete change that fixes the requested behavior.
- Preserve proven behavior outside the affected boundary.
- Do not convert fixture, documentation, package, or simulated checks into claims about installed or live acceptance.

## Parallel work

Multiple branches may be active at the same time.

Before integration or merge work:

1. fetch the current remote `main`;
2. inspect drift since the branch base;
3. avoid files owned by another active stream unless a synchronization boundary was explicitly agreed;
4. do not force-push to erase divergence;
5. keep one clear integration boundary for shared changes.

## Executor boundary

An implementation executor may write or fix code, run prescribed tests, and report factual results inside a bounded task.

It must not independently change project roadmap, architecture, product scope or repository strategy. The active owner-authorized coordination plan permits selecting the next ready task within the assigned stream; moving outside that plan requires controller review.

## Validation

- Reproduce a concrete defect or requirement before changing behavior when practical.
- Keep source, packaged, browser, database, integration, and deployment evidence distinct.
- A green documentation check proves documentation consistency only.
- A green package build proves package construction only.
- Installed/live acceptance requires the checks defined for that boundary.
- Record exact commit/revision identifiers for accepted evidence.

## Security and data

- Never commit credentials, private keys, production tokens, raw customer data, or private conversation content.
- Do not add sensitive values to fixtures, logs, screenshots, CI artifacts, or documentation.
- Treat destructive server cleanup and broad deletion as separate operations requiring explicit maintainer approval.

## Git safety

- Re-check remote `main` before publishing or merging.
- Do not use force push to bypass another stream's work.
- Keep unrelated formatting or cleanup out of bounded changes.
- Report what changed, what was tested, remaining limitations, and the exact resulting revision.


## Owner resource and throughput policy

At every controller review inspect disk/inodes, MemAvailable, swap/PSI/OOM and process ownership/lifecycle. Read docs/development/coordination/RESOURCE_POLICY.md. Preserve useful concurrency and quality; proactively recommend added RAM whenever measured workload/queue shows it can increase useful throughput. Owner prefers speed over RAM cost. Do not impose a blanket single-process or single-job rule. Report historical garbage, provenance and size to owner before any cleanup; obtain approval for the concrete cleanup inventory. Newly supervised test groups always terminate their own descendants at completion. Never sweep historical files, containers or unrelated processes as part of that lifecycle.

## Owner early store publication priority

At EVERY controller review assess and report extension store readiness alongside resources. Follow docs/development/coordination/STORE_POLICY.md. Owner confirms publisher registration for chosen stores except Safari and authorizes early submission/publication as soon as each channel meets its minimum working, security, privacy and reviewer requirements. Do not wait for full roadmap completion, all browsers or C06. Report exact submission blockers, next action/owner, real store state and needed owner input; promptly fix small independent blockers in an isolated assigned scope while A/B/C continue. Preserve quality, existing audience limits, integration rules and separate production authority. Early approval does not guarantee zero review delay on updates.
