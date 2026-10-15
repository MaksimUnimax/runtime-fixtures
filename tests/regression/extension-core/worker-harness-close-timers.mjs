import assert from "node:assert/strict";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { makeWorker } from "./worker-harness.mjs";

// A stopped MV3 worker cannot enqueue more timers. The synthetic fixture must
// enforce that lifecycle even when an already-running promise completes late.
const runtime = path.resolve(process.argv[2]);
const worker = await makeWorker(runtime);
try {
  await worker.call(
    "(function () { setTimeout(() => {}, 60000); return true; })",
  );
  assert.ok(
    worker.pendingTimerCount() >= 1,
    "live fixture must support timers",
  );

  worker.close();
  assert.equal(worker.pendingTimerCount(), 0, "close clears existing timers");

  const result = await worker.call(
    "(function () { setTimeout(() => {}, 60000); setInterval(() => {}, 60000); return true; })",
  );
  assert.equal(result, true);
  assert.equal(
    worker.pendingTimerCount(),
    0,
    "closed fixture must reject late timer and interval registrations",
  );
} finally {
  worker.close();
}
console.log(
  JSON.stringify({
    status: "PASS",
    cases: [
      "existing_timers_cleared",
      "late_timeout_rejected",
      "late_interval_rejected",
    ],
  }),
);
