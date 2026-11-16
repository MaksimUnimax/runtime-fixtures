# Program-pair service adapter — 16 November 2026

**WIP — FINAL INDEPENDENT REVIEW REQUIRED. Not deployment-qualified.**

This continuation supersedes the earlier statements that the broker phase/file primitives have no real service adapter. `ProgramPairServiceFence` and `ProgramPairDeployment` now implement that adapter, and the existing finite activation CLI exposes separately bound `program-plan` and `program-apply`. No new scheduler, service runner, permissions, provider call or owner-result reader is introduced.

## Boundaries

`program-plan` holds the two existing kernel flocks, revalidates the exact product package, accepted broker, SDK reference identity, candidate files and loaded systemd definitions, and calls the existing read-only native/voice/PostgreSQL readiness samplers. It does not create an attempt or change units. Four historical UNKNOWN jobs are NOT ignored or cleared by these commands.

`program-apply` accepts only a fresh coordination record bound to the product, exact plan, tool and prepared package. It rederives the plan before creating an attempt. The old and candidate source trees and the two unit definitions have explicit fixed hashes. Publication is no-replace and immutable, with recorded directory identity. This program transition does not switch the R15 product or enable new product flags.

The service adapter closes only the program socket and cleanup timer. It never stops an accepted broker or paid worker. Both program locks must remain held; all accepted/worker instances, cleanup and queued systemd jobs must be idle. A failed or partial fence is not rollback permission. Unit-file mutation and restoration use the existing separately reviewed serialized transaction. No result-store contents are read or rewritten.

The maintenance window is rechecked at the release entry, immediately before each mask removal, before daemon reload and immediately before start. Expiry at any of these boundaries refuses further admission work; after the marker it never causes automatic downgrade. A durable possible-admission marker precedes removal of runtime masks and reopening of the socket/timer. Errors after that boundary never trigger automatic downgrade. Before that boundary, guarded restoration can reopen the verified old definitions. An existing attempt or publication is not silently reused after an uncertain outcome. A partial failure retains evidence for reviewed recovery.

## Defects found with real systemd

A timer has no ControlPID property; the observer now checks the exact property shape for each unit type rather than inventing a zero. Reloading a /dev/null mask over an already active socket loses its loaded Listen/RemoveOnStop definition, and over an active timer can lose its trigger. The corrected sequence durably stages both masks, stops the original still-loaded socket/timer, observes completion, and only then reloads and verifies the masks. The two existing locks stay held throughout. Reopening a timer can immediately schedule cleanup; readiness therefore has a finite five-second observation window rather than treating a transient state as completion.

All earlier failed local test invocations and their results are retained outside the checkout in the current evidence directory. The invalid template-name query was a fixture launch error, not a production defect. No failed test is relabelled as success.

## Actual tests completed before publication

The complete activation unit discovery passed 199 methods, no failures/errors/skips. The new 16 methods cover exact service-property and job grammars, busy instances without stops, queued program work, no made-up timer PID, stop-before-reload ordering, unresolved stop, foreign mask identity and source/plan/window/readiness binding.

The actual systemd fixture passed 17 checks. Its final scenario expires coordination after the durable possible-admission marker: both triggers remain masked and no automatic downgrade occurs. It runs the full adapter and phase core with real private source publication, unit changes, socket/timer masks, real instance/job observations, a pre-admission failure after new-unit reload and restoration, and successful activation. The new synthetic service uses the exact accepted broker and Results source for retained protocol 2/3 responses. Fresh dispatch is prohibited; retained unanswered data and UNKNOWN retrieval are checked. An already active accepted instance refuses before masks or unit-file changes. Cleanup is bound to owned file identities, not only path names or matching bytes.

The fixture substitutes owner/product readiness and SDK context; its retained-broker wrapper maps only the fixture peer, lock and result-store paths and prohibits any new executor dispatch. Its cleanup command is a no-op. Thus the fixture proves service-control/retained-protocol mechanics, NOT owner authority, a new SDK qualification, live sweeper behavior, InstalledSynthetic on Alisa or LiveOwner acceptance. Existing separate readiness, credential and product gates remain in the unchanged pipeline.

The existing activation CI workflow now includes this actual-systemd gate and observes removal of its own units/root. It does not add a second workflow or daemon. Exact-head CI and independent review results must be read separately after they complete; this source document does not predeclare them successful.

## Remaining operational sequence

After exact-source review and CI, deliver the externally hashed tool and inspect `program-plan` against the live accepted base. Resolve any current readiness block through primary operation outcomes, never by blanket deletion/replay. Only with actual readiness and fresh coordination may `program-apply` install the backward-compatible handler. Then perform InstalledSynthetic retained v2/v3 qualification before admitting the already-built R15 consumer. The full Ozon owner report remains a separate acceptance step.

## Review outcome and publication boundary

Independent gpt-6-luna review R1 returned REQUEST_CHANGES: coordination was not rechecked at the release/start boundary. An author regression reproduced the missing refusal before the fix. The fixed adapter checks the window at entry, every mask removal, before reload and before start; three focused methods plus the real post-marker expiry scenario pass. A follow-up read-only reviewer invocation was blocked by the tool safety system before execution; readback confirmed no R2 intent/result file or running reviewer unit. That call was not retried or routed through another tool/model. The original REQUEST_CHANGES remains open until an authorized independent reviewer checks the exact fixed source.

The Git branch/PR is a DRAFT source checkpoint for inspection and existing automated CI, not accepted SOURCE or a deployment approval. No live installer invocation may be inferred from a green test/CI result. Initial review incorrectly described the workflow as unchanged because sparse-checkout hid its diff; the 44-line existing-workflow delta is now explicit and still needs independent review. Earlier source approvals cover preceding commits only.
