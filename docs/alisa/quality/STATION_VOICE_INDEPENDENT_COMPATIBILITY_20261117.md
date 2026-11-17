# Existing Station voice write: independent compatibility review

Review of PR464 source `485a2034ac0dc36fea2590666075b54c24b12174`, 17 November 2026. Source compatibility passes for the declared existing-Station scope. The author's first native candidate had a stale internal core seal; a corrected, checked immutable revision is now prepared separately. Activation/rollback is not yet qualified. No working release, owner permission or coefficient was changed by this review.

## Existing owner path

The authenticated cabinet confirms that the existing Station is paired with Яндекс Лайт 2 and has returned a ready skill response. The separate platform Alice OAuth page reports DISCONNECTED. The installed user's path is `/app/station/`; the bridge can use that existing binding without a new OAuth connection. No consent control was operated.

## Verified source composition

The accepted installed platform contains154 Python/JSON files. Six backend overlay files produce157 files while retaining151 original files unchanged, the old AliceLink models/views/migration set and the installed R15 settings. There is no new DB migration or web build for this selected legacy-only route. Native receives two source files over the installed IPC extension, and Station receives six files, including its existing site's UI.

The installed IPC base is `ac059ff23efa44516436ac20b3a567c4bb17dfe28896d49745a036e8988e02fc`, different from the PR's older repository baseline. Replacing the whole IPC file from that baseline would discard installed extensions. The reviewed composition preserves the installed file and applies the exact-head overlay.

| Independent isolated run | Cases | Outcome | Scope |
| --- | ---: | --- | --- |
| Installed R15 + modern source7ac22354 |140|PASS|Original platform parameters and voice cases|
| Installed R15 + complete Station source485a2034 |168|PASS|Full source bridge with original test definitions|
| Installed R15 + minimal legacy-only bridge485a2034 |129|PASS|101existing parameter cases and28Station cases; no AliceLink migration|

These are overlapping runs and must not be added together. Every run used real PostgreSQL, synthetic identities/grants, no external connections, and had zero failures/errors/skips. The Station suite exercises two real Unix sockets and native peer checks; private HTTP carriage is RequestFactory. This does not prove rendered installed UI or physical audio. Existing test methods were unchanged; the minimal copy's launcher labels/result scope were narrowed to its129cases.

Initial setup failures are retained: the first lacked mandatory runtime roles, the second raced PostgreSQL's temporary initdb server. The successful platform run supplied the required NOLOGIN runtime roles and waited for the final PostgreSQL PID1 process. No migration guard or application check was removed. Results and source receipts are pinned in the adjacent JSON evidence.

## Package and complete candidates

CI Source44054235750 and Documentation44054235806 succeeded at exact source485a2034. Artifact14315374671,52379279bytes, SHA256`de1025c8f4570a010e9f8b65e7b7ef9542d88022370fb0262cf108d5c5e6b92f`, was delivered by file channel. ZIP digest, nested TAR digest and backend payload hashes were checked. No binary/Base64 payload was transferred as tool text.

Independent full private candidates contain211native,4724platform and29Station declared files. They retain the platform's existing42internal links and shared immutable Python environment. Unchanged source bytes and every resulting manifest hash were checked. The private native candidate regenerates its core seal so that `core.files == outer.files excluding CURRENT_CORE_MANIFEST.json`.

The author concurrently prepared inactive real release candidates. Independent staging stopped on STAGED_ALREADY_EXISTS before copying or overwriting them; the failure/outcome is retained. No retry into a differently named release was attempted.

### Delivery finding requiring correction

Author native outer manifest `12b4dd614ea3c27788a0b1ba750743b88b85827759d1271916b8ee3c40bd3d0b` correctly lists the changed IPC and new proxy. Its retained CURRENT_CORE_MANIFEST.json still lists the old IPC and omits station_parameter_proxy.py. Regenerate the inner file map from the entire resulting native payload, preserve R15 metadata, record exact overlay provenance, and regenerate the outer manifest. Publish a newly named immutable revision; do not edit the already published candidate in place.

The unmodified installed `runtime.py --check` passes, reporting zero external calls and secrets_read=false. The installed `runtime_versions_sync.py --check` also passes and reports only catalog_bundle_hash requires update. These checks do not detect the stale inner seal. Both successful CLI checks and the additional failed consistency assertion are retained in AUTHOR_CANDIDATE_CHECK_R1.json, SHA256`e097d2415e899c96ce0f74ff4c1975727e356534e3070d70f7064849f9dc1fc2`.

Source review comments5936035491 and5936125658 and delivery finding5936350988 are attached to PR464. They are technical review comments by a separate dialogue, not a GitHub formal approval of one's own account. The source author adopted the minimal no-migration variant in SELECTED_VARIANT.json.

### Corrected inactive revision

The review subsequently prepared `/opt/alice-market/releases/alisa-coefficient-station-native-485a2034ac0dc36f-core-r2` using the author's exact assembly helper9477ae87 and its pinned accepted release primitives. This is a fresh candidate over the original installed R15 base; the author's first candidate was not edited. Payload equality to the independent reviewed candidate and complete inner/outer seal equality pass. It has211declared files, manifest SHA256`14735e33aa5e830f34c98f4c3a76045fd1d190db3b05a0c65a82e500daf03151`, core manifest SHA256`dbd45835064190c1851ae65f944c8b64ff3b2c52cec971f013dc70cdd92454ac`.

Both unchanged installed configuration and version checks pass; only catalog_bundle_hash requires publication. CORE_CORRECTION_R2_RESULT.json SHA256`e6b0f88b729d3a7a1894f8b2bc8dbb32fee55d00a9d7be08535a0ea48faa2745` records the result. A first correction attempt stopped before assembly because the shared rollout lock was held by the author's fixture qualification. Its outcome was preserved; after lock release a fresh bounded attempt used the same guards and succeeded. There was no selector switch or live service change.

The source author separately recorded24checks on an actual owned systemd selector fixture, including inherited EnvironmentFile preservation, feature0, pre-admission restore and later-writer refusal. That is mechanical fixture evidence; it does not qualify a post-admission rollback of the real product. These24checks are not added to parameter test counts.

## Remaining work and acceptance

The author must qualify a bounded assembled-release activation/rollback procedure and obtain independent delivery review before switching. Keep inherited environment/credentials, R15 owner-source projection and unknown-job semantics. The corrected core-r2 candidate must be explicitly repinned into that qualification.

After installation, verify live site/proof behavior with owner permission absent. The owner then explicitly opts in on the existing Station page; physical proposal→confirmation→cabinet current value→economics recomputation is still open. Do not invent a real coefficient value for acceptance or grant permission on the owner's behalf. Source-only and isolated PostgreSQL results are not installed or acoustic acceptance. Ozon's source-attested historical lower bound remains an independent open item.

At the last independent assembly readback all9 live service generations and installed source manifests were unchanged. No working DB migration, permission, provider/model call, coefficient write, main merge or service restart was performed by this review.
