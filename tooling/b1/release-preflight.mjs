#!/usr/bin/env node
/* global console, process */

import { resolve } from "node:path";
import { preflight } from "./release-lib.mjs";

try {
  if (process.argv.length !== 5 || process.argv[3] !== "--authority")
    throw new Error(
      "Usage: release-preflight.mjs <candidate-dir> --authority <external.json>",
    );
  const result = preflight({
    candidateDir: resolve(process.argv[2]),
    authorityPath: resolve(process.argv[4]),
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
