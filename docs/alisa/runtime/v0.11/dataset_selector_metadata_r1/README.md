# Dataset output semantics in template selection

The selector previously received dataset names and an empty metrics list, without their output columns. A request for the total number of WB campaigns was declined before any source call despite an available registered campaign inventory.

The selector view now adds a small static dataset_output description: output stage, whitelisted field/label/kind columns, and existing output grouping. Non-dataset rows remain identical. The strict prefix contract accepts original rows and the optional validated metadata, keeping tenant availability and the exact question in the dynamic tail. Notes, source paths, credentials, acquisition steps and real API data are excluded.

Selection guidance allows registered dataset sources to cover simple exact calculations after a complete read. It does not calculate in selection, add operations or input filters, change metric bindings, or relax compilation. Existing clarification guidance and source are retained. All template definitions are byte-equivalent in parsed JSON; only the catalog top-level version changes to invalidate pinned catalog state for new work.

Validation includes the actual worker-to-HTTP selector payload, privacy projection, lossless old/new prefix round trips, deep-copy isolation, strict unknown-field rejection, unchanged dataset input restrictions and the full focused template/prefix/clarification suite. The native server run uses alice-lab and performs no paid provider calls. Live acceptance must repeat the original question and verify the count against complete API inventory.

The finite installer pins the current 911259 release and every base file, changes exactly three payload files, preserves clarification metadata and current Station code/settings, uses the existing recovery lock and atomic pointer rollback. Owner answer/planning settings are not modified. Private live receipts stay outside Git.

Rollout also blocks on unexpired READY clarification results before and after stopping the core, because those continuations remain pinned to the old catalog hash. It never cancels or migrates an unfinished clarification.
