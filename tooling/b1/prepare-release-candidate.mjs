#!/usr/bin/env node
/* global console, process */

import { resolve } from "node:path";
import { prepare } from "./release-lib.mjs";

function usage() {
  throw new Error(
    "Usage: prepare-release-candidate.mjs --authority <external.json> --out <candidate-dir> --chromium <zip> --firefox <zip>",
  );
}
try {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i],
      v = process.argv[i + 1];
    if (!k?.startsWith("--") || !v) usage();
    args[k.slice(2)] = v;
  }
  if (Object.keys(args).sort().join() !== "authority,chromium,firefox,out")
    usage();
  const result = prepare({
    authorityPath: resolve(args.authority),
    outputDir: resolve(args.out),
    chromium: resolve(args.chromium),
    firefox: resolve(args.firefox),
  });
  console.log(
    JSON.stringify({
      status: "PREPARED",
      ...result,
      productionMutation: "NOT_PERFORMED",
      externalAcceptance: "NOT_CLAIMED",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "FAIL",
      code: "RELEASE_CANDIDATE_PREPARATION_FAILED",
      reason: error.message,
      productionMutation: "NOT_PERFORMED",
    }),
  );
  process.exitCode = 1;
}
