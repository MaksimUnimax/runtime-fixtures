"""Carry one trusted matrix packet to the existing marketplace confirmation check."""
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256
import json


_scheduled = ContextVar("timer_matrix_request", default=None)


@contextmanager
def matrix_request(packet):
    turn = packet.get("turn") or {}
    active = (turn.get("requestId","").startswith("timer.run.")
              and (packet.get("readTemplate") or {}).get("action")=="edit")
    token = _scheduled.set(packet if active else None)
    try:
        yield
    finally:
        _scheduled.reset(token)


def authorized_occurrence(db,workspace,chat,plugin):
    packet = _scheduled.get()
    if packet is None:
        return False
    turn,args = packet["turn"],packet["readTemplate"]
    run = turn["requestId"].removeprefix("timer.run.")
    row = db.execute("""SELECT r.write_args,i.provider FROM timer_runs r JOIN timer_events e ON e.id=r.event
        JOIN usage_operations o ON o.workspace_id=e.workspace AND o.chat_id=e.chat
        JOIN usage_grants g ON g.operation_id=o.operation_id JOIN workspaces w ON w.workspace_id=e.workspace
        JOIN account_integrations i ON i.workspace=e.workspace AND i.id=?
        WHERE r.id=? AND r.state='writing' AND r.revision=e.revision AND e.status='active' AND e.kind='action'
        AND e.workspace=? AND e.chat=? AND o.source='chat.turn' AND o.run_key=? AND g.token_hash=?
        AND g.expires_at>unixepoch() AND w.owner_id=o.actor_id AND o.actor_id=?
        AND EXISTS(SELECT 1 FROM chat_plugins p WHERE p.workspace_id=e.workspace AND p.chat_id=e.chat
                   AND p.plugin_id='timer')""",(args["connectionId"],run,workspace,chat,turn["requestId"],
                   sha256(turn["token"].encode()).hexdigest(),packet["actor"])).fetchone()
    if (not row or json.loads(row[0])!=args or {"ozon":"ozon","wb":"wildberries"}.get(row[1])!=plugin
            or packet["workspace"]!=workspace or packet["chat"]!=chat):
        raise PermissionError("Поручение не разрешает это изменение.")
    # Called inside the matrix writer transaction, after its ordinary input validation.
    if not db.execute("UPDATE timer_runs SET state='dispatching' WHERE id=? AND state='writing'",(run,)).rowcount:
        raise PermissionError("Запуск уже использован.")
    return True
