# Controller source repair: publication reopening and FIFO readers

Base: e01778cca4af25c366fd80acd55fca5349527052. Sole author: CONTROLLER, continuing CONTROLLER-4P2-TRUSTEDROOT-20261010T120000Z under the owner's direct six-P2 instruction.

A negative candidate-bound review now moves the previous publication registration/snapshot and resource seal provenance into completion_history. Active IN_PROGRESS no longer carries DONE-only publication fields. The existing resource callback still unseals only after durable queue commit; foreign-resource reopening authority is unchanged.

Both pinned registration and verified receipt leaf readers add O_NONBLOCK before fstat. O_NOFOLLOW, pinned directory/descriptor identity, regular-file checks, size/JSON/hash limits and fail-closed errors remain.

Four isolated native regressions fail on the unchanged base and pass after repair: publication reopening for V1 and genuinely migrated V2 (DONE/SEALED -> IN_PROGRESS/REOPENED, followed by native begin), unrelated registration FIFO, and review receipt FIFO. FIFO tests use only disposable fixture roots, a bounded child, and verify the resource lock is free while that reader remains alive after rejection.

Full relevant Python checks: 696 PASS (49 control, 82 disk lifecycle, 76 queue, 60 board v2, 76 reader rollout, 3 migration, 349 publication, 1 publishing workflows). The original disk run exposed eight virtual-os fixture errors because its two fault-injection fixtures lacked O_NONBLOCK. Those fixtures gained the real flag; fault assertions remain. Original RED/failure logs are retained.

Evidence: /root/octoport-control/controllers/audits/CONTROLLER-4P2-TRUSTEDROOT-20261010T120000Z/RESUME_1030_NEW_P2_{RED,GREEN,FINAL_SUITE_RESULTS}.*

This is SOURCE and isolated native fixture evidence. Independent exact-candidate review, five exact push CI, main/installed application and safe installed readback remain required. No dangerous FIFO repro ran on the live registry. No RDC parser, protected Controller eligibility route, SOURCE-before-write, cold writer, cap or admission protection changed. API candidate a480bffb remains separate.
