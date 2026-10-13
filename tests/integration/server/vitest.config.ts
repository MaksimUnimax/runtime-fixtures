import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites deliberately reset one disposable database.  Keeping
    // files sequential also makes the concurrency assertions meaningful.
    fileParallelism: false,
    include: [
      "packages/server/db/src/**/*.integration.test.ts",
      "tests/integration/server/**/*.integration.test.ts",
      "tests/integration/server/credential-transfer-reset-compatibility.test.ts",
    ],
  },
});
