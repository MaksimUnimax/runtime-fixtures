import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { ReadableStream } from "node:stream/web";
import { clearTimeout, setTimeout } from "node:timers";
import { acquireOfficialSource } from "./dist/index.js";

const { Response } = globalThis;

const entry = {
  sourceFamily: "OZON_SELLER",
  officialUrl: "https://docs.ozon.ru/spec.json",
  expectedArtifactTypes: ["JSON"],
  maximumBytes: 1024 * 1024,
  acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
  operatorAcceptancePolicy: "DETERMINISTIC",
};

let requests = 0;
let cancelled = 0;
let latestSignal = null;
let watchdogId;
const started = Date.now();
try {
  const outcome = await Promise.race([
    acquireOfficialSource({
      entry,
      timeoutMs: 35,
      fetcher: async (_url, init) => {
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "manual");
        assert.ok(init.signal);
        latestSignal = init.signal;
        requests++;
        assert.equal(
          requests,
          1,
          "A stalled redirect must not trigger another request",
        );
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
              return new Promise(() => undefined);
            },
          }),
          { status: 307, headers: { location: "/next.json" } },
        );
      },
    }),
    new Promise((resolve) => {
      watchdogId = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 250);
    }),
  ]);
  assert.notEqual(outcome, "WATCHDOG_EXPIRED");
  assert.equal(outcome.kind, "SOURCE_TEMPORARILY_UNAVAILABLE");
  assert.equal(requests, 1);
  assert.equal(cancelled, 1);
  assert.equal(latestSignal?.aborted, true);
  assert.ok(Date.now() - started < 250);
} finally {
  if (watchdogId) clearTimeout(watchdogId);
}

const openapi = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Synthetic", version: "1.0.0" },
  paths: {
    "/synthetic": {
      get: { responses: { 200: { description: "ok" } } },
    },
  },
});
let normalRequests = 0;
let normalCancels = 0;
const success = await acquireOfficialSource({
  entry,
  timeoutMs: 200,
  fetcher: async (_url, init) => {
    assert.ok(init?.signal);
    normalRequests++;
    if (normalRequests === 1)
      return new Response(
        new ReadableStream({
          cancel() {
            normalCancels++;
          },
        }),
        { status: 307, headers: { location: "/next.json" } },
      );
    assert.equal(normalRequests, 2);
    return new Response(openapi, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
assert.equal(success.kind, "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
assert.equal(normalRequests, 2);
assert.equal(normalCancels, 1);
assert.equal(success.bytes?.byteLength, Buffer.byteLength(openapi));

console.log(
  JSON.stringify({
    status: "PASS",
    boundary: "NODE24_BUILT_ESM_WITH_BUNDLED_PRIVATE_WORKSPACE_DEPENDENCY",
    cases: ["never_settling_redirect_cancel", "normal_redirect_to_openapi"],
    timeoutRequests: requests,
    normalRequests,
    providerRequests: 0,
    compiledArtifact: true,
  }),
);
