# Finite R15 activation tool

This is a separate activation artifact for product commit
`1964d60f9a7598fefa2e10a0affcda0cce0f1f34`. It does not change that product, its
96 source inputs, the five frozen builder inputs, the web release, or the
publisher. Source review and disposable tests do not authorize execution on an
installed system and do not establish installed readiness or owner acceptance.

A real immutable R15 package was built on 15 November 2026 at 12:38:29 UTC.
Its externally retained `PREPARED.json` SHA-256 is
`2f83b12b5a9d67e4060051dce26ddae934cc98f638669c1a156060164622bc4d`;
the exact source, role inventories and package were independently checked.
The first activation `plan` at 12:45:14 UTC refused with
`UNTRUSTED_DIRECTORY` before creating an attempt or changing application state:
the existing `/run/lock` is a root-owned sticky directory. The narrow lock
correction below changes only this separate tool. Its authoring made no remote
retry or modification of the installed tool, product, builder or package.

The corrected actual `plan` at 13:54:02 UTC passed the lock boundary and refused
with `HELPER_CHANGED`, again before attempt/publication changes. Five of the six
installed helper hashes matched. The existing shared version synchronizer was
still the exact accepted 10 November source `8257aaac46a075ee6e1b59601f4ccce6dd7edbcd`,
SHA-256 `b57ebf6be29b05d08955b043cc3036592cf768016d4fcf18ac6ff67b1d63cee0`.
The initial activation contract had incorrectly used the newer canonical product
source hash as if that helper had been installed. Its observed inode and mtime/
ctime were unchanged since 10 November; this was not a new concurrent edit.

This correction preserves that installed helper as an exact baseline and carries
the stronger canonical version synchronizer as a fourth immutable tool file.
It also preserves unprivileged version computation when the verified bundle has
private root-owned ancestors. Neither the shared helper nor those permissions
are changed.

The next actual `plan`, using activation source `ee6351c7b912417cba58e3e889dce157099d116d`,
finished at 14:16:17 UTC with `ACTIVATION_DEPENDENCY_UNAVAILABLE`. The bounded
exception-location diagnostic reached the accepted credential reader's parent
`lstat`, before opening credential material, computing versions or counting
readiness. A separate metadata-only comparison at 14:24:57 UTC established
that the installer's strict systemd namespace hides `/run/credentials` as a
root-owned mode-0000 directory. The native service's credential directory still
existed in both the host and the native process view. No application attempt,
publication or binding change had occurred.

The correction below reads only the current native process's existing
credential directory through a checked descriptor. The installer retains its
strict namespace; the native service, shared helpers and credential stores are
unchanged. A successful source gate is required before another real PLAN.

## Fixed identities and scope

The exact product PLAN is
`7e86513fd831d74d89eb0ab3aaf5ce8f851ec936d5e09a0684516a7eee25cb73`.
The 96-input source index is
`3b6bee51f233398d46c15646b3435edf147ee19e9cdf7abe74ae8908472dc26b`.
Its encoding is the frozen builder's sorted, indented JSON with a final newline.
The builder files and exact hashes remain in `activation_contract.BUILD_TOOLS`.

The four executable files in this artifact have a separate tool identity:
the SHA-256 of the same canonical encoding of their filename-to-SHA-256 map.
Only `activation_contract.py`, `activate.py`, `readiness.py`, and
`runtime_versions_sync.py` participate. The last file is an unchanged copy of
the canonical product helper, SHA-256
`10421a4ec0000a5e26ecc92e5fbeed0a31f48133698a84b92935b04700615dd4`.
Their publication and review can therefore proceed independently of product CI.
There is no production test mode, custom target role, alternative owner, clock,
permission, readiness receipt, or skip-check CLI option.

| Role | Retained installed base | Candidate role |
| --- | --- | --- |
| Platform | `alisa-customer-catalog-8b8b919993c38128` | `alisa-economics-r15-platform-1964d60f9a7598fe` |
| Authority | `alisa-parameters-1d572aebf6b05b88` | `alisa-economics-r15-authority-1964d60f9a7598fe` |
| Native | `alisa-parameters-1d572aebf6b05b88` | `alisa-economics-r15-native-1964d60f9a7598fe` |
| Web, preserved | `alisa-public-guidance-e0cc5b5aea966213` | No replacement |

Platform and authority are distinct releases. Their unit and process working
directories are checked separately. Web's unit works from its release root,
while its process works from `ui/web/apps/web`; neither is replaced by R15.
The accepted query-gap publisher remains byte-for-byte unchanged. Admin,
identity, Station and SMTP service identities/PIDs are preserved. The existing
store checker is restarted only by the scoped native-generation refresh, which
preserves the accepted full source context and HMAC algorithm.

The new report remains WEB-only. The existing voice continuation branch is not
changed. Two flags are enabled in one new, own file,
`/etc/alisa-platform/stage/economics-r15-flags.env`: exactly
`ALISA_OWNER_PARAMETER_COMPOUNDS_ENABLED=1` and
`ALISA_OWNER_ECONOMICS_COMPOSITES_ENABLED=1`. Both backend role drop-ins append
this as the last `EnvironmentFile`. Earlier environment files are neither read
into receipts nor edited. Their order and file identities are pinned. A later
`UnsetEnvironment` for either flag blocks execution; the two actual new-process
values are checked in memory without returning the rest of the environment.

Native configuration changes are limited to the three policy blocks
`parameter_sources`, `parameter_compounds`, and `economics_composites`, using
the PINs recomputed from the exact candidate. All other configuration values,
including `execution_enabled`, remain unchanged. Setting that flag false is
not an admission fence: submission can still enqueue work.

### Existing authority selector and release identity

The observed authority selector retains a leading comment, empty lines,
`Environment=ALISA_RELEASE=<old release>`, the matching existing Gunicorn
`--env ALISA_RELEASE=<old release>` argument, and the query-insights then
question-catalog `EnvironmentFile` directives. These are part of the accepted
source. The writer now recognizes that exact ordered authority grammar and the
existing platform grammar. Comments, empty lines and all unrelated arguments
are preserved. Unknown directives, changed environment-file order or paths,
empty resets, duplicate assignments and ambiguous release arguments still block.

The writer changes the full release paths and both existing authority release
identities. The effective-command predictor uses the same bounded rewrite;
it cannot leave an old Gunicorn release name while predicting a successful new
start. The existing health check still requires the target release name.
Because a later drop-in appends its existing environment files again, the unit
predictor retains their ordered duplicates and then the final two-flag file.
It neither deduplicates that list nor resets earlier environment assignments.
Existing environment-file metadata and source hashes remain under the original
before/after checks. This changes no admission, credential, recovery or readiness
state-machine boundary.

## Phase contract

| Command or phase | Required evidence | Permitted effect |
| --- | --- | --- |
| `plan` | Real externally pinned builder package; exact old bases, source, helpers, environment and active units | Metadata and private-in-memory policy checks; finite count samplers; PLAN on stdout. No selectors or existing service changes. |
| `prepare` | All plan checks, sufficient resource reserve | Three independent immutable copies under the package's exact `/opt` targets; private attempt receipts. No activation. |
| Apply admission check | Externally pinned activation PLAN; exact published directory inodes; fresh coordination record | Private backups and immutable journal events. |
| Admission freeze | Current zero counts; exact unit load path; unoccupied own masks | Own masks, then stop web → platform → authority → native. |
| Post-stop check | All masks still ours, all four processes stopped; new count samples | No switch if a final admission raced the initial sample. |
| Source switch | Exact original/own component CAS | Two role drop-ins, two-flag file, native pointer, three policy blocks and compatible version metadata. |
| `ADMISSION_POSSIBLE` | Successful write **and fsync** of its journal event | Only now may the first new native process start. |
| Start | Candidate source and version checks | Native → generation refresh → authority → platform; exact role health and protected state; preserved web starts last. |
| Finish | Exact new source/configuration/process checks | `INSTALLED_TECHNICAL_CHECKS_PASS`, with live owner acceptance still `NOT_RUN`. |

The frozen builder's `verify_prepared()` intentionally checks **old** live
references. It is used before switching. Post-switch checks validate the exact
new candidate trees, role-specific service definitions, component inodes,
configuration, native generation and preserved web/publisher instead. The old
verifier is not weakened or reused against new live references.

### Admission masks and systemd precedence

The installed native and authority units have explicit fragments under `/etc`.
A mask in `/run/systemd/system` does not override those files. This tool uses
only exact unit names under `/run/systemd/system.control`, which precedes
`/etc/systemd/system` in the observed systemd 255 manager's load path.
The [official systemd 255 unit documentation](https://www.freedesktop.org/software/systemd/man/255/systemd.unit.html)
defines both that ordering and the `/dev/null` mask behavior. The observed
12-element `UnitPath` is fixed in the contract. Any change, higher-priority exact
or template shadow, existing own-name occupant, or failure to read back
`LoadState=masked` blocks progress.

Both control directories were absent in the installed metadata readback.
Absence is checked through the trusted parent; `plan` does not create them.
Apply may create the standard runtime control directory as root-owned 0755,
recording its inode. It never removes that shared directory. Only this attempt's
exact mask inodes can be removed. Template masks are not created, original
`/etc` fragments are not replaced, and other template instances are unaffected.

The lookup mechanism also passed seven independent offline cases using a
private `systemd-analyze --root` tree on systemd 257: explicit `/etc` unit,
ineffective lower-priority runtime mask, effective control mask, restoration,
one masked template instance, the other instance preserved, and restoration.
This is lookup qualification, not an installed-manager activation test. Every
real mask still requires its actual manager readback before stopping anything.

## Counts and privacy

Readiness uses three finite samplers under the existing installed principals:

| Sampler | Existing user/group | Data returned |
| --- | --- | --- |
| SQLite | `alice-market` / `alice-lab` | Active/unknown jobs, live leases, unexpired jobs, two pending outbox counts |
| Voice | `alice-lab` / `alice-lab` | Count of undelivered Station answers |
| PostgreSQL | `alisa-platform-stage` / `alisa-platform-stage` | Active Queries, live Query leases, unresolved live continuations |

All three require `DynamicUser=no`. The SQLite and Station paths do not need a
new shared principal or permission change. Sampler outputs have exact disjoint
schemas, nonnegative integer values and no row identifiers or bodies. A boolean,
extra key, malformed metadata, missing table, unreadable path or failed process
cannot become zero.

SQLite uses `mode=ro`, `query_only` and a fresh transaction over the current WAL.
It does not use `immutable=1`, a stale copied database, `GapStore`,
`TerminalStore`, or their mutating `pending()` methods. All rows of the two
outbox tables count: the existing publisher acknowledges them by deletion.
Ordinary WAL/shared-memory locking is allowed; no business data is written.

The PostgreSQL sampler receives the observed environment files through
systemd, in their exact order. It verifies the ordinary
`alisa_stage_platform_runtime` role and `alisa_stage_platform` database,
read-only transaction settings, permissions, exact table/column shape and
authoritative visibility. RLS, views, inheritance/partitioning, hidden rows or
inherited transactions fail closed. An ordinary ACCESS SHARE table lock keeps
the visibility/schema proof and aggregate in one bounded transaction. It does
not use the old migration bootstrap, create a Query, read owner facts, mint a
ticket, or modify grants.

Each sampler has a 20-second runtime limit, 10-second start timeout, 5-second
stop timeout, control-group kill with SIGKILL, OOM stop, memory accounting,
256 MiB memory, zero swap and 16 tasks. The parent waits at most 45 seconds.
These are finite processes, not a new persistent worker or controller.

Private config/projection backups remain root-only in the attempt directory.
Existing bridge validation consumes its existing credential material internally
and emits no values. Public receipts contain hashes, codes, booleans and counts.
`direct_provider_calls: 0` describes this tool; it is not a claim that already
started services cannot perform their authorized work.

## Verified executable bytes

Production invocation requires `python -I -B`. The four tool files must be
root-owned, immutable and readable at
`/usr/local/libexec/alisa-r15-activation-<tool-pin-first-16>/`, with no additional
files or directories. Every parent must permit traversal by the sampler users.
Placing source under `/root` is not a supported sampler bootstrap.

The CLI checks the external tool PIN before executing its sibling modules.
Sibling modules, builder modules and accepted helpers execute their already
verified source bytes with `compile`/`exec`; `-B` alone would still permit
reading an old `.pyc`. The sampler command similarly verifies and executes the
four source byte strings before entering its function. Its source directory is
not prepended to `sys.path`, so an extra `sqlite3.py` cannot shadow the standard
library. Native roots are checked for bytecode caches before import probes.

The native bridge closure is pinned and loaded in order:
`shared_http` → `store_checker` → `native_store_binding`. The accepted pair
helper receives that exact binding module object. The installer uses the
unchanged accepted `native_context`, `mac`, JSON decoder, process-generation
and socket-peer checks. Its small projection adapter supplies credential
material through the current process view and publishes only through the
existing `change('projection')` inode CAS. It does not replace the accepted
module's `root_json`, mutate a shared helper, or expose a general reader/writer.

### Credentials from the current native process

The observed systemd version is `255.4-1ubuntu8.18`. Its strict namespace hides
other units' credential stores. An explicit bind of the initial store would
also risk retaining the old mount when native restarts. The installer instead
opens `/proc/<expected-native-PID>` and follows only its literal kernel `root`
link plus the `ns/mnt` identity link. It never resolves that root link to `/`,
opens PID 1's root, enters a namespace, or changes a mount. Linux documents the
process root's per-process mount view and its access checks in
[proc_pid_root(5)](https://man7.org/linux/man-pages/man5/proc_pid_root.5.html).

Every scope requires the fixed native unit's current MainPID, active/running
state, complete accepted generation (PID, start ticks, UID and boot ID), exact
selected release and process cwd, and the configured socket's SO_PEERCRED to
agree before and after the read. A still-alive previous PID cannot substitute
for the unit's current generation. The root descriptor is used only to walk
`run/credentials/alice-market.service`; each ordinary component and leaf is
opened with `O_NOFOLLOW`. Directories remain root-owned without group/world
write access. Only explicit binding filenames are admitted, within the accepted
checker's 1–128 binding limit. A leaf must be a root-owned regular single-link
file, have the accepted mode restrictions, contain 1–32768 bytes, and reside on
a read-only mount. The accepted strict decoder receives the bounded bytes in
private memory.

Held process, mount-namespace, root and credential-directory identities are
compared with a freshly opened current-process path. Descriptor identity
includes Linux's `mnt_id` from
[proc_pid_fdinfo(5)](https://man7.org/linux/man-pages/man5/proc_pid_fdinfo.5.html);
the same root inode across two mount namespaces is insufficient. File metadata,
length and the directory entry must also remain unchanged. All descriptors are
non-inheritable and closed on success or failure; none survives a reader scope
or is reused after a restart.

For `plan`, `prepare` and apply's initial check, expected generation comes from
the exact captured projection. Old and candidate policy contexts are checked
against the same full old HMAC in one current-generation scope. During refresh,
the accepted wait selects the new generation and a new descriptor opens its
material. That new material must first validate the previous HMAC using the
original old generation. Only then is the new generation's HMAC calculated.
A generation check immediately precedes projection publication. Configuration
and projection states are pinned to the caller's exact owned intent. The
independent post-publication check opens another fresh scope. Recovery after an
old-source restart explicitly selects the retained baseline; normal activation
and post-switch checks select the candidate. Changed material, PID, socket,
namespace, source or managed input blocks the operation.

The private canonical version synchronizer runs `--check` on the published
native target with the inherited common flock descriptor. Its complete strict
manifest and payload checks, including content digests in the before/after
snapshots, remain unchanged. It is not replaced with the older installed
implementation. Only `catalog_bundle_hash` may change. Exact source, config and
version CAS are repeated before the caller publishes the validated bytes. This
supplies an owned staged inode before rename, including a crash after
publication. The helper's `/usr/bin/python3` alias must resolve to the exact
pinned `/usr/bin/python3.12` executable.

For the still-private bundle, the tool loads that same canonical helper from
verified bytes and uses a narrow descriptor-based adapter for its `compute`
operation. The only accepted roots are this package's `releases/native` and its
fixed published native target. The exact frozen builder manifest, all payload
hashes, immutable ownership/modes, inventory and absence of bytecode caches are
checked before and after computation. The private bundle leaf is named `native`,
while its manifest names the final artifact; it is therefore checked by the
frozen builder rather than passing an incorrect root alias to the canonical
publisher's final-release validator.

The adapter opens the verified directory read-only with `O_DIRECTORY|O_NOFOLLOW`.
It compares the held descriptor and pathname identity before and after the
manifest checks and the child. A subprocess still runs as `nobody`, with no
supplementary groups, an explicit minimal environment, `-I -B`, the canonical
CPU/file/core limits, eight-second timeout and bounded output. Only the payload
directory descriptor is inherited; `cwd` and the import path use its
`/proc/self/fd/<n>` alias. The exact current-version import closure reads adjacent
files through `__file__.parent` and `with_name`; it does not resolve this alias
back to the private ancestor. The caller always closes the descriptor, including
child failure, timeout, malformed output and source/path changes. Product code
is never imported as root for this calculation.

The shared `/usr/local/libexec/alisa/runtime_versions_sync.py` remains pinned to
its observed `b57ebf6b…` bytes and remains the native service's existing startup
helper. The six accepted shared helper files and service definition are not
edited. The separate artifact's canonical check does not claim that the shared
startup helper was upgraded.

The source suite covers missing or changed fourth-file identities, canonical
same-metadata manifest tampering, the two fixed source coordinates, descriptor
closure on child failures/timeouts/oversized output, payload tampering and
directory replacement. The existing activation workflow also contains a finite
root-to-nobody fixture gate. Its root-owned 0700 RuntimeDirectory contains only
owned synthetic source/data and exact tool/verifier copies; it demonstrates
that an absolute private path fails while the held descriptor permits imports
and adjacent data reads. It checks the clean child environment, absence of an
unrelated inheritable descriptor, complete source checks after tampering and
closure after actual child failures/timeouts. Both explicit fixture cleanup and
the unit's native RuntimeDirectory cleanup are checked. These fixtures do not
access installed applications or establish live acceptance.

## Failure and recovery boundary

Before `ADMISSION_POSSIBLE`, independent components can be conditionally restored
only while they match the captured original or this attempt's exact inode.
Receipt failures do not prevent independent safe restoration attempts. A
successful rename followed by a failed `fsync` is resolved through the retained
old inode, without deleting a foreign occupant. An ambiguous later writer is
preserved and unsafe restarts are skipped.

Once any source mutation was attempted, pre-admission recovery first requires
all exact owned masks and stopped processes. A foreign unmask or externally
started process makes admission possible even if this tool never reached its
own start call; no downgrade is then attempted.
The same exact masks/stopped-process checks run before every pre-admission
publication and immediately before the durable marker. Recovery checks original
unit source files before releasing a mask and the effective old unit definition
before starting it. A failed release never falls through to a web start.

After `ADMISSION_POSSIBLE`, this tool provides **no automatic downgrade**. Fresh
busy counts produce `ROLLBACK_BLOCKED_BUSY`. Zero counts or unavailable evidence
produce `RECOVERY_REQUIRES_REVIEW`; two zero samples do not prove a running
runtime cannot admit a request between them. The tool leaves current selectors,
PINs and processes intact. There is deliberately no general `rollback` CLI
command. A later recovery needs a separately concrete, reviewed admission
fence and the actual journal/current state. Interrupted attempts are not
automatically retried; incomplete publications and historical bases are retained.

## Invocation contract for a future real package

The common arguments are `--builder`, `--bundle`, `--prepared-sha256`,
`--tool-sha256`, and a new `--attempt` path matching
`/root/alisa-r15-activation-1964d60f-<16-hex-nonce>`.

Run `plan` first to inspect the exact candidate, current sources and count-only
state. This creates only finite sampler units and prints a proposed plan.
The finite outer unit must provide `PrivateTmp=yes` for the canonical and
descriptor compute subprocesses' bounded temporary output files when
`ProtectSystem=strict` is used. No root ancestor permission change or shared
temporary workspace is required.
After its resource estimate is reviewed, `prepare` repeats the checks and
publishes the three copies using independent inodes and `RENAME_NOREPLACE`.
Existing destinations are never merged, overwritten, adopted or deleted.
Every staging inode is recorded before copying, and final verification checks
the actual destination tree, ownership, inode, manifest and environment.

`apply` additionally requires the SHA-256 of the private `ACTIVATION_PLAN.json`
and an externally provided, hash-pinned coordination record. That record has
schema `alisa-r15-maintenance-coordination/v1`, binds the product, tool,
prepared package and activation-plan hashes, and includes a nonce, issue/expiry
times no more than 300 seconds apart and
`coordination: OWNER_BROWSER_AND_VOICE_WINDOW_CONFIRMED`. It records fresh human
coordination; it is not a measured admission fence or an owner authorization
token. Freshness is checked again before freezing, switching and the first new
start. The actual masks, process checks and counts remain mandatory.

The copy reserve remains at least 3 GiB and 200,000 free inodes after the full
independent-copy budget. Memory headroom must remain at least 1 GiB beyond a
512 MiB task allowance. No reserve, quota or cap is relaxed to make a package
fit, and no historical or foreign fixture is cleaned up by this tool.

### Existing shared rollout lock

The tool uses only the already existing
`/run/lock/alisa-stage-rollout.lock`. The exact `/run/lock` directory may have
its normal root:root mode `01777`; `/run` and `/` must remain strict root-owned
directories without group/world write permission. No other writable parent
receives this exception. The generic `secure_dir` validator remains unchanged.

The parent is opened with `O_DIRECTORY|O_NOFOLLOW`; the existing file is opened
relative to that directory fd with `O_RDWR|O_NOFOLLOW`, never `O_CREAT`. The
file must be root:root, regular, have exactly one link and no group/world write
bits. Directory identity, security metadata and all three file views (held fd,
held-directory entry and full pathname) must match before and after the
nonblocking exclusive flock. A changed inode, owner, permissions, symlink or
hardlink fails before the critical section. A held lock remains `ROLLOUT_BUSY`.
Unrelated files appearing in the sticky directory do not invalidate its
identity; directory timestamps and link count are not treated as authority.
The tool never creates, replaces, renames, chmods or relabels the common lock.

## Qualification evidence and limits

Run only disposable source tests from the checkout:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover \
  -s docs/alisa/runtime/v0.11/economics_composite_r15_activation/tests \
  -p 'test_*.py' -v
```

The activation tests cover source identity, policy scope, all pre-admission
failure phases, the durable marker, later admission/busy refusal, foreign mask
loss, config/source drift after version validation, exact inode recovery,
publication collisions, sampler principals/lifetime/schema, isolated bootstrap,
stale bytecode, standard-library shadowing and the complete pinned helper load
order. They use disposable files and explicit Python fakes; no fake adapter is
reachable from the CLI and they do not certify installed readiness.

The lock correction adds 18 focused cases using actual disposable files and
kernel flock, with the fixed logical `/run` paths mapped into the test's own
directory. Only fixture ownership metadata is represented as root for ordinary
CI users; the production path and ownership constants have no override. These
cases cover the normal sticky directory, a strict parent, true busy exclusion,
missing files, symlinks, hardlinks, unsafe ownership/permissions, file and parent
replacement during open/flock, descriptor cleanup, and unrelated lock activity.

The separately authored readiness suite passed 28 disposable cases, including
uncheckpointed WAL visibility and fail-closed SQL/metadata shapes. The actual
isolated PostgreSQL gate passed 20 cases with no failures or skips using the
ordinary role, real transactions and real visibility/schema changes; its own
database and role were confirmed removed afterward. That evidence establishes
SQL behavior in the isolated fixture, not current production visibility, current
idle state, installed synthetic acceptance, or a live financial result.

Before the selector correction, the 122 native credential and CI setup cases passed locally, including
15 descriptor/HMAC cases and six gate setup/diagnostic cases. A seventh setup
case brought that correction's required CI total to 123; the local execution environment
rejects its real AF_UNIX socket creation with `EPERM` before the tested call.
It has no mock or skip fallback. The local descriptor fixtures explicitly substitute
their own UID and read-only mount bit; they do not claim a kernel namespace
result. Independent review ran those 15 cases and ten additional rejection/CAS
cases against the frozen runtime source.

The existing activation workflow now has one additional finite lifecycle gate
on its Ubuntu 24.04 runner. An owned strict observer has a 120-second limit,
128 MiB memory and zero swap. Its sole synthetic producer runs as `nobody`,
has a separate strict mount namespace and a real `LoadCredential`, a 90-second
limit, 64 MiB memory, zero swap, and `BindsTo` the observer. Its immutable cwd
is root-owned; its own writable RuntimeDirectory contains only its Unix socket.
Synthetic credential input and projection remain under a root-only private
subdirectory. Network access is disabled.

The gate checks the hidden direct path, real descriptor access, process/socket/
cwd fences, descriptor closure, two producer restarts and mount replacement.
It retains the old namespace and credential descriptors, proves old material
is still readable, and rejects those stale descriptors even when the root
inode is unchanged. Same material must confirm the old full HMAC before new
generation publication; changed material must leave the synthetic projection
and writer count unchanged. A separate injected final-generation failure tests
the immediate pre-publication boundary. Projection publication and checker
restart use explicit fixture substitutes; no installed acceptance is claimed.
The artifact records exact source/tool/helper identities, systemd version,
checks and owned cleanup. This new real lifecycle gate remains **NOT_RUN** at
source qualification; its eventual current-commit CI artifact is separate
evidence. No production retry or application mutation was used to author it.

The first real CI run on source `ed3ce2c5fa4d02dde7f3005b4ef7fe7904beafee`
(`43726077665`) failed while starting the disposable producer, before the
lifecycle checks. Its 116 source tests and ten private-bundle checks passed;
PostgreSQL was not reached. The producer's immediate collection and discarded
stderr did not preserve its actual exit reason. A separate real-umask
reproduction established a concrete setup defect: `mkdir(mode=0555)` under
the observer's `UMask=0077` creates `0500`, so `nobody` lacks traversal access.
Both synthetic release directories now receive explicit `chmod(0555)` and
exact root-owner, directory-mode and ancestor-traversal checks before startup.
The six new local cases use the real restrictive umask and test diagnostic
redaction; they do not substitute for a successful new-commit lifecycle run.

An owned failed producer is now retained until its bounded status has been
observed and strict identity cleanup has completed. Failure output contains
only a fixed operation/error classification, numeric exit status or timeout,
and whitelisted properties of that exact fixture unit. Raw argv, stdout,
stderr and arbitrary error messages remain private. The startup-failure path
requires the fresh fixture identity before cleanup; an occupied-name refusal
cannot adopt or stop another unit. `BindsTo`, finite limits, zero swap and
five-second stop timeouts remain in place. That setup correction changed no
runtime tool file: its tool identity remained
`d1d3ca18cdca4d5419fd53dbfd924bb71bf529d409ae0f076d6e42c395dfff04`.

The subsequent corrected-source CI (`43726961701`) started the producer but
stopped in the fixture's first socket readiness check: `socket.connect` received
a `pathlib.Path`, producing `TypeError` before the runtime adapter was reached.
Only the fixture peer boundary now converts the address with `os.fspath`.
One additional regression requires a real owned AF_UNIX listener and checks
SO_PEERCRED for both `Path` and string input without mocks. Local execution
stopped at `socket()` with `EPERM`, so a positive socket result is still pending
the corrected-source CI. The runtime consumes
the unchanged config string; its four-file identity and the workflow are
unchanged. The new source still requires its own successful lifecycle CI run.

The corrected socket source `985ead5d66e7960416062c9aeef8a4e100b1b7f8`
subsequently passed its actual CI: 123 source tests, ten private-bundle checks,
15 native credential lifecycle checks and 20 PostgreSQL checks, with owned
cleanup confirmed. Actual PLAN R4 then stopped at `SELECTOR_GRAMMAR` at
15:08:04 UTC on 15 November, before any attempt or publication. Bounded
diagnostics identified the accepted 900-byte authority selector described above;
the 315-byte platform selector already passed the old grammar. The post-R4
readback confirmed all eleven protected services unchanged and the attempt and
three publication targets absent. No credential or environment-file contents
were emitted by that diagnosis.

The selector correction passed eleven focused local cases and the existing
62 activation cases; independent source review also passed the eleven cases.
These use synthetic structural equivalents, not a copy of private production
arguments. Its four-file tool identity is
`db2af005bbe06fca76bea2a60f16dc69fe858dbb1247d3446019de6ef99da9b5`.

One additional step in the existing workflow requires six actual systemd and
locked Gunicorn 26.2.0 consumer checks. A single owned authority-shaped service
starts an old synthetic WSGI release and restarts once with the generated later
drop-in. It checks the real effective unit against the runtime predictor,
ordered duplicate environment files, conflicting synthetic values, both new
release identities, module/cwd selection, new process generation and the actual
two process flags. The unprivileged service uses only the existing CI virtual
environment and its own synthetic paths. Its 60-second, 128 MiB limit and the
observer's 120-second, 128 MiB limit retain zero swap, five-second stop,
control-group termination and private AF_UNIX-only networking. Exact owned
unit files, stopped/empty cgroup, absent runtime paths and unit unload are
mandatory cleanup results. Existing native and PostgreSQL gates remain real.

The corrected source requires its own CI result: 134 source tests, ten private
bundle checks, 15 native lifecycle checks, six selector consumer checks and
20 PostgreSQL checks without errors or skips. The new consumer gate is
**NOT_RUN** at source qualification. Its future artifact cannot substitute for
a fresh installed PLAN, preparation, coordination or owner acceptance.
