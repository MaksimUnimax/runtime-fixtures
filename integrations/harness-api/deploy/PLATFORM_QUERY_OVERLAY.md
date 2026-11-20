# Alisa native Query / Harness coexistence

The Harness adapter creates genuine `WEB` Query receipts after the ordinary
authorization path. `parameter_report_rpc` needs the receipt and its signed web
principal proof. Execution belongs to the isolated Harness RuntimePort queue.
The native Alisa runtime must never attempt to operate on those receipts.

## Patch scope

`platform_query_patch.py` modifies only two existing functions:

1. `owned()` retains `actor()`, identifier validation, customer/tenant lookup and
   expiry validation. It then rejects any receipt with the continuation key
   `harness_runtime_v1` using the existing `NOT_FOUND` error. `views.queries`
   already serializes that error as HTTP 404. Native status, result, clarification,
   cancellation, submit recovery, delivery guards and query feedback all use
   `owned()`. No native runtime dispatch occurs for these Harness receipts.
2. `list_queries()` excludes `continuation__has_key='harness_runtime_v1'` in the
   ORM before ordering and applying the 50-result limit. It preserves customer,
   tenant and expiry filters and the final principal recheck.

The presence of the key is sufficient. An incomplete marker must not accidentally
become eligible for native execution. The current adapter marker is:

```json
{"harness_runtime_v1":{"session_id":"UUID","runtime":"octoport-harness","request_id":"UUID"}}
```

There are no changes to Query models, DB schema, WEB proof creation, serializers,
`parameter_report_rpc`, `parameter_collection`, runtime authority or credentials.
The native `submit()` still performs its existing authorizer preparation before
the locked receipt lookup, but the guard stops before any native submission.

## Audited source and output

Source release: `alisa-demand-platform-13f01118c7402814`.

Source relative path: `services/platform/src/alisa_platform/queries/service.py`.

| File | SHA256 |
| --- | --- |
| Original source | `a3c8e2ffab12aedc83d645979a839bce9fd73cc799d77df7fb3541242d754a20` |
| Patched source | `ff7596001a538306133b5d26053c6e8e056a0278de6ea6fe039f2b62bc571f0e` |

The patch refuses different source hashes, changed anchors, an existing output
file or an in-place update. It writes a new inode, including when a release clone
uses hardlinks, and compiles the result before writing.

## Deployment boundary

Read-only inspection on 2026-11-18 confirmed the live platform is started by
`alisa-platform@stage.service`. Its effective `WorkingDirectory` and `ExecStart`
point directly at the audited release, not at `/opt/alisa-platform/stage/current`.
That `current` symlink points to a different older base release and must not be
used to activate this patch. The separate web service uses `web-current`.

`infra/launch.py` derives the source root from its own location and overwrites
`PYTHONPATH`. Therefore a lone PYTHONPATH override is insufficient. A safe small
release overlay is a complete cloned release layout with the one replacement
module (the audited original release occupies about 85 MB and has a symlinked
venv). Preserve symlinks when cloning.

Preparation, to be performed by the deployment owner:

1. Clone the audited release into a new, unique release directory, preserving
   symlinks and file metadata. Reflinks are appropriate when available. Keep the
   original release intact for rollback.
2. Run the patch with `--source` pointing to the audited original module and
   `--output` pointing to a new temporary module beside the clone's module. Then
   atomically replace the clone's module with that new file. This avoids modifying
   a shared hardlink inode. Record source/output hashes and the overlay identity.
3. Preserve existing systemd environment, credential, network and filesystem
   restrictions. Add an override only for this unit's `WorkingDirectory` and
   `ExecStart`, using the clone's `.venv/bin/python` and `infra/launch.py platform`.
   The unit has several existing ordered release overrides; confirm the effective
   `systemctl show` values resolve to the clone before restarting.
4. Activate the prepared unit override and restart the platform through the
   normal deployment procedure. No migrations are required. Confirm the effective
   path, the platform health route, and ordinary native query history. The
   Harness runtime's parameter RPC authority does not require this service patch.
5. After Harness has accepted traffic, rollback its UI, engine and gateway while
   retaining the platform QueryService guard. The original unguarded platform
   release can be restored only after the gateway is stopped and a read-only
   check reports zero `harness_runtime_v1` receipts with `expires_at > now`.
   Otherwise keep this guard in the rollback release until ordinary TTL/retention
   expires those receipts. Removing it earlier would expose the receipts to
   native history and dispatch. Once that prerequisite is met, remove only the
   reviewed override, reload systemd and restart the platform. No DB rollback or
   receipt deletion is required.

This artifact does not perform deployment or restart any live service.

`install_platform_overlay.py` automates preparation only. It pins the original
query module, launcher and manifest hashes, checks the actual platform unit and
its drop-in hashes, clones the release using `cp -a --reflink=auto`, preserves the
exact dependency symlink, patches only the clone and updates its manifest with
the new artifact ID and query hash. It writes a separate `plan.json`, proposed
drop-in and `ACTIVATION_AND_ROLLBACK.md`. No drop-in is installed automatically.

Example invocation on Alisa, after transferring both scripts together:

```bash
python3 install_platform_overlay.py \
  --output-release /opt/alisa-platform/stage/releases/alisa-harness-query-20261118-v1 \
  --plan-directory /root/alisa-harness-query-20261118-v1-plan
```

The current final platform drop-in has 180 leading `z` characters and the suffix
`-demand-s12.conf`. Preparation chooses 181 leading `z` characters and the suffix
`-harness-query.conf`, verifying that it sorts after all observed existing files
and fits the filesystem name length limit. Existing environment and hardening
overrides are inherited. The `.venv` symlink remains exactly
`/opt/alisa-platform/stage/releases/alisa-coefficient-station-platform-485a2034ac0dc36f/.venv`.

## Isolated verification

```bash
python3 -m unittest discover -s harness-api/deploy/tests -p 'test_*.py' -v
```

15 tests pass, including 11 using the exact audited source as a pinned fixture. The tests
execute the real patched functions with in-memory ORM/authority/runtime doubles,
without Django, a live DB, marketplace calls or DeepSeek calls. They cover native
dispatch preservation; Harness status/result/clarify/cancel/recover isolation;
owner and expiry validation order; list filtering before limit and principal
recheck; incomplete markers; refusal of unreviewed source and safe output writes.
The JSON `has_key` predicate is Django's standard JSONField lookup; these tests
do not claim an end-to-end PostgreSQL or production deployment verification.
Four additional installer tests verify an independent source-preserving clone,
unchanged dependency symlinks, no activation commands, source and concurrent
drop-in drift rejection, existing-output refusal and correct override ordering.
