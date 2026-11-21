"""Resume a known failed inference stage without replaying the store request."""
import json
import os
import time

from .chat_connections import vault_cipher
from .hub_direct import Refused

SCHEMA = """CREATE TABLE IF NOT EXISTS hub_resume(
    operation_id TEXT PRIMARY KEY REFERENCES usage_operations ON DELETE CASCADE,
    snapshot TEXT NOT NULL, payload BLOB NOT NULL, expires INTEGER NOT NULL)"""


def scope_snapshot(db,op):
    return json.dumps([tuple(r) for r in db.execute("""SELECT i.id,i.version FROM usage_operations o
        JOIN chat_integrations a ON a.chat_id=o.chat_id JOIN account_integrations i
        ON i.id=a.connection_id AND i.workspace=o.workspace_id WHERE o.operation_id=? ORDER BY i.id""",(op,))])


def restore(db,op,snapshot,request):
    row=db.execute("SELECT snapshot,payload,expires FROM hub_resume WHERE operation_id=?",(op,)).fetchone()
    if not row: return request
    if row[0]!=snapshot or row[2]<=time.time():
        raise Refused("Подключения изменились или истёк срок продолжения")
    payload=row[1]
    return json.loads(vault_cipher().decrypt(payload[:12],payload[12:],op.encode()))


def save(db,op,snapshot,request):
    if scope_snapshot(db,op)!=snapshot: return
    safe={k:request[k] for k in ("messages","tools","max_tokens") if k in request}
    if safe["messages"][-1].get("role")=="tool":
        safe.pop("tools",None)
    persist(db,op,snapshot,safe)


def persist(db,op,snapshot,safe):
    nonce=os.urandom(12)
    blob=nonce+vault_cipher().encrypt(nonce,json.dumps(safe).encode(),op.encode())
    db.execute("DELETE FROM hub_resume WHERE expires<=unixepoch()")
    db.execute("INSERT OR REPLACE INTO hub_resume VALUES(?,?,?,?)",(op,snapshot,blob,int(time.time())+86400))
