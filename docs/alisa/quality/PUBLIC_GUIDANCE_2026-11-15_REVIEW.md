# Independent review · public guidance · 15 Nov 2026

Exact web source e0cc5b5aea9662132fb1a933e7aa21d26a3b36b7. Final finite rollout SHA48c36a4920d135f5d7fa1a9ca5d063e6e314136406c9398747358b39c363c9d0. Read-only Codex gpt-6-luna, separate finite cgroups, existing subscription.

## Source

APPROVE

HEAD is `e0cc5b5aea9662132fb1a933e7aa21d26a3b36b7`, the requested diff endpoint. The updated copy gates real-customer claims on `realLoginEnabled`; registration-specific guidance is gated on `registrationOpen`. It describes password plus email-code login, store connection, catalogue and reports, while stating that calculations require active access, report documents last 48 hours, payments are unavailable, and Station setup is separate.

I found no release-blocking regression or incorrect customer guidance in the exact two-file diff. The tracked `/login`, `/app`, and `/auth/start` routes have dedicated handlers. I did not run a build, CI, or live UI verification.

## Rollout baseline and guards

**APPROVE.** The final installer hash matches `c0fbec8d…caeba1f`, and the pinned helper matches its stated SHA. The baseline-tree addition accepts only root-owned, non-group/world-writable cache directories and matching bounded CPython 3.12 bytecode; it does not add cache files to the candidate manifest or copy them. Unrelated cache entries still fail the exact-tree check.

No remaining concrete safety or rollback finding in the reviewed script. I did not run tests or perform deployment or live acceptance.

## Final API delta and regression coverage

**APPROVE.** The final installer hash matches `48c36a4920d135f5d7fa1a9ca5d063e6e314136406c9398747358b39c363c9d0`. Both restart calls—in the apply and rollback paths—now pass three string arguments. The pinned helper defines `run(*args)` and passes those arguments to `subprocess.run`.

The regression test executes the actual helper’s `run` function with a mocked subprocess boundary and checks the successful apply command vector and receipt. Existing tests also cover failed health and rollback behavior. I found no remaining defect in this delta.
