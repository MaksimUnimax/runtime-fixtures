# Bounded owner metadata preflight

Source prepared on 15 November 2026. **Not executed against the installed database. Root source review is required before the finite invocation below.** This diagnostic is separate from the product release overlay and changes no installed application, permission, setting, Query, owner fact or coefficient.

## Fixed accepted target

`preflight.py` reads only `/finance/query_id` from the pinned, existing `/root/alisa-user-acceptance-gap-fix-20261115/LIVE_OWNER.json`. The receipt hash is `b272f4da25040970b84ca817881f8dd915c3918dafdf76aeb4a298fdaee24a9b`. Its UUID remains in process memory. There is no command-line target, account search, browser/session extraction, new ticket or synthetic Query.

That one WEB Query must still exist and name exactly one store. Its tenant/customer/store references constrain subsequent metadata reads. Query has no product column: the product and OZON provider conditions are imposed on the selected Store. Any missing or ambiguous target stops the diagnostic without a fallback search.

## Source and environment binding

`source_context.json` records the observed active platform unit, immutable release manifest and 28 distinct source/catalogue files. These include all 11 installed applications' package initializers and models, the platform/config initializers and `staff.policy` imported during Django setup. An explicit list also pins absence of each application's auto-discovered `apps.py`, `apps` package and alternative `models` package. Unexpected files, directories or dangling symlinks at those paths block setup. This is a fixed source list, not runtime code discovery.

The context also records device/inode/mode/owner/size/mtime/ctime for the unit source files and its declared EnvironmentFiles. Every stat value is a decimal string, produced directly from Python's exact integers and compared as an exact string. Environment file **contents were not read** to make this record. The helper checks the stat identity, file hashes and absence guards before database initialization and again before releasing its result. A changed configuration, source, environment file or receipt blocks the run. The record is an observation of this exact installed source; it must not be silently regenerated to bypass a mismatch.

The second invocation reached the helper but stopped before Django/database initialization with `ENVIRONMENT_SOURCE_MOVED`: its original numeric timestamp pins had lost nanoseconds during JavaScript Number serialization. `STAT_REPRESENTATION_PROOF.json` preserves all 16 previous stat records as decimal lexemes and the exact string readback. All 96 non-timestamp fields match exactly; all 32 old timestamp lexemes equal `JSON.stringify(Number(current_exact_string))`. All other context fields, including the 28-source closure, are unchanged. This representation repair adds no tolerance or coarse timestamp comparison: subsequent changes of even 1 ns are rejected. The failed receipt remains `/root/alisa-economics-r15-owner-preflight-20261115/RESULT_R2.json` on Alisa.

Source inspection found no custom `AppConfig.ready()` or executable app initializer in this installed closure. The models declare Django fields, constraints and managers; `staff.policy` declares constants and functions. Settings perform local environment validation and configure the standard logging stream handler. The inspection did not initialize Django, import application services or open a database connection.

The pinned release manifest alone has an explicit 1 MiB read limit, accommodating the observed 984,658-byte manifest. Receipt, context and individual source-file reads retain the 256 KiB limit. Both limits retain the same expected hash, ordinary-file, owner, mode and no-final-symlink checks.

The approved invocation uses systemd's EnvironmentFile loader for the existing, observed paths. The helper neither sources shell code nor parses, exports or prints dotenv contents. `infra/launch.py` is not imported because it executes a server. The old installation `migrate.py.config()` is not imported because it selects the migration database identity.

The helper uses the installed virtual environment and settings module. It requires the existing runtime role `alisa_stage_platform_runtime` and database `alisa_stage_platform`, then verifies the **actual** `current_user`, `session_user`, database, both read-only settings and absence of superuser/CREATEDB/CREATEROLE/BYPASSRLS privileges before any model query. PostgreSQL receives default read-only options before connection, an explicit read-only transaction, a 1500 ms statement timeout, a 250 ms lock timeout and a 5000 ms idle-in-transaction timeout. There are no row locks, migrations or application service calls.

## Exact data access allowlist

All ORM reads use explicit `.values(...)` and a two-row maximum. No model instance or lazy relation is returned. There are at most eight bounded ORM reads: one each for Query, Store status, Customer, Membership, Store identity presence and OwnerDataset, and one per required credential kind. Store is checked twice within that total. After the first four reads, an inactive customer, inactive store or absent/ambiguous current owner membership stops with `CURRENT_OWNER_SCOPE_CHANGED`, before any identity, credential or dataset read.

| Source | Exact constraint | Selected fields |
|---|---|---|
| Query | Fixed receipt UUID, `channel=WEB` | `tenant_id`, `customer_id`, `store_ids` |
| Store | Exact selected UUID/tenant, `product_id=alisa_market`, `provider=OZON` | `status` |
| Customer | Exact Query customer UUID | `is_active`, `security_revision` |
| Membership | Exact customer/tenant, `role=OWNER_CLIENT` | `role` |
| Store identity presence | Same exact Store constraints, identity nonnull and nonempty | `id` only; identity itself is never selected |
| CredentialRevision | Exact product/tenant/store, `status=ACTIVE`, separately SELLER and PERFORMANCE | `check_code` only |
| OwnerDataset | Exact product/tenant/store | `status`, `approval_id`, `approved_by_id`, `approved_security_revision`, `approved_at`, `catalog_hash` |

The only explicit SQL outside those model queries is the read-only transaction/timeout setup and the one `pg_roles WHERE rolname=current_user` identity check. It selects booleans, not database identities. Normal driver connection initialization is not an application model read.

No `facts`, `continuation`, question, email, token, VaultSecret, CurrentParameter, access grant or provider value is selected. Catalogue fields are read from the pinned installed JSON without importing owner or account services. Unknown credential text is reduced to `UNQUALIFIED`; it is never reflected. `CONNECTED_NATIVE_OWNER` remains distinct from strict owner-source `CONNECTED`.

Output contains only fixed codes and booleans. `METADATA_COMPATIBLE` covers the listed checks. `profile_coverage=NOT_CHECKED` and `execution_authorized=false` remain explicit: this does not qualify SKU/day facts, entitlements, current sessions, financial sources or report execution. There is no queue/delivery scan in this target-scoped diagnostic.

## Proposed finite invocation — only after exact source review

Set `SCRIPT` to the reviewed absolute `preflight.py` path in an owned checkout. Its adjacent source context must be the reviewed file. Verify both hashes before this command. The path is the sole caller-supplied deployment location; the accepted target and installed source are fixed inside the artifact.

```bash
systemd-run --unit=alisa-economics-owner-metadata-20261115 \
  --wait --pipe --collect \
  --property=Type=oneshot --property=TimeoutStartSec=20s \
  --property=TimeoutStopSec=2s --property=MemoryMax=256M --property=TasksMax=24 \
  --property=User=root --property=UMask=0077 --property=NoNewPrivileges=yes \
  --property=ProtectSystem=strict --property=ProtectHome=read-only --property=PrivateTmp=yes \
  --property=IPAddressDeny=any --property=IPAddressAllow=localhost \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=WorkingDirectory=/opt/alisa-platform/stage/releases/alisa-customer-catalog-8b8b919993c38128 \
  --property=EnvironmentFile=/etc/alisa-platform/stage/platform.env \
  --property=EnvironmentFile=/etc/alisa-platform/stage/runtime-link.env \
  --property=EnvironmentFile=/etc/alisa-platform/stage/alice-link.env \
  --property=EnvironmentFile=/etc/alisa-platform/stage/query-insights.env \
  --property=EnvironmentFile=/etc/alisa-platform/stage/question-catalog.env \
  --property=EnvironmentFile=/etc/alisa-platform/stage/question-catalog.env \
  --setenv=PYTHONDONTWRITEBYTECODE=1 \
  --setenv='PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=1500 -c lock_timeout=250 -c idle_in_transaction_session_timeout=5000' \
  /opt/alisa-platform/stage/releases/alisa-customer-catalog-8b8b919993c38128/.venv/bin/python \
  -I -B "$SCRIPT"
```

OS root permits reading the root-owned receipt and source metadata. The database role remains the ordinary runtime role; a migration/admin role is rejected. This creates one finite transient systemd diagnostic unit, not a persistent service or scheduled task. The command must not be retried automatically or rerun with a different account after a blocker.

Each environment file is a separate repeated `EnvironmentFile=` property, in the observed order, including the repeated question-catalog entry. One property containing all six space-separated paths is interpreted as one pathname by `systemd-run`; the initial metadata unit therefore stopped with `Result=resources`, before Python or database initialization. Its receipt remains `/root/alisa-economics-r15-owner-preflight-20261115/RESULT.json` on Alisa.

The corrected argument form was observed in a finite, disposable unit on Easyscript with two nonsecret environment files, using systemd `249 (249.11-0ubuntu3.23)`. Both distinct sentinels were present, the second file won for an overlapping key, and the running unit's actual `EnvironmentFiles` property contained exactly the two separate paths in order. The unit finished successfully with exit status 0 in 83 ms. Its retained receipt is `/root/alisa-economics-r15-envfile-proof-20261115-m0vl8ixd/RESULT.json` on Easyscript, SHA256 `7e116e6c014958885d79c169dec322c84f631b7752385dce4bafe847933e40da`. This probe imported no application or database code. The corrected installed metadata invocation still requires root review before its single finite execution.

## Disposable source tests

```bash
python3 -B -m unittest discover \
  -s docs/alisa/runtime/v0.11/economics_composite_r15_preflight/tests -v
```

These tests cover pinned receipt integrity/symlinks/modes, the manifest-only larger read limit, changed setup imports and unexpected app/model packages, exact stat strings above 2^53 and rejection of 1 ns drift, exact target scoping, early rejection of multiple or foreign stores and changed owner scope, explicit projections, metadata redaction, strict credential distinctions and current approval metadata. They use temporary files and model doubles; they do not import Django or open a database. They are not evidence that the installed owner is compatible.
