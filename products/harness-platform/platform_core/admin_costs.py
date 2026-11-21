"""Read verified model estimates for admin chat responses, using the same rules as the operator CLI."""

from decimal import DecimalException, localcontext
import os
from pathlib import Path
from threading import Lock

from .usage_reconciliation import attribution_summary, index_journal, operation_key, read_tariffs


def _version(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


class AdminCosts:
    def __init__(self):
        directory = Path(os.environ.get("LAB_USAGE_DIR", "/var/lib/harness-native-lab/meter"))
        self.journal = Path(os.environ.get("HARNESS_USAGE_JOURNAL", directory / "model-attempts.jsonl"))
        self.tariffs = Path(__file__).resolve().parents[1] / "usage-reconciliation" / "tariffs.json"
        self._lock = Lock()
        self._version = None
        self._rows = {}

    def for_operations(self, workspace, ids):
        # The caller supplies only IDs already emitted by the authorized chat worker.
        with self._lock:
            try:
                version = _version(self.journal), _version(self.tariffs)
                if version != self._version:
                    with localcontext() as context:
                        context.prec = 256
                        tariffs = read_tariffs(self.tariffs)
                        claims = {}
                        attempts, _ = index_journal(self.journal, operation_claims=claims)
                        # A disputed attempt can refer to the same turn as other valid attempts.
                        uncertain = {op for attempt, ops in claims.items()
                                     if operation_key(attempts[attempt])[1] for op in ops}
                        report = attribution_summary(attempts, tariffs)
                    if version != (_version(self.journal), _version(self.tariffs)):
                        return {}  # A later read can use a consistent snapshot.
                    self._rows = {
                        (row["workspace_id"], row["operation_id"]): {
                            "rub": row["total_rub"], "usd": row["total_usd"],
                        }
                        for row in report["operations"]
                        if row["source"] == "chat.turn" and row["operation_id"] not in uncertain
                    }
                    self._version = version
                return {key: self._rows[(workspace, key)] for key in ids if (workspace, key) in self._rows}
            except (OSError, ValueError, DecimalException, RecursionError):
                # Cost visibility must not interrupt or replay an already completed chat turn.
                return {}


def present_chat(identity, costs, token, scope, action, result):
    """Drop private fields by default. Public event payloads already use an allowlist."""
    if action == "events":
        result.pop("adminCosts", None)
        messages = result["messages"]
    elif action == "history":
        messages = result
    else:
        messages = [result]
    # Capture server-produced references, then strip them from the public representation.
    references = []
    for message in messages:
        message.pop("modelCost", None)
        message.pop("modelUsage", None)
        operation = message.pop("operationId", None)
        if operation is not None:
            references.append((message, operation))
    images = [(m, op) for m, op in references if m.get("role") == "assistant"]
    if images:
        with identity._lock:
            if identity._db.execute("SELECT 1 FROM sqlite_master WHERE name='plugin_illustrations'").fetchone():
                for message,key in images:
                    row=identity._db.execute("SELECT id FROM plugin_illustrations WHERE operation_id=? AND chat=? AND content IS NOT NULL",
                                             (key,scope.chat_id)).fetchone()
                    if row:
                        message["illustration"]="/api/chats/"+scope.chat_id+"/illustrations/"+row[0]
    if not identity.can_view_costs(token, scope):
        return result
    if references:
        ids = {key for _, key in references}
        receipts = identity.chat_receipts(scope, ids)
        rows = costs.for_operations(scope.workspace_id, ids)
        if not identity.can_view_costs(token, scope):
            return result
        for message, key in references:
            if key in receipts:
                message["modelUsage"] = receipts[key]
            message["operationId"] = key
            message["modelCost"] = rows.get(key, {"rub": None, "usd": None})
    if action == "events":
        result["adminCosts"] = True
    return result
