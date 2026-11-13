# Station pending-to-terminal delivery race

A request could become READY while a pending-message scenario was being prepared. The last guard correctly cancelled the obsolete pending action, but the exception path then switched the job to manual delivery. The candidate records only an observed pending-to-terminal transition and re-arms the same still-authorized job only when no action was dispatched. A fresh tick chooses the final nonce/callback or terminal error path.

Pause, global policy disable, replacement, manual takeover, disconnect, revocation and unknown launch outcomes retain their previous protections. No model or marketplace request is replayed. No stored answer is rewritten.

Seven new boundary test methods reproduce eight baseline failures across create/update and terminal-state variants. The full native suite passes 67 tests as alice-lab, including the latest parallel clarification core. The installer changes one payload file and only the existing systemd code paths, preserving the current security settings and credentials. See REVIEW.json and SERVER_TEST_PROOF.json for exact pins and validation.
