# Controller assignment: superseded notice filtering

Date: 2026-09-27. Audit: STREAMS-AUDIT-20260927-0857.

Owner-authorized scope: routine workstream audit and bounded coordination fixes.
Author: controller, isolated worktree. Integrator: C only.
Base: 0b9648bd0bb14d1af6a2916f6fbba16e37b887a0.
Reserved source: tooling/coordination/control.py, function controller_notices only.
Receipt: this document.

Defect: the active notice reader excludes CLOSED but still returns SUPERSEDED notices. Fifteen already-superseded historical notices across A/B/C were therefore included in active feeds. Their files and history are preserved; the controller marked those superseded records CLOSED after checking replacement records exist. Current OPEN notices remain active.

Fix boundary: exclude CLOSED and SUPERSEDED from active notices, preserve existing behavior for other statuses, role filtering and sorting. No task lifecycle, STOP, admission, review or resource behavior change. No production/service change.

Validation: execute only the extracted pure reader against temporary notices; demonstrate the old implementation includes SUPERSEDED and the new implementation excludes it, while OPEN and the pre-existing treatment of unknown status remain unchanged and other roles remain excluded. No full suite or resource inspection in this audit.

Handoff: C reviews and integrates this bounded candidate with its current intake, then runs its normal required CI on the integrated candidate. The controller does not publish main.

Validation result: reproduced SUPERSEDED leakage in the old reader; corrected reader passed OPEN retention, CLOSED/SUPERSEDED exclusion, unchanged other-status behavior, filename order, role mismatch rejection and empty-role output. Only the extracted function was executed. Runtime metadata archive: 15 already-superseded records closed, 0 files removed; two active notices per role preserved.
