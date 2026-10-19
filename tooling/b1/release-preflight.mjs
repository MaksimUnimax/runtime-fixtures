#!/usr/bin/env node
/* global console, process */

import { resolve } from "node:path";
import { preflight } from "./release-lib.mjs";

try {
  const channel =
    process.argv.length === 7 && process.argv[5] === "--channel"
      ? process.argv[6]
      : null;
  const chromiumOnly = channel === "chrome";
  const firefoxOnly = channel === "firefox";
  if (
    process.argv[3] !== "--authority" ||
    (process.argv.length !== 5 &&
      !(process.argv.length === 7 && (chromiumOnly || firefoxOnly)))
  ) {
    throw new Error(
      "Usage: release-preflight.mjs <candidate-dir> --authority <external.json> [--channel chrome|firefox]",
    );
  }
  const result = preflight({
    candidateDir: resolve(process.argv[2]),
    authorityPath: resolve(process.argv[4]),
    chromiumOnly,
    firefoxOnly,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      code: "RELEASE_PREFLIGHT_FAILED",
      reason: error.message,
      productionMutation: "NOT_PERFORMED",
    }),
  );
  process.exitCode = 1;
}
