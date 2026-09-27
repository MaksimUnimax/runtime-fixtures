import { createDatabaseRuntime } from "@product/db";
import {
  preflightMonitorPilotAuthorityForTest,
  reportMonitorPilotPreflightResult,
} from "../../../../tooling/server/monitor-pilot-authority.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const expectedDatabaseName = process.env.MONITOR_PILOT_TEST_DATABASE_NAME;
  const expectedDatabaseRole = process.env.MONITOR_PILOT_TEST_DATABASE_ROLE;

  if (!connectionString || !expectedDatabaseName || !expectedDatabaseRole) {
    throw new Error("MONITOR_PILOT_TEST_CLI_CONFIGURATION_REQUIRED");
  }

  const database = createDatabaseRuntime(connectionString);
  try {
    await database.ready();
    const result = await preflightMonitorPilotAuthorityForTest(database, {
      expectedDatabaseName,
      expectedDatabaseRole,
    });
    process.exitCode = reportMonitorPilotPreflightResult(result);
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "TEST_CLI_FAILED");
  process.exitCode = 1;
});
