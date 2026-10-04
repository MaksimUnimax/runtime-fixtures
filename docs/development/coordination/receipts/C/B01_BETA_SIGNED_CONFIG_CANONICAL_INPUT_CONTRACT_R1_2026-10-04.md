# B01 beta signed-config canonical input contract R1

Task: B01-BETA-SIGNED-CONFIG-CANONICAL-INPUT-CONTRACT-R1-20261004

This source-only contract narrows the free-beta control_plane_v2 canonical input boundary. It does not seed or publish configuration, create signing authority, choose persisted compatibility-policy revisions, touch a database, or authorize a live catalog mutation.

The committed source values are only:
- contractVersion = control_plane_v2
- snapshotVersion = bootstrap_snapshot_v2
- envelopeVersion = bootstrap_envelope_v2

The signing key remains DYNAMIC_SECURITY_AUTHORITY. Persisted compatibility-policy revision IDs remain DYNAMIC_REVISION_AUTHORITY. Current feature-rule and feature-rollout links are represented as CONDITIONAL_NOT_SELECTED with an exact empty selected list for the bounded beta-v2 scenario; this does not claim the underlying tables are globally SAFE_EMPTY.

configVersion and publishedAt are publication outputs. sourceFingerprintSha256 and contentHashSha256 are derived only after the external authority graph is fixed. The contract deliberately contains no key ID, key material, UUID, revision number, timestamp, precomputed hash, DB identity, writer authority, or live authority.

This boundary consumes the accepted B01 classification/canonical-input evidence. Current compatibility-policy canonical input is still a separate unresolved authority; the contract therefore does not manufacture policy revision IDs.

## Accepted evidence binding

- Exact source parent: 7e3406d4f51fc4469d1fc6c09e7b4a131fe4fc6d.
- Corrected beta-reseed classification RESULT: /root/octoport-control/logs/C/b01-legacy-s2-beta-reseed-minimum-classification-r1-20261004/RESULT.json, SHA-256 d818eb7a426f1abb208e01d464098da645c3c6004eb398dd2efa0714110184e0.
- Accepted beta-critical canonical-input candidate RESULT: /root/octoport-control/logs/A/b01-beta-critical-canonical-input-candidates-r1-20261004/RESULT.json, SHA-256 9316cf49275f703e2895f3eaf5453fa109ca8290552cff1ce2bd044f5360acb9.
- The f203d8d3 to 7e3406d4 main advance changed only the separately accepted adapter-registry/Store1 AI-profile contract paths; remote-config source paths for this task were unchanged.

The accepted input evidence classifies signing authority as dynamic security authority, concrete compatibility-policy revision IDs as dynamic revision authority, and feature/rollout links as conditional rather than mandatory beta rows. This contract does not claim that a current multibrowser compatibility-policy input has already been selected.
