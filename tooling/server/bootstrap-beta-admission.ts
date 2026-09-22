import { randomUUID } from "node:crypto";
import {
  bootstrapInitialBetaAdmission,
  createDatabaseRuntime,
} from "@product/db";
import { loadConfig } from "@product/shared";

const config = loadConfig(process.env);
const database = createDatabaseRuntime(config.databaseUrl);

try {
  const result = await bootstrapInitialBetaAdmission(database, {
    correlationId: randomUUID(),
    reason:
      "Initial production beta bootstrap for first verified owner account",
  });
  if (result.kind === "APPLIED") {
    console.log("INITIAL_BETA_BOOTSTRAP=PASS");
    console.log(`MODE=${result.state.mode}`);
    console.log(`CAPACITY=${result.state.capacity}`);
    console.log(`ADMITTED=${result.state.admitted}`);
    console.log(`REMAINING=${result.state.remaining}`);
    console.log(`REVISION=${result.state.revision}`);
  } else {
    console.log(`INITIAL_BETA_BOOTSTRAP=${result.kind}`);
    process.exitCode = result.kind === "BOOTSTRAP_CLOSED" ? 2 : 1;
  }
} finally {
  await database.close();
}
