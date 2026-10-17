#!/usr/bin/env node
/* global console, process */

import { resolve } from "node:path";
import { prepare } from "./release-lib.mjs";

function usage() {
  throw new Error(
    "Usage: prepare-release-candidate.mjs --authority <external.json> --out <candidate-dir> --chromium <zip> --firefox <zip> OR --authority <external.json> --out <candidate-dir> --chromium <zip> --channel chrome",
  );
}
try {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i],
      v = process.argv[i + 1];
    if (!k?.startsWith("--") || !v) usage();
    const key = k.slice(2);
    if (Object.hasOwn(args, key)) usage();
    args[key] = v;
  }
  const keys = Object.keys(args).sort().join();
  const chromiumOnly =
    keys === "authority,channel,chromium,out" && args.channel === "chrome";
  if (!chromiumOnly && keys !== "authority,chromium,firefox,out") usage();
  const result = prepare({
    authorityPath: resolve(args.authority),
    outputDir: resolve(args.out),
    chromium: resolve(args.chromium),
    ...(chromiumOnly ? {} : { firefox: resolve(args.firefox) }),
    chromiumOnly,
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
