import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { test } from "node:test";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test(
  "native package generator completes without SQL or history changes",
  { timeout: 40_000 },
  () => {
    const dbDirectory = fileURLToPath(new URL("../", import.meta.url));
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "octoport-b01-schema-generate-"),
    );
    const fixtureDrizzle = path.join(temporary, "drizzle");
    const files = (directory, prefix = "") => {
      const result = {};
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(prefix, entry.name);
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) Object.assign(result, files(file, name));
        else result[name] = digest(fs.readFileSync(file));
      }
      return result;
    };
    try {
      fs.cpSync(path.join(dbDirectory, "drizzle"), fixtureDrizzle, {
        recursive: true,
      });
      fs.symlinkSync(
        path.join(dbDirectory, "node_modules"),
        path.join(temporary, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const config = path.join(temporary, "drizzle.config.ts");
      fs.writeFileSync(
        config,
        'import { defineConfig } from "drizzle-kit";\n' +
          'export default defineConfig({dialect: "postgresql", schema: ' +
          JSON.stringify(
            fileURLToPath(new URL("./schema.ts", import.meta.url)),
          ) +
          ", out: " +
          JSON.stringify(path.relative(dbDirectory, fixtureDrizzle)) +
          "});\n",
      );
      const before = files(fixtureDrizzle);
      const environment = {
        ...process.env,
        PATH:
          path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      };
      delete environment.DATABASE_URL;
      delete environment.PGPASSWORD;
      const command = spawnSync(
        "pnpm",
        ["run", "db:generate", "--config=" + config],
        {
          cwd: dbDirectory,
          env: environment,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      );
      assert.equal(command.error, undefined, command.stderr);
      assert.equal(command.status, 0, command.stderr);
      // The kit may print a loader error yet exit0; actual completion is required.
      assert.ok(
        command.stdout.includes("No schema changes, nothing to migrate"),
        command.stdout + command.stderr,
      );
      assert.deepEqual(files(fixtureDrizzle), before);
    } finally {
      fs.rmSync(temporary, { recursive: true });
    }
    assert.equal(fs.existsSync(temporary), false);
  },
);
