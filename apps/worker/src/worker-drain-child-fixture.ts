import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { createWorker } from "./lifecycle.js";

let admissions = 0;
let active = 0;
let closed = 0;
let unhandled = 0;
process.on("unhandledRejection", () => {
  unhandled += 1;
});

const runner = new DeviceAuthorizationExpiryRunner(
  {
    expireDue: async () => {
      admissions += 1;
      if (admissions === 1) return 0;
      if (admissions === 2) {
        active += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        active -= 1;
        return 1;
      }
      throw new Error("synthetic scheduled failure with no emitted details");
    },
  },
  10,
);
const runtime = createWorker(
  {
    ready: async () => undefined,
    close: async () => {
      closed += 1;
    },
  },
  new CompositeJobRunner([runner]),
  { info: () => undefined },
);

await runtime.start();
let timeout!: NodeJS.Timeout;
const outcome = await Promise.race([
  runtime.completion,
  new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("CHILD_TIMEOUT")), 2_000);
  }),
]);
clearTimeout(timeout);
await new Promise((resolve) => setTimeout(resolve, 0));
process.stdout.write(
  JSON.stringify({
    outcome: outcome.state,
    admissions,
    active,
    closed,
    unhandled,
  }),
);
process.exitCode =
  outcome.state === "FAILED" &&
  admissions === 3 &&
  active === 0 &&
  closed === 1 &&
  unhandled === 0
    ? 1
    : 2;
