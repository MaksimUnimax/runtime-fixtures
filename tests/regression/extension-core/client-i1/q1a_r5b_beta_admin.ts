import {
  createBetaAdmissionRepository,
  createDatabaseRuntime,
} from "@product/db";
import { BetaAdmissionService } from "@product/beta-access";

const databaseUrl = process.env.DATABASE_URL;
const actorPrincipalId = process.env.SA_R5B_ADMIN_PRINCIPAL_ID;
const requestId = process.env.SA_R5B_REQUEST_ID;
const amount = Number(process.env.SA_R5B_INCREMENT_AMOUNT ?? "1");
if (!databaseUrl || !actorPrincipalId || !requestId) {
  throw new Error(
    "DATABASE_URL, SA_R5B_ADMIN_PRINCIPAL_ID, and SA_R5B_REQUEST_ID are required",
  );
}

const database = createDatabaseRuntime(databaseUrl);
const service = new BetaAdmissionService(
  createBetaAdmissionRepository(database),
);
async function main() {
  try {
    const before = await service.read();
    const expectedRevision = Number(
      process.env.SA_R5B_EXPECTED_REVISION ?? before.revision,
    );
    const result = await service.mutate({
      actorPrincipalId,
      requestId,
      correlationId: `q1a-r5b-${requestId}`,
      expectedRevision,
      action: "ADD_CAPACITY",
      amount,
      reason: "Q1A-43 bounded synthetic capacity increment",
    });
    const after = await service.read();
    console.log(
      JSON.stringify({
        requestId,
        before: {
          capacity: before.capacity,
          admitted: before.admitted,
          remaining: before.remaining,
          revision: before.revision,
        },
        result:
          result.kind === "APPLIED"
            ? { kind: result.kind, replay: result.replay }
            : { kind: result.kind },
        after: {
          capacity: after.capacity,
          admitted: after.admitted,
          remaining: after.remaining,
          revision: after.revision,
        },
      }),
    );
    if (result.kind !== "APPLIED") process.exitCode = 1;
  } finally {
    await database.close();
  }
}

void main();
