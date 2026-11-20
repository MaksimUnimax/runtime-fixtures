"""Integer coin accounting shared by the product and the scoped gateway."""
import os
import re
from decimal import Decimal

UNIT = 10**12
MAX_BALANCE = 8_000_000 * UNIT
PRICING_SCHEMA = """CREATE TABLE IF NOT EXISTS coin_pricing (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), sale_bps INTEGER NOT NULL CHECK(sale_bps BETWEEN 0 AND 100000))"""
SCHEMA = (
    PRICING_SCHEMA,
    """CREATE TABLE IF NOT EXISTS coin_ruble_orders (
        operation_id TEXT PRIMARY KEY REFERENCES coin_orders ON DELETE CASCADE, fx_e4 INTEGER NOT NULL CHECK(fx_e4>0))""",
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
    """CREATE VIEW IF NOT EXISTS coin_wallet_balances AS
        SELECT workspace_id, granted-spent-held AS available, held FROM (
            SELECT w.workspace_id,
                (SELECT COALESCE(SUM(amount),0) FROM coin_grants g WHERE g.workspace_id=w.workspace_id) AS granted,
                COALESCE(SUM(o.spent),0) AS spent, COALESCE(SUM(CASE
                    WHEN o.operation_id IS NULL OR o.closed THEN 0
                    WHEN r.operation_id IS NULL THEN o.cap-o.spent
                    ELSE (SELECT COALESCE(SUM(a.bound),0) FROM coin_attempts a
                          WHERE a.operation_id=o.operation_id AND a.charge IS NULL) END),0) AS held
            FROM workspaces w LEFT JOIN coin_order_totals o USING(workspace_id)
            LEFT JOIN coin_ruble_orders r USING(operation_id) GROUP BY w.workspace_id)""",
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


def rub_rate():
    value = os.getenv("HARNESS_RUB_PER_USD", "81.9290")
    if not re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,4})?", value) or Decimal(value) <= 0:
        raise ValueError("Invalid RUB/USD rate")
    return int(Decimal(value) * 10000)


def sale_pricing(db):
    row = db.execute("SELECT sale_bps FROM coin_pricing WHERE singleton=1").fetchone()
    bps = row[0] if row else 2000
    return {"markupPercent": display(bps * UNIT // 100),
            "rubPerCoin": display((10000 + bps) * UNIT // 10000)}


def set_sale_pricing(db, percent):
    if not isinstance(percent, str) or not re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,2})?", percent):
        raise ValueError("Invalid sale markup")
    bps = int(Decimal(percent) * 100)
    if bps > 100000:
        raise ValueError("Invalid sale markup")
    db.execute("""INSERT INTO coin_pricing(singleton,sale_bps) VALUES(1,?)
        ON CONFLICT(singleton) DO UPDATE SET sale_bps=excluded.sale_bps""", (bps,))
    return sale_pricing(db)


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
    row = db.execute("SELECT available, held FROM coin_wallet_balances WHERE workspace_id=?", (workspace,)).fetchone()
    return tuple(row) if row else (0, 0)


class InsufficientCoins(PermissionError):
    pass


def reserve_order(db, workspace, operation, limit=None, *, free=False):
    close_orders(db, workspace)
    if db.execute("SELECT 1 FROM coin_orders WHERE operation_id=?", (operation,)).fetchone():
        return  # Native replay may read the result. The gateway refuses closed orders.
    if not free and balances(db, workspace)[0] <= 0:
        raise InsufficientCoins()
    # Only explicit limits from older clients constrain an operation. The gateway
    # reserves each provider attempt against the shared available balance.
    db.execute("INSERT INTO coin_orders(operation_id,workspace_id,cap,markup,coins_per_usd) VALUES(?,?,?,?,?)",
               (operation, workspace, 0 if free else (parse_amount(limit) if limit is not None else MAX_BALANCE), 0, 1))
    db.execute("INSERT INTO coin_ruble_orders(operation_id,fx_e4) VALUES(?,?)", (operation, rub_rate()))



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
