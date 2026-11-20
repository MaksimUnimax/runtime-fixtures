"""Operator reconciliation of a stopped, unresolved provider attempt against billing evidence."""
import argparse
import re
from decimal import Decimal
import sqlite3
from .coins import close_orders
from .operation_grants import _transaction


def resolve(path, attempt, usd, evidence):
    if not isinstance(usd, str) or not re.fullmatch(r"[0-9]{1,7}(?:\.[0-9]{1,12})?", usd):
        raise ValueError("Expected the provider-confirmed USD charge, to at most twelve decimal places")
    if not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 250:
        raise ValueError("A provider reconciliation reference is required")
    with _transaction(path) as db:
        row = db.execute("""SELECT o.workspace_id, o.operation_id, o.coins_per_usd, o.markup, a.bound,
                            a.charge, a.evidence FROM coin_attempts a JOIN coin_orders o USING(operation_id)
                            WHERE attempt_id=?""", (attempt,)).fetchone()
        if row is None:
            raise ValueError("Unknown attempt")
        workspace, operation, conversion, markup, bound, prior, original = row
        if db.execute("SELECT 1 FROM usage_grants WHERE operation_id=? AND expires_at>unixepoch()", (operation,)).fetchone():
            raise ValueError("Operation still active")
        raw = Decimal(usd) * 10**12 * conversion * (100+markup) / 100
        # Supported provider tariffs produce exact pico-coins. Do not silently round an adjustment.
        if raw != int(raw) or raw > bound:
            raise ValueError("Evidence is outside this reservation or currency precision")
        note = "review:" + evidence
        if prior is None:
            db.execute("UPDATE coin_attempts SET charge=?, evidence=? WHERE attempt_id=?", (int(raw), note, attempt))
        elif (prior, original) != (int(raw), note):
            raise ValueError("Attempt was settled with different evidence")
        close_orders(db, workspace)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("attempt")
    parser.add_argument("--confirmed-usd", required=True)
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()
    try:
        resolve(args.db, args.attempt, args.confirmed_usd, args.evidence)
    except (ValueError, sqlite3.Error) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
