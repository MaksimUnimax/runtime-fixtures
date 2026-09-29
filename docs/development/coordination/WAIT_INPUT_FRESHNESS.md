# Fresh input boundary for whole-stream waiting

Controller L2 owns this bounded organizational correction on base f9b6cc00. Paths: waiting_gate.py, control.py waiting call, test_waiting_inputs.py, this document. L1 resume changes remain independent.

A full queue scan is invalid if a relevant controller notice, directed handoff or intake changed after its checked_at. The WAITING transition must reject that scan without rewriting state. Re-reading current inputs permits a fresh justified wait; STOP is never cleared. This does not create a scheduler or a new release gate.
