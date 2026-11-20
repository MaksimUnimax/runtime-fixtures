"""Integer coin accounting shared by the product and the scoped gateway."""
import os
import re

UNIT = 10**12
MAX_BALANCE = 8_000_000 * UNIT
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS coin_grants (
        issuer TEXT NOT NULL, key TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces,
        amount INTEGER NOT NULL CHECK(amount>0), reason TEXT NOT NULL,
        created INTEGER NOT NULL DEFAULT(unixepoch()), PRIMARY KEY(issuer,key))""",
    """CREATE TABLE IF NOT EXISTS coin_orders (
        operation_id TEXT PRIMARY KEY REFERENCES usage_operations, workspace_id TEXT NOT NULL REFERENCES workspaces,
        cap INTEGER NOT NULL, markup INTEGER NOT NULL, coins_per_usd INTEGER NOT NULL,
        budget_hit INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT(unixepoch()))""",
    """CREATE TABLE IF NOT EXISTS coin_attempts (
        attempt_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES coin_orders, bound INTEGER NOT NULL,
        charge INTEGER, model TEXT NOT NULL, started_ms INTEGER NOT NULL, rate_version TEXT NOT NULL,
        period TEXT NOT NULL, provider_id TEXT, usage_json TEXT, evidence TEXT)""",
    "CREATE INDEX IF NOT EXISTS coin_grants_wallet ON coin_grants(workspace_id)",
    "CREATE INDEX IF NOT EXISTS coin_orders_wallet ON coin_orders(workspace_id)",
    "CREATE INDEX IF NOT EXISTS coin_attempts_order ON coin_attempts(operation_id)",
    """CREATE VIEW IF NOT EXISTS coin_order_totals AS SELECT o.*,
        COALESCE((SELECT SUM(a.charge) FROM coin_attempts a WHERE a.operation_id=o.operation_id),0) AS spent
        FROM coin_orders o""",
)


def parse_amount(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,7}(?:\.[0-9]{1,12})?", value):
        raise ValueError("Expected a positive decimal coin amount")
    whole, _, fraction = value.partition(".")
    amount = int(whole) * UNIT + int(fraction.ljust(12, "0"))
    if not 0 < amount <= MAX_BALANCE:
        raise ValueError("Coin amount out of range")
    return amount


def display(amount):
    whole, fraction = divmod(amount, UNIT)
    return f"{whole}.{fraction:012d}".rstrip("0").rstrip(".")


def policy():
    cap = parse_amount(os.getenv("HARNESS_TURN_COINS", "2"))
    markup = int(os.getenv("HARNESS_MARKUP_PERCENT", "20"))
    conversion = int(os.getenv("HARNESS_COINS_PER_USD", "1"))
    if not 0 <= markup <= 1000 or not 1 <= conversion <= 10000:
        raise ValueError("Invalid coin policy")
    return cap, markup, conversion


def close_orders(db, workspace=None):
    # Run in the same write transaction as issuance, wallet reads or revocation.
    # An interrupted gateway leaves its pending attempt reserved across restarts.
    db.execute("""UPDATE coin_orders AS o SET closed=1 WHERE closed=0
        AND (? IS NULL OR workspace_id=?)
        AND NOT EXISTS(SELECT 1 FROM usage_grants g WHERE g.operation_id=o.operation_id AND expires_at>unixepoch())
        AND NOT EXISTS(SELECT 1 FROM coin_attempts a WHERE a.operation_id=o.operation_id AND charge IS NULL)
        AND EXISTS(SELECT 1 FROM coin_attempts a WHERE a.operation_id=o.operation_id)""", (workspace, workspace))
    db.execute("""DELETE FROM coin_orders AS o WHERE closed=0 AND (? IS NULL OR workspace_id=?)
        AND NOT EXISTS(SELECT 1 FROM usage_grants g WHERE g.operation_id=o.operation_id AND expires_at>unixepoch())
        AND NOT EXISTS(SELECT 1 FROM coin_attempts a WHERE a.operation_id=o.operation_id)""", (workspace, workspace))


def balances(db, workspace):
    granted, = db.execute("SELECT COALESCE(SUM(amount),0) FROM coin_grants WHERE workspace_id=?", (workspace,)).fetchone()
    spent, hold = db.execute("""SELECT COALESCE(SUM(spent),0), COALESCE(SUM(CASE WHEN closed=0 THEN cap-spent ELSE 0 END),0)
        FROM coin_order_totals WHERE workspace_id=?""", (workspace,)).fetchone()
    return granted - spent - hold, hold


class InsufficientCoins(PermissionError):
    pass


def reserve_order(db, workspace, operation, limit=None):
    close_orders(db, workspace)
    if db.execute("SELECT 1 FROM coin_orders WHERE operation_id=?", (operation,)).fetchone():
        return  # Native replay may read the result. The gateway refuses closed orders.
    cap, markup, conversion = policy()
    if limit is not None:
        requested = parse_amount(limit)
        if requested > cap:
            raise ValueError("Turn limit exceeds the configured maximum")
        cap = requested
    if balances(db, workspace)[0] < cap:
        raise InsufficientCoins()
    db.execute("INSERT INTO coin_orders(operation_id,workspace_id,cap,markup,coins_per_usd) VALUES(?,?,?,?,?)",
               (operation, workspace, cap, markup, conversion))


def grant(db, issuer, key, workspace, value, reason):
    amount = parse_amount(value)
    if (not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", key)
            or not isinstance(reason, str) or not reason.strip() or len(reason) > 256):
        raise ValueError("Invalid grant reference or reason")
    old = db.execute("SELECT workspace_id,amount,reason FROM coin_grants WHERE issuer=? AND key=?",
                     (issuer, key)).fetchone()
    if old:
        if tuple(old) != (workspace, amount, reason):
            raise ValueError("Grant key already used with different parameters")
        return
    total, = db.execute("SELECT COALESCE(SUM(amount),0) FROM coin_grants WHERE workspace_id=?", (workspace,)).fetchone()
    if total > MAX_BALANCE - amount:
        raise ValueError("Wallet limit exceeded")
    db.execute("INSERT INTO coin_grants(issuer,key,workspace_id,amount,reason) VALUES(?,?,?,?,?)",
               (issuer, key, workspace, amount, reason))
    db.execute("INSERT OR IGNORE INTO workspace_paid_model_access(workspace_id) VALUES(?)", (workspace,))
