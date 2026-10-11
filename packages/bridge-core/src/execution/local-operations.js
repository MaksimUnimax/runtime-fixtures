(() => {
  "use strict";

  // Extracted from the accepted worker; one local flight owns a given key.
  // Errors clear the flight but do not execute a replacement operation.
  function singleFlight(map, key, fn) {
    if (map.has(key)) return map.get(key);
    const request = Promise.resolve()
      .then(fn)
      .finally(() => {
        if (map.get(key) === request) map.delete(key);
      });
    map.set(key, request);
    return request;
  }

  function createWriteQueue() {
    let tail = Promise.resolve();
    return Object.freeze({
      run(fn) {
        const next = tail.then(fn, fn);
        tail = next.catch(() => null);
        return next;
      },
    });
  }

  // A queue belongs to the whole storage map, not an individual dialogue.
  // Otherwise concurrent read/modify/write operations can erase each other.
  const recordWriters = new Set();
  function canonicalRecord(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonicalRecord);
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => [key, canonicalRecord(value[key])]));
  }
  function recordBytes(value) { return JSON.stringify(canonicalRecord(value)); }
  function createRecordStore({
    read,
    write,
    namespace,
    now = () => new Date().toISOString(),
    onCommitFailure = () => {},
    writerKey = null,
  }) {
    if (
      typeof read !== "function" ||
      typeof write !== "function" ||
      !namespace
    ) {
      throw new TypeError(
        "Local record storage ports and namespace are required",
      );
    }
    if (writerKey !== null) {
      if (typeof writerKey !== "string" || !writerKey) throw new TypeError("Invalid writer identity");
      if (recordWriters.has(writerKey)) throw Object.assign(new Error("RECORD_STORE_WRITER_ALREADY_REGISTERED"), { code: "RECORD_STORE_WRITER_ALREADY_REGISTERED" });
      recordWriters.add(writerKey);
    }
    const queue = createWriteQueue();
    let unavailable = null;
    function assertAvailable() { if (unavailable) throw unavailable; }
    function failStorage(stage) {
      unavailable = Object.assign(new Error("RECORD_STORE_COMMIT_UNCONFIRMED"), {
        code: "RECORD_STORE_COMMIT_UNCONFIRMED", stage,
      });
      // The in-memory barrier is immediate. Do not await cleanup under this writer.
      Promise.resolve().then(() => onCommitFailure(unavailable)).catch(() => null);
      return unavailable;
    }
    async function snapshot() {
      assertAvailable();
      try {
        const data = await read(namespace);
        if (!data || typeof data !== "object" || Array.isArray(data) ||
            (data[namespace] !== undefined && (!data[namespace] || typeof data[namespace] !== "object" || Array.isArray(data[namespace]))))
          throw new Error("Invalid record map");
        return data;
      } catch (_) { throw failStorage("read"); }
    }
    async function get(key) {
      const data = await snapshot();
      return (data[namespace] || {})[key] || null;
    }
    function mutate(key, mutator) {
      return queue.run(async () => {
        const data = await snapshot();
        const records = { ...(data[namespace] || {}) };
        const next = await mutator(records[key] || null);
        assertAvailable();
        if (next) records[key] = { ...next, updated_at: now() };
        else delete records[key];
        const expected = recordBytes(records);
        try { await write({ [namespace]: records }); }
        catch (_) { throw failStorage("write"); }
        let observed;
        try { observed = await read(namespace); }
        catch (_) { throw failStorage("readback"); }
        if (!observed || typeof observed !== "object" || Array.isArray(observed) ||
            !observed[namespace] || typeof observed[namespace] !== "object" || Array.isArray(observed[namespace]) ||
            recordBytes(observed[namespace]) !== expected) throw failStorage("readback");
        // Observed exact persistence, not a promise of fsync/power-loss durability.
        return records[key] || null;
      });
    }
    return Object.freeze({ get, mutate, withWrite: fn => queue.run(() => { assertAvailable(); return fn(); }) });
  }

  globalThis.SellerAgentsLocalOperations = Object.freeze({
    singleFlight,
    createWriteQueue,
    createRecordStore,
  });
})();
