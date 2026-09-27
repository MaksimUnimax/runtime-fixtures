# B08 STORE1 reviewer + v2 preflight — 2026-09-27

Status: SOURCE_VALIDATED_CANDIDATE

## Authority and scope

This is an incremental correction to the accepted STORE1 ordinary-admin preparation already present in main. It does not repeat package/catalog preparation and performs no live identity, catalog, database, commercial, registration, or store mutation.

Preflight was performed on stream B after B07 candidate `89f5d6f0cb11d1d6b2106ca53cd0cd98192ea66b`. Fresh `origin/main` at the final pre-commit fetch remained `7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

## Confirmed gap

The existing planner correctly verified CLOSED beta, an ACTIVE verified reviewer identity, exactly one ACTIVE reviewer-owned account, and existing beta admission before any mutation.

However, it could still publish the extension release and compatibility policy before reading the latest v2 config. A missing, malformed, or no-longer-ACTIVE signing authority could therefore be discovered only after partial STORE1 catalog mutation.

The database config-publication path already revalidates Ed25519 key metadata and current signing-key lifecycle transactionally. That protection remains unchanged, but it occurs too late to protect the earlier release/policy POSTs.
## Correction

The safe admin latest-config readback now includes `signingKeyId` plus the resolved append-only `signingKeyState`. It does not expose public-key bytes, private material, OTP/session data, or owner credentials.

The read repository resolves state from ordered `signing_key_events` through the canonical strict lifecycle evaluator. Signing-key metadata remains immutable, and config publication still performs its independent cryptographic/lifecycle validation.

After reviewer preflight, the STORE1 planner now requires, before any catalog POST:

1. a latest `control_plane_v2` base config exists;
2. the base is `bootstrap_snapshot_v2` / `bootstrap_envelope_v2`;
3. its signing key lifecycle is exactly `ACTIVE`.

Missing base returns `STORE1_V2_BASE_CONFIG_MISSING`. Unexpected v2 shape returns `STORE1_V2_CONFIG_CONFLICT`. Non-ACTIVE signing authority returns `STORE1_V2_BASE_SIGNING_KEY_NOT_ACTIVE`.

Only after those checks may release, policy, config-link, registry, profile, or assignment mutations be planned.
## Disposable verification

Toolchain: Node 24.20.0, pnpm 10.34.5.

PASS:
- planner unit tests: 17/17;
- admin-commercial route unit tests: 72/72;
- focused total: 89/89;
- typecheck: `@product/admin-commercial`, `@product/db`, `@product/api`;
- OpenAPI source test: 6/6; the route currently has the existing generic 200 schema, so no tracked shared OpenAPI artifact change is introduced by this candidate;
- B disposable PostgreSQL: P6.4 + STORE1 whole-sequence, 121/121.

Final supervised PostgreSQL job: `622c287f4f174b4182b80165c88fcf65`.
It finished with `command_exit_code=0`, `cleanup_verified=true`, `oom_kill=0`.
Final log: `/root/octoport-control/logs/B/b08-store1-reviewer-v2-r2.log`.
Log SHA256: `55a03f34d1d2d6ae3f0e013c8a3eaa2a215dca05a685ec4c7158511ec253a6d8`.
Supervisor receipt SHA256: `7ce6356befa66e3769e5be34d25ae8a9135bcd9db09a4537b51e80b06ee3776a`.

The whole-sequence rehearsal proves an ACTIVE real signing-key event chain is read through authenticated ordinary admin before STORE1 mutations and that replay is mutation-free. P6.4 A05h additionally revokes the real baseline key, observes admin latest-config readback `signingKeyState=REVOKED`, and confirms config publication fails closed with no new config/link row.
## Smallest remaining ordinary-provisioning gap — handoff to C

The source review reconfirms the boundary already documented by the accepted STORE1 preparation:

- while global beta is CLOSED, an already-existing verified identity can use the ordinary OTP login path;
- first-time identity creation is denied;
- there is no accepted targeted reviewer-invite/provision mutation that creates and admits exactly one new reviewer while keeping global beta CLOSED.

Therefore B does not fabricate a user with SQL/admin bypass and does not open registration. STORE1 live preparation may proceed only with an already-existing ordinary verified + admitted reviewer, or after a separately accepted targeted provisioning contract is designed and integrated.

This is the smallest external gap handed to C. It is not a request to activate anything live, and it does not block completion or review of this source candidate.

## Safety invariants retained

Global beta stays CLOSED. No hidden reviewer creation, owner-as-reviewer substitution, SQL bypass, private signing material, live DB mutation, catalog publication, worker cadence change, or commercial enablement is introduced.
