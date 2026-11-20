"""Resolve matrix scope and credentials from the requesting Octoport chat."""
from dataclasses import asdict
from hashlib import sha256
import sqlite3
import time
from pathlib import Path

from ..chat_connections import unseal


class ChatAuthority:
    def __init__(self, packet):
        from semantics import fingerprint
        turn = packet["turn"]
        self.database = Path(turn["databasePath"]).as_uri() + "?mode=ro"
        self.grant_hash = sha256(turn["token"].encode()).hexdigest()
        self.ids = tuple(sorted(packet["connections"]))
        self.pins = {"actor_id": packet["actor"], "tenant_id": packet["workspace"],
                     "chat_id": packet["chat"], "request_id": turn["requestId"]}
        self.deadline = turn["deadline"] / 1000
        self.authority = self
        self.currencies = {}
        self.frozen = self._rows()
        self.revision = fingerprint([list(r[:4]) for r in self.frozen])
        self.names = {r[0]: r[2] for r in self.frozen}

    def _rows(self, credential_id=None):
        from semantics import Rejected
        if not self.ids or time.time() >= self.deadline:
            raise Rejected("PERMISSION_DENIED")
        # The same query verifies the live turn, current chat grants and workspace
        # ownership. The vault value is selected only at credential resolution.
        args = (credential_id, self.grant_hash, int(time.time()), self.pins["request_id"],
                self.pins["actor_id"], self.pins["tenant_id"], self.pins["chat_id"], *self.ids)
        db = sqlite3.connect(self.database, uri=True)
        try:
            rows = db.execute("""
                SELECT i.id,i.provider,i.name,i.version,CASE WHEN i.id=? THEN i.encrypted END
                FROM usage_grants g JOIN usage_operations o USING(operation_id)
                JOIN workspaces w ON w.workspace_id=o.workspace_id AND w.owner_id=o.actor_id
                JOIN chats c ON c.chat_id=o.chat_id AND c.workspace_id=w.workspace_id
                JOIN chat_integrations a ON a.chat_id=c.chat_id
                JOIN account_integrations i ON i.id=a.connection_id AND i.workspace=w.workspace_id
                WHERE g.token_hash=? AND g.expires_at>? AND o.source='chat.turn' AND o.run_key=?
                  AND o.actor_id=? AND o.workspace_id=? AND c.chat_id=? AND i.provider IN ('ozon','wb')
                  AND i.id IN (""" + ",".join("?" for _ in self.ids) + ") ORDER BY i.id", args).fetchall()
        finally:
            db.close()
        if tuple(row[0] for row in rows) != self.ids:
            raise Rejected("PERMISSION_DENIED")
        return rows

    def check(self, credential_id=None):
        from semantics import Rejected
        rows = self._rows(credential_id)
        if [r[:4] for r in rows] != [r[:4] for r in self.frozen]:
            raise Rejected("PERMISSION_DENIED")
        return rows

    def store(self, row):
        from semantics import Store
        cid, provider, _, version, _ = row
        return Store(cid, provider, cid, str(version), "platform:octoport:" + str(version), self.currencies.get(cid))

    def scope_for(self, guard):
        from semantics import Rejected, Scope
        if guard != {"pins": self.pins}:
            raise Rejected("PERMISSION_DENIED")
        return Scope(self.pins["tenant_id"], self.revision, tuple(self.store(row) for row in self.check()))

    def field_names(self, store):
        return set(self.credentials(self.pins, asdict(store)))

    def credentials(self, pins, store):
        from semantics import Rejected
        if pins != self.pins or store["id"] not in self.ids:
            raise Rejected("PERMISSION_DENIED")
        row = next(r for r in self.check(store["id"]) if r[0] == store["id"])
        if asdict(self.store(row)) != store:
            raise Rejected("PERMISSION_DENIED")
        fields = unseal(self.pins["tenant_id"], row[1], row[0], row[4])
        aliases = {"token": "seller_token", "api_key": "seller_api_key", "client_id": "seller_client_id",
                   "performance_id": "performance_client_id", "performance_secret": "performance_client_secret"}
        return {aliases[k]: value for k, value in fields.items() if k in aliases}
