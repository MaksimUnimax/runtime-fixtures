import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("native worker scheduled-failure drain", () => {
  it("waits for admitted work, closes once, and exits nonzero without unhandled rejection", async () => {
    const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/worker/src/worker-drain-child-fixture.ts"],
      {
        cwd,
        env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "";
    let overflow = false;
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (output.length + chunk.length > 8192) {
        overflow = true;
        child.kill("SIGKILL");
      } else output += chunk;
    });
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 3000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      // Wait for process termination AND stdout closure, including on timeout.
      child.once("close", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
    expect(timedOut).toBe(false);
    expect(overflow).toBe(false);
    expect(exit).toBe(1);
    expect(JSON.parse(output)).toEqual({
      outcome: "FAILED",
      admissions: 3,
      active: 0,
      closed: 1,
      unhandled: 0,
    });
  }, 10000);
});
