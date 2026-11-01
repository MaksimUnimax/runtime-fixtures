import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, get } from "node:http";
import { test } from "node:test";
import {
  BOOTSTRAP_RESPONSE_ORDINAL_HEADER as HEADER,
  createBootstrapResponseLifecycle,
} from "./bootstrap-response-lifecycle.mjs";

function fakeReply() {
  const raw = new EventEmitter();
  raw.statusCode = 200;
  raw.writableFinished = false;
  const headers = {};
  return {
    raw,
    headers,
    header(name, value) {
      headers[name] = value;
    },
  };
}
test("fixed schema preserves exact response ordinal, not private values", () => {
  let time = 10;
  const snapshots = [];
  const observer = createBootstrapResponseLifecycle(
    (x) => snapshots.push(x),
    () => time,
  );
  const reply = fakeReply();
  Object.defineProperty(reply, "body", {
    get() {
      throw Error("SECRET");
    },
  });
  observer.attach(reply);
  time = 20;
  reply.raw.writableFinished = true;
  reply.raw.emit("finish");
  reply.raw.emit("close");
  const value = observer.snapshot();
  assert.equal(reply.headers[HEADER], value.run_id + ":1");
  assert.deepEqual(
    value.records[0].events.map((x) => x.phase),
    ["RECEIVED", "FINISH", "CLOSE"],
  );
  assert.equal(value.records[0].events[2].elapsed_ms, 10);
  assert.equal(value.records[0].events[2].writable_finished, true);
  assert.deepEqual(Object.keys(value).sort(), [
    "complete",
    "records",
    "run_id",
    "schema_version",
  ]);
  assert.ok(!JSON.stringify(value).includes("SECRET"));
  snapshots[0].records[0].events[0].phase = "SECRET";
  assert.equal(observer.snapshot().records[0].events[0].phase, "RECEIVED");
});
test("new process observation cannot reuse previous response identity", () => {
  const one = createBootstrapResponseLifecycle(() => {}).snapshot().run_id;
  const two = createBootstrapResponseLifecycle(() => {}).snapshot().run_id;
  assert.match(one, /^[0-9a-f]{32}$/);
  assert.notEqual(one, two);
});
test("overflow and evidence write errors are explicitly incomplete", () => {
  const observer = createBootstrapResponseLifecycle(() => {});
  for (let i = 0; i < 64; i++) observer.attach(fakeReply());
  const extra = fakeReply();
  observer.attach(extra);
  assert.equal(extra.headers[HEADER], undefined);
  assert.equal(observer.snapshot().complete, false);
  assert.equal(observer.snapshot().records.length, 64);
  const broken = createBootstrapResponseLifecycle(() => {
    throw Error("SECRET");
  });
  assert.doesNotThrow(() => broken.attach(fakeReply()));
  assert.equal(broken.snapshot().complete, false);
});
test("clock anomalies and raw invalid status never escape as unbounded data", () => {
  const observer = createBootstrapResponseLifecycle(
    () => {},
    () => NaN,
  );
  const reply = fakeReply();
  observer.attach(reply);
  reply.raw.statusCode = "SECRET";
  reply.raw.emit("close");
  const row = observer.snapshot().records[0].events[1];
  assert.equal(row.elapsed_ms, null);
  assert.equal(row.status, null);
  assert.equal(row.writable_finished, false);
});
async function httpCase(premature) {
  const observer = createBootstrapResponseLifecycle(() => {});
  const server = createServer((_request, response) => {
    observer.attach({
      raw: response,
      header: (name, value) => response.setHeader(name, value),
    });
    response.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": "2",
    });
    response.flushHeaders();
    if (premature) setImmediate(() => response.destroy());
    else response.end("OK");
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const header = await new Promise((resolve, reject) => {
      const req = get(
        { host: "127.0.0.1", port: server.address().port },
        (res) => {
          const value = res.headers[HEADER];
          res.once("end", () => resolve(value));
          res.once("error", () =>
            premature
              ? resolve(value)
              : reject(Error("unexpected body failure")),
          );
          res.resume();
        },
      );
      req.once("error", reject);
      req.setTimeout(2000, () => req.destroy(Error("fixture timeout")));
    });
    await new Promise((resolve) => setImmediate(resolve));
    const value = observer.snapshot();
    assert.equal(header, value.run_id + ":1");
    const events = value.records[0].events;
    assert.equal(
      events.some((x) => x.phase === "FINISH"),
      !premature,
    );
    assert.equal(events.at(-1).phase, "CLOSE");
    assert.equal(events.at(-1).writable_finished, !premature);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test(
  "real loopback response finish and close remain distinct",
  { timeout: 5000 },
  () => httpCase(false),
);
test("real premature response close has no finish", { timeout: 5000 }, () =>
  httpCase(true),
);
