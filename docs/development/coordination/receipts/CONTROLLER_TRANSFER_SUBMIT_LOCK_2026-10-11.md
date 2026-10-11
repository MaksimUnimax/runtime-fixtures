# Controller transfer submit guard — 2026-10-11

Parent SOURCE: 8b7232db2d881817ff5a0aed3748657171fbbab9 (coordination fixes only); original main review: e01778cca4af25c366fd80acd55fca5349527052.

A successful packet-available commit previously left submit outside the request guard while its repository response was delayed. A repeated source-seen then reset the durable request to SOURCE_SEEN and stranded receive. Submit now holds the existing per-request guard across reservation, durable transition, relay activation and final read. Existing authorization, bounds, deadline, reservation release and replay checks remain. Concurrent receive while submit is committing now rejects TRANSFER_CONFLICT without exposing a reservation.

The bounded source regression delays only the response after the real memory-repository commit. Baseline: source-seen incorrectly succeeds and returns SOURCE_SEEN. Fixed: concurrent source-seen rejects TRANSFER_CONFLICT, state stays PACKET_AVAILABLE_EPHEMERAL, then receive and ACK reach COMPLETED. The exact post-commit regression and all 27 service unit tests pass; strict source typecheck and formatting pass. Existing dependencies are reused read-only; no installation, database, network, Chromium or foreign source edits occur.

This is SOURCE evidence only. The independent report used real PostgreSQL; its PostgreSQL boundary, main/installed application and mandatory product outcome remain OPEN. B04 accounting/admission and protected Controller runtime eligibility are not bypassed. Original recipient-result recovery is already foreign WIP in A/OPERATOR and is preserved.
