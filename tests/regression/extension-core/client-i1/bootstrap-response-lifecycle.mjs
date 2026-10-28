import { randomUUID } from "node:crypto";

// Test-only response lifecycle. No URL, payload, headers, identity or error text is retained.
export const BOOTSTRAP_RESPONSE_ORDINAL_HEADER = "x-oct-i1-bootstrap-ordinal";

export function createBootstrapResponseLifecycle(
  write,
  now = () => performance.now(),
) {
  const records = [];
  const runId = randomUUID().replaceAll("-", "");
  let complete = true;
  const snapshot = () => ({
    schema_version: 1,
    run_id: runId,
    complete,
    records: records.map((row) => ({
      ordinal: row.ordinal,
      events: row.events.map((event) => ({ ...event })),
    })),
  });
  function publish() {
    try {
      write(snapshot());
    } catch {
      complete = false;
    }
  }
  return Object.freeze({
    attach(reply) {
      if (records.length >= 64) {
        complete = false;
        publish();
        return;
      }
      const row = { ordinal: records.length + 1, events: [] };
      records.push(row);
      const start = now();
      const observe = (phase) => {
        const delta = now() - start;
        const status = reply.raw.statusCode;
        row.events.push({
          phase,
          elapsed_ms:
            Number.isFinite(delta) && delta >= 0 && delta <= 180000
              ? Math.round(delta)
              : null,
          status:
            phase !== "RECEIVED" &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
              ? status
              : null,
          writable_finished:
            phase === "RECEIVED" ? null : reply.raw.writableFinished === true,
        });
        publish();
      };
      try {
        reply.header(
          BOOTSTRAP_RESPONSE_ORDINAL_HEADER,
          runId + ":" + row.ordinal,
        );
        reply.raw.once("finish", () => observe("FINISH"));
        reply.raw.once("close", () => observe("CLOSE"));
        observe("RECEIVED");
      } catch {
        complete = false;
        publish();
      }
    },
    snapshot,
  });
}
