// Keep evidence of an outgoing model turn across restarts, including uncertain outcomes.
import { createHash } from 'node:crypto';

export function modelDispatchStore(db, fail) {
  db.exec(`CREATE TABLE IF NOT EXISTS native_model_dispatch (
    scope_key TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
    operation_id TEXT NOT NULL, active_until INTEGER NOT NULL,
    PRIMARY KEY(scope_key, request_id)
  );
  CREATE INDEX IF NOT EXISTS native_model_active ON native_model_dispatch(scope_key, active_until);`);
  const lookup = db.prepare('SELECT * FROM native_model_dispatch WHERE scope_key=? AND request_id=?');
  const active = db.prepare('SELECT 1 FROM native_model_dispatch WHERE scope_key=? AND active_until>?');
  const insert = db.prepare('INSERT INTO native_model_dispatch VALUES (?,?,?,?,?)');
  const release = db.prepare('UPDATE native_model_dispatch SET active_until=0 WHERE scope_key=? AND request_id=?');
  const discard = db.prepare('DELETE FROM native_model_dispatch WHERE scope_key=? AND request_id=?');
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function check(key, req) {
    const row = lookup.get(key, req.requestId);
    if (row && (req.action !== 'turn' || row.input_hash !== digest(req.text))) fail('conflict');
    const now = Date.now();
    if (row && !(req.resumeHub && req.grant?.operationId===row.operation_id && row.active_until<=now)) fail(row.active_until > now ? 'busy' : 'turn_unconfirmed');
    if (active.get(key, now)) fail('busy');
  }
  return {
    atomic, check,
    operationId: (key, id) => lookup.get(key, id)?.operation_id,
    reserve(key, req) {
      check(key, req);
      if (req.deadline <= Date.now()) fail('busy');
      if (req.resumeHub) discard.run(key,req.requestId);
      insert.run(key, req.requestId, digest(req.text), req.grant.operationId, req.deadline);
    },
    release(key, id) { release.run(key, id); },
    discard(key, id) { discard.run(key, id); },
  };
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}
