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
      "tests/regression/extension-core/client-i1/transfer-fixture-lifecycle.test.ts",
      // Keep test-fixture cleanup faults in the normal server integration run.
      "tests/integration/server/helpers/credential-transfer-test-authority.test.ts",
      "tests/integration/server/helpers/credential-transfer-fixture-reset.test.ts",
    ],
  },
});
