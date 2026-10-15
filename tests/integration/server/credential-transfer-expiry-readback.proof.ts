import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseQuery,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferRepository } from "../../../packages/server/db/src/credential-transfer-repository.js";

/** Uses real repository/runtime/PG in a unique disposable schema. No live input. */
export async function proveExpiryReadback(connectionString: string) {
  const db = createDatabaseRuntime(connectionString);
  const schema = `c06_expiry_${randomUUID().replaceAll("-", "")}`;
  const beforeExpiry = new Date("2026-10-13T00:00:00.000Z");
  const atExpiry = new Date(beforeExpiry.getTime() + 60_000);
  const principal = {
    accountId: randomUUID(),
    deviceId: randomUUID(),
    sessionId: randomUUID(),
  };
  const sourceId = randomUUID();
  const checks: { name: string; passed: boolean; detail: unknown }[] = [];
  let owned = false;
  let cleanup = false;
  type Hooks = {
    before?: (sql: string) => Promise<void>;
    after?: (sql: string, rows: Record<string, unknown>[]) => Promise<void>;
  };
  type Isolation = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
  function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  async function bounded<T>(p: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), 7_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  function adapter(
    hooks: Hooks = {},
    isolation: Isolation = "READ COMMITTED",
  ): DatabaseRuntime {
    return {
      ...db,
      transaction: (action) =>
        db.transaction(async (tx) => {
          await tx.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
          await tx.query(`SET LOCAL search_path=${schema},pg_catalog`);
          await tx.query("SET LOCAL statement_timeout='5000ms'");
          await tx.query("SET LOCAL lock_timeout='4000ms'");
          await tx.query(
            "SET LOCAL idle_in_transaction_session_timeout='12000ms'",
          );
          const hooked: DatabaseQuery = {
            async query<T extends Record<string, unknown>>(
              text: string,
              values?: unknown[],
            ) {
              await hooks.before?.(text);
              const result = await tx.query<T>(text, values);
              await hooks.after?.(text, result.rows);
              return result;
            },
          };
          return action(hooked);
        }),
    };
  }
  function project(row: { state: string; revision: number } | undefined) {
    return row ? { state: row.state, revision: row.revision } : null;
  }
  async function durable(id: string) {
    const found = await db.query<{ state: string; revision: number }>(
      `SELECT state,revision FROM ${schema}.credential_transfer_requests WHERE request_id=$1`,
      [id],
    );
    return project(found.rows[0]);
  }
  function check(name: string, actual: unknown, expected: unknown) {
    checks.push({
      name,
      passed: JSON.stringify(actual) === JSON.stringify(expected),
      detail: { actual, expected },
    });
  }
  async function seed(state = "DELIVERED_TO_RECIPIENT") {
    const id = randomUUID();
    await db.query(
      `INSERT INTO ${schema}.credential_transfer_requests VALUES($1,$2,$3,$4,'SYNTHETIC_PUBLIC_KEY',ARRAY['synthetic-store'],$5,1,$6,$7)`,
      [
        id,
        principal.accountId,
        principal.deviceId,
        sourceId,
        state,
        beforeExpiry,
        atExpiry,
      ],
    );
    return id;
  }
  try {
    await db.ready();
    await db.query(`CREATE SCHEMA ${schema}`);
    owned = true;
    await db.query(`CREATE TABLE ${schema}.devices(id uuid PRIMARY KEY,account_id uuid NOT NULL,status text NOT NULL);
      CREATE TABLE ${schema}.credential_transfer_requests(request_id uuid PRIMARY KEY,account_id uuid NOT NULL,recipient_device_id uuid NOT NULL,source_device_id uuid,recipient_public_key_spki text NOT NULL,selected_store_ids text[] NOT NULL,state text NOT NULL,revision integer NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL)`);
    await db.query(
      `INSERT INTO ${schema}.devices VALUES($1,$2,'ACTIVE'),($3,$2,'ACTIVE')`,
      [principal.deviceId, principal.accountId, sourceId],
    );
    const repo = createCredentialTransferRepository(adapter());
    const id = await seed();
    check(
      "unexpired_control",
      project(await repo.read({ principal, requestId: id, now: beforeExpiry })),
      await durable(id),
    );
    const expired = await repo.read({
      principal,
      requestId: id,
      now: atExpiry,
    });
    assert.deepEqual(await durable(id), { state: "EXPIRED", revision: 2 });
    check(
      "first_expiry_returns_committed_revision",
      project(expired),
      await durable(id),
    );
    check(
      "second_expiry_does_not_increment_again",
      project(await repo.read({ principal, requestId: id, now: atExpiry })),
      { state: "EXPIRED", revision: 2 },
    );

    for (const scenario of [
      { kind: "ACK", isolation: "READ COMMITTED" },
      { kind: "CANCEL", isolation: "READ COMMITTED" },
      { kind: "EXPIRE", isolation: "READ COMMITTED" },
      { kind: "DELETE", isolation: "READ COMMITTED" },
      { kind: "ACK", isolation: "REPEATABLE READ" },
      { kind: "ACK", isolation: "SERIALIZABLE" },
    ] as const) {
      const requestId = await seed(
        scenario.kind === "CANCEL" ? "REQUESTED" : "DELIVERED_TO_RECIPIENT",
      );
      const mutationEntered = signal(),
        releaseMutation = signal(),
        readSelected = signal(),
        releaseRead = signal();
      let mutationPaused = false,
        readPaused = false,
        readerUpdates = 0;
      const mutator = createCredentialTransferRepository(
        adapter({
          before: async (sql) => {
            if (!mutationPaused && sql.startsWith("SELECT request_id")) {
              mutationPaused = true;
              mutationEntered.resolve();
              await bounded(releaseMutation.promise, "MUTATION_GATE_TIMEOUT");
            }
          },
        }),
      );
      const reader = createCredentialTransferRepository(
        adapter(
          {
            after: async (sql, rows) => {
              if (!readPaused && sql.startsWith("SELECT request_id")) {
                assert.equal(rows.length, 1);
                readPaused = true;
                readSelected.resolve();
                await bounded(releaseRead.promise, "READER_GATE_TIMEOUT");
              }
              if (sql.startsWith("UPDATE credential_transfer_requests"))
                readerUpdates++;
            },
          },
          scenario.isolation,
        ),
      );
      // ACK/cancel enter with a pre-expiry timestamp; the read sees the old row
      // before their commit, then continues its cleanup only after the commit.
      const mutating =
        scenario.kind === "ACK"
          ? mutator.acknowledge({
              principal,
              ack: {
                requestId,
                packetId: randomUUID(),
                importDecision: "IMPORTED",
              },
              now: beforeExpiry,
            })
          : scenario.kind === "CANCEL"
            ? mutator.cancel({ principal, requestId, now: beforeExpiry })
            : scenario.kind === "EXPIRE"
              ? mutator.read({ principal, requestId, now: atExpiry })
              : (async () => {
                  mutationEntered.resolve();
                  await bounded(releaseMutation.promise, "DELETE_GATE_TIMEOUT");
                  await db.query(
                    `DELETE FROM ${schema}.credential_transfer_requests WHERE request_id=$1`,
                    [requestId],
                  );
                  return undefined;
                })();
      const mutationOutcome = mutating.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: undefined, error }),
      );
      let readOutcome:
        | Promise<{
            value: Awaited<ReturnType<typeof reader.read>>;
            error: unknown;
          }>
        | undefined;
      try {
        await bounded(mutationEntered.promise, "MUTATION_NOT_ENTERED");
        readOutcome = reader.read({ principal, requestId, now: atExpiry }).then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: undefined, error }),
        );
        await bounded(readSelected.promise, "READ_NOT_SELECTED");
        releaseMutation.resolve();
        const mutation = await bounded(
          mutationOutcome,
          "MUTATION_DID_NOT_COMMIT",
        );
        assert.equal(mutation.error, null);
        const committed = await durable(requestId);
        const expected =
          scenario.kind === "DELETE"
            ? null
            : {
                state:
                  scenario.kind === "ACK"
                    ? "COMPLETED"
                    : scenario.kind === "CANCEL"
                      ? "CANCELLED"
                      : "EXPIRED",
                revision: 2,
              };
        assert.deepEqual(committed, expected);
        releaseRead.resolve();
        const read = await bounded(readOutcome, "READ_DID_NOT_FINISH");
        if (scenario.isolation === "READ COMMITTED") {
          assert.equal(read.error, null);
          assert.equal(readerUpdates, 1);
          check(
            `concurrent_${scenario.kind}_returns_authoritative_row`,
            project(read.value),
            committed,
          );
        } else {
          check(
            `${scenario.isolation}_serialization_conflict_not_retried`,
            (read.error as { code?: string } | null)?.code,
            "40001",
          );
        }
        assert.deepEqual(await durable(requestId), committed);
        check(
          `stable_read_after_${scenario.kind}_${scenario.isolation}`,
          project(await repo.read({ principal, requestId, now: atExpiry })),
          committed,
        );
      } finally {
        releaseMutation.resolve();
        releaseRead.resolve();
        await Promise.allSettled([
          mutationOutcome,
          ...(readOutcome ? [readOutcome] : []),
        ]);
      }
    }
  } finally {
    try {
      if (owned) {
        await db.query(`DROP SCHEMA ${schema} CASCADE`);
        const remaining = await db.query<{ n: string }>(
          "SELECT count(*) AS n FROM pg_namespace WHERE nspname=$1",
          [schema],
        );
        cleanup = remaining.rows[0]?.n === "0";
        assert.ok(cleanup, "OWN_SCHEMA_CLEANUP_NOT_VERIFIED");
      }
    } finally {
      await db.close();
    }
  }
  return {
    kind: "C06_EXPIRY_READBACK_REAL_RUNTIME_PG",
    at_utc: new Date().toISOString(),
    checks,
    passed: checks.filter((x) => x.passed).length,
    total: checks.length,
    cleanup,
    schema,
    limitations:
      "Exact repository and actual DatabaseRuntime/node-postgres; isolated minimal tables, not deployed API, migrated product schema, relay or epoch acceptance.",
  };
}
