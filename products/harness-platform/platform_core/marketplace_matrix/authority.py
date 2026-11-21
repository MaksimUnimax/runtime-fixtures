"""Resolve matrix scope and credentials from the requesting Octoport chat."""
from dataclasses import asdict
from hashlib import sha256
from math import ceil
import sqlite3
import time
from pathlib import Path

from ..chat_connections import unseal
from ..operation_grants import extend_marketplace_wait, marketplace_deadline, renew_marketplace_grant, set_marketplace_window


class ChatAuthority:
    def __init__(self, packet):
        from semantics import fingerprint
        turn = packet["turn"]
        self.database_path = Path(turn["databasePath"])
        self.database = self.database_path.as_uri() + "?mode=ro"
        self.grant_hash = sha256(turn["token"].encode()).hexdigest()
        self.ids = tuple(sorted(packet["connections"]))
        self.pins = {"actor_id": packet["actor"], "tenant_id": packet["workspace"],
                     "chat_id": packet["chat"], "request_id": turn["requestId"]}
        self.resume_rate_limits = turn.get("resumeRateLimits") is True
        self.deadline_ms = (marketplace_deadline(self.database, self.grant_hash, turn["deadline"])
                            if self.resume_rate_limits else turn["deadline"])
        self.authority = self
        self.currencies = {}
        self.frozen = self._rows()
        self.revision = fingerprint([list(r[:4]) for r in self.frozen])
        self.names = {r[0]: r[2] for r in self.frozen}

    @property
    def deadline(self):
        return self.deadline_ms / 1000

    def report_progress(self):
        """Give a verified long report working time for its next operations."""
        from semantics import Rejected
        now = int(time.time() * 1000)
        if self.deadline_ms - now >= 90_000:
            return
        self.check()
        deadline = set_marketplace_window(self.database_path, self.grant_hash, self.deadline_ms,
                                           now + 120_000, None, now)
        if deadline is None:
            raise Rejected("PERMISSION_DENIED")
        self.deadline_ms = deadline

    def wait_for_provider(self, due):
        from semantics import Rejected

        self.check()
        now = int(time.time() * 1000)
        deadline = extend_marketplace_wait(self.database_path, self.grant_hash, self.deadline_ms, ceil(due * 1000), now)
        if deadline is None:
            raise Rejected("PERMISSION_DENIED")
        self.deadline_ms = deadline
        renew_at = time.monotonic() + 20
        while (remaining := due - time.time()) > 0:
            time.sleep(min(5, remaining))
            self.check()
            if time.monotonic() >= renew_at:
                if not renew_marketplace_grant(self.database_path, self.grant_hash, int(time.time())):
                    raise Rejected("PERMISSION_DENIED")
                renew_at = time.monotonic() + 20

    def _rows(self, credential_id=None):
        from semantics import Rejected
        if not self.ids or time.time() >= self.deadline:
            raise Rejected("PERMISSION_DENIED")
        # The same query verifies the live turn, current chat grants and workspace
        # ownership. The vault value is selected only at credential resolution.
        now = int(time.time())
        args = (credential_id, self.grant_hash, now, now, self.pins["request_id"],
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
                LEFT JOIN marketplace_retry_windows r ON r.token_hash=g.token_hash
                LEFT JOIN identity_sessions s ON s.digest=r.session_digest AND s.actor_id=o.actor_id
                WHERE g.token_hash=? AND g.expires_at>? AND (r.session_digest IS NULL OR s.expires_at>?)
                  AND o.source='chat.turn' AND o.run_key=?
                  AND o.actor_id=? AND o.workspace_id=? AND c.chat_id=? AND i.provider IN ('ozon','wb')
                  AND EXISTS(SELECT 1 FROM chat_plugins p WHERE p.workspace_id=w.workspace_id
                        AND p.chat_id=c.chat_id AND p.plugin_id=CASE i.provider WHEN 'wb' THEN 'wildberries' ELSE 'ozon' END)
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

    def saved_ozon_coefficients(self, cid):
        from semantics import Rejected
        if not any(row[0] == cid and row[1] == "ozon" for row in self.check()):
            raise Rejected("PERMISSION_DENIED")
        with sqlite3.connect(self.database, uri=True) as db:
            return db.execute("""SELECT sku,metric,value,source,since,until,revision
                FROM user_plugin_values WHERE plugin='ozon' AND cid=? ORDER BY sku,metric""", (cid,)).fetchall()

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
