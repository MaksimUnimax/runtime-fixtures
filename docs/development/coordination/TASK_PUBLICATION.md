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
   push target. It also materializes a separate hash-bound **completion bundle**
   from the candidate commit objects (not mutable checkout bytes): `task_publication.py`,
   `control.py`, queue/v2-board, disk/resource/waiting/notice helpers and the
   publication/CI helpers needed by that writer. It installs only worktree-local
   route configuration. Registration never changes the candidate's tracked files
   or canonical worktree settings.
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

   One narrower recovery exists only for a `TASK_REF_PUBLISHED` registration whose
   originally hash-bound review **path itself changed bytes after the exact task ref
   was already published**. Normal supersede still requires the original review hash.
   Review-drift retirement instead requires a separate hash-bound
   `octoport.task-publication-review-drift-retirement-evidence` receipt that binds the
   registration/task/candidate/tree/exact task ref, the registered review path and
   expected SHA, the freshly observed different SHA, a fixed evidence-drift
   classification, nonempty reason and hash-verified supporting evidence. The current
   work-board row must be role-matched and `BLOCKED`; an active task cannot use this
   recovery. Matching review bytes, wrong expected/observed hash or path, candidate/
   diff/manifest/bundle drift, dirty worktree, route/common/global/fixed-role config
   drift, or a foreign task ref all fail before deletion. Only an absent exact ref may
   close as `ALREADY_ABSENT`; only a ref still equal to the registered candidate can be
   CAS-deleted. The path never pushes `main`, never trusts the changed review bytes as
   approval, and normal supersede semantics remain unchanged.

   A distinct fail-closed retirement exists for a registration that already reached
   `READY` and then loses its registered `main` base **before** any MAIN push starts.
   `supersede` first validates the immutable READY receipt (including the exact five
   successful workflows), registration/source/review/config identity, evidence and
   absence of an armed lease. It then reads `main` through the immutable captured push
   target. Retirement is allowed only when that remote SHA is present, differs from the
   registered base, and is not the candidate itself. The stale READY authority is
   revoked locally first: the ready receipt is cleared and the observed base drift is
   recorded while state returns to `TASK_REF_PUBLISHED`. From there the existing exact
   ref supersede rules apply: absent is recorded, foreign is retained, and only a ref
   still equal to the registered candidate can be CAS-deleted. Immediately before a
   deletion lease is created, READY-originated retirement revalidates route/config
   identity and requires `main` to still equal the previously observed drift SHA. If
   either changed after READY authority was cleared, the registration remains only
   `TASK_REF_PUBLISHED`, no deletion lease/send-pack exists, and the exact task ref is
   retained for fresh reconciliation. The isolated pre-push hook repeats both
   route/config validation and the exact observed-`main` comparison immediately before
   consuming the deletion lease, so drift after lease preparation still cannot reach
   send-pack. This retirement path performs **no MAIN send-pack**
   and never converts old CI into authority for the new base. Unchanged `main` or
   `main==candidate` fails closed. A fresh-main reconstruction
   must obtain a new independent review, exact-five CI and READY receipt before later
   publication.
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
   worktree HEAD.

   Queue finalization is **not executed from mutable route-worktree Python bytes**.
   Invoke the `task_publication.py` stored in the selected verified completion
   bundle and pass `--route-source-root /exact/accepted/checkout`. For first use,
   the route HEAD+tree must equal the target CLOSED registration candidate and
   that registration supplies the completion bundle. For later use, the route
   HEAD must already be a strict-valid publication-backed DONE and that accepted
   route task's own registration supplies the execution bundle; this permits
   older CLOSED target registrations to be finalized without rewriting history.

   Before disk `SEALING` or board mutation, the immutable bundle rechecks the
   route repository with the trusted absolute system Git binary and a minimal
   environment, then compares every authority/writer-critical checkout file
   byte-for-byte with `git show <route-head>:<path>`. Git index flags such as
   `assume-unchanged` or `skip-worktree` therefore cannot hide substituted
   executable bytes. `OWNERSHIP.json` is read from the committed route HEAD,
   not mutable working-tree bytes. Same-tree/different-commit descendants,
   self-authored policy checkouts, dirty copies, hidden tracked-byte substitutions
   and arbitrary source heads fail closed.

   The selected bundle manifest hash and every bundled file are rechecked. Its
   `task_publication.py` must be the actual complete-queue entrypoint, and the
   child writer must be that same bundle's `control.py`. The child receives only
   the minimal authority environment plus exact route-root/bundle identity, runs
   through the current absolute Python executable with `-B`, and keeps cwd equal
   to the target role's canonical worktree. Canonical cwd/top-level/exact branch
   remains a separate mandatory boundary. Caller `PATH`, inherited `GIT_*`,
   `LD_*`, `PYTHON*`, HOME/XDG or arbitrary process variables cannot select
   Git, repository/config/object namespace or Python imports for this route.
   This is an operational fail-closed boundary, not an OS sandbox against a
   privileged host process. `complete-queue` performs no Git push/ref/main
   mutation and does not bypass STOP, role ownership, role location, strict
   receipt validation or disk-lifecycle completion gates.

12. Historical BLOCKED attempts are resolved without rewriting them as DONE by
   invoking `resolve-blocker` from an accepted current-main completion bundle.
   The broker accepts an exact current-main route checkout only when a strict
   publication-backed DONE row binds that HEAD/tree to a CLOSED registration and
   verified completion bundle. The accepted registration's immutable repository
   identity supplies the only remote query target, and remote `main` must still
   equal the route HEAD. Authority-critical checkout bytes and committed
   `OWNERSHIP.json` are revalidated before the broker selects the bundle whose
   `task_publication.py` is actually executing.

   The broker does not implement blocker policy itself. Remote authority never
   trusts the route checkout's mutable `.git/config`: the repository identity is
   derived from the immutable accepted registration `push_target`, normalized to
   a canonical read-only target (GitHub identity -> canonical HTTPS URL; disposable
   local fixture -> exact resolved path), and queried by absolute `/usr/bin/git
   ls-remote` from outside every repository with the minimal authority environment.
   The same out-of-repository read is repeated immediately before starting the
   shared-board writer and fails closed if the route HEAD is no longer current.
   The remote cannot be locked across this boundary; the receipt records the
   authorization-time observation rather than claiming a distributed atomic lock.

   It then runs that immutable bundle's existing
   `control.py ROLE queue-resolve-blocker` from the target
   role's committed canonical cwd/branch, with only the sanitized authority
   environment. The normal queue writer remains authoritative for target owner,
   BLOCKED state, same-PLAN distinct successor, strict DONE successor receipt,
   idempotency and STOP. The historical task stays BLOCKED; only evidence-bound
   `blocker_resolution=RESOLVED` is recorded. Stale route source, remote-main
   drift, hidden/mutable route bytes, wrong role location, STOPPED role, invalid
   successor/receipt or non-BLOCKED target fail before a valid shared-board
   mutation. This broker performs no Git push/ref/main or product/live mutation.

## Interruption and recovery
A TASK_REF process that exits before any remote mutation settles back to REGISTERED with CANCELLED_REMOTE_UNCHANGED; the immutable transport binding is not edited in place. If that binding itself is wrong, create normal hash-bound supersede evidence with verdict FAIL or REWORK_REQUIRED and run supersede. The existing CANCELLED_REMOTE_UNCHANGED REGISTERED recovery remains unchanged: no armed lease, exact task ref absent, no remote deletion, ALREADY_ABSENT, REGISTERED to REVOKED, then ordinary close.

A second fail-closed REGISTERED retirement exists only for a registration proven never to have started a push and whose immutable registered main base has since advanced. Under the existing role and coordination locks, normal supersede identity, clean-state and evidence validation must pass; nonce, lease, push and settlement fields must be null; armed, consumed and cancelled lease namespaces plus attempt and settlement stores must contain no records; the event journal must be exactly the matching initial REGISTERED v2 event. Main and the exact task ref are observed through the immutable captured push target. Unavailable or unchanged main, any history ambiguity, or any present or foreign task ref fails before state mutation. With changed main and an absent task ref, the route records a non-secret NEVER_PUBLISHED_CONFIRMED_ABSENT fact, performs no send-pack, ref or main mutation, CAS-transitions REGISTERED to REVOKED and uses ordinary close. A later close or config failure leaves truthful REVOKED evidence for the normal recovery path; no synthetic settlement is created. Each registration still requires its own accepted supersede evidence. Re-register a successor only after the old registration is CLOSED.


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


Publication-bound completion separates evidence authority, executable authority and mutation authority. The immutable completion bundle supplies the only accepted `task_publication.py`/`control.py` runtime; committed route bytes and policy supply evidence authority; the mutation child still runs with cwd equal to the role's canonical worktree and verifies cwd/top-level/branch. Ordinary queue-task keeps the original require_location behavior.


## Legacy close receipt v2: value-free artifact contract

The R3 artifact reader accepts ordinary v1 close receipts and the value-free v2
format. V2 retains the close identity/timestamps and stores per-key canonical
SHA256 digests for before/installed/final configuration, plus the frozen legacy
close checkpoint. Ordered values and absent versus present-empty stay distinct.
The checkpoint is matched to the registration current binding and complete
history; a hash by itself does not authenticate a reviewer or grant permission.

The pure encoder validates an ordinary-shaped completed observation before
producing v2. It does not write or rewrite receipts. The anchor observer uses
the same strict validator for both formats while retaining descriptor-relative
file reads, pinned file hashes and registration readback. Existing v1 artifacts
and ordinary close behavior remain unchanged.

This is an artifact-format implementation, not an operational legacy-close
command. Trusted evidence/reviewer/config/lineage observations, under-lock
bind/rebind, intent persistence, close recovery and full R3 acceptance are still
required before any live legacy registration can use this format.

### Artifact validation is not strict queue completion

A value-free v2 receipt may be verified as an archived anchor artifact. This
does not make it evidence for strict publication-backed queue completion:
the current `work_queue._publication_completion_candidate` accepts only a
version-1 close receipt whose `state_before` is `PUBLISHED`. An artifact observer
returning `anchor_close_receipt_valid` is not a completion or publication grant.
Do not rewrite historical v1 receipts or bypass the existing queue validator to
finish a v2-shaped publication. A compatibility change to that separate consumer
needs its own admitted scope and review before any operational dependence on it.

The R3 v2 file regressions exercise real pinned receipt files and the existing
anchor reader, including rehashed invalid content and readback replacement.
They retain an explicit registration-reader test double: these tests do not
prove the complete registration journal, independent review, current transport,
ancestry or live close authority.


### Construction time and archived close time

`_legacy_common_config_construct_close_receipt` prepares an unpersisted v2
receipt from the caller's before/after observations, captured route config and
frozen checkpoint. It samples the system UTC clock itself, using the same
whole-second precision as the journal. The registration must still be in a
normal close prestate. Its creation and last-update timestamps must be valid,
timezone-aware and no later than the observed time. It never rewrites those
timestamps or records a CLOSED state to satisfy validation.

Construction and archival verification share only payload/config validation.
The existing archived validator and archived v1-to-v2 converter continue to
require registration-created <= receipt-created <= registration-updated.
Consequently a newly constructed receipt is not yet a valid completed archive
against the pre-close registration. After the truthful CLOSED transition, the
normal archived validator can check it. No caller-supplied cutoff overrides the
archived upper bound, and a backward clock fails closed during construction.

The constructor does not collect settings, authenticate review/lineage, write
intent/receipt/state, restore configuration or authorize queue completion. The
future locked close caller must perform those operations and retain the exact
checkpoint through crash recovery. Ordinary close still writes v1 and the
strict-completion boundary above is unchanged.

### Legacy bind and close integration safety

The R3 internal bind path keeps reviewer provenance separate from the evidence
being bound. The bind orchestrator accepts a separately authenticated reviewer
observation, keeps the role and coordination locks across evidence/anchor/current
authority observation and the journal CAS, and never derives reviewer identity
from the evidence review block alone.

R5 defines the operational source for that observation as a distinct immutable
reviewer-observation receipt. The receipt kind is
`octoport.legacy-common-config-review-observation`, version 1, with exactly
`target_registration_id`, `evidence_sha256`, `reviewer_role`,
`reviewer_identity`, `independence_basis`, `verdict` and `findings`.
The verdict must be `PASS`; P0/P1/P2 findings are present and empty; the reviewer
role must differ from the target registration role. The receipt contains no
remote URL, pushurl, configuration value, credential, token or business data.
`reviewer_identity` and `independence_basis` are not free-form payload fields:
they are ASCII public labels restricted to the fixed coordination-review
vocabulary implemented by `LEGACY_COMMON_CONFIG_REVIEW_PUBLIC_WORDS`, with only
plain label punctuation. Digits, URI/path/config separators and any word outside
that vocabulary fail schema validation, so operational identifiers or provider,
store, order, credential and configuration data cannot be smuggled through
those labels.

The public `bind-legacy-common-config` command accepts only the target
registration plus exact `--evidence/--evidence-sha` and
`--review-observation/--review-observation-sha` pairs. Evidence and reviewer
observation must be distinct files below the managed control-root evidence
boundary. Both are read through bounded no-follow/hash checks; duplicate keys,
unknown fields, hash drift, non-PASS review, non-empty findings, target/evidence
mismatch, target-role review or disagreement with the review identity embedded
in the legacy evidence fail before any registration journal mutation. Inline
review assertions are not accepted.

After the separate receipt is authenticated, the command passes only its
validated review object to the existing internal bind orchestrator. Bind/rebind
remains a same-logical-state registration CAS and never authorizes or performs
task-ref deletion, main mutation, route/common/global configuration mutation,
board mutation or source mutation. The exact validated review identity is then
part of the persisted legacy authority journal; later close revalidates that
identity together with the immutable evidence, anchor, current transport/config
and lineage. Operational users must still collect fresh legacy evidence and a
fresh independent reviewer-observation receipt immediately before bind/rebind.

Ordinary close is unchanged when the registered common-config matcher succeeds.
Only a matcher failure with an already persisted legacy authority enters the
legacy close path. That path revalidates the evidence, CLOSED anchor, current
configuration/transport/main lineage and frozen binding checkpoint, requires the
task ref to be absent and the target worktree clean, and repeats the authority,
ref and cleanliness checks immediately before freezing the close intent.

The legacy intent stores only registration identity, state/version, canonical
configuration digests and the frozen checkpoint; it stores no raw route config
or reviewer values. Recovery accepts only the exact frozen checkpoint and only
installed/prior route-config states. The resulting close receipt is v2 and is
not strict queue-completion authority; the existing v1/PUBLISHED queue rule is
unchanged. A crash after receipt creation may finalize the same CLOSED state
only after exact checkpoint, receipt and restored-config revalidation.
