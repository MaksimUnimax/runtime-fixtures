# Isolated task publication

This route publishes one independently reviewed task candidate without moving
the fixed A/B/C working branches. It supplements the fixed-role route; it does
not bypass STOP, ownership, task scope, source review, or the five required CI
workflows. Source acceptance, publication to `main`, and installed product
verification are separate results.

## Preconditions

- The acting role is RUNNING under current authority. The task is IN_PROGRESS,
  owns every changed path, and has no unfinished prerequisite.
- The candidate is clean, has exactly one parent equal to fresh `origin/main`,
  and contains only the reviewed task change.
- The independent receipt binds task fingerprint, candidate commit/tree,
  parent, exact changed paths, full binary diff hash, and accepted manifest hash.
- Except for the route's own bootstrap task, an accepted source manifest is
  required. A and C frozen schemas are normalized explicitly. Source Git
  objects, ancestry, patch, review, preservation record, and path scope must all
  match; DEFER/DENY entries cannot be registered.
- The route source is a clean committed tree, independently accepted before
  operational use. Its exact committed helpers are copied to a hash-verified
  external bundle. A live v2 board requires the reviewed v2-capable queue
  reader in that same committed bundle.

## Workflow

Invoke `tooling/coordination/task_publication.py --control-root ROOT COMMAND`.
Each subcommand has `--help` for its exact required arguments.

1. For a task blocked specifically on this route, use `unblock` with the accepted
   manifest only after the route task is DONE. It preserves the blocker evidence
   and calls the normal queue writer with the exact previously read task. A
   concurrent task change aborts instead of unblocking a different task state.
2. Use `reconstruct` in an empty, clean task worktree at fresh main. It checks
   actual same-path changes since the accepted source base, applies the preserved
   patch, verifies staged blob identities, and creates one new commit.
3. Obtain independent review of that exact candidate and current task identity.
4. `register` binds the worktree, task, candidate, review, source bundle and one
   push target. It installs only worktree-local route configuration. Registration
   never changes the candidate's tracked files or canonical worktree settings.
5. `publish-task-ref` sends one normal refspec to a unique `controller/**` branch.
6. Wait for Server CI, Extension CI, Extension I1-C1 client, Documentation CI,
   and Coordination and release safety on that exact SHA and branch. `ready`
   obtains their results through `ci_gate.py`; a supplied `--ci-json` must be a
   captured real gate result, never a hand-written success assertion.
7. `publish-main` requires the fresh ready receipt and unchanged remote main.
   Successful readback records PUBLISHED. This does not prove installation.
8. If exact CI/review rejects a candidate after `TASK_REF_PUBLISHED`, or a
   reviewed successor supersedes it, use `supersede` with a hash-bound control
   evidence receipt. The receipt binds registration, task, candidate commit/tree
   and exact task-ref plus supporting evidence; `SUPERSEDED` also binds a distinct
   successor SHA. The command accepts no armed lease and **never writes `main`**.
   It deletes the task-ref only when the remote ref still equals the registered
   candidate, through one direct `git send-pack` deletion using the immutable captured
   push target and `--force-with-lease=<exact-ref>:<registered-candidate>`. This low-level
   transport does not resolve the target through Git `url.*.insteadOf/pushInsteadOf`
   rewriting. System/global/runtime Git config injection is stripped, the SSH command is
   pinned to the normal `ssh` binary while retaining the user's SSH host/key config, and
   preflight plus settlement classify only exact/absent/foreign remote state through
   `send-pack --dry-run --helper-status` CAS probes. The independently accepted route
   bundle hook is invoked explicitly and must consume the same immutable lease before
   the real send-pack child starts. Therefore no persistent Git config lock is needed,
   and a parent crash cannot leave one that later recovery would have to guess about.
   Unknown/live child identity remains fail-closed before any recovery remote probe. An
   already absent ref is recorded; a foreign ref is retained. A
   later reviewed successor may have changed the live task fingerprint:
   that drift is not cleanup authority and grants no broader ref/config mutation.
   Immutable registration/source/review identities remain required.
9. `cleanup-ref` deletes only this registration's exact candidate ref after a
   verified `PUBLISHED` main result. An absent ref is recorded; a foreign ref is
   retained. Cleanup failure does not revoke an already verified main publication.
10. `close` restores the exact prior route-owned worktree configuration, preserving
   absent versus empty values, ordered multi-values, and unrelated settings.
   `supersede` reaches this same close path after the stale ref is retired. Same-key,
   global and fixed-role config drift fails closed and is never overwritten. Common
   config also fails closed except for a byte-proven append-only suffix of ordinary
   `branch` sections containing only `remote`/`merge` tracking written by later
   normal worktree creation; stripping only that suffix must restore the exact
   registered common-config SHA. Any other common-config key, edit or reordering
   remains `COMMON_CONFIG_DRIFT`. Registration/state/evidence history is retained.
11. After a published registration is `CLOSED` and its temporary-output inventory
   is complete, `complete-queue` may finalize the exact work-board task without
   moving the canonical role branch. The queue revalidates registration/core and
   immutable state-chain hashes, immediate `PUBLISHED` predecessor, exact
   task/role/paths/full task fingerprint, ready receipt with exactly five successful
   required workflows, close receipt with `state_before=PUBLISHED`, and
   `DELETED`/`ALREADY_ABSENT` task-ref cleanup before accepting the publication
   candidate SHA. Normal `queue-task DONE` remains bound to the canonical
   worktree HEAD. Before its internal queue write, `complete-queue` proves the
   executing control source independently of caller cwd or caller policy. First
   use is allowed only from a clean Git source whose exact HEAD and tree equal the
   supplied CLOSED registration candidate; the original candidate worktree path
   may already be gone. A later route source is accepted only when its exact HEAD
   is already represented by a strict-valid publication-backed DONE task. Only
   after that source identity is accepted may its `OWNERSHIP.json` define the
   target role's canonical worktree path and exact branch; that canonical HEAD
   need not equal the isolated candidate. Same-tree/different-commit descendants,
   siblings, self-authored policy checkouts and arbitrary source copies fail
   before disk SEALING or board mutation. This command performs no Git
   push/ref/main mutation and does not bypass role state, role location, or
   disk-lifecycle completion gates. Git checks that establish source/canonical
   identity, cleanliness, top-level and branch use a dedicated sanitized
   environment: inherited repository/worktree/index/common/object/config
   namespace selectors (including `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
   `GIT_COMMON_DIR`, object/namespace and `GIT_CONFIG*` selectors) cannot redirect
   those authority checks; ordinary Git transport/auth environment is not
   broadened or replaced by this queue-finalization guard.

## Interruption and recovery

The parent takes the role lock before the short coordination lock and releases
the coordination lock before Git starts. The hook takes neither lock. Every
push has a unique immutable lease, a same-boot monotonic deadline, and exactly
one atomic outcome: consumed by the hook or cancelled by recovery. Nonces and
task-ref generations are never reused. The hook checks the advertised old
remote SHA; Git's normal receive transaction supplies the final old-SHA check.
Force, mirror, multiple refspecs, and replacing a foreign ref are not supported.

`recover` first proves that the exact recorded Git process has ended. Unknown
identity or an active process cannot authorize another push. A consumed lease
with any non-target remote outcome is FAILED/manual, even after a normal Git
exit. A cancelled MAIN attempt returns at most to TASK_REF_PUBLISHED and needs
a new `ready` operation before another main attempt.

Settlement is a create-once observation for one nonce. Recovery validates the
same settlement bytes and all current immutable identities, then reads the
remote again immediately before updating registration state. It never replaces
the settlement with a later, more convenient remote result. Drift blocks the
state change. Registration versions also have immutable predecessor snapshots.

`supersede` uses the same lease/attempt/settlement machinery and CAS deletion,
but its execution bundle is the current hash-verified route source rather than
the stale candidate's historical bundle. The immutable registration still binds
the candidate/ref/push target. Supersede evidence and the current bundle hash are
also bound into the lease. An unknown process identity, cancelled delete or
post-settlement remote drift cannot become a false successful revocation; retry
starts from the preserved registration/evidence and re-reads the exact ref.

Not every interrupted administrative write is automatically repairable. A
partial initial config installation, missing settlement checksum, or conflicting
state snapshot fails closed and needs evidence-based reconciliation. Do not
delete evidence, edit a receipt, reset a registration, or resend a consumed
attempt to make it appear successful. No automatic rollback of remote main is
performed.

## Verification

`python3 -m unittest discover -s tooling/coordination -p test_task_publication.py`
uses disposable local bare Git repositories and no external service or live
queue. Run through the normal resource runner on Linux with observable child
process identities. The suite covers the actual hook and publication cycle,
source and manifest identity, exact-five CI, STOP and scope fencing, cancellation
versus consumption, immutable settlement recovery, configuration restoration,
normal published cleanup, strict isolated queue completion after temporary-worktree
cleanup, accepted later-route bootstrap, and failed/superseded task-ref retirement
with changed task fingerprints, absent/foreign refs, config drift, armed leases,
evidence identity and idempotency. Product installation has its own acceptance.


Publication-bound completion separates evidence authority from mutation authority. The mutation process runs with cwd equal to the role's canonical worktree and verifies cwd/top-level/branch against OWNERSHIP.json. Ordinary queue-task keeps the original require_location behavior.
