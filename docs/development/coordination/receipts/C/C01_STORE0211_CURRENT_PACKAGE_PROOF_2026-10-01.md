# C01 exact STORE 0.2.11 current package proof — 2026-10-01

Status: **SOURCE + PACKAGE PASS / FROZEN BYTES RECHECKED / NOT INSTALLED-LIVE / NOT DEPLOYED / NOT SUBMITTED**.

Task: `C01-STORE0211-CURRENT-PACKAGE-PROOF`.

This receipt binds the accepted C01 fail-closed release-verification contract to the exact frozen STORE `0.2.11` candidate. It does not rebuild either extension ZIP and does not create any new installed, live, store-publication or production claim.

## Exact package source

Frozen release source:

- HEAD: `7353c996fb72b62196d57ef2dbcd5c8339057dba`;
- tree: `a1f5b3616dba28473ce7275e5994af89001a4532`;
- product version: `0.2.11`;
- contract: `control_plane_v2`;
- migration level: `55`;
- environment: PREPRODUCTION release authority.

Preserved external authority:

`/root/octoport-control/logs/C/store-release-0211-7353c996/authority.json`

SHA-256:

`50d62b8b697b2abcd20d42d18a97ce15c0f20fbcc7ba516e57ac639dd9824f24`.

Preserved candidate manifest:

`/root/octoport-control/logs/C/store-release-0211-7353c996/candidate/B1_RC_MANIFEST.json`

SHA-256:

`8dea8bb67e4381c0eba8433380753d3e572fab0ce7e4204669713e970e2689c6`.

## Verifier applicability

The C01 verifier core is unchanged from the prior accepted C01 boundary:

- `tooling/b1/prepare-release-candidate.mjs` blob:
  `53a41402b1fb111f2891c7addc6d1de7c0e6fcd8`;
- `tooling/b1/release-preflight.mjs` blob:
  `94f4fa656329ceb23e4ff7074f0d96aa5694df47`.

Those two blobs are identical at:

- earlier accepted C01 source `1ca6184056ac1151b0764df55664351394701654`;
- frozen `0.2.11` source `7353c996fb72b62196d57ef2dbcd5c8339057dba`;
- current common main at the time of this proof `7ed7294150fb8797bd2141b93f295ac144441509`.

The strengthened negative suite at the frozen source is:

- `tooling/b1/release-safety.test.mjs` blob
  `53dc52ca29deaaf76c9931159e794b8ff23b1983`.

The same suite blob is present on current main.

## Current negative/positive release-safety suite

Executed from a detached exact `7353c996...` worktree under Node `v24.20.0`:

`node --test tooling/b1/release-safety.test.mjs`

Result:

- tests: **42**;
- pass: **42**;
- fail: **0**;
- skipped/cancelled/todo: **0**.

The suite includes fail-closed coverage for:

- `NOT_AN_EXTENSION` input;
- PRODUCTION authority in the PREPRODUCTION store-review lane;
- unsupported Chromium module service worker;
- non-canonical / obfuscated classic `importScripts` forms;
- development-only material in background or popup;
- wrong Firefox stable add-on ID;
- arbitrary bootstrap trust;
- inconsistent authority public-key fingerprint;
- ZIP traversal, absolute paths and backslash escape;
- duplicate and case-folded duplicate ZIP entries;
- missing declared extension runtime;
- private-key material and forbidden secret files;
- symlink-like entries;
- oversized and non-regular package input;
- missing reachable packaged config;
- stale packaged contract;
- replaced packaged endpoint;
- mismatched packaged environment;
- stale source HEAD/tree;
- stale product version;
- stale server contract;
- stale migration level;
- authority-origin replacement without matching package evidence;
- authority exact-byte binding;
- candidate filename escape;
- candidate metadata/archive-hash disagreement;
- authority placed inside the candidate directory;
- attempts by the preparer to claim browser/live/deployment acceptance.

Evidence log:

`/root/octoport-control/logs/C/c01-store0211-current-package-proof-20261001/release-safety.log`

SHA-256:

`6aed9769837f367e2d8867a27f4f0c7c82f0918bb595c948b0baf6da8807b8b1`.

## Direct exact candidate preflight

The current verifier was run directly against the preserved frozen candidate directory and external authority:

`node tooling/b1/release-preflight.mjs <candidate-dir> --authority <authority.json>`

Safe result:

- status: `PASS`;
- `productionMutation=NOT_PERFORMED`;
- evidence level: `PACKAGE`;
- source HEAD/tree exactly match `7353c996...` / `a1f5b361...`;
- version `0.2.11`;
- contract `control_plane_v2`;
- migration level `55`;
- authority SHA-256
  `50d62b8b697b2abcd20d42d18a97ce15c0f20fbcc7ba516e57ac639dd9824f24`;
- `externalAcceptance=NOT_CLAIMED`.

Result file:

`/root/octoport-control/logs/C/c01-store0211-current-package-proof-20261001/release-preflight.json`

SHA-256:

`3009abb3cd1c517ec0cf85e4b3fc8a3cf448e23d1d6427e595231c94076efa16`.

## Exact frozen package identities

Chromium:

- file: `OCTOPORT_v0.2.11_CHROMIUM_STORE.zip`;
- bytes: `2247016`;
- SHA-256:
  `66c8b34e533f0e716cc3b7d214127a8443e89a241682d2307487c96a373f07c9`.

Firefox:

- file: `OCTOPORT_v0.2.11_FIREFOX_STORE.zip`;
- bytes: `4191713`;
- SHA-256:
  `f53340ccedec844041d57c0b3e37de0bd8acf234aacd4852ee2b5fe0c72926ca`.

Both actual file hashes and byte lengths were re-read and matched the preserved B1 manifest exactly.

No archive was rebuilt.

## C01 conclusion

The exact frozen STORE `0.2.11` package satisfies the current C01 release-verification contract at **SOURCE + PACKAGE** level.

This closes only the package-verification applicability question. It does not prove:

- authenticated browser behavior;
- normal login/device authority;
- real ChatGPT or marketplace useful flow;
- browser-store installation/update;
- store submission/moderation/publication;
- server deployment;
- beta readiness;
- production.

Those remain owned by their separate evidence gates.
