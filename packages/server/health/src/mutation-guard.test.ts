import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mutationNames = [
  "publishProfileRevision",
  "startRollout",
  "changeRolloutPercentage",
  "pauseProfileRollout",
  "resumeProfileRollout",
  "completeRollout",
  "rollbackProfileAssignment",
];

describe("Health product mutation boundary", () => {
  it("keeps the Health admin/handoff module free of P7 mutation authority", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(resolve(here, "admin.ts"), "utf8");
    for (const mutation of mutationNames)
      expect(source).not.toContain(mutation);
  });
});
