# S05 qualification snapshots

Original safe JSON exports retain all FAILED and PASS outcomes. 3f3162: PostgreSQL36 passed, browser foreign-store test failed because S02 cleanup had expired the second session. c6217b attempt1: PostgreSQL38 passed, legacy engineering assertion failed with no partial browser receipt; its exact cause remains UNKNOWN. c6217b attempt2 passed the unchanged engineering assertion but timed out selecting the nested marketplace label. efa6a4 closes the label and no-JavaScript form boundaries and has full successful qualification.

ci-binding.json pins the only accepted package source efa6a412ddc6926132cfd6fa648b71d0a155232a. pre-integration-server-readback.json confirms the working server still has S04, no stores migration/capability/keyring and no RT-CHECK socket. It is a read-only snapshot, not S05 deployment evidence.

The source/package qualification uses real disposable PostgreSQL, Unix sockets and native-login packaged browsers, with an explicit synthetic provider-check peer. It does not qualify actual marketplace endpoints or keys.
