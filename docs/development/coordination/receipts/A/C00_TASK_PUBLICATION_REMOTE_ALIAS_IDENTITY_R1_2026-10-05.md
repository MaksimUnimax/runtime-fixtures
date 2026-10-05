# C00 task-publication remote alias identity R1 — source evidence

Task: `C00-TASK-PUBLICATION-REMOTE-ALIAS-IDENTITY-R1-20261005`

## Scope

The governed task-publication trusted-route broker rejected the project's existing deploy-key push target form:

`github-seller-agents:MaksimUnimax/runtime-fixtures.git`

The change recognizes only the exact trusted host alias `github-seller-agents` in scp-style `host:owner/repository[.git]` form and normalizes it to the same GitHub repository identity used by the already accepted HTTPS / `git@` / `ssh://git@` forms.

No live board, registration, GitHub ref, repository remote, DB, browser, provider, package, deployment, or production mutation is part of this source task.

## Preserved fail-closed boundary

- Arbitrary or foreign aliases remain rejected.
- Empty/malformed owner/repository forms remain rejected.
- Internal whitespace remains rejected.
- Existing accepted GitHub forms and absolute local-path semantics are unchanged.
- Trusted-route checks still require their existing strict publication/registration/tree/remote-main authority; this change only normalizes the immutable repository identity input.

## Pre-fresh-base verification

Original WIP base: `d798b735f3af434e0d806f14bcc853503bfde30f`.

Fresh fetched main at reconciliation: `6b3a6c5e0863d4750011af7a88a69cf0b4158a1c`.

Same-path drift between those commits for this task's three paths: none.

Focused trusted-route / remote-identity tests: 8/8 PASS.

Full `tooling/coordination/test_task_publication.py`: 78/78 PASS.

`python3 -m py_compile task_publication.py test_task_publication.py`: PASS.

`git diff --check`: PASS.

The tests above were executed before moving the exact task delta onto fresh main. They are provenance for the WIP only; fresh-candidate tests must be rerun after the base move and before independent review.

## Fresh-base verification

The exact task delta was rebased cleanly onto fetched `origin/main` `6b3a6c5e0863d4750011af7a88a69cf0b4158a1c`; there was no same-path drift on this task boundary.

On that fresh-base candidate:

- full `tooling/coordination/test_task_publication.py`: 78/78 PASS;
- `python3 -m py_compile task_publication.py test_task_publication.py`: PASS;
- `git diff --check origin/main...HEAD`: PASS;
- candidate is single-parent from the exact fetched main.

No repository ref, live board, registration, DB, browser, provider, package, deployment, or production mutation occurred during these source checks.

## Independent review R1 and bounded rework

Independent gpt-6-luna read-only review of the exact fresh-base candidate returned `REWORK_REQUIRED` with one P2 finding: the initial alias component regex allowed URL metacharacters such as `?`, `#`, backslash and `:`, which could make the canonical HTTPS query target parse differently from the alias identity.

Review evidence: `/root/octoport-control/logs/A/C00-TASK-PUBLICATION-REMOTE-ALIAS-IDENTITY-REVIEW-R1-20261005-result.md`, SHA-256 `7abbe3286f41c4a56a9cf759f3bf44cd19d016a475bc3e1fa0145c3e8ef1ecf4`.

The rework narrows only the new `github-seller-agents:owner/repository[.git]` branch to ASCII GitHub-safe owner/repository characters, rejects empty/dot traversal repository forms, and adds explicit negative cases for query, fragment, backslash, colon and extra path segments. Existing accepted remote parser branches remain unchanged.

R1 is not accepted as PASS; a new exact candidate test run and a new independent review are required.

## Evidence level

SOURCE candidate only until new exact tests, independent gpt-6-luna PASS review, exact five CI, governed non-force publication/readback, cleanup/close, and strict queue completion.
