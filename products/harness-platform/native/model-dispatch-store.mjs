// Keep evidence of an outgoing model turn across restarts, including uncertain outcomes.
import { createHash } from 'node:crypto';

export function modelDispatchStore(db, fail, checkParked) {
  db.exec(`CREATE TABLE IF NOT EXISTS native_model_dispatch (
    scope_key TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
    operation_id TEXT NOT NULL, active_until INTEGER NOT NULL,
    PRIMARY KEY(scope_key, request_id)
  );
  CREATE INDEX IF NOT EXISTS native_model_active ON native_model_dispatch(scope_key, active_until);`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(native_model_dispatch)').all().some(col=>col.name==='owner'))
      db.exec('ALTER TABLE native_model_dispatch ADD COLUMN owner TEXT');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const owner = req => digest(req.grant.token);
  const lookup = db.prepare('SELECT * FROM native_model_dispatch WHERE scope_key=? AND request_id=?');
  const active = db.prepare('SELECT 1 FROM native_model_dispatch WHERE scope_key=? AND active_until>?');
  const activeExcept=db.prepare('SELECT 1 FROM native_model_dispatch WHERE scope_key=? AND request_id!=? AND active_until>?');
  const insert = db.prepare('INSERT INTO native_model_dispatch(scope_key,request_id,input_hash,operation_id,active_until,owner) VALUES (?,?,?,?,?,?)');
  const extend = db.prepare('UPDATE native_model_dispatch SET active_until=? WHERE scope_key=? AND request_id=? AND active_until>0 AND owner=?');
  // Positive values are live leases. Zero is closed/uncertain; -1 records an explicit cancellation.
  const cancelled = -1;
  const restore = db.prepare('UPDATE native_model_dispatch SET active_until=?,owner=? WHERE scope_key=? AND request_id=?');
  const finish = db.prepare('UPDATE native_model_dispatch SET active_until=? WHERE scope_key=? AND request_id=? AND owner=?');
  const discard = db.prepare('DELETE FROM native_model_dispatch WHERE scope_key=? AND request_id=? AND owner=?');
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
    checkParked(req);
    const row = lookup.get(key, req.requestId);
    if (row && (req.action !== 'turn' || row.input_hash !== digest(req.inputKey ?? req.text))) fail('conflict');
    const now = Date.now();
    if (row?.active_until === cancelled) fail('model_wait_cancelled');
    if(req.restore){
      if(!row || row.operation_id!==req.grant?.operationId || activeExcept.get(key,req.requestId,now)) fail('conflict');
      if (row.owner===owner(req) && row.active_until>now) fail('busy');
      return;
    }
    if (row) fail(row.active_until > now ? 'busy' : 'turn_unconfirmed');
    if (active.get(key, now)) fail('busy');
  }
  return {
    atomic, check,
    operationId: (key, id) => lookup.get(key, id)?.operation_id,
    reserve(key, req) {
      check(key, req);
      if (req.deadline <= Date.now()) fail('busy');
      if(req.restore) restore.run(req.deadline,owner(req),key,req.requestId);
      else insert.run(key, req.requestId, digest(req.inputKey ?? req.text), req.grant.operationId, req.deadline,owner(req));
    },
    owns(key,req) { return lookup.get(key,req.requestId)?.owner===owner(req); },
    extend(key,req,deadline) { extend.run(deadline,key,req.requestId,owner(req)); },
    release(key,req) { finish.run(0,key,req.requestId,owner(req)); },
    cancel(key,req) { finish.run(cancelled,key,req.requestId,owner(req)); },
    discard(key,req) { discard.run(key,req.requestId,owner(req)); },
  };
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}
